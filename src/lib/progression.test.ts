import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type WorkoutSet } from './db'
import { belowMinimum, progressionAdvice, readyToIncrease, workTotals } from './progression'
import { importSeedIfNeeded } from './seed'
import { createTemplate, addTemplateExercise } from './template'
import { recentTrainingSessions, type TrainingSession } from './workout'

const base = { user_id: 'u1', created_at: '2026-10-01', updated_at: '2026-10-01', deleted_at: null }
const targets = { target: 10, minimum: 7 }
function set(reps: number | null, i: number, patch: Partial<WorkoutSet> = {}): WorkoutSet {
  return { ...base, id: `set-${i}`, workout_exercise_id: 'we', position: i + 1, set_type: 'working', weight: 30,
    reps, reps_left: null, reps_right: null, rir: null, duration_s: null, distance_km: null, completed_at: 'done', ...patch }
}
function session(reps: number[], patch: Partial<WorkoutSet> = {}): TrainingSession {
  return { workout: { ...base, id: 'w', template_id: 't', template_name_snapshot: 'Main Day A', started_at: '2026-10-01', finished_at: 'done', note: null },
    exercise: { ...base, id: 'we', workout_id: 'w', exercise_id: 'ex', position: 1, rest_s: 150, comment: null },
    sets: reps.map((rep, i) => set(rep, i, patch)) }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('progression decisions', () => {
  it('increases only after all planned work sets reach the target, ignoring RIR and warm-ups', () => {
    const prior = session([10, 11, 10], { rir: 0 })
    prior.sets.unshift(set(3, -1, { set_type: 'warmup' }))
    expect(progressionAdvice([prior], targets, false, 3)).toBe('increase')
    expect(progressionAdvice([session([10, 10])], targets, false, 3)).toBe('hold')
    expect(progressionAdvice([], targets, false, 3)).toBeNull()
  })

  it('keeps the weight after a weak last set and after a single weak first set', () => {
    expect(progressionAdvice([session([10, 9, 6]), session([10, 8, 6])], targets, false, 3)).toBe('hold')
    expect(progressionAdvice([session([6, 6, 5]), session([8, 7, 6])], targets, false, 3)).toBe('hold')
    expect(progressionAdvice([session([7, 6, 5]), session([7, 6, 5])], targets, false, 3)).toBe('hold')
  })

  it('reduces only after two weak first sets with matching load, set count and recorded rest', () => {
    expect(progressionAdvice([session([6, 6, 5]), session([6, 5, 5])], targets, false, 3)).toBe('reduce')
    expect(progressionAdvice([session([6, 6, 5]), session([6, 5, 5], { weight: 27.5 })], targets, false, 3)).toBe('hold')
    expect(progressionAdvice([session([6, 6, 5]), session([6, 5])], targets, false, 3)).toBe('hold')
    // A lighter back-off set does not matter, the top weight does
    const backOff = session([6, 5, 5]); backOff.sets[2]!.weight = 25
    expect(progressionAdvice([session([6, 6, 5]), backOff], targets, false, 3)).toBe('reduce')
    const rest = session([6, 5, 5]); rest.exercise.rest_s = 90
    expect(progressionAdvice([session([6, 6, 5]), rest], targets, false, 3)).toBe('hold')
    expect(progressionAdvice([session([6, 6, 5], { weight: null }), session([6, 5, 5], { weight: null })], targets, false, 3)).toBe('hold')
  })

  it('decides on the top set only', () => {
    const pyramid = (reps: number[]) => { const s = session(reps); s.sets[0]!.weight = 40; s.sets[1]!.weight = 50; s.sets[2]!.weight = 40; return s }
    expect(progressionAdvice([pyramid([7, 10, 7])], targets, false, 3)).toBe('increase')
    expect(progressionAdvice([pyramid([10, 9, 10])], targets, false, 3)).toBe('hold')
    expect(progressionAdvice([pyramid([10, 6, 10]), pyramid([10, 5, 10])], targets, false, 3)).toBe('reduce')
    // More sets than planned still count
    expect(progressionAdvice([session([10, 10, 10, 10])], targets, false, 3)).toBe('increase')
  })

  it('requires both sides for an increase and uses the weaker side for the first-set minimum', () => {
    expect(progressionAdvice([session([10, 10], { reps_left: 10, reps_right: 9 })], targets, true, 2)).toBe('hold')
    expect(progressionAdvice([session([10, 10], { reps_left: 10, reps_right: 10 })], targets, true, 2)).toBe('increase')
    expect(progressionAdvice([session([10, 10], { reps_left: 6, reps_right: 9 }), session([10, 10], { reps_left: 6, reps_right: 9 })], targets, true, 2)).toBe('reduce')
    expect(progressionAdvice([session([10, 10], { reps_left: 6 }), session([10, 10], { reps_left: 6 })], targets, true, 2)).toBe('hold')
  })
})

describe('work totals', () => {
  it('sums reps and weight × reps of work sets, optionally only checked ones', () => {
    const current = [set(10, 0), set(9, 1, { completed_at: null }), set(8, 2, { set_type: 'warmup' }), set(100, 3, { deleted_at: 'gone' })]
    expect(workTotals(current, false, true)).toEqual({ reps: 10, volume: 300 })
    expect(workTotals(current, false)).toEqual({ reps: 19, volume: 570 })
    expect(workTotals([set(10, 0, { weight: 30 }), set(10, 1, { weight: 15 })], false)).toEqual({ reps: 20, volume: 450 })
    expect(workTotals([set(null, 0, { weight: 4.5, reps_left: 10, reps_right: 8 })], true)).toEqual({ reps: 18, volume: 81 })
  })
  it('marks reps below the minimum only when entered', () => {
    expect(belowMinimum(6, 7)).toBe(true)
    expect(belowMinimum(7, 7)).toBe(false)
    expect(belowMinimum(null, 7)).toBe(false)
    expect(belowMinimum(3, null)).toBe(false)
  })
})

describe('shared history', () => {
  it('uses the last performance of the same exercise in any workout and ignores skipped exercises', async () => {
    await importSeedIfNeeded('u1')
    const ex = (await db.exercise.toArray()).find((e) => e.name === 'Leg Press')!
    const main = (await db.template.toArray()).find((t) => t.name === 'DAY1')!
    const bonus = await createTemplate('u1', 'Bonus Day')
    await addTemplateExercise(bonus, ex.id)
    // Template filter still available, without it all workouts count
    expect(await recentTrainingSessions(ex.id, bonus)).toEqual([])
    expect(await recentTrainingSessions(ex.id)).toHaveLength(1)
    const original = (await recentTrainingSessions(ex.id))[0]!
    expect(original.workout.template_id).toBe(main.id)
    await db.workout_exercise.put({ ...original.exercise, id: 'duplicate-entry' })
    await db.workout_set.bulkPut(original.sets.map((s) => ({ ...s, id: `duplicate-${s.id}`, workout_exercise_id: 'duplicate-entry' })))
    expect(await recentTrainingSessions(ex.id)).toHaveLength(1)
    // One entry per exercise, even if it appears in several workouts
    const entries = (await readyToIncrease()).filter((e) => e.exerciseId === ex.id)
    expect(entries).toHaveLength(1)
    await db.workout_exercise.update(original.exercise.id, { skipped_at: 'skipped' })
    await db.workout_exercise.update('duplicate-entry', { skipped_at: 'skipped' })
    expect(await recentTrainingSessions(ex.id)).toEqual([])
  })
})
