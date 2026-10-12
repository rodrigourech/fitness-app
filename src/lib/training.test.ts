import 'fake-indexeddb/auto'
import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { importSeedIfNeeded } from './seed'
import { exerciseTrainingSettings, repetitionTargets, validRepetitionTargets } from './training'
import { startWorkout, cancelWorkout } from './workout'

beforeEach(async () => { await db.delete(); await db.open(); await importSeedIfNeeded('u1') })

it('inherits exercise settings and applies only work-set overrides', async () => {
  const all = await db.exercise.toArray()
  const variant = all.find((e) => e.name === 'Griffe Mitte Brust')!
  const parent = all.find((e) => e.id === variant.parent_id)!
  Object.assign(parent, { target_reps: 12, min_reps: 8, warm_up: true })
  const byId = new Map(all.map((e) => [e.id, e]))
  expect(exerciseTrainingSettings(variant, byId)).toEqual({ targetReps: 12, minReps: 8, warmUp: true })
  Object.assign(variant, { target_reps: 10, min_reps: 7, warm_up: false })
  expect(exerciseTrainingSettings(variant, byId)).toEqual({ targetReps: 10, minReps: 7, warmUp: false })
  const te = (await db.template_exercise.toArray()).find((e) => e.exercise_id === variant.id)!
  const planned = (await db.template_set.where('template_exercise_id').equals(te.id).toArray()).map((s) => ({ ...s, target_reps_min: 8, target_reps_max: 11 }))
  expect(repetitionTargets(variant, byId, planned)).toEqual({ target: 11, minimum: 8 })
  expect(repetitionTargets(variant, byId, planned.map((s) => ({ ...s, set_type: 'warmup' })))).toEqual({ target: 10, minimum: 7 })
  expect(validRepetitionTargets(10, 11)).toBe(false)
  expect(validRepetitionTargets(10, 0)).toBe(false)
})

it('snapshots targets and warm-up reminders, creates no warm-up or RIR sets, and leaves history intact', async () => {
  const day = (await db.template.toArray()).find((t) => t.name === 'DAY1')!
  const ex = (await db.exercise.toArray()).find((e) => e.name === 'Griffe Mitte Brust')!
  const te = (await db.template_exercise.where('template_id').equals(day.id).toArray()).find((e) => e.exercise_id === ex.id)!
  await db.exercise.update(ex.id, { target_reps: 12, min_reps: 8, warm_up: true })
  for (const set of await db.template_set.where('template_exercise_id').equals(te.id).toArray()) {
    await db.template_set.update(set.id, { target_reps_min: null, target_reps_max: null })
  }
  const source = (await db.template_set.where('template_exercise_id').equals(te.id).first())!
  await db.template_set.put({ ...source, id: 'warmup-test', set_type: 'warmup', target_reps_min: 8, target_reps_max: 8, target_weight: 15 })
  const w = await startWorkout(day.id, 'u1')
  const we = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).find((e) => e.exercise_id === ex.id)!
  expect(we).toMatchObject({ target_reps: 12, min_reps: 8, warm_up: true })
  const sets = await db.workout_set.where('workout_exercise_id').equals(we.id).toArray()
  expect(sets).toHaveLength(4)
  expect(sets.every((s) => s.set_type === 'working' && s.rir === null)).toBe(true)
  await db.exercise.update(ex.id, { target_reps: 15, min_reps: 10, warm_up: false })
  expect(await db.workout_exercise.get(we.id)).toMatchObject({ target_reps: 12, min_reps: 8, warm_up: true })
  await cancelWorkout(w)
  expect(await db.template_set.get('warmup-test')).toMatchObject({ deleted_at: null })
})
