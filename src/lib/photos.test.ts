import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createPhotoKey, lockPhotos, photoKeyState, unlockPhotoKey } from './photos'

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
