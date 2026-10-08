import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteBodyWeight, saveBodyWeight } from './body'
import { db, getMeta, type BodyPhoto, type Workout } from './db'
import { deleteWorkout } from './history'
import { deletePhoto } from './photos'
import { daysLeft, purgeExpired, purgeItems, restoreConflict, restoreItem, trashItems } from './trash'

const base = { user_id: 'u1', created_at: '2026-10-08T06:00:00Z', updated_at: '2026-10-08T06:00:00Z', deleted_at: null }

function photo(id: string, measured_on: string): BodyPhoto {
  return { ...base, id, measured_on, pose: 'front', object_key: `u1/${id}`, iv: 'aXY=', mime: 'image/jpeg', width: 10, height: 10, bytes: 1 }
}

async function addWorkout(): Promise<Workout> {
  const w: Workout = {
    ...base,
    id: 'w1',
    template_id: null,
    template_name_snapshot: 'Push',
    started_at: '2026-10-07T17:00:00Z',
    finished_at: '2026-10-07T18:00:00Z',
    note: null,
  }
  await db.workout.put(w)
  await db.workout_exercise.bulkPut([
    { ...base, id: 'we1', workout_id: 'w1', exercise_id: 'e1', position: 1, rest_s: null, comment: null },
    { ...base, id: 'we2', workout_id: 'w1', exercise_id: 'e2', position: 2, rest_s: null, comment: null },
  ])
  const set = { set_type: 'working' as const, weight: 50, reps: 8, reps_left: null, reps_right: null, rir: null, duration_s: null, distance_km: null, completed_at: null }
  await db.workout_set.bulkPut([
    { ...base, ...set, id: 's1', workout_exercise_id: 'we1', position: 1 },
    { ...base, ...set, id: 's2', workout_exercise_id: 'we1', position: 2 },
    // Removed during the workout: must stay deleted when the workout is restored
    { ...base, ...set, id: 's3', workout_exercise_id: 'we2', position: 1, deleted_at: '2026-10-07T17:30:00Z' },
    { ...base, ...set, id: 's4', workout_exercise_id: 'we2', position: 2 },
  ])
  return w
}

