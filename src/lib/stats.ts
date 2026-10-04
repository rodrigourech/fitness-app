import { db, type WorkoutSet } from './db'

// Analytics definitions from docs/00_handover.md (Epley 1RM, volume) and docs/entscheidungen.md (progression).

/** Reps counted for strength metrics; for one-sided sets the weaker side counts. */
export function effectiveReps(s: Pick<WorkoutSet, 'reps' | 'reps_left' | 'reps_right'>): number | null {
  if (s.reps !== null) return s.reps
  if (s.reps_left !== null && s.reps_right !== null) return Math.min(s.reps_left, s.reps_right)
  return s.reps_left ?? s.reps_right
}

/** Estimated one-rep max (Epley): w * (1 + r / 30). */
export function epley(weight: number | null, reps: number | null): number | null {
  if (weight === null || reps === null || weight <= 0 || reps <= 0) return null
  return weight * (1 + reps / 30)
}

/** Volume of working sets: weight * reps, one-sided sets count both sides. */
export function volume(sets: WorkoutSet[]): number {
  return sets
    .filter((s) => s.set_type === 'working' && s.deleted_at === null && s.weight !== null)
    .reduce((sum, s) => sum + s.weight! * (s.reps ?? (s.reps_left ?? 0) + (s.reps_right ?? 0)), 0)
}

export interface Best {
  maxWeight: number
  maxE1rm: number
  /** false if there is no earlier set: then nothing counts as a record */
  hasHistory: boolean
}

/** Best values of an exercise over all finished workouts except one. */
export async function bestBefore(exerciseId: string, excludeWorkoutId: string): Promise<Best> {
  const wes = (await db.workout_exercise.where('exercise_id').equals(exerciseId).toArray()).filter(
    (we) => we.deleted_at === null && we.workout_id !== excludeWorkoutId,
  )
  const workouts = await db.workout.bulkGet(wes.map((we) => we.workout_id))
  const valid = wes.filter((_, i) => workouts[i] && workouts[i]!.deleted_at === null && workouts[i]!.finished_at !== null)
  const sets = valid.length
    ? (await db.workout_set.where('workout_exercise_id').anyOf(valid.map((we) => we.id)).toArray()).filter(
        (s) => s.deleted_at === null && s.set_type === 'working',
      )
    : []
  let maxWeight = 0
  let maxE1rm = 0
  for (const s of sets) {
    const reps = effectiveReps(s)
    if (s.weight !== null && reps !== null && reps > 0) maxWeight = Math.max(maxWeight, s.weight)
    maxE1rm = Math.max(maxE1rm, epley(s.weight, reps) ?? 0)
  }
  return { maxWeight, maxE1rm, hasHistory: sets.length > 0 }
}

/** Record labels for a completed set compared with earlier workouts. */
export function recordsOf(s: WorkoutSet, best: Best): string[] {
  if (!best.hasHistory || s.completed_at === null || s.set_type !== 'working') return []
  const reps = effectiveReps(s)
  const out: string[] = []
  if (s.weight !== null && reps !== null && reps > 0 && s.weight > best.maxWeight) out.push('Weight')
  const e = epley(s.weight, reps)
  if (e !== null && e > best.maxE1rm + 1e-9) out.push('1RM')
  return out
}

/**
 * Progression rule (decision 4 October 2026): all working sets of the last workout reached the
 * target reps and the last working set had at least 2 RIR.
 */
export function shouldIncrease(previous: WorkoutSet[], targetReps: number | null): boolean {
  const working = previous.filter((s) => s.set_type === 'working')
  const last = working.at(-1)
  if (!last || targetReps === null || last.rir === null || last.rir < 2) return false
  return working.every((s) => (effectiveReps(s) ?? 0) >= targetReps)
}

/** Target reps for an exercise from the template the workout was started from. */
export async function targetRepsFor(templateId: string | null, exerciseId: string): Promise<number | null> {
  if (!templateId) return null
  const te = (await db.template_exercise.where('template_id').equals(templateId).toArray()).find(
    (x) => x.deleted_at === null && x.exercise_id === exerciseId,
  )
  if (!te) return null
  const sets = (await db.template_set.where('template_exercise_id').equals(te.id).toArray()).filter(
    (s) => s.deleted_at === null && s.set_type === 'working',
  )
  const values = sets.map((s) => s.target_reps_max ?? s.target_reps_min).filter((v): v is number => v !== null)
  return values.length ? Math.max(...values) : null
}
