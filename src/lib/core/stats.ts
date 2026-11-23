// Strength metrics without database access (shared by the app and the Food connector, decision 23 November 2026).
// Definitions from docs/00_handover.md (Epley 1RM, volume).
import type { WorkoutSet } from './rows.ts'

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
