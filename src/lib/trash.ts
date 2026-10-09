import { db, type BodyPhoto, type BodyWeight, type Template, type Workout } from './db'
import { deletePendingPhotoObjects, queuePhotoObjectDeletes } from './photos'
import { saveRows } from './sync'

// Trash (decision 8 October 2026, docs/entscheidungen.md).
//
// Deleting only sets deleted_at. Everything deleted in the last TRASH_DAYS days and not purged is
// listed here and can be restored. Rows deleted together (a workout with its exercises and sets, a
// body weight entry with the photos of its day) share the same deleted_at and are restored together;
// rows deleted earlier on their own (e.g. a set removed during the workout) stay deleted.
// "Delete permanently" sets purged_at; for photos the encrypted object in the bucket is deleted then.

export const TRASH_DAYS = 30
const DAY = 86_400_000
/** Before the trash existed, deleting a photo removed its object in the bucket right away;
 * such photos cannot be restored and are not listed. */
const PHOTO_TRASH_SINCE = Date.parse('2026-10-08T00:00:00Z')

export type TrashItem =
  | { kind: 'body_weight'; id: string; deletedAt: string; entry: BodyWeight; photos: BodyPhoto[] }
  | { kind: 'body_photo'; id: string; deletedAt: string; photo: BodyPhoto }
  | { kind: 'workout'; id: string; deletedAt: string; workout: Workout; exercises: number; sets: number }
  | { kind: 'template'; id: string; deletedAt: string; template: Template; exercises: number }

/** Same instant: Postgres returns +00:00, the app writes Z. */
function sameTime(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && Date.parse(a) === Date.parse(b)
}

function inTrash(row: { deleted_at: string | null; purged_at?: string | null }, cutoff: number): boolean {
  return row.deleted_at !== null && !row.purged_at && Date.parse(row.deleted_at) > cutoff
}

/** Full days until an item deleted at `deletedAt` leaves the trash; 0 on its last day. */
export function daysLeft(deletedAt: string, now = Date.now()): number {
  return Math.max(0, Math.floor((Date.parse(deletedAt) + TRASH_DAYS * DAY - now) / DAY))
}

/** Everything in the trash, most recently deleted first. Cancelled (unfinished) workouts are not listed. */
export async function trashItems(now = Date.now()): Promise<TrashItem[]> {
  const cutoff = now - TRASH_DAYS * DAY
  const [weights, photos, workouts, templates] = await Promise.all([
    db.body_weight.filter((b) => inTrash(b, cutoff)).toArray(),
    db.body_photo.filter((p) => inTrash(p, Math.max(cutoff, PHOTO_TRASH_SINCE))).toArray(),
    db.workout.filter((w) => w.finished_at !== null && inTrash(w, cutoff)).toArray(),
    db.template.filter((t) => inTrash(t, cutoff)).toArray(),
  ])
  const items: TrashItem[] = []

  const grouped = new Set<string>()
  for (const entry of weights) {
    const own = photos.filter((p) => p.measured_on === entry.measured_on && sameTime(p.deleted_at, entry.deleted_at))
    own.forEach((p) => grouped.add(p.id))
    items.push({ kind: 'body_weight', id: entry.id, deletedAt: entry.deleted_at!, entry, photos: own })
  }
  for (const photo of photos)
    if (!grouped.has(photo.id)) items.push({ kind: 'body_photo', id: photo.id, deletedAt: photo.deleted_at!, photo })

  for (const workout of workouts) {
    const { wes, sets } = await workoutParts(workout)
    items.push({ kind: 'workout', id: workout.id, deletedAt: workout.deleted_at!, workout, exercises: wes.length, sets: sets.length })
  }
  for (const template of templates) {
    const { tes } = await templateParts(template)
    items.push({ kind: 'template', id: template.id, deletedAt: template.deleted_at!, template, exercises: tes.length })
  }
  return items.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))
}

/** Exercises and planned sets deleted together with the workout template. */
async function templateParts(t: Template) {
  const tes = (await db.template_exercise.where('template_id').equals(t.id).toArray()).filter((te) => sameTime(te.deleted_at, t.deleted_at))
  const sets = (await db.template_set.where('template_exercise_id').anyOf(tes.map((te) => te.id)).toArray()).filter((s) =>
    sameTime(s.deleted_at, t.deleted_at),
  )
  return { tes, sets }
}

/** Exercises and sets deleted together with the workout. */
async function workoutParts(w: Workout) {
  const wes = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).filter((we) => sameTime(we.deleted_at, w.deleted_at))
  const sets = (await db.workout_set.where('workout_exercise_id').anyOf(wes.map((we) => we.id)).toArray()).filter((s) =>
    sameTime(s.deleted_at, w.deleted_at),
  )
  return { wes, sets }
}

