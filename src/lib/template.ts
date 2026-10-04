import { db, type Template, type TemplateExercise, type TemplateSet } from './db'
import { saveRows } from './sync'
import { effective, previousSets } from './workout'

// Template editing. Workouts copy a template at start, so edits never change past workouts.

const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

function base(userId: string, ts: string) {
  return { user_id: userId, created_at: ts, updated_at: ts, deleted_at: null }
}

export async function createTemplate(userId: string, name: string): Promise<string> {
  const ts = now()
  const t: Template = { id: uuid(), name: name.trim() || 'New template', note: null, ...base(userId, ts) }
  await saveRows('template', [t])
  return t.id
}

export async function renameTemplate(t: Template, name: string): Promise<void> {
  const current = (await db.template.get(t.id)) ?? t
  if (name.trim()) await saveRows('template', [{ ...current, name: name.trim() }])
}

async function activeExercises(templateId: string): Promise<TemplateExercise[]> {
  return (await db.template_exercise.where('template_id').equals(templateId).toArray())
    .filter((te) => te.deleted_at === null)
    .sort((a, b) => a.position - b.position)
}

export async function activeSets(teId: string): Promise<TemplateSet[]> {
  return (await db.template_set.where('template_exercise_id').equals(teId).toArray())
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.position - b.position)
}

export async function deleteTemplate(t: Template): Promise<void> {
  const ts = now()
  const tes = await activeExercises(t.id)
  for (const te of tes) {
    const sets = await activeSets(te.id)
    if (sets.length) await saveRows('template_set', sets.map((s) => ({ ...s, deleted_at: ts })))
  }
  if (tes.length) await saveRows('template_exercise', tes.map((te) => ({ ...te, deleted_at: ts })))
  await saveRows('template', [{ ...t, deleted_at: ts }])
}

type Targets = Pick<TemplateSet, 'target_reps_min' | 'target_reps_max' | 'target_weight' | 'target_duration_s' | 'target_distance_km'>

function newSet(te: TemplateExercise, position: number, targets: Targets): TemplateSet {
  return { id: uuid(), template_exercise_id: te.id, position, set_type: 'working', ...targets, ...base(te.user_id, now()) }
}

/** Adds an exercise at the end with 3 sets (1 for time or distance), targets from the last performance. */
export async function addTemplateExercise(templateId: string, exerciseId: string): Promise<void> {
  const template = await db.template.get(templateId)
  const ex = await db.exercise.get(exerciseId)
  if (!template || !ex) throw new Error('Template or exercise not found')
  const parent = ex.parent_id ? await db.exercise.get(ex.parent_id) : undefined
  const eff = effective(ex, new Map([[ex.id, ex], ...(parent ? ([[parent.id, parent]] as const) : [])]))
  const existing = await activeExercises(templateId)
  const te: TemplateExercise = {
    id: uuid(),
    template_id: templateId,
    exercise_id: ex.id,
    position: Math.max(0, ...existing.map((e) => e.position)) + 1,
    rest_s: null,
    comment: null,
    ...base(template.user_id, now()),
  }
  const last = (await previousSets(ex.id)).filter((s) => s.set_type === 'working').at(-1)
  const weightReps = eff.trackingType === 'weight_reps'
  const targets: Targets = {
    target_reps_min: weightReps ? 10 : null,
    target_reps_max: weightReps ? 10 : null,
    target_weight: weightReps ? (last?.weight ?? null) : null,
    target_duration_s: eff.trackingType === 'weight_reps' ? null : (last?.duration_s ?? null),
    target_distance_km: eff.trackingType === 'distance_duration' ? (last?.distance_km ?? null) : null,
  }
  const count = weightReps ? 3 : 1
  await saveRows('template_exercise', [te])
  await saveRows('template_set', Array.from({ length: count }, (_, i) => newSet(te, i + 1, targets)))
}

export async function removeTemplateExercise(te: TemplateExercise): Promise<void> {
  const ts = now()
  const sets = await activeSets(te.id)
  if (sets.length) await saveRows('template_set', sets.map((s) => ({ ...s, deleted_at: ts })))
  await saveRows('template_exercise', [{ ...te, deleted_at: ts }])
}

/** Moves an exercise one place up (-1) or down (+1). */
export async function moveTemplateExercise(te: TemplateExercise, direction: -1 | 1): Promise<void> {
  const list = await activeExercises(te.template_id)
  const i = list.findIndex((x) => x.id === te.id)
  const j = i + direction
  if (i < 0 || j < 0 || j >= list.length) return
  // Renumber 1..n to repair gaps, then swap the two neighbours
  const reordered = [...list]
  ;[reordered[i], reordered[j]] = [reordered[j]!, reordered[i]!]
  const changed = reordered.map((x, k) => ({ ...x, position: k + 1 })).filter((x, k) => list.find((o) => o.id === x.id)!.position !== k + 1)
  if (changed.length) await saveRows('template_exercise', changed)
}

/** Switches the template entry to another exercise (e.g. a different variant); planned sets stay. */
export async function setTemplateExerciseVariant(te: TemplateExercise, exerciseId: string): Promise<void> {
  const current = (await db.template_exercise.get(te.id)) ?? te
  if (current.exercise_id !== exerciseId) await saveRows('template_exercise', [{ ...current, exercise_id: exerciseId }])
}

/** Sets the number of planned sets; new sets copy the targets of the last one. */
export async function setPlannedSetCount(te: TemplateExercise, count: number): Promise<void> {
  const sets = await activeSets(te.id)
  const n = Math.max(1, Math.min(10, count))
  if (n > sets.length) {
    const last = sets.at(-1)
    const targets: Targets = {
      target_reps_min: last?.target_reps_min ?? null,
      target_reps_max: last?.target_reps_max ?? null,
      target_weight: last?.target_weight ?? null,
      target_duration_s: last?.target_duration_s ?? null,
      target_distance_km: last?.target_distance_km ?? null,
    }
    const start = (last?.position ?? 0) + 1
    await saveRows('template_set', Array.from({ length: n - sets.length }, (_, i) => newSet(te, start + i, targets)))
  } else if (n < sets.length) {
    const ts = now()
    await saveRows('template_set', sets.slice(n).map((s) => ({ ...s, deleted_at: ts })))
  }
}

/** Applies the same targets to all planned sets of the exercise. */
export async function setPlannedTargets(te: TemplateExercise, patch: Partial<Targets>): Promise<void> {
  const sets = await activeSets(te.id)
  if (sets.length) await saveRows('template_set', sets.map((s) => ({ ...s, ...patch })))
}
