import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { saveBodyWeight, updateBodyWeight } from './body'

const base = { user_id: 'u1', created_at: '2026-10-13T06:00:00Z', updated_at: '2026-10-13T06:00:00Z', deleted_at: null }
const photo = (id: string, day: string) => ({ ...base, id, measured_on: day, pose: 'front' as const, object_key: id, iv: 'x', mime: 'image/jpeg', width: 1, height: 1, bytes: 1 })
const live = async (day: string) => (await db.body_weight.where('measured_on').equals(day).toArray()).filter((b) => b.deleted_at === null)

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('updateBodyWeight', () => {
  it('moves an entry with its photos to another day', async () => {
    await saveBodyWeight('u1', '2026-10-13', 86.4, 'morning_fasted')
    await db.body_photo.bulkPut([photo('p1', '2026-10-13'), photo('p2', '2026-10-13')])
    const entry = (await live('2026-10-13'))[0]!
    await updateBodyWeight(entry, '2026-10-15', 86.2, 'after_meal')
    expect(await live('2026-10-13')).toHaveLength(0)
    const moved = await live('2026-10-15')
    expect(moved).toMatchObject([{ id: entry.id, weight_kg: 86.2, condition: 'after_meal' }])
    expect((await db.body_photo.toArray()).every((p) => p.measured_on === '2026-10-15' && p.deleted_at === null)).toBe(true)
  })

  it('replaces an entry already on the target day and keeps its photos', async () => {
    await saveBodyWeight('u1', '2026-10-13', 86.4)
    await saveBodyWeight('u1', '2026-10-15', 87.0)
    await db.body_photo.put(photo('p3', '2026-10-15'))
    const entry = (await live('2026-10-13'))[0]!
    await updateBodyWeight(entry, '2026-10-15', 86.4, null)
    expect(await live('2026-10-15')).toMatchObject([{ id: entry.id, weight_kg: 86.4 }])
    expect((await db.body_photo.get('p3'))!.deleted_at).toBeNull()
  })

  it('updates values in place when the day stays the same', async () => {
    await saveBodyWeight('u1', '2026-10-13', 86.4)
    const entry = (await live('2026-10-13'))[0]!
    await updateBodyWeight(entry, '2026-10-13', 85.9, 'other')
    expect(await live('2026-10-13')).toMatchObject([{ id: entry.id, weight_kg: 85.9, condition: 'other' }])
  })
})