/** The active entry of the same day that a restore would replace, if any. */
export async function restoreConflict(item: TrashItem): Promise<BodyWeight | null> {
  if (item.kind !== 'body_weight') return null
  const day = await db.body_weight.where('measured_on').equals(item.entry.measured_on).toArray()
  return day.find((b) => b.deleted_at === null && b.id !== item.id) ?? null
}

/**
 * Restores an item from the trash. A restored body weight entry replaces an active entry of the same
 * day; that one moves to the trash itself (ask first with restoreConflict).
 */
export async function restoreItem(item: TrashItem): Promise<void> {
  if (item.kind === 'body_weight') {
    const entry = await db.body_weight.get(item.id)
    if (!entry || entry.deleted_at === null) return
    const current = await restoreConflict(item)
    if (current) await saveRows('body_weight', [{ ...current, deleted_at: new Date().toISOString() }])
    const photos = (await db.body_photo.where('measured_on').equals(entry.measured_on).toArray()).filter(
      (p) => !p.purged_at && sameTime(p.deleted_at, entry.deleted_at),
    )
    if (photos.length) await saveRows('body_photo', photos.map((p) => ({ ...p, deleted_at: null })))
    await saveRows('body_weight', [{ ...entry, deleted_at: null }])
  } else if (item.kind === 'body_photo') {
    const photo = await db.body_photo.get(item.id)
    if (!photo || photo.deleted_at === null || photo.purged_at) return
    await saveRows('body_photo', [{ ...photo, deleted_at: null }])
  } else if (item.kind === 'template') {
    const t = await db.template.get(item.id)
    if (!t || t.deleted_at === null) return
    const { tes, sets } = await templateParts(t)
    // Comes back into the archive (archived_at stays)
    await saveRows('template', [{ ...t, deleted_at: null }])
    if (tes.length) await saveRows('template_exercise', tes.map((te) => ({ ...te, deleted_at: null })))
    if (sets.length) await saveRows('template_set', sets.map((s) => ({ ...s, deleted_at: null })))
  } else {
    const w = await db.workout.get(item.id)
    if (!w || w.deleted_at === null) return
    const { wes, sets } = await workoutParts(w)
    // Parents first, matching the push order of the sync
    await saveRows('workout', [{ ...w, deleted_at: null }])
    if (wes.length) await saveRows('workout_exercise', wes.map((we) => ({ ...we, deleted_at: null })))
    if (sets.length) await saveRows('workout_set', sets.map((s) => ({ ...s, deleted_at: null })))
  }
}

/** Removes items from the trash for good. */
export async function purgeItems(items: TrashItem[]): Promise<void> {
  const ts = new Date().toISOString()
  const weights = items.flatMap((i) => (i.kind === 'body_weight' ? [i.entry] : []))
  const photos = items.flatMap((i) => (i.kind === 'body_weight' ? i.photos : i.kind === 'body_photo' ? [i.photo] : []))
  const workouts = items.flatMap((i) => (i.kind === 'workout' ? [i.workout] : []))
  const templates = items.flatMap((i) => (i.kind === 'template' ? [i.template] : []))
  if (weights.length) await saveRows('body_weight', weights.map((b) => ({ ...b, purged_at: ts })))
  if (photos.length) await saveRows('body_photo', photos.map((p) => ({ ...p, purged_at: ts })))
  if (workouts.length) await saveRows('workout', workouts.map((w) => ({ ...w, purged_at: ts })))
  if (templates.length) await saveRows('template', templates.map((t) => ({ ...t, purged_at: ts })))
  await queuePhotoObjectDeletes(photos.map((p) => p.id))
}

/**
 * Housekeeping on app start: photos that have been in the trash longer than TRASH_DAYS are purged
 * (bucket object deleted). Other rows simply drop out of the list; they need no write.
 */
export async function purgeExpired(now = Date.now()): Promise<number> {
  const cutoff = now - TRASH_DAYS * DAY
  const expired = await db.body_photo.filter((p) => p.deleted_at !== null && !p.purged_at && Date.parse(p.deleted_at) <= cutoff).toArray()
  if (expired.length) {
    const ts = new Date(now).toISOString()
    await saveRows('body_photo', expired.map((p) => ({ ...p, purged_at: ts })))
    await queuePhotoObjectDeletes(expired.map((p) => p.id))
  }
  await deletePendingPhotoObjects()
  return expired.length
}
