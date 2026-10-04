import { db, type Exercise, type ExerciseLink } from './db'
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
