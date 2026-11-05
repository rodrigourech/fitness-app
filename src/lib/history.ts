import { db, displayName, type Exercise, type Workout, type WorkoutExercise, type WorkoutSet } from './db'
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
  /** Minimum reps per work set (snapshot of the workout, else the exercise setting); null = not weight_reps */
  minReps: number | null
  /** Planned exercise when its alternative was trained (decision 22 October 2026) */
  alternativeFor: string | null
  /** Setting «Top set» of the exercise (variants inherit it); labels the sets Top set / Back-off */
  topSet: boolean
  /** The row of this exercise in the workout, for editing afterwards */
  workoutExercise: WorkoutExercise
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
        alternativeFor: we.original_exercise_id && byId.get(we.original_exercise_id) ? displayName(byId.get(we.original_exercise_id)!, byId) : null,
        minReps: (eff?.trackingType ?? 'weight_reps') === 'weight_reps' ? we.min_reps ?? eff?.minReps ?? null : null,
        topSet: (eff?.trackingType ?? 'weight_reps') === 'weight_reps' && (eff?.topSet ?? false),
        workoutExercise: we,
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

// --- editing a finished workout afterwards -------------------------------------------
// Every change goes through saveRows (updated_at and sync outbox). Records, stats and the history list
// are computed from the sets, so they follow automatically.

async function liveSets(workoutExerciseId: string): Promise<WorkoutSet[]> {
  return (await db.workout_set.where('workout_exercise_id').equals(workoutExerciseId).toArray())
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.position - b.position)
}

/** Changes values of a set of a finished workout (weight, reps, duration, distance). */
export async function updateHistorySet(set: WorkoutSet, patch: Partial<WorkoutSet>): Promise<void> {
  const current = (await db.workout_set.get(set.id)) ?? set
  await saveRows('workout_set', [{ ...current, ...patch }])
}

/**
 * Adds a work set to an exercise of a finished workout: values copied from the last work set (else the last set),
 * done at the end of the workout. A skipped exercise counts as trained again.
 */
export async function addHistorySet(we: WorkoutExercise, w: Workout): Promise<WorkoutSet> {
  const sets = await liveSets(we.id)
  const last = sets.filter((s) => s.set_type === 'working').at(-1) ?? sets.at(-1)
  const ts = new Date().toISOString()
  const set: WorkoutSet = {
    id: crypto.randomUUID(),
    workout_exercise_id: we.id,
    position: Math.max(0, ...sets.map((s) => s.position)) + 1,
    set_type: 'working',
    weight: last?.weight ?? null,
    reps: last?.reps ?? null,
    reps_left: last?.reps_left ?? null,
    reps_right: last?.reps_right ?? null,
    duration_s: last?.duration_s ?? null,
    distance_km: last?.distance_km ?? null,
    rir: null,
    completed_at: w.finished_at ?? ts,
    user_id: we.user_id,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  }
  await saveRows('workout_set', [set])
  const current = (await db.workout_exercise.get(we.id)) ?? we
  if (current.skipped_at) await saveRows('workout_exercise', [{ ...current, skipped_at: null }])
  return set
}

/**
 * Removes a set of a finished workout (soft delete). Removing the last set marks the exercise as skipped,
 * as when finishing a workout (an exercise without a done set stays in the history as «Skipped»).
 */
export async function removeHistorySet(set: WorkoutSet): Promise<void> {
  const current = (await db.workout_set.get(set.id)) ?? set
  if (current.deleted_at !== null) return
  const ts = new Date().toISOString()
  await saveRows('workout_set', [{ ...current, deleted_at: ts }])
  if ((await liveSets(current.workout_exercise_id)).length > 0) return
  const we = await db.workout_exercise.get(current.workout_exercise_id)
  if (we && !we.skipped_at) await saveRows('workout_exercise', [{ ...we, skipped_at: ts }])
}
