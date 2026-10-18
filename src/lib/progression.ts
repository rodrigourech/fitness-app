import { db, displayName, type WorkoutSet } from './db'
import { repetitionTargets, type RepetitionTargets } from './training'
import { effective, recentTrainingSessions, type TrainingSession } from './workout'

export interface ReadyExercise {
  exerciseId: string
  templateId: string
  templateName: string
  name: string
  lastDate: string
}

export type ProgressionAdvice = 'increase' | 'hold' | 'reduce' | null

function workSets(sets: WorkoutSet[]) {
  return sets.filter((s) => s.deleted_at === null && s.set_type === 'working').sort((a, b) => a.position - b.position)
}

function repsOf(set: WorkoutSet, unilateral: boolean): number | null {
  return unilateral ? set.reps_left !== null && set.reps_right !== null ? Math.min(set.reps_left, set.reps_right) : null : set.reps
}

/** Work sets that carry the heaviest weight (the top set, or all sets at equal weight; all sets without weight). */
function topWeightSets(sets: WorkoutSet[]): WorkoutSet[] {
  const top = Math.max(0, ...sets.map((s) => s.weight ?? 0))
  return top > 0 ? sets.filter((s) => s.weight === top) : sets
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

/**
 * Exercises (variants separately) of the active workouts whose last performance in any workout reached the
 * Max Reps in every deciding set (decisions 15 and 18 October 2026).
 */
export async function readyToIncrease(): Promise<ReadyExercise[]> {
  const [templates, tes, exercises] = await Promise.all([
    db.template.filter((t) => t.deleted_at === null && !t.archived_at).toArray(),
    db.template_exercise.filter((te) => te.deleted_at === null).toArray(),
    db.exercise.toArray(),
  ])
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const live = new Set(templates.map((t) => t.id))
  const out: ReadyExercise[] = []
  const seen = new Set<string>()
  for (const te of tes) {
    if (!live.has(te.template_id) || seen.has(te.exercise_id)) continue
    seen.add(te.exercise_id)
    const ex = byId.get(te.exercise_id)
    if (!ex || effective(ex, byId).trackingType !== 'weight_reps') continue
    const sessions = await recentTrainingSessions(te.exercise_id)
    const latest = sessions[0]
    if (!latest) continue
    // Planned count and targets of the workout the last performance came from (its snapshot), else this template
    const source = latest.workout.template_id
      ? await db.template_exercise.where('template_id').equals(latest.workout.template_id).filter((row) => row.exercise_id === te.exercise_id && row.deleted_at === null).first()
      : undefined
    const planned = (await db.template_set.where('template_exercise_id').equals((source ?? te).id).toArray()).filter((s) => s.deleted_at === null && s.set_type === 'working')
    const defaults = repetitionTargets(ex, byId, planned)
    const targets = { target: latest.exercise.target_reps ?? defaults.target, minimum: latest.exercise.min_reps ?? defaults.minimum }
    const plannedCount = planned.length || workSets(latest.sets).length
    const eff = effective(ex, byId)
    if (progressionAdvice(sessions, targets, eff.isUnilateral, plannedCount, eff.topSet) !== 'increase') continue
    out.push({ exerciseId: ex.id, templateId: te.template_id, templateName: templates.find((t) => t.id === te.template_id)!.name,
      name: displayName(ex, byId), lastDate: latest.workout.started_at })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
