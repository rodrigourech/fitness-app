import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getMeta, type BodyPhoto } from './db'
import {
  changePhotoPassphrase,
  createPhotoKey,
  deletePendingPhotoObjects,
  lockPhotos,
  photoBytes,
  photoKeyState,
  resetPhotoPassphrase,
  storedPhotoCount,
  unlockPhotoKey,
} from './photos'

describe('photo passphrase', () => {
  beforeEach(async () => {
    await db.user_setting.clear()
    await db.keystore.clear()
  })

  it('creates a key, locks and unlocks only with the right passphrase', async () => {
    expect(await photoKeyState()).toBe('none')
    await createPhotoKey('u1', 'correct horse battery')
    expect(await photoKeyState()).toBe('ready')
    // The stored setting holds salt and check value, never the key or passphrase
    const setting = JSON.stringify((await db.user_setting.toArray())[0]?.value)
    expect(setting).not.toContain('correct horse')

    await lockPhotos()
    expect(await photoKeyState()).toBe('locked')
    expect(await unlockPhotoKey('wrong passphrase')).toBe(false)
    expect(await photoKeyState()).toBe('locked')
    expect(await unlockPhotoKey('correct horse battery')).toBe(true)
    expect(await photoKeyState()).toBe('ready')
  }, 30_000)

  it('refuses a second passphrase', async () => {
    await createPhotoKey('u1', 'first passphrase')
    await expect(createPhotoKey('u1', 'second passphrase')).rejects.toThrow()
  }, 30_000)
})

describe('changing and resetting the passphrase', () => {
  const bucket = new Map<string, ArrayBuffer>()

  beforeEach(async () => {
    await Promise.all([db.user_setting, db.keystore, db.body_photo, db.photo_blob, db.outbox, db.meta].map((t) => t.clear()))
    bucket.clear()
    await db.meta.put({ key: 'session_token', value: 't' })
    // Auth proxy stand-in: upload, download and delete by photo id
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>
      if (url.endsWith('/photo/upload')) {
        bucket.set(headers['x-photo-id']!, init.body as ArrayBuffer)
        return new Response(null, { status: 204 })
      }
      const { id } = JSON.parse(init.body as string) as { id: string }
      if (url.endsWith('/photo/delete')) {
        bucket.delete(id)
        return new Response(null, { status: 204 })
      }
      const data = bucket.get(id)
      return data ? new Response(data) : new Response(null, { status: 404 })
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** A photo as addPhoto stores it, without the canvas step. */
  async function storePhoto(measured_on: string, text: string, deleted_at: string | null = null): Promise<BodyPhoto> {
    const key = (await db.keystore.get('photo'))!.key
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
    const id = crypto.randomUUID()
    const ts = '2026-10-07T06:00:00Z'
    const row: BodyPhoto = {
      id,
      user_id: 'u1',
      measured_on,
      pose: 'front',
      object_key: `u1/${id}`,
      iv: btoa(String.fromCharCode(...iv)),
      mime: 'image/jpeg',
      width: 1,
      height: 1,
      bytes: data.byteLength,
      created_at: ts,
      updated_at: ts,
      deleted_at,
    }
    bucket.set(id, data)
    await db.body_photo.put(row)
    return row
  }

  const text = async (p: BodyPhoto) => new TextDecoder().decode(await photoBytes(p))
  const live = async () => (await db.body_photo.toArray()).filter((p) => !p.purged_at)

  it('re-encrypts every photo with the new passphrase without knowing the old one', async () => {
    await createPhotoKey('u1', 'old passphrase 1')
    await storePhoto('2026-10-07', 'front 7 Oct')
    const trashed = await storePhoto('2026-10-06', 'side 6 Oct', '2026-10-08T07:00:00Z')
    const progress: number[] = []

    await changePhotoPassphrase('u1', 'new passphrase 2', (done) => progress.push(done))
    expect(progress).toEqual([0, 1, 2])
    const photos = await live()
    expect(photos).toHaveLength(2)
    expect((await Promise.all(photos.map(text))).sort()).toEqual(['front 7 Oct', 'side 6 Oct'])
    // The trashed photo stays in the trash with the same deleted_at (keeps its group)
    expect(photos.find((p) => p.measured_on === '2026-10-06')!.deleted_at).toBe(trashed.deleted_at)
    // Old objects are deleted, only the new ones remain
    await deletePendingPhotoObjects()
    expect([...bucket.keys()].sort()).toEqual(photos.map((p) => p.id).sort())

    // A device that unlocks again needs the new passphrase
    await lockPhotos()
    expect(await unlockPhotoKey('old passphrase 1')).toBe(false)
    expect(await unlockPhotoKey('new passphrase 2')).toBe(true)
    expect((await Promise.all((await live()).map(text))).sort()).toEqual(['front 7 Oct', 'side 6 Oct'])
  }, 60_000)

  it('changes nothing when a photo cannot be loaded', async () => {
    await createPhotoKey('u1', 'old passphrase 1')
    const p = await storePhoto('2026-10-07', 'front')
    bucket.delete(p.id)
    await db.photo_blob.clear()
    const before = (await db.user_setting.toArray())[0]!.value
    await expect(changePhotoPassphrase('u1', 'new passphrase 2')).rejects.toThrow('Nothing was changed')
    expect((await db.user_setting.toArray())[0]!.value).toEqual(before)
    expect(await live()).toHaveLength(1)
  }, 60_000)

  it('locks a device whose key belongs to an older passphrase', async () => {
    await createPhotoKey('u1', 'old passphrase 1')
    const oldKey = (await db.keystore.get('photo'))!.key
    await changePhotoPassphrase('u1', 'new passphrase 2')
    // Simulate the other device: it still holds the old key
    await db.keystore.put({ id: 'photo', key: oldKey })
    expect(await photoKeyState()).toBe('locked')
  }, 60_000)

  it('resets a forgotten passphrase and removes the unreadable photos', async () => {
    await createPhotoKey('u1', 'forgotten passphrase')
    await storePhoto('2026-10-07', 'front')
    await storePhoto('2026-10-06', 'side', '2026-10-08T07:00:00Z')
    await lockPhotos()
    expect(await storedPhotoCount()).toBe(2)

    await resetPhotoPassphrase('u1', 'brand new passphrase')
    expect(await photoKeyState()).toBe('ready')
    expect(await storedPhotoCount()).toBe(0)
    await deletePendingPhotoObjects()
    expect(bucket.size).toBe(0)
    expect(JSON.parse((await getMeta('photo_purge_queue'))!)).toEqual([])
    await lockPhotos()
    expect(await unlockPhotoKey('brand new passphrase')).toBe(true)
  }, 60_000)
})
