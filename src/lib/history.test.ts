import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type Workout, type WorkoutExercise, type WorkoutSet } from './db'
import { importSeedIfNeeded } from './seed'
import { addHistorySet, finishedWorkouts, removeHistorySet, updateHistorySet, workoutDetail } from './history'
import { finishWorkout, startWorkout, toggleSetDone } from './workout'

const USER = 'u1'

/** A finished DAY2 workout where every work set of Lying Leg Curl and Lateral Raise was done. */
async function finishedDay2(): Promise<{ w: Workout; curl: WorkoutExercise; raise: WorkoutExercise }> {
  const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
  const started = await startWorkout(day2.id, USER)
  const wes = await db.workout_exercise.where('workout_id').equals(started.id).toArray()
  const exercises = new Map((await db.exercise.toArray()).map((e) => [e.id, e]))
  const byName = (name: string) => wes.find((we) => exercises.get(we.exercise_id)!.name === name)!
  const curl = byName('Lying Leg Curl (Machine)')
  const raise = byName('Lateral Raise (Cable)')
  for (const we of [curl, raise]) {
    for (const s of await working(we.id)) await toggleSetDone(s)
  }
  await finishWorkout((await db.workout.get(started.id))!)
  return { w: (await db.workout.get(started.id))!, curl: (await db.workout_exercise.get(curl.id))!, raise: (await db.workout_exercise.get(raise.id))! }
}

async function working(weId: string): Promise<WorkoutSet[]> {
  return (await db.workout_set.where('workout_exercise_id').equals(weId).toArray())
    .filter((s) => s.deleted_at === null && s.set_type === 'working')
    .sort((a, b) => a.position - b.position)
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
})

describe('updateHistorySet', () => {
  it('changes the values, sets updated_at and queues the sync', async () => {
    const { w, curl } = await finishedDay2()
    const [first] = await working(curl.id)
    const before = (await finishedWorkouts()).find((s) => s.workout.id === w.id)!.volume
    await new Promise((r) => setTimeout(r, 5))
    await updateHistorySet(first!, { weight: 40, reps: 12 })
    const saved = (await db.workout_set.get(first!.id))!
    expect(saved).toMatchObject({ weight: 40, reps: 12, completed_at: first!.completed_at })
    expect(saved.updated_at > first!.updated_at).toBe(true)
    expect(await db.outbox.where('[table+row_id]').equals(['workout_set', first!.id]).count()).toBe(1)
    const after = (await finishedWorkouts()).find((s) => s.workout.id === w.id)!.volume
    expect(after - before).toBe(40 * 12 - first!.weight! * first!.reps!)
  })

  it('keeps one-sided reps separate', async () => {
    const { raise } = await finishedDay2()
    const [first] = await working(raise.id)
    await updateHistorySet(first!, { reps_left: 11, reps_right: 9 })
    expect(await db.workout_set.get(first!.id)).toMatchObject({ reps: null, reps_left: 11, reps_right: 9 })
  })
})

describe('addHistorySet', () => {
  it('appends a done work set with the values of the last set', async () => {
    const { w, curl } = await finishedDay2()
    const before = await working(curl.id)
    await updateHistorySet(before.at(-1)!, { weight: 25, reps: 9 })
    const added = await addHistorySet(curl, w)
    const after = await working(curl.id)
    expect(after).toHaveLength(before.length + 1)
    expect(after.at(-1)).toMatchObject({
      id: added.id,
      set_type: 'working',
      weight: 25,
      reps: 9,
      position: Math.max(...before.map((s) => s.position)) + 1,
      completed_at: w.finished_at,
      user_id: USER,
      deleted_at: null,
    })
    const detail = (await workoutDetail(w.id)).find((d) => d.workoutExercise.id === curl.id)!
    expect(detail.sets.map((s) => s.id)).toContain(added.id)
  })

  it('copies left and right reps of one-sided exercises', async () => {
    const { w, raise } = await finishedDay2()
    const last = (await working(raise.id)).at(-1)!
    const added = await addHistorySet(raise, w)
    expect(added).toMatchObject({ reps: null, reps_left: last.reps_left, reps_right: last.reps_right, weight: last.weight })
  })

  it('brings a skipped exercise back', async () => {
    const { w } = await finishedDay2()
    const skipped = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).find((we) => we.skipped_at)!
    expect(skipped).toBeDefined()
    await addHistorySet(skipped, w)
    expect((await db.workout_exercise.get(skipped.id))!.skipped_at).toBeNull()
    expect(await working(skipped.id)).toHaveLength(1)
  })
})

describe('removeHistorySet', () => {
  it('soft-deletes the set', async () => {
    const { w, curl } = await finishedDay2()
    const sets = await working(curl.id)
    await removeHistorySet(sets[1]!)
    expect((await db.workout_set.get(sets[1]!.id))!.deleted_at).not.toBeNull()
    expect(await working(curl.id)).toHaveLength(sets.length - 1)
    expect((await db.workout_exercise.get(curl.id))!.skipped_at ?? null).toBeNull()
    const detail = (await workoutDetail(w.id)).find((d) => d.workoutExercise.id === curl.id)!
    expect(detail.sets.map((s) => s.id)).not.toContain(sets[1]!.id)
  })

  it('marks the exercise as skipped when its last set is removed', async () => {
    const { w, curl } = await finishedDay2()
    const all = (await db.workout_set.where('workout_exercise_id').equals(curl.id).toArray()).filter((s) => s.deleted_at === null)
    for (const s of all) await removeHistorySet(s)
    expect((await db.workout_exercise.get(curl.id))!.skipped_at).not.toBeNull()
    expect((await workoutDetail(w.id)).find((d) => d.workoutExercise.id === curl.id)!.skipped).toBe(true)
  })
})