describe('trash', () => {
  beforeEach(async () => {
    await Promise.all(
      [db.body_weight, db.body_photo, db.photo_blob, db.workout, db.workout_exercise, db.workout_set, db.outbox, db.meta].map((t) => t.clear()),
    )
  })

  it('moves a body weight entry with the photos of its day to the trash and restores both', async () => {
    await saveBodyWeight('u1', '2026-10-07', 80.4, 'morning_fasted', 'nach Ferien')
    await db.body_photo.bulkPut([photo('p1', '2026-10-07'), photo('p2', '2026-10-07'), photo('p3', '2026-10-06')])
    const entry = (await db.body_weight.toArray())[0]!

    await deleteBodyWeight(entry)
    const items = await trashItems()
    expect(items).toHaveLength(1)
    expect(items[0]!.kind).toBe('body_weight')
    expect(items[0]!.kind === 'body_weight' && items[0]!.photos.map((p) => p.id).sort()).toEqual(['p1', 'p2'])
    expect((await db.body_photo.get('p3'))!.deleted_at).toBeNull()

    await restoreItem(items[0]!)
    const restored = (await db.body_weight.get(entry.id))!
    expect(restored.deleted_at).toBeNull()
    expect(restored.note).toBe('nach Ferien')
    expect((await db.body_photo.bulkGet(['p1', 'p2'])).every((p) => p!.deleted_at === null)).toBe(true)
    expect(await trashItems()).toHaveLength(0)
  })

  it('lists an entry deleted with the old version (photos untouched) and restores it', async () => {
    await db.body_weight.put({ ...base, id: 'b-old', measured_on: '2026-10-07', weight_kg: 80.4, deleted_at: '2026-10-07T20:00:00+00:00' })
    await db.body_photo.put(photo('p1', '2026-10-07'))
    const [item] = await trashItems(Date.parse('2026-10-08T07:00:00Z'))
    expect(item!.kind === 'body_weight' && item!.photos).toEqual([])
    await restoreItem(item!)
    expect((await db.body_weight.get('b-old'))!.deleted_at).toBeNull()
    expect((await db.body_photo.get('p1'))!.deleted_at).toBeNull()
  })

  it('replaces an active entry of the same day on restore', async () => {
    await saveBodyWeight('u1', '2026-10-07', 80.4)
    const old = (await db.body_weight.toArray())[0]!
    await deleteBodyWeight(old)
    await saveBodyWeight('u1', '2026-10-07', 81)
    const [item] = await trashItems()
    const current = await restoreConflict(item!)
    expect(current?.weight_kg).toBe(81)

    await restoreItem(item!)
    const active = (await db.body_weight.toArray()).filter((b) => b.deleted_at === null)
    expect(active.map((b) => b.weight_kg)).toEqual([80.4])
    // The replaced entry is in the trash now
    expect((await trashItems()).map((i) => i.kind === 'body_weight' && i.entry.weight_kg)).toEqual([81])
  })

  it('restores a single photo and keeps its local copy while in the trash', async () => {
    await db.body_photo.put(photo('p1', '2026-10-08'))
    await db.photo_blob.put({ id: 'p1', data: new ArrayBuffer(4), uploaded: 0 })
    await deletePhoto((await db.body_photo.get('p1'))!)
    expect(await db.photo_blob.get('p1')).toBeDefined()
    const [item] = await trashItems()
    expect(item!.kind).toBe('body_photo')
    await restoreItem(item!)
    expect((await db.body_photo.get('p1'))!.deleted_at).toBeNull()
  })

  it('restores a workout with exactly the exercises and sets deleted with it', async () => {
    const w = await addWorkout()
    await deleteWorkout(w)
    const [item] = await trashItems()
    expect(item!.kind === 'workout' && [item!.exercises, item!.sets]).toEqual([2, 3])

    await restoreItem(item!)
    expect((await db.workout.get('w1'))!.deleted_at).toBeNull()
    expect((await db.workout_exercise.toArray()).every((we) => we.deleted_at === null)).toBe(true)
    const sets = await db.workout_set.toArray()
    expect(sets.filter((s) => s.deleted_at !== null).map((s) => s.id)).toEqual(['s3'])
  })

  it('matches timestamps written by Postgres (+00:00) after a sync', async () => {
    const w = await addWorkout()
    await deleteWorkout(w)
    const ts = (await db.workout.get('w1'))!.deleted_at!
    const pg = new Date(ts).toISOString().replace('Z', '+00:00')
    await db.workout.update('w1', { deleted_at: pg })
    const [item] = await trashItems()
    expect(item!.kind === 'workout' && item!.sets).toBe(3)
  })

  it('does not list cancelled workouts, purged rows or rows older than 30 days', async () => {
    const w = await addWorkout()
    await db.workout.put({ ...w, id: 'w-cancelled', finished_at: null, deleted_at: '2026-10-08T05:00:00Z' })
    await db.body_weight.bulkPut([
      { ...base, id: 'b1', measured_on: '2026-09-01', weight_kg: 80, deleted_at: '2026-09-01T06:00:00Z' },
      { ...base, id: 'b2', measured_on: '2026-10-07', weight_kg: 80, deleted_at: '2026-10-07T06:00:00Z', purged_at: '2026-10-07T07:00:00Z' },
    ])
    expect(await trashItems(Date.parse('2026-10-08T07:00:00Z'))).toEqual([])
  })

  it('does not list photos deleted with the old version (object already gone)', async () => {
    await db.body_photo.put({ ...photo('p1', '2026-10-06'), deleted_at: '2026-10-07T12:00:00Z' })
    expect(await trashItems(Date.parse('2026-10-08T07:00:00Z'))).toEqual([])
  })

  it('purges for good and queues the bucket objects of photos', async () => {
    await saveBodyWeight('u1', '2026-10-07', 80.4)
    await db.body_photo.put(photo('p1', '2026-10-07'))
    await db.photo_blob.put({ id: 'p1', data: new ArrayBuffer(4), uploaded: 1 })
    await deleteBodyWeight((await db.body_weight.toArray())[0]!)

    await purgeItems(await trashItems())
    expect(await trashItems()).toEqual([])
    expect((await db.body_photo.get('p1'))!.purged_at).not.toBeNull()
    expect(await db.photo_blob.get('p1')).toBeUndefined()
    expect(JSON.parse((await getMeta('photo_purge_queue'))!)).toEqual(['p1'])
    // purged_at is synchronised
    expect((await db.outbox.toArray()).some((e) => e.table === 'body_photo' && e.row_id === 'p1')).toBe(true)
  })

  it('purges photos that have been in the trash for more than 30 days', async () => {
    await db.body_photo.bulkPut([
      { ...photo('old', '2026-10-08'), deleted_at: '2026-10-08T06:00:00Z' },
      { ...photo('new', '2026-10-20'), deleted_at: '2026-10-20T06:00:00Z' },
    ])
    expect(await purgeExpired(Date.parse('2026-11-08T07:00:00Z'))).toBe(1)
    expect((await db.body_photo.get('old'))!.purged_at).not.toBeNull()
    expect((await db.body_photo.get('new'))!.purged_at).toBeUndefined()
  })

  it('counts the days left', () => {
    expect(daysLeft('2026-10-08T06:00:00Z', Date.parse('2026-10-08T07:00:00Z'))).toBe(29)
    expect(daysLeft('2026-10-08T06:00:00Z', Date.parse('2026-11-06T05:00:00Z'))).toBe(1)
    expect(daysLeft('2026-10-08T06:00:00Z', Date.parse('2026-11-07T05:00:00Z'))).toBe(0)
    expect(daysLeft('2026-09-01T06:00:00Z', Date.parse('2026-11-07T05:00:00Z'))).toBe(0)
  })
})
