import { db, getMeta, setMeta, type BodyPhoto, type PhotoBlob, type PhotoPose } from './db'
import { saveRows } from './sync'

// Encrypted progress photos (decision 5 October 2026, docs/entscheidungen.md).
//
// - The app shrinks every photo (max 1600 px, JPEG) which also drops metadata such as the GPS position.
// - It encrypts the bytes with AES-256-GCM. The key is derived from the user's photo passphrase
//   (PBKDF2-SHA-256, 600 000 rounds) and kept on the device as a non-extractable CryptoKey.
// - Only ciphertext leaves the device: the auth proxy stores it in the private bucket body-photos.
// - The salt and an encrypted check value live in user_setting "photo_key", so every device derives
//   the same key from the same passphrase and can tell a wrong passphrase. A lost passphrase cannot
//   be recovered; the photos are then unreadable.

const KEY_SETTING_ID = '3a9e5c71-2f84-4d6b-a0c3-8e1f7b2d5964'
const KEY_ID = 'photo'
const ITERATIONS = 600_000
const CHECK_TEXT = 'fitness-app photo key v1'
const MAX_EDGE = 1600
const QUALITY = 0.82
const PROXY = (import.meta.env.VITE_AUTH_PROXY_URL ?? '').replace(/\/+$/, '')

interface KeySetting {
  v: 1
  salt: string
  iterations: number
  check_iv: string
  check: string
}

export type PhotoKeyState = 'none' | 'locked' | 'ready'

// --- encoding helpers ----------------------------------------------------------------

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64)
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

function random(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)))
}

// --- key handling ------------------------------------------------------------------------

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable: the raw key can never be read out of the browser
    ['encrypt', 'decrypt'],
  )
}

async function keySetting(): Promise<KeySetting | null> {
  const row = await db.user_setting.get(KEY_SETTING_ID)
  if (!row || row.deleted_at !== null) return null
  const v = row.value as Partial<KeySetting>
  return v && v.v === 1 && v.salt && v.check && v.check_iv && v.iterations ? (v as KeySetting) : null
}

async function localKey(): Promise<CryptoKey | null> {
  return (await db.keystore.get(KEY_ID))?.key ?? null
}

async function opensCheck(key: CryptoKey, s: KeySetting): Promise<boolean> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.check_iv) }, key, fromB64(s.check))
    return new TextDecoder().decode(plain) === CHECK_TEXT
  } catch {
    return false
  }
}

const verified = new WeakMap<CryptoKey, string>()

/**
 * The key on this device, if it still belongs to the current passphrase. After the passphrase was
 * changed or reset on another device, the old key no longer opens the check value: photos are locked.
 */
async function currentKey(): Promise<CryptoKey | null> {
  const key = await localKey()
  if (!key) return null
  const s = await keySetting()
  if (!s || verified.get(key) === s.check) return key
  if (!(await opensCheck(key, s))) return null
  verified.set(key, s.check)
  return key
}

export async function photoKeyState(): Promise<PhotoKeyState> {
  if (await currentKey()) return 'ready'
  return (await keySetting()) ? 'locked' : 'none'
}

/** New key and the setting value (salt and encrypted check value) for a passphrase. */
async function newKey(passphrase: string): Promise<{ key: CryptoKey; value: KeySetting }> {
  const salt = random(16)
  const key = await deriveKey(passphrase, salt, ITERATIONS)
  const iv = random(12)
  const check = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(CHECK_TEXT)))
  return { key, value: { v: 1, salt: toB64(salt), iterations: ITERATIONS, check_iv: toB64(iv), check: toB64(check) } }
}

/** Stores the setting for all devices and the key on this device. */
async function activateKey(userId: string, key: CryptoKey, value: KeySetting): Promise<void> {
  const existing = await db.user_setting.get(KEY_SETTING_ID)
  const ts = new Date().toISOString()
  await saveRows('user_setting', [
    existing
      ? { ...existing, value, deleted_at: null }
      : { id: KEY_SETTING_ID, user_id: userId, key: 'photo_key', value, created_at: ts, updated_at: ts, deleted_at: null },
  ])
  await db.keystore.put({ id: KEY_ID, key })
}

/** Sets up the photo passphrase (first device). */
export async function createPhotoKey(userId: string, passphrase: string): Promise<void> {
  if (await keySetting()) throw new Error('A photo passphrase already exists. Enter it to unlock.')
  const { key, value } = await newKey(passphrase)
  await activateKey(userId, key, value)
}

