// Top set of a performance without database access (shared by the app and the Food connector, decision 23 November 2026).
import type { WorkoutSet } from './rows.ts'

export interface TopSet {
  weight: number
  reps: number | null
  repsLeft: number | null
  repsRight: number | null
}

/** Reps that count for comparing: reps, or the weaker side of a one-sided set. */
export function comparingReps(s: Pick<WorkoutSet, 'reps' | 'reps_left' | 'reps_right'>): number {
  if (s.reps !== null) return s.reps
  const sides = [s.reps_left, s.reps_right].filter((r): r is number => r !== null)
  return sides.length ? Math.min(...sides) : 0
}

/** Top set of the given work sets: heaviest weight, then most reps; null without a weight above 0. */
export function topSetOf(sets: Pick<WorkoutSet, 'set_type' | 'weight' | 'reps' | 'reps_left' | 'reps_right'>[]): TopSet | null {
  let best: (typeof sets)[number] | null = null
  for (const s of sets) {
    if (s.set_type !== 'working' || s.weight === null || s.weight <= 0) continue
    if (!best || s.weight > best.weight! || (s.weight === best.weight && comparingReps(s) > comparingReps(best))) best = s
  }
  return best ? { weight: best.weight!, reps: best.reps, repsLeft: best.reps_left, repsRight: best.reps_right } : null
}

/** Bodyweight exercise: the work set with the most reps (weaker side for one-sided sets) as a top set with weight 0. */
export function bestRepsSet(sets: Pick<WorkoutSet, 'set_type' | 'reps' | 'reps_left' | 'reps_right'>[]): TopSet | null {
  let best: (typeof sets)[number] | null = null
  for (const s of sets) {
    if (s.set_type !== 'working' || comparingReps(s) <= 0) continue
    if (!best || comparingReps(s) > comparingReps(best)) best = s
  }
  return best ? { weight: 0, reps: best.reps, repsLeft: best.reps_left, repsRight: best.reps_right } : null
}
