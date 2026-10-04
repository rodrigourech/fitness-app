import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { importSeedIfNeeded } from './seed'
import {
  activeSets,
  addTemplateExercise,
  createTemplate,
  deleteTemplate,
  moveTemplateExercise,
  removeTemplateExercise,
  setPlannedSetCount,
  setPlannedTargets,
} from './template'
import { startWorkout } from './workout'

const USER = 'u1'

async function order(templateId: string) {
  const exercises = new Map((await db.exercise.toArray()).map((e) => [e.id, e.name]))
  return (await db.template_exercise.where('template_id').equals(templateId).toArray())
    .filter((te) => te.deleted_at === null)
    .sort((a, b) => a.position - b.position)
    .map((te) => exercises.get(te.exercise_id))
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
})

describe('template editing', () => {
  it('creates a template, adds exercises with targets from history, reorders and removes', async () => {
    const id = await createTemplate(USER, 'Upper')
    const legCurl = (await db.exercise.toArray()).find((e) => e.name === 'Lying Leg Curl (Machine)')!
    const run = (await db.exercise.toArray()).find((e) => e.name === 'Laufen')!
    await addTemplateExercise(id, legCurl.id)
    await addTemplateExercise(id, run.id)
    expect(await order(id)).toEqual(['Lying Leg Curl (Machine)', 'Laufen'])

    const tes = (await db.template_exercise.where('template_id').equals(id).toArray()).sort((a, b) => a.position - b.position)
    const curlSets = await activeSets(tes[0]!.id)
    expect(curlSets).toHaveLength(3)
    // last working set of the 2 Oct workout was 30 kg
    expect(curlSets.map((s) => [s.target_reps_min, s.target_weight])).toEqual([
      [10, 30],
      [10, 30],
      [10, 30],
    ])
    expect(await activeSets(tes[1]!.id)).toHaveLength(1)

    await moveTemplateExercise(tes[1]!, -1)
    expect(await order(id)).toEqual(['Laufen', 'Lying Leg Curl (Machine)'])

    await removeTemplateExercise(tes[1]!)
    expect(await order(id)).toEqual(['Lying Leg Curl (Machine)'])
  })

  it('changes set count and targets; a new workout uses them', async () => {
    const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
    const te = (await db.template_exercise.where('template_id').equals(day2.id).toArray()).sort((a, b) => b.position - a.position)[0]!
    await setPlannedSetCount(te, 5)
    expect(await activeSets(te.id)).toHaveLength(5)
    await setPlannedSetCount(te, 2)
    expect(await activeSets(te.id)).toHaveLength(2)
    await setPlannedTargets(te, { target_weight: 37.5, target_reps_min: 8, target_reps_max: 12 })
    expect((await activeSets(te.id)).every((s) => s.target_weight === 37.5 && s.target_reps_max === 12)).toBe(true)

    const w = await startWorkout(day2.id, USER)
    const we = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).find((x) => x.exercise_id === te.exercise_id)!
    const sets = (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray()).filter((s) => s.deleted_at === null)
    expect(sets).toHaveLength(2)
  })

  it('deleting a template keeps past workouts', async () => {
    const day1 = (await db.template.toArray()).find((t) => t.name === 'DAY1')!
    await deleteTemplate(day1)
    expect((await db.template.get(day1.id))!.deleted_at).not.toBeNull()
    const workouts = (await db.workout.toArray()).filter((w) => w.template_id === day1.id && w.deleted_at === null)
    expect(workouts).toHaveLength(1)
  })
})
