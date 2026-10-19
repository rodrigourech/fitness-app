import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type WorkoutSet } from './db'
import { formatMinutes, formatVolume, percentChange, workoutReport, workoutReports } from './report'
import { importSeedIfNeeded } from './seed'
import { finishWorkout, startWorkout, toggleSetDone, updateSet } from './workout'

const USER = 'u1'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
})

async function setsByExercise(workoutId: string) {
  const wes = await db.workout_exercise.where('workout_id').equals(workoutId).toArray()
  const names = new Map((await db.exercise.toArray()).map((e) => [e.id, e.name]))
  const out = new Map<string, WorkoutSet[]>()
  for (const we of wes) {
    const sets = (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray())
      .filter((s) => s.set_type === 'working').sort((a, b) => a.position - b.position)
    out.set(names.get(we.exercise_id)!, sets)
  }
  return out
}

describe('workout report', () => {
  it('compares with the last workout of the same template and gives the weight for the next workout', async () => {
    const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
    const w = await startWorkout(day2.id, USER)
    const sets = await setsByExercise(w.id)
    // Lying Leg Curl: every set at Max Reps → increase; the other exercises: only the first set done
    const curl = sets.get('Lying Leg Curl (Machine)')!
    for (const s of curl) {
      await updateSet(s, { weight: 35, reps: 20 })
      await toggleSetDone((await db.workout_set.get(s.id))!)
    }
    const row = sets.get('Seated Row (Cable)')!
    await toggleSetDone(row[0]!)
    await finishWorkout((await db.workout.get(w.id))!)

    const r = (await workoutReport(w.id))!
    expect(r.name).toBe('DAY2')
    expect(r.kind).toBe('strength')
    expect(r.previous).not.toBeNull()
    expect(r.totals.sets).toBe(curl.length + 1)
    expect(r.totals.planned).toBeGreaterThan(r.totals.sets)
    const curlLine = r.lines.find((l) => l.name === 'Lying Leg Curl (Machine)')!
    expect(curlLine).toMatchObject({ current: 35, advice: 'increase' })
    const rowLine = r.lines.find((l) => l.name === 'Seated Row (Cable)')!
    expect(rowLine.advice).toBe('hold')
    expect(rowLine.next).toBe(rowLine.current)
    // Exercises without a done set have no line
    expect(r.lines.length).toBe(2)
    expect((await workoutReports())[0]!.workout.id).toBe(w.id)
  })

  it('formats the numbers', () => {
    expect(percentChange(104, 100)).toBe(4)
    expect(percentChange(100, null)).toBeNull()
    expect(formatMinutes(58 * 60)).toBe('58 min')
    expect(formatMinutes(65 * 60)).toBe('1 h 05')
    expect(formatVolume(5640)).toBe('5 640')
  })
})
