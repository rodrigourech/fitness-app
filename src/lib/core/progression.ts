// Progression without database access (shared by the app and the Food connector, decision 23 November 2026).
import type { Workout, WorkoutExercise, WorkoutSet } from './rows.ts'
import type { RepetitionTargets } from '../training.ts'
import { lowerWeight, nextWeight, topIndex } from '../topset.ts'

export interface TrainingSession {
  workout: Workout
  exercise: WorkoutExercise
  sets: WorkoutSet[]
}

export type ProgressionAdvice = 'increase' | 'hold' | 'reduce' | null

export function workSets(sets: WorkoutSet[]) {
  return sets.filter((s) => s.deleted_at === null && s.set_type === 'working').sort((a, b) => a.position - b.position)
}

function repsOf(set: WorkoutSet, unilateral: boolean): number | null {
  return unilateral ? set.reps_left !== null && set.reps_right !== null ? Math.min(set.reps_left, set.reps_right) : null : set.reps
}

/** The top set: the first set at the heaviest weight (one top set, decision 20 November 2026); all sets without weight. */
function topWeightSets(sets: WorkoutSet[]): WorkoutSet[] {
  const top = topIndex(sets.map((s) => s.weight))
  return top === -1 ? sets : [sets[top]!]
}

/**
 * Progression (decisions 18 October 2026). Top set on: the sets at the top weight decide; back-off sets never
 * trigger a decision. Off: every work set decides. Increase when all deciding sets reached Max Reps; reduce when
 * the first deciding set stayed below Min Reps twice at the same weight and rest.
 */
export function progressionAdvice(sessions: TrainingSession[], targets: RepetitionTargets, unilateral: boolean, plannedCount: number, topSet = false): ProgressionAdvice {
  const deciding = (sets: WorkoutSet[]) => (topSet ? topWeightSets(sets) : sets)
  const latest = sessions[0]
  if (!latest) return null
  const previous = workSets(latest.sets)
  if (!previous.length) return null
  const top = deciding(previous)
  if (previous.length >= plannedCount && top.every((s) => (repsOf(s, unilateral) ?? 0) >= targets.target)) return 'increase'
  const older = sessions[1]
  if (!older) return 'hold'
  const before = workSets(older.sets)
  if (!before.length || previous.length < plannedCount || before.length < plannedCount) return 'hold'
  const olderTop = deciding(before)
  const load = top[0]!.weight
  const comparable = load !== null && load > 0 && olderTop[0]!.weight === load && latest.exercise.rest_s === older.exercise.rest_s
  const lastReps = repsOf(top[0]!, unilateral)
  const olderReps = repsOf(olderTop[0]!, unilateral)
  return comparable && lastReps !== null && olderReps !== null && lastReps < targets.minimum && olderReps < targets.minimum ? 'reduce' : 'hold'
}

export interface WorkTotals {
  /** Sum of reps; one-sided sets count both sides */
  reps: number
  /** Sum of weight × reps */
  volume: number
}

/** Totals of the work sets; with onlyDone only checked sets count (running workout). */
export function workTotals(sets: WorkoutSet[], unilateral: boolean, onlyDone = false): WorkTotals {
  let reps = 0
  let volume = 0
  for (const s of workSets(sets)) {
    if (onlyDone && s.completed_at === null) continue
    const r = unilateral ? (s.reps_left ?? 0) + (s.reps_right ?? 0) : s.reps ?? 0
    reps += r
    volume += (s.weight ?? 0) * r
  }
  return { reps, volume: Math.round(volume * 100) / 100 }
}

/** True if reps were entered and lie below the minimum (one side is enough for one-sided sets). */
export function belowMinimum(reps: number | null, minimum: number | null): boolean {
  return reps !== null && minimum !== null && reps < minimum
}

/** Recommended top-set weight for next time: same weight on hold, one step up or down, null without a weight step. */
export function nextWeightAfter(advice: ProgressionAdvice, current: number, step: number | null): number | null {
  if (advice === null || advice === 'hold') return current
  if (!step) return null
  return advice === 'increase' ? nextWeight(current, step) : lowerWeight(current, step)
}

/** Timed exercise (Plank): every planned work set held for the goal time of the template (decision 23 November 2026). */
export function durationReached(sets: WorkoutSet[], goalS: number | null, plannedCount: number): boolean {
  const work = workSets(sets)
  return goalS !== null && goalS > 0 && work.length > 0 && work.length >= plannedCount && work.every((s) => (s.duration_s ?? 0) >= goalS)
}

/**
 * Recent completed performances of the exact same exercise or variant over plain rows, newest first: the same rules as
 * recentTrainingSessions in workout.ts (finished, not deleted, exercise not skipped, at least one work set, one per
 * workout), for callers without IndexedDB such as the Food connector.
 */
export function trainingSessionsOf(exerciseId: string, rows: { workouts: Workout[]; wes: WorkoutExercise[]; sets: WorkoutSet[] }, limit = 2, templateId?: string | null): TrainingSession[] {
  const byWorkout = new Map(rows.workouts.map((w) => [w.id, w]))
  const candidates = rows.wes
    .filter((we) => we.exercise_id === exerciseId && we.deleted_at === null && !we.skipped_at)
    .flatMap((exercise) => {
      const workout = byWorkout.get(exercise.workout_id)
      return workout && workout.deleted_at === null && workout.finished_at !== null && (templateId === undefined || workout.template_id === templateId) ? [{ workout, exercise }] : []
    })
    .sort((a, b) => b.workout.started_at.localeCompare(a.workout.started_at))
  const result: TrainingSession[] = []
  const seen = new Set<string>()
  for (const c of candidates) {
    if (seen.has(c.workout.id)) continue
    const sets = rows.sets.filter((s) => s.workout_exercise_id === c.exercise.id && s.deleted_at === null).sort((a, b) => a.position - b.position)
    if (!sets.some((s) => s.set_type === 'working')) continue
    seen.add(c.workout.id)
    result.push({ ...c, sets })
    if (result.length === limit) break
  }
  return result
}
