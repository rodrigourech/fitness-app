import { db, displayName } from './db'
import { shouldIncrease, suggestWeight, targetRepsFor, type WeightSuggestion } from './stats'
import { effective, previousSets } from './workout'

export interface ReadyExercise extends WeightSuggestion {
  exerciseId: string
  name: string
  lastDate: string
}

/**
 * Exercises of the current workouts (templates) whose progression rule is met by the last workout:
 * all working sets reached the target reps and the last one had RIR >= 2.
 */
export async function readyToIncrease(): Promise<ReadyExercise[]> {
  const [templates, tes, exercises] = await Promise.all([
    db.template.filter((t) => t.deleted_at === null).toArray(),
    db.template_exercise.filter((te) => te.deleted_at === null).toArray(),
    db.exercise.toArray(),
  ])
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const live = new Set(templates.map((t) => t.id))
  const seen = new Set<string>()
  const out: ReadyExercise[] = []
  for (const te of tes) {
    if (!live.has(te.template_id) || seen.has(te.exercise_id)) continue
    seen.add(te.exercise_id)
    const ex = byId.get(te.exercise_id)
    if (!ex || effective(ex, byId).trackingType !== 'weight_reps') continue
    const prev = await previousSets(te.exercise_id)
    if (!shouldIncrease(prev, await targetRepsFor(te.template_id, te.exercise_id))) continue
    const s = suggestWeight(prev, effective(ex, byId).weightStep)
    if (!s) continue
    const lastDate =
      prev
        .map((p) => p.completed_at ?? p.updated_at)
        .sort()
        .at(-1) ?? ''
    out.push({ ...s, exerciseId: ex.id, name: displayName(ex, byId), lastDate })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
