import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { bodyWeightSeries, saveBodyWeight } from './body'
import { db, type WorkoutSet } from './db'
import { deleteWorkout, finishedWorkouts } from './history'
import { importSeedIfNeeded } from './seed'
import { bestBefore, effectiveReps, epley, recordsOf, shouldIncrease, suggestWeight, targetRepsFor, volume } from './stats'
import { setTemplateExerciseVariant } from './template'
import { finishWorkout, startWorkout, toggleSetDone } from './workout'

const USER = 'u1'
const set = (p: Partial<WorkoutSet>): WorkoutSet =>
  ({
    id: 'x', user_id: USER, workout_exercise_id: 'we', position: 1, set_type: 'working', weight: null, reps: null,
    reps_left: null, reps_right: null, rir: null, duration_s: null, distance_km: null, completed_at: 'now',
    created_at: '', updated_at: '', deleted_at: null, ...p,
  }) as WorkoutSet

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
})

describe('formulas', () => {
  it('epley, effective reps and volume', () => {
    expect(epley(30, 10)).toBeCloseTo(40)
    expect(epley(30, 0)).toBeNull()
    expect(effectiveReps(set({ reps_left: 10, reps_right: 8 }))).toBe(8)
    expect(volume([set({ weight: 30, reps: 10 }), set({ weight: 4.5, reps_left: 10, reps_right: 8 }), set({ weight: 20, reps: 10, set_type: 'warmup' })])).toBe(381)
  })

  it('progression needs target reps on all sets and RIR >= 2 on the last', () => {
    const ok = [set({ reps: 10 }), set({ reps: 10, rir: 2 })]
    expect(shouldIncrease(ok, 10)).toBe(true)
    expect(shouldIncrease([set({ reps: 9 }), set({ reps: 10, rir: 3 })], 10)).toBe(false)
    expect(shouldIncrease([set({ reps: 10 }), set({ reps: 10, rir: 1 })], 10)).toBe(false)
    expect(shouldIncrease([set({ reps: 10 }), set({ reps: 10, rir: null })], 10)).toBe(false)
  })
})

describe('records', () => {
  it('detects weight and 1RM records against finished workouts only', async () => {
    const legCurl = (await db.exercise.toArray()).find((e) => e.name === 'Lying Leg Curl (Machine)')!
    const best = await bestBefore(legCurl.id, 'none')
    expect(best).toMatchObject({ maxWeight: 35, hasHistory: true })
    expect(best.maxE1rm).toBeCloseTo(35 * (1 + 10 / 30))
    expect(recordsOf(set({ weight: 36, reps: 7 }), best)).toEqual(['Weight'])
    expect(recordsOf(set({ weight: 35, reps: 11 }), best)).toEqual(['1RM'])
    expect(recordsOf(set({ weight: 35, reps: 10 }), best)).toEqual([])
    expect(recordsOf(set({ weight: 40, reps: 10, completed_at: null }), best)).toEqual([])
  })

  it('target reps come from the workout template', async () => {
    const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
    const crunch = (await db.exercise.toArray()).find((e) => e.name === '−15°')!
    expect(await targetRepsFor(day2.id, crunch.id)).toBe(15)
    expect(await targetRepsFor(null, crunch.id)).toBeNull()
  })
})

describe('history and body weight', () => {
  it('lists finished workouts newest first and deletes them', async () => {
    const day1 = (await db.template.toArray()).find((t) => t.name === 'DAY1')!
    const w = await startWorkout(day1.id, USER)
    const first = (await db.workout_set.toArray()).find((s) => s.completed_at === null)!
    await toggleSetDone(first)
    await finishWorkout(w)
    let list = await finishedWorkouts()
    expect(list.map((s) => s.workout.template_name_snapshot)).toEqual(['DAY1', 'DAY2', 'DAY1'])
    expect(list[1]!.volume).toBeCloseTo(4148.5)
    await deleteWorkout(list[0]!.workout)
    list = await finishedWorkouts()
    expect(list).toHaveLength(2)
  })

  it('one entry per day and a 7-day average over available days', async () => {
    await saveBodyWeight(USER, '2026-10-01', 80)
    await saveBodyWeight(USER, '2026-10-03', 81)
    await saveBodyWeight(USER, '2026-10-03', 82) // same day: updated
    await saveBodyWeight(USER, '2026-10-12', 79)
    const s = await bodyWeightSeries()
    expect(s.map((p) => [p.entry.measured_on, p.entry.weight_kg, p.avg7])).toEqual([
      ['2026-10-12', 79, 79],
      ['2026-10-03', 82, 81],
      ['2026-10-01', 80, 80],
    ])
  })

  it('switches the variant used in a template', async () => {
    const day1 = (await db.template.toArray()).find((t) => t.name === 'DAY1')!
    const low = (await db.exercise.toArray()).find((e) => e.name === 'Sitz tiefer')!
    const te = (await db.template_exercise.where('template_id').equals(day1.id).toArray()).find((x) => x.position === 2)!
    await setTemplateExerciseVariant(te, low.id)
    expect((await db.template_exercise.get(te.id))!.exercise_id).toBe(low.id)
  })
})

describe('weight suggestion', () => {
  const prev = [
    set({ set_type: 'warmup', weight: 20, reps: 10 }),
    set({ weight: 30, reps: 10 }),
    set({ weight: 30, reps: 10, rir: 2 }),
  ]

  it('adds the weight step to the heaviest working weight', () => {
    expect(suggestWeight(prev, 2.5)).toEqual({ lastWeight: 30, reps: [10, 10], next: 32.5 })
  })

  it('gives no number without a weight step', () => {
    expect(suggestWeight(prev, null)).toEqual({ lastWeight: 30, reps: [10, 10], next: null })
  })
})
