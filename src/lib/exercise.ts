import { db, type Exercise, type ExerciseLink, type TrackingType } from './db'
import { saveRows } from './sync'

// Exercise master data edits: focus muscles, cue and reference links.

export async function updateExercise(ex: Exercise, patch: Partial<Exercise>): Promise<void> {
  const current = (await db.exercise.get(ex.id)) ?? ex
  await saveRows('exercise', [{ ...current, ...patch }])
}

/** Links of the exercise and, for a variant, of its parent. */
export async function linksFor(ex: Exercise): Promise<(ExerciseLink & { inherited: boolean })[]> {
  const ids = ex.parent_id ? [ex.id, ex.parent_id] : [ex.id]
  const links = await db.exercise_link.where('exercise_id').anyOf(ids).toArray()
  return links
    .filter((l) => l.deleted_at === null)
    .map((l) => ({ ...l, inherited: l.exercise_id !== ex.id }))
    .sort((a, b) => Number(a.inherited) - Number(b.inherited) || a.created_at.localeCompare(b.created_at))
}

/** Accepts URLs with or without scheme; returns null for invalid input. */
export function normalizeUrl(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export async function addLink(ex: Exercise, url: string, title: string | null): Promise<void> {
  const ts = new Date().toISOString()
  await saveRows('exercise_link', [
    {
      id: crypto.randomUUID(),
      user_id: ex.user_id,
      exercise_id: ex.id,
      url,
      title,
      created_at: ts,
      updated_at: ts,
      deleted_at: null,
    } satisfies ExerciseLink,
  ])
}

export async function removeLink(link: ExerciseLink): Promise<void> {
  const current = (await db.exercise_link.get(link.id)) ?? link
  await saveRows('exercise_link', [{ ...current, deleted_at: new Date().toISOString() }])
}

/** Short label for a link: its title or the host name. */
export function linkLabel(link: ExerciseLink): string {
  if (link.title) return link.title
  try {
    return new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    return link.url
  }
}

export interface NewExercise {
  name: string
  trackingType: TrackingType
  isUnilateral: boolean
  restS: number | null
  note: string | null
  /** Optional values taken from the exercise catalog */
  equipment?: string | null
  musclesPrimary?: string[]
  musclesSecondary?: string[]
  focusMuscles?: string[]
  sourceId?: string | null
}

function blankExercise(userId: string, ts: string): Exercise {
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    parent_id: null,
    name: '',
    equipment: null,
    muscles_primary: null,
    muscles_secondary: null,
    tracking_type: null,
    is_unilateral: null,
    weight_step: null,
    default_rest_s: null,
    floor: null,
    seat: null,
    foot_position: null,
    setup_note: null,
    source_id: null,
    focus_muscles: null,
    focus_cue: null,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  }
}

/** Creates a main exercise. Returns its id. */
export async function createExercise(userId: string, input: NewExercise): Promise<string> {
  const ts = new Date().toISOString()
  const ex: Exercise = {
    ...blankExercise(userId, ts),
    name: input.name.trim(),
    tracking_type: input.trackingType,
    is_unilateral: input.trackingType === 'weight_reps' ? input.isUnilateral : false,
    equipment: input.equipment ?? null,
    muscles_primary: input.musclesPrimary ?? [],
    muscles_secondary: input.musclesSecondary ?? [],
    default_rest_s: input.restS,
    setup_note: input.note,
    focus_muscles: input.focusMuscles ?? [],
    source_id: input.sourceId ?? null,
  }
  await saveRows('exercise', [ex])
  return ex.id
}

/** Creates a variant that inherits tracking, muscles, rest and links from its parent. Returns its id. */
export async function createVariant(parent: Exercise, name: string, note: string | null): Promise<string> {
  const ts = new Date().toISOString()
  const ex: Exercise = { ...blankExercise(parent.user_id, ts), parent_id: parent.id, name: name.trim(), setup_note: note }
  await saveRows('exercise', [ex])
  return ex.id
}

export interface ExerciseOption {
  id: string
  label: string
  isVariant: boolean
}

/** All active exercises, main exercises alphabetically with their variants right below. */
export async function exerciseOptions(): Promise<ExerciseOption[]> {
  const all = (await db.exercise.toArray()).filter((e) => e.deleted_at === null)
  const mains = all.filter((e) => e.parent_id === null).sort((a, b) => a.name.localeCompare(b.name))
  const out: ExerciseOption[] = []
  for (const m of mains) {
    out.push({ id: m.id, label: m.name, isVariant: false })
    for (const v of all.filter((e) => e.parent_id === m.id).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ id: v.id, label: `${m.name} – ${v.name}`, isVariant: true })
    }
  }
  return out
}
