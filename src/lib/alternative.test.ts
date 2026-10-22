import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Exercise } from './db'
import { loadExportData, workoutMarkdown } from './markdown'
import { importSeedIfNeeded } from './seed'
import { alternativeOf, finishWorkout, startWorkout, switchExercise, toggleSetDone } from './workout'

// Alternative exercises (decision 22 October 2026)

const USER = 'u1'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
})

const byName = async (name: string): Promise<Exercise> => (await db.exercise.toArray()).find((e) => e.name === name)!

async function weOf(workoutId: string, exerciseId: string) {
  return (await db.workout_exercise.where('workout_id').equals(workoutId).toArray()).find((we) => we.exercise_id === exerciseId)!
}

async function activeSets(weId: string) {
  return (await db.workout_set.where('workout_exercise_id').equals(weId).toArray())
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.position - b.position)
}

describe('alternative exercises', () => {
  it('inherits the alternative on a variant and ignores deleted ones', async () => {
    const lateral = await byName('Lateral Raise (Cable)')
    const curl = await byName('Preacher Curl (Machine)')
    const byId = new Map((await db.exercise.toArray()).map((e) => [e.id, e]))
    expect(alternativeOf(lateral, byId)).toBeNull()
    byId.set(lateral.id, { ...lateral, alternative_id: curl.id })
    expect(alternativeOf(byId.get(lateral.id)!, byId)?.id).toBe(curl.id)
    const variant: Exercise = { ...curl, id: 'v1', parent_id: lateral.id, name: 'Variante', alternative_id: null }
    expect(alternativeOf(variant, byId)?.id).toBe(curl.id)
    byId.set(curl.id, { ...curl, deleted_at: '2026-10-22T00:00:00Z' })
    expect(alternativeOf(byId.get(lateral.id)!, byId)).toBeNull()
  })

  it('switches to the alternative and back while no set is done', async () => {
    const lateral = await byName('Lateral Raise (Cable)')
    const curl = await byName('Preacher Curl (Machine)')
    await db.exercise.put({ ...lateral, alternative_id: curl.id })
    const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
    const w = await startWorkout(day2.id, USER)
    const we = await weOf(w.id, lateral.id)
    const before = (await activeSets(we.id)).filter((s) => s.set_type === 'working').length

    await switchExercise(we)
    const switched = (await db.workout_exercise.get(we.id))!
    expect(switched.exercise_id).toBe(curl.id)
    expect(switched.original_exercise_id).toBe(lateral.id)
    const curlSets = (await activeSets(we.id)).filter((s) => s.set_type === 'working')
    expect(curlSets.length).toBe(before)
    // Prefilled from the last Preacher Curl (15 kg in the seed history), two-sided
    expect(curlSets[0]!.weight).toBe(15)
    expect(curlSets[0]!.reps).not.toBeNull()
    expect(curlSets[0]!.reps_left).toBeNull()

    await switchExercise(switched)
    const back = (await db.workout_exercise.get(we.id))!
    expect(back.exercise_id).toBe(lateral.id)
    expect(back.original_exercise_id).toBeNull()
    const lateralSets = (await activeSets(we.id)).filter((s) => s.set_type === 'working')
    expect(lateralSets.length).toBe(before)
    expect(lateralSets[0]!.reps_left).not.toBeNull()

    // After a done set the exercise stays
    await toggleSetDone(lateralSets[0]!)
    await expect(switchExercise(back)).rejects.toThrow()
  })

  it('marks the alternative in the Markdown export', async () => {
    const lateral = await byName('Lateral Raise (Cable)')
    const curl = await byName('Preacher Curl (Machine)')
    await db.exercise.put({ ...lateral, alternative_id: curl.id })
    const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
    const w = await startWorkout(day2.id, USER)
    const we = await weOf(w.id, lateral.id)
    await switchExercise(we)
    const set = (await activeSets(we.id)).find((s) => s.set_type === 'working')!
    await toggleSetDone(set)
    await finishWorkout((await db.workout.get(w.id))!)
    const md = workoutMarkdown(await loadExportData(), w.id)!
    expect(md).toContain('Preacher Curl (Machine) (alternative for Lateral Raise (Cable))')
  })
})
