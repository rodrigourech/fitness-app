import { db, displayName, type Exercise, type Workout, type WorkoutSet } from './db'
import { saveRows } from './sync'
import { volume } from './stats'
import { effective } from './workout'

export interface WorkoutSummary {
  workout: Workout
  durationS: number | null
  volume: number
  sets: number
  exercises: number
}

export async function finishedWorkouts(): Promise<WorkoutSummary[]> {
  const workouts = (await db.workout.toArray())
    .filter((w) => w.deleted_at === null && w.finished_at !== null)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  const wes = (await db.workout_exercise.where('workout_id').anyOf(workouts.map((w) => w.id)).toArray()).filter(
    (we) => we.deleted_at === null && !we.skipped_at,
  )
  const sets = (await db.workout_set.where('workout_exercise_id').anyOf(wes.map((we) => we.id)).toArray()).filter((s) => s.deleted_at === null)
  return workouts.map((w) => {
    const myWes = wes.filter((we) => we.workout_id === w.id)
    const ids = new Set(myWes.map((we) => we.id))
    const mySets = sets.filter((s) => ids.has(s.workout_exercise_id))
    return {
      workout: w,
      durationS: w.finished_at ? Math.round((Date.parse(w.finished_at) - Date.parse(w.started_at)) / 1000) : null,
      volume: volume(mySets),
      sets: mySets.length,
      exercises: myWes.length,
    }
  })
}

export interface DetailExercise {
  name: string
  /** Skipped as a whole in this workout */
  skipped: boolean
  trackingType: string
  unilateral: boolean
  sets: WorkoutSet[]
}

export async function workoutDetail(workoutId: string): Promise<DetailExercise[]> {
  const exercises = await db.exercise.toArray()
  const byId = new Map<string, Exercise>(exercises.map((e) => [e.id, e]))
  const wes = (await db.workout_exercise.where('workout_id').equals(workoutId).toArray())
    .filter((we) => we.deleted_at === null)
    .sort((a, b) => a.position - b.position)
  return Promise.all(
    wes.map(async (we) => {
      const ex = byId.get(we.exercise_id)
      const eff = ex ? effective(ex, byId) : null
      return {
        name: ex ? displayName(ex, byId) : 'Unknown exercise',
        skipped: !!we.skipped_at,
        trackingType: eff?.trackingType ?? 'weight_reps',
        unilateral: eff?.isUnilateral ?? false,
        sets: (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray())
          .filter((s) => s.deleted_at === null)
          .sort((a, b) => a.position - b.position),
      }
    }),
  )
}

/** Soft-deletes a finished workout with all its exercises and sets. */
export async function deleteWorkout(w: Workout): Promise<void> {
  const ts = new Date().toISOString()
  const wes = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).filter((we) => we.deleted_at === null)
  const sets = (await db.workout_set.where('workout_exercise_id').anyOf(wes.map((we) => we.id)).toArray()).filter((s) => s.deleted_at === null)
  if (sets.length) await saveRows('workout_set', sets.map((s) => ({ ...s, deleted_at: ts })))
  if (wes.length) await saveRows('workout_exercise', wes.map((we) => ({ ...we, deleted_at: ts })))
  await saveRows('workout', [{ ...w, deleted_at: ts }])
}
