import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type WorkoutExercise, type WorkoutSet } from './db'
import { importSeedIfNeeded } from './seed'
import {
  addSet,
  cancelWorkout,
  finishWorkout,
  getActiveWorkout,
  parseDuration,
  parseNumber,
  previousSets,
  removeLastSet,
  startWorkout,
  toggleSetDone,
} from './workout'

const USER = 'u1'
let day1 = '' // resolved in beforeEach
let day2 = ''

async function setsOf(workoutId: string) {
  const wes = (await db.workout_exercise.where('workout_id').equals(workoutId).toArray()).sort((a, b) => a.position - b.position)
  const exercises = new Map((await db.exercise.toArray()).map((e) => [e.id, e]))
  const out: Record<string, { we: WorkoutExercise; sets: WorkoutSet[] }> = {}
  for (const we of wes) {
    const sets = (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray()).sort((a, b) => a.position - b.position)
    out[exercises.get(we.exercise_id)!.name] = { we, sets }
  }
  return out
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
  const templates = await db.template.toArray()
  day1 = templates.find((t) => t.name === 'DAY1')!.id
  day2 = templates.find((t) => t.name === 'DAY2')!.id
})

describe('startWorkout', () => {
  it('copies the template and prefills the last performance per set', async () => {
    const w = await startWorkout(day2, USER)
    expect(await getActiveWorkout()).toMatchObject({ id: w.id, template_name_snapshot: 'DAY2' })
    const s = await setsOf(w.id)
    // DAY2 history 2 Oct: Lying Leg Curl 35/35/30 kg x 10
    expect(s['Lying Leg Curl (Machine)']!.sets.map((x) => x.weight)).toEqual([35, 35, 30])
    // Unilateral: Lateral Raise 2 Oct sets R/L = 10/10, 8/10, 8/7
    expect(s['Lateral Raise (Cable)']!.sets.map((x) => [x.reps_left, x.reps_right])).toEqual([
      [10, 10],
      [10, 8],
      [7, 8],
    ])
    // Bicycle: duration 7 min
    expect(s['Bicycle']!.sets[0]!.duration_s).toBe(420)
    expect(Object.values(s).flatMap((x) => x.sets).every((x) => x.completed_at === null)).toBe(true)
  })

  it('falls back to template targets without history', async () => {
    const run = (await db.template.toArray()).find((t) => t.name === 'Lauf')!
    const w = await startWorkout(run.id, USER)
    const s = await setsOf(w.id)
    expect(s['Laufen']!.sets[0]).toMatchObject({ distance_km: 7, duration_s: null })
  })

  it('uses the latest finished workout of the same variant', async () => {
    const w1 = await startWorkout(day1, USER)
    const s1 = await setsOf(w1.id)
    const chest = s1['Griffe Mitte Brust']!
    await db.workout_set.update(chest.sets[0]!.id, { weight: 32.5 })
    await toggleSetDone({ ...chest.sets[0]!, weight: 32.5 })
    await finishWorkout(w1)
    const prev = await previousSets(chest.we.exercise_id)
    expect(prev.map((x) => x.weight)).toEqual([32.5])
    const w2 = await startWorkout(day1, USER)
    const s2 = await setsOf(w2.id)
    // 4 planned sets, only 1 previous set: the last previous value is repeated
    expect(s2['Griffe Mitte Brust']!.sets.map((x) => x.weight)).toEqual([32.5, 32.5, 32.5, 32.5])
  })
})

describe('finish and cancel', () => {
  it('discards open sets and empty exercises, keeps completed ones', async () => {
    const w = await startWorkout(day2, USER)
    const s = await setsOf(w.id)
    const curl = s['Lying Leg Curl (Machine)']!
    await toggleSetDone(curl.sets[0]!)
    await finishWorkout(w)
    const after = await setsOf(w.id)
    const curlAfter = after['Lying Leg Curl (Machine)']!
    expect(curlAfter.sets.filter((x) => x.deleted_at === null)).toHaveLength(1)
    expect(after['Bicycle']!.we.deleted_at).not.toBeNull()
    expect((await db.workout.get(w.id))!.finished_at).not.toBeNull()
    expect(await getActiveWorkout()).toBeUndefined()
  })

  it('cancel soft-deletes everything', async () => {
    const w = await startWorkout(day1, USER)
    await cancelWorkout(w)
    expect((await db.workout.get(w.id))!.deleted_at).not.toBeNull()
    const s = await setsOf(w.id)
    expect(Object.values(s).every((x) => x.we.deleted_at !== null && x.sets.every((y) => y.deleted_at !== null))).toBe(true)
    expect(await getActiveWorkout()).toBeUndefined()
  })

  it('add and remove sets', async () => {
    const w = await startWorkout(day1, USER)
    const s = await setsOf(w.id)
    const leg = s['Leg Press']!
    await addSet(leg.we)
    let after = (await setsOf(w.id))['Leg Press']!.sets.filter((x) => x.deleted_at === null)
    expect(after).toHaveLength(4)
    expect(after[3]).toMatchObject({ position: 4, weight: 70, reps: 10 })
    await toggleSetDone(after[3]!)
    await removeLastSet(leg.we) // removes the last open set, not the completed one
    after = (await setsOf(w.id))['Leg Press']!.sets.filter((x) => x.deleted_at === null)
    expect(after.map((x) => x.position)).toEqual([1, 2, 4])
  })

  it('queues every change for sync', async () => {
    await db.outbox.clear()
    const w = await startWorkout(day1, USER)
    const count = await db.outbox.count()
    const s = await setsOf(w.id)
    const rows = 1 + Object.keys(s).length + Object.values(s).reduce((n, x) => n + x.sets.length, 0)
    expect(count).toBe(rows)
  })
})

describe('parsing', () => {
  it('parses numbers with comma and durations', () => {
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('abc')).toBeUndefined()
    expect(parseDuration('7')).toBe(420)
    expect(parseDuration('38:20')).toBe(2300)
    expect(parseDuration('1:02:03')).toBe(3723)
    expect(parseDuration('7,5')).toBe(450)
    expect(parseDuration('x:1')).toBeUndefined()
  })
})