/** Unlocks photos on this device. Returns false for a wrong passphrase. */
export async function unlockPhotoKey(passphrase: string): Promise<boolean> {
  const s = await keySetting()
  if (!s) throw new Error('No photo passphrase set up yet.')
  const key = await deriveKey(passphrase, fromB64(s.salt), s.iterations)
  if (!(await opensCheck(key, s))) return false
  await db.keystore.put({ id: KEY_ID, key })
  return true
}

/** Forgets the key on this device (e.g. on sign-out); the passphrase is needed again. */
export async function lockPhotos(): Promise<void> {
  await db.keystore.delete(KEY_ID)
  await db.photo_blob.where('uploaded').equals(1).delete()
}

// --- image processing ------------------------------------------------------------------

async function shrink(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.round(img.naturalWidth * scale)
    const height = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
    // Re-encoding drops all metadata (EXIF, GPS)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the image.'))), 'image/jpeg', QUALITY),
    )
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// --- proxy calls -----------------------------------------------------------------------------

async function sessionToken(): Promise<string> {
  const token = await getMeta('session_token')
  if (!token) throw new Error('Not signed in.')
  return token
}

async function upload(id: string, data: ArrayBuffer): Promise<void> {
  const res = await fetch(`${PROXY}/photo/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-session-token': await sessionToken(), 'x-photo-id': id },
    body: data,
  })
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`)
}

async function download(id: string): Promise<ArrayBuffer> {
  const res = await fetch(`${PROXY}/photo/download`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: await sessionToken(), id }),
  })
  if (res.status === 404) throw new Error('Photo not uploaded yet (the other device may still be offline).')
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
  return res.arrayBuffer()
}

// --- public API -----------------------------------------------------------------------------

/** Shrinks, encrypts and stores a photo for a day; uploads now or as soon as the device is online. */
export async function addPhoto(userId: string, measuredOn: string, file: Blob, pose: PhotoPose | null): Promise<void> {
  const key = await currentKey()
  if (!key) throw new Error('Photos are locked.')
  const { blob, width, height } = await shrink(file)
  const iv = random(12)
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await blob.arrayBuffer())
  const id = crypto.randomUUID()
  const ts = new Date().toISOString()
  const row: BodyPhoto = {
    id,
    user_id: userId,
    measured_on: measuredOn,
    pose,
    object_key: `${userId}/${id}`,
    iv: toB64(iv),
    mime: 'image/jpeg',
    width,
    height,
    bytes: data.byteLength,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  }
  await db.photo_blob.put({ id, data, uploaded: 0 })
  await saveRows('body_photo', [row])
  void uploadPendingPhotos()
}

let uploading: Promise<void> | null = null

/** Uploads photos taken offline. Safe to call often. */
export function uploadPendingPhotos(): Promise<void> {
  uploading ??= (async () => {
    if (!navigator.onLine) return
    for (const p of await db.photo_blob.where('uploaded').equals(0).toArray()) {
      try {
        await upload(p.id, p.data)
        await db.photo_blob.update(p.id, { uploaded: 1 })
      } catch (err) {
        console.error('Photo upload failed', err)
        return
      }
    }
  })().finally(() => {
    uploading = null
  })
  return uploading
}

/** Encrypted bytes of a photo: from this device or downloaded (and kept) from the bucket. */
async function encryptedBytes(photo: BodyPhoto): Promise<ArrayBuffer> {
  let data = (await db.photo_blob.get(photo.id))?.data
  if (!data) {
    data = await download(photo.id)
    await db.photo_blob.put({ id: photo.id, data, uploaded: 1 })
  }
  return data
}

/** Decrypted image bytes of a photo. */
export async function photoBytes(photo: BodyPhoto): Promise<ArrayBuffer> {
  const key = await currentKey()
  if (!key) throw new Error('Photos are locked.')
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(photo.iv) }, key, await encryptedBytes(photo))
}

/** Decrypted photo as an object URL (revoke it when no longer shown). */
export async function photoUrl(photo: BodyPhoto): Promise<string> {
  return URL.createObjectURL(new Blob([await photoBytes(photo)], { type: photo.mime }))
}

// --- changing or resetting the passphrase (decision 8 October 2026) --------------------------

/** Photos whose object still exists or may exist (everything not purged, including the trash). */
async function storedPhotos(): Promise<BodyPhoto[]> {
  return (await db.body_photo.toArray()).filter((p) => !p.purged_at)
}

export async function storedPhotoCount(): Promise<number> {
  return (await storedPhotos()).length
}

/** Purges photo rows for good and queues their bucket objects for deletion. */
async function purgePhotos(photos: BodyPhoto[], ts: string): Promise<void> {
  if (!photos.length) return
  await saveRows('body_photo', photos.map((p) => ({ ...p, deleted_at: p.deleted_at ?? ts, purged_at: ts })))
  await queuePhotoObjectDeletes(photos.map((p) => p.id))
}

