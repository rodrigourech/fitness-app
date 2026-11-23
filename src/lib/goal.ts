import type { WorkoutSet } from './core/rows.ts'
import type { RepetitionTargets } from './training.ts'
import { nextWeight, topIndex } from './topset.ts'

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

/**
 * Indexes of the deciding sets among the work sets (in their order). Top set on: only the top set, the first set at
 * the heaviest weight (decision Rodrigo, 20 November 2026: one top set; a later set at the same weight is a back-off
 * set). Off: every work set.
 */
export function decidingIndexes(work: Pick<WorkoutSet, 'weight'>[], topSet: boolean): number[] {
  if (!topSet) return work.map((_, i) => i)
  const top = topIndex(work.map((s) => s.weight))
  return top === -1 ? work.map((_, i) => i) : [top]
}

/** Heaviest weight of the deciding sets, or null. */
function countingWeight(work: Pick<WorkoutSet, 'weight'>[], topSet: boolean): number | null {
  const w = decidingIndexes(work, topSet).map((i) => work[i]!.weight ?? 0)
  return w.length ? Math.max(...w) : null
}

/**
 * Which of the recent performances (work sets, newest first) prefills the next workout (decision Rodrigo,
 * 19 November 2026). A performance is skipped if its counting weight is heavier than the one before, the app did not
 * suggest that jump (not every counting set of the one before reached Max), and a counting set stayed below Min.
 * Then the older performance with the last qualified weight is used.
 */
export function prefillSource(recent: Work[][], topSet: boolean, unilateral: boolean, targets: Pick<RepetitionTargets, 'minimum' | 'target'>): number {
  let i = 0
  while (i + 1 < recent.length) {
    const now = recent[i]!
    const before = recent[i + 1]!
    const wNow = countingWeight(now, topSet)
    const wBefore = countingWeight(before, topSet)
    if (wNow === null || wBefore === null || wNow <= wBefore) return i
    const suggested = (decidingReps(before, topSet, unilateral) ?? 0) >= targets.target
    const nowLow = decidingIndexes(now, topSet).some((k) => {
      const r = repsOf(now[k]!, unilateral)
      return r !== null && r < targets.minimum
    })
    if (suggested || !nowLow) return i
    i += 1
  }
  return i
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

export interface HistoryBar {
  date: string
  /** Weight of the shown set, null when the workout had no such set */
  kg: number | null
  reps: number | null
}

/**
 * History bars of the progression sheet (decision 19 November 2026), oldest first. Top set on: «top» is the top set
 * (heaviest weight, lowest reps among the sets at that weight), «other» the back-off sets (their heaviest weight, lowest
 * reps). Top set off: «top» is the lowest set (every set counts), «other» set 1.
 */
export function historyBars(sessions: { date: string; sets: Work[] }[], topSet: boolean, unilateral: boolean): { top: HistoryBar[]; other: HistoryBar[] } {
  const top: HistoryBar[] = []
  const other: HistoryBar[] = []
  for (const s of [...sessions].reverse()) {
    const work = s.sets.filter((x) => x.set_type === 'working').sort((a, b) => a.position - b.position)
    const weight = Math.max(0, ...work.map((x) => x.weight ?? 0))
    if (weight <= 0) continue
    top.push({ date: s.date, kg: weight, reps: decidingReps(work, topSet, unilateral) })
    if (topSet) {
      const deciding = new Set(decidingIndexes(work, true))
      const backs = work.filter((_, i) => !deciding.has(i))
      const reps = backs.map((x) => repsOf(x, unilateral)).filter((r): r is number => r !== null)
      const kg = Math.max(0, ...backs.map((x) => x.weight ?? 0))
      other.push({ date: s.date, kg: backs.length && kg > 0 ? kg : null, reps: backs.length && reps.length ? Math.min(...reps) : null })
    } else {
      const first = work[0]
      other.push({ date: s.date, kg: first?.weight ?? null, reps: first ? repsOf(first, unilateral) : null })
    }
  }
  return { top, other }
}
