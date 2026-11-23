import { db, displayName, type WorkoutSet } from './db'
import { repetitionTargets } from './training'
import { effective, recentTrainingSessions } from './workout'
import { progressionAdvice, workSets } from './core/progression'

export { belowMinimum, nextWeightAfter, progressionAdvice, workTotals, type ProgressionAdvice, type WorkTotals } from './core/progression'

export interface ReadyExercise {
  exerciseId: string
  templateId: string
  templateName: string
  name: string
  lastDate: string
  /** Bodyweight or timed exercise: the next stage of the movement instead of more weight (decision 23 November 2026) */
  stage: boolean
}

/** Timed exercise (Plank): every planned work set held for the goal time of the template (decision 23 November 2026). */
export function durationReached(sets: WorkoutSet[], goalS: number | null, plannedCount: number): boolean {
  const work = workSets(sets)
  return goalS !== null && goalS > 0 && work.length > 0 && work.length >= plannedCount && work.every((s) => (s.duration_s ?? 0) >= goalS)
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
    if (!ex) continue
    const eff = effective(ex, byId)
    if (eff.trackingType !== 'weight_reps' && eff.trackingType !== 'duration') continue
    const sessions = await recentTrainingSessions(te.exercise_id)
    const latest = sessions[0]
    if (!latest) continue
    // Planned count and targets of the workout the last performance came from (its snapshot), else this template
    const source = latest.workout.template_id
      ? await db.template_exercise.where('template_id').equals(latest.workout.template_id).filter((row) => row.exercise_id === te.exercise_id && row.deleted_at === null).first()
      : undefined
    const planned = (await db.template_set.where('template_exercise_id').equals((source ?? te).id).toArray()).filter((s) => s.deleted_at === null && s.set_type === 'working')
    const plannedCount = planned.length || workSets(latest.sets).length
    if (eff.trackingType === 'duration') {
      const goal = planned.reduce<number | null>((m, s) => (s.target_duration_s === null ? m : Math.max(m ?? 0, s.target_duration_s)), null)
      if (!durationReached(latest.sets, goal, plannedCount)) continue
    } else {
      const defaults = repetitionTargets(ex, byId, planned)
      const targets = { target: latest.exercise.target_reps ?? defaults.target, minimum: latest.exercise.min_reps ?? defaults.minimum }
      if (progressionAdvice(sessions, targets, eff.isUnilateral, plannedCount, eff.topSet) !== 'increase') continue
    }
    out.push({ exerciseId: ex.id, templateId: te.template_id, templateName: templates.find((t) => t.id === te.template_id)!.name,
      name: displayName(ex, byId), lastDate: latest.workout.started_at, stage: eff.bodyweight || eff.trackingType === 'duration' })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