/**
 * Changes the passphrase on a device where photos are unlocked; the old passphrase is not needed.
 * Every photo is decrypted, encrypted with the new key and uploaded as a new object. Only when all
 * uploads succeeded does the app switch to the new key in one step (new setting, new photo rows,
 * old rows purged). If anything fails before, nothing changes. Photos in the trash whose object is
 * already gone are purged.
 */
export async function changePhotoPassphrase(
  userId: string,
  passphrase: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const oldKey = await currentKey()
  if (!oldKey) throw new Error('Unlock photos on this device first.')
  if (navigator.onLine === false) throw new Error('Changing the passphrase needs a connection.')
  const photos = await storedPhotos()
  const { key, value } = await newKey(passphrase)
  const ts = new Date().toISOString()
  const fresh: BodyPhoto[] = []
  const blobs: PhotoBlob[] = []
  onProgress?.(0, photos.length)
  for (const [i, photo] of photos.entries()) {
    let plain: ArrayBuffer
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(photo.iv) }, oldKey, await encryptedBytes(photo))
    } catch (err) {
      // In the trash and no longer stored (deleted before the trash existed): purged below
      if (photo.deleted_at !== null) continue
      const reason = err instanceof Error ? err.message : String(err)
      throw new Error(`The photo of ${photo.measured_on} could not be opened (${reason}). Nothing was changed.`)
    }
    const iv = random(12)
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain)
    const id = crypto.randomUUID()
    await upload(id, data)
    blobs.push({ id, data, uploaded: 1 })
    fresh.push({ ...photo, id, object_key: `${photo.user_id}/${id}`, iv: toB64(iv), bytes: data.byteLength })
    onProgress?.(i + 1, photos.length)
  }
  // Switch: new key first, so the new rows are readable as soon as they arrive on other devices
  await activateKey(userId, key, value)
  await db.photo_blob.bulkPut(blobs)
  if (fresh.length) await saveRows('body_photo', fresh)
  await purgePhotos(photos, ts)
}

/**
 * Sets a new passphrase when the old one is forgotten and no device has photos unlocked.
 * All existing photos cannot be opened any more and are deleted for good.
 */
export async function resetPhotoPassphrase(userId: string, passphrase: string): Promise<void> {
  await purgePhotos(await storedPhotos(), new Date().toISOString())
  await db.keystore.delete(KEY_ID)
  const { key, value } = await newKey(passphrase)
  await activateKey(userId, key, value)
}

/** Moves a photo to the trash (soft delete). The encrypted object stays in the bucket and on this
 * device until the photo is purged, so it can be restored (decision 8 October 2026). */
export async function deletePhoto(photo: BodyPhoto): Promise<void> {
  await saveRows('body_photo', [{ ...photo, deleted_at: new Date().toISOString() }])
}

const PURGE_QUEUE = 'photo_purge_queue'

/** Queues the encrypted objects of purged photos for deletion and removes the local copies. */
export async function queuePhotoObjectDeletes(ids: string[]): Promise<void> {
  if (!ids.length) return
  const queued = new Set<string>(JSON.parse((await getMeta(PURGE_QUEUE)) ?? '[]') as string[])
  for (const id of ids) queued.add(id)
  await setMeta(PURGE_QUEUE, JSON.stringify([...queued]))
  await db.photo_blob.bulkDelete(ids)
  void deletePendingPhotoObjects()
}

let purging: Promise<void> | null = null

/** Deletes queued objects in the bucket; whatever fails (e.g. offline) is retried later. */
export function deletePendingPhotoObjects(): Promise<void> {
  purging ??= (async () => {
    if (navigator.onLine === false) return
    const ids = JSON.parse((await getMeta(PURGE_QUEUE)) ?? '[]') as string[]
    if (!ids.length) return
    const token = await getMeta('session_token')
    if (!token) return
    const done = new Set<string>()
    for (const id of ids) {
      try {
        const res = await fetch(`${PROXY}/photo/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, id }),
        })
        if (!res.ok) break
        done.add(id)
      } catch {
        break
      }
    }
    // Re-read: photos may have been queued while the requests ran
    const rest = (JSON.parse((await getMeta(PURGE_QUEUE)) ?? '[]') as string[]).filter((id) => !done.has(id))
    await setMeta(PURGE_QUEUE, JSON.stringify(rest))
  })().finally(() => {
    purging = null
  })
  return purging
}

export async function photosOf(measuredOn: string): Promise<BodyPhoto[]> {
  const rows = await db.body_photo.where('measured_on').equals(measuredOn).toArray()
  return rows.filter((p) => p.deleted_at === null).sort((a, b) => a.created_at.localeCompare(b.created_at))
}
