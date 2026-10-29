import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type WorkoutSet } from './db'
import { formatMinutes, formatVolume, percentChange, topSetChange, topSetOf, workoutReport, workoutReports } from './report'
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
    expect(curlLine).toMatchObject({ status: 'done', today: { weight: 35, reps: 20 } })
    // Last time = the last earlier workout with this exercise (the imported DAY2 of 2 October: 35 × 10)
    expect(curlLine.last).toMatchObject({ weight: 35, reps: 10 })
    // Exercises without a done set appear as skipped rows without today's values
    const done = r.lines.filter((l) => l.status === 'done')
    expect(done.length).toBe(2)
    const skipped = r.lines.filter((l) => l.status === 'skipped')
    expect(skipped.length).toBeGreaterThan(0)
    expect(skipped.every((l) => l.today === null && l.next === null && !l.record)).toBe(true)
    expect((await workoutReports())[0]!.workout.id).toBe(w.id)
  })

  it('formats the numbers', () => {
    expect(percentChange(104, 100)).toBe(4)
    expect(percentChange(100, null)).toBeNull()
    expect(formatMinutes(58 * 60)).toBe('58 min')
    expect(formatMinutes(65 * 60)).toBe('1 h 05')
    expect(formatVolume(5640)).toBe('5 640')
  })

  it('takes the heaviest set as top set and describes the change in kg or reps', () => {
    const w = (weight: number | null, reps: number | null, left: number | null = null, right: number | null = null) =>
      ({ set_type: 'working' as const, weight, reps, reps_left: left, reps_right: right })
    expect(topSetOf([w(36, 10), w(41, 7), w(36, 10)])).toMatchObject({ weight: 41, reps: 7 })
    expect(topSetOf([w(45, 8), w(45, 10)])).toMatchObject({ weight: 45, reps: 10 })
    expect(topSetOf([{ ...w(20, 6), set_type: 'warmup' as const }, w(null, 10)])).toBeNull()
    const t = (weight: number, reps: number | null, left: number | null = null, right: number | null = null) =>
      ({ weight, reps, repsLeft: left, repsRight: right })
    expect(topSetChange(t(45, 10), t(45, 8))).toEqual({ text: '+2 reps', tone: 'up' })
    expect(topSetChange(t(24, 10), t(24, 9))).toEqual({ text: '+1 rep', tone: 'up' })
    expect(topSetChange(t(50, 9), t(40, 10))).toEqual({ text: '+10 kg · −1 rep', tone: 'up' })
    expect(topSetChange(t(15, 10), t(20, 10))).toEqual({ text: '−5 kg', tone: 'down' })
    expect(topSetChange(t(20, 10), t(20, 10))).toEqual({ text: '=', tone: 'same' })
    // One-sided: the weaker side counts
    expect(topSetChange(t(4.5, null, 12, 12), t(4.5, null, 10, 10))).toEqual({ text: '+2 reps', tone: 'up' })
    expect(topSetChange(t(4.5, null, 12, 9), t(4.5, null, 12, 12))).toEqual({ text: '−3 reps', tone: 'down' })
  })
})
