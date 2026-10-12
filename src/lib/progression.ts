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

/** Conservative heuristic: only the first work set can trigger a repeated low-rep warning. */
export function progressionAdvice(sessions: TrainingSession[], targets: RepetitionTargets, unilateral: boolean, plannedCount: number): ProgressionAdvice {
  const latest = sessions[0]
  if (!latest) return null
  const previous = workSets(latest.sets)
  if (!previous.length) return null
  if (previous.length === plannedCount && previous.every((s) => (repsOf(s, unilateral) ?? 0) >= targets.target)) return 'increase'
  const older = sessions[1]
  if (!older) return 'hold'
  const before = workSets(older.sets)
  const first = previous[0]!
  const other = before[0]
  if (!other || previous.length !== plannedCount || before.length !== plannedCount) return 'hold'
  const load = first.weight
  const comparable = load !== null && load > 0 && [...previous, ...before].every((s) => s.weight === load)
    && latest.exercise.rest_s === older.exercise.rest_s
  const lastReps = repsOf(first, unilateral)
  const olderReps = repsOf(other, unilateral)
  return comparable && lastReps !== null && olderReps !== null && lastReps < targets.minimum && olderReps < targets.minimum ? 'reduce' : 'hold'
}

export interface RepComparison {
  total: number
  previousTotal: number | null
  delta: number | null
  completed: number
  planned: number
  reason: 'unfinished' | 'no_history' | 'different_sets' | 'different_weight' | 'missing_reps' | null
}

/** Only checked work sets count. A difference is shown only after a comparable performance is complete. */
export function compareRepetitions(current: WorkoutSet[], previous: WorkoutSet[], unilateral: boolean): RepComparison {
  const work = workSets(current)
  const before = workSets(previous)
  const done = work.filter((s) => s.completed_at !== null)
  const count = (s: WorkoutSet) => unilateral ? s.reps_left !== null && s.reps_right !== null ? s.reps_left + s.reps_right : null : s.reps
  const total = done.reduce((sum, s) => sum + (count(s) ?? 0), 0)
  const previousTotal = before.length && before.every((s) => count(s) !== null) ? before.reduce((sum, s) => sum + count(s)!, 0) : null
  const reason = !before.length ? 'no_history' : done.length !== work.length ? 'unfinished' : work.length !== before.length ? 'different_sets'
    : work.some((s, i) => s.weight !== before[i]!.weight) ? 'different_weight'
      : previousTotal === null || done.some((s) => count(s) === null) ? 'missing_reps' : null
  return { total, previousTotal, delta: reason === null ? total - previousTotal! : null, completed: done.length, planned: work.length, reason }
}

/** Increase-ready entries are evaluated separately for every active template and exercise variant. */
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
    if (!live.has(te.template_id)) continue
    const key = `${te.template_id}/${te.exercise_id}`
    if (seen.has(key)) continue
    seen.add(key)
    const ex = byId.get(te.exercise_id)
    if (!ex || effective(ex, byId).trackingType !== 'weight_reps') continue
    const sessions = await recentTrainingSessions(te.exercise_id, te.template_id)
    const planned = (await db.template_set.where('template_exercise_id').equals(te.id).toArray()).filter((s) => s.deleted_at === null && s.set_type === 'working')
    if (progressionAdvice(sessions, repetitionTargets(ex, byId, planned), effective(ex, byId).isUnilateral, planned.length) !== 'increase') continue
    out.push({ exerciseId: ex.id, templateId: te.template_id, templateName: templates.find((t) => t.id === te.template_id)!.name,
      name: displayName(ex, byId), lastDate: sessions[0]!.workout.started_at })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
