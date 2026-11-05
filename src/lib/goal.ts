import type { WorkoutSet } from './db'
import type { RepetitionTargets } from './training'
import { nextWeight } from './topset'

// Progress towards the next weight step (decision 5 November 2026, design «Progression im Workout», simpler version):
// the deciding sets are the top set (the sets at the heaviest weight) or, without a top set, every work set. The weight
// goes up once every deciding set reaches Max reps; back-off sets never count.

type Reps = Pick<WorkoutSet, 'reps' | 'reps_left' | 'reps_right'>
type Work = Pick<WorkoutSet, 'set_type' | 'weight' | 'reps' | 'reps_left' | 'reps_right' | 'completed_at' | 'position'>

/** Reps of a set; one-sided sets count the weaker side. */
export function repsOf(set: Reps, unilateral: boolean): number | null {
  if (!unilateral) return set.reps
  return set.reps_left !== null && set.reps_right !== null ? Math.min(set.reps_left, set.reps_right) : null
}

/** Indexes of the deciding sets among the work sets (in their order). */
export function decidingIndexes(work: Pick<WorkoutSet, 'weight'>[], topSet: boolean): number[] {
  if (!topSet) return work.map((_, i) => i)
  const top = Math.max(0, ...work.map((s) => s.weight ?? 0))
  if (top <= 0) return work.map((_, i) => i)
  return work.flatMap((s, i) => (s.weight === top ? [i] : []))
}

/** Lowest reps of the deciding sets that have reps, or null. */
export function decidingReps<T extends Work>(work: T[], topSet: boolean, unilateral: boolean, onlyDone = false): number | null {
  const reps = decidingIndexes(work, topSet)
    .map((i) => work[i]!)
    .filter((s) => !onlyDone || s.completed_at !== null)
    .map((s) => repsOf(s, unilateral))
    .filter((r): r is number => r !== null)
  return reps.length ? Math.min(...reps) : null
}

export interface GoalState {
  topSet: boolean
  /** Weight of the deciding sets now */
  weight: number
  target: number
  minimum: number
  /** Next weight with a known step, else null («heavier») */
  next: number | null
  /** Every deciding set is checked and reached Max reps in this workout */
  reached: boolean
  /** Lowest reps of the checked deciding sets today, null before the first one */
  todayReps: number | null
}

/** Goal line of an exercise in the running workout; null without a weight. */
export function goalState(work: Work[], topSet: boolean, unilateral: boolean, targets: RepetitionTargets, step: number | null): GoalState | null {
  const sorted = [...work].filter((s) => s.set_type === 'working').sort((a, b) => a.position - b.position)
  const weight = Math.max(0, ...sorted.map((s) => s.weight ?? 0))
  if (weight <= 0) return null
  const deciding = decidingIndexes(sorted, topSet).map((i) => sorted[i]!)
  const reached = deciding.length > 0 && deciding.every((s) => s.completed_at !== null && (repsOf(s, unilateral) ?? 0) >= targets.target)
  return {
    topSet,
    weight,
    target: targets.target,
    minimum: targets.minimum,
    next: step ? nextWeight(weight, step) : null,
    reached,
    todayReps: decidingReps(sorted, topSet, unilateral, true),
  }
}

/**
 * Start reps of a deciding set: last time plus one, at most Max reps. After Max reps was reached (the weight goes up)
 * or without a last value the middle of the range applies.
 */
export function startReps(last: number | null, targets: RepetitionTargets, middle: number): number {
  return last !== null && last < targets.target ? Math.min(targets.target, Math.max(last + 1, targets.minimum)) : middle
}

export interface ProgressPoint {
  date: string
  weight: number
  reps: number | null
  /** Weight went up against the workout before */
  up: boolean
}

/** One point per earlier workout (newest first): weight and lowest reps of the deciding sets. */
export function progressPoints(sessions: { date: string; sets: Work[] }[], topSet: boolean, unilateral: boolean): ProgressPoint[] {
  const points = sessions.flatMap((s) => {
    const work = s.sets.filter((x) => x.set_type === 'working').sort((a, b) => a.position - b.position)
    const weight = Math.max(0, ...work.map((x) => x.weight ?? 0))
    if (weight <= 0) return []
    return [{ date: s.date, weight, reps: decidingReps(work, topSet, unilateral), up: false }]
  })
  return points.map((p, i) => ({ ...p, up: i + 1 < points.length && p.weight > points[i + 1]!.weight }))
}
