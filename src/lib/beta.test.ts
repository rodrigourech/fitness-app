import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'

vi.hoisted(() => vi.stubEnv('VITE_BETA_SANDBOX', 'true'))

import { db, getMeta, SYNC_TABLES, type SyncTable } from './db'
import { BETA_READY_KEY, importBetaSnapshot } from './beta'
import { importSeedIfNeeded } from './seed'
import { pull, push, saveRows } from './sync'
import { neonRemote, type RemoteApi, type RemoteRow } from './remote'
import { proxyChangePassword } from './session'
import { addPhoto, changePhotoPassphrase, deletePendingPhotoObjects, resetPhotoPassphrase, uploadPendingPhotos } from './photos'

beforeEach(async () => { await db.delete(); await db.open(); vi.restoreAllMocks() })

async function sourceRemote() {
  await importSeedIfNeeded('u1')
  const te = (await db.template_exercise.toArray())[0]!
  const original = (await db.template_set.where('template_exercise_id').equals(te.id).first())!
  await db.template_set.put({ ...original, id: 'warm', set_type: 'warmup', target_weight: 15, target_reps_min: 8, target_reps_max: 8 })
  const rows = new Map<SyncTable, RemoteRow[]>()
  for (const table of SYNC_TABLES) rows.set(table, (await db.table(table).toArray()).map((row) => ({ ...row, synced_at: '2026-10-12T00:00:00Z' })))
  const fetchSince = vi.fn(async (table: SyncTable, _since: string, limit: number, offset: number) => rows.get(table)!.slice(offset, offset + limit))
  const upsert = vi.fn(async () => undefined)
  const remote: RemoteApi = { hasSession: async () => true, fetchSince, upsert }
  return { remote, fetchSince, upsert, rows, te }
}

it('uses a separate database and imports once; edits never upload or get overwritten by later pulls', async () => {
  const { remote, fetchSince, upsert, rows, te } = await sourceRemote()
  const before = JSON.stringify([...rows])
  expect(db.name).toBe('fitness-app-beta-progression-v1')
  await importBetaSnapshot(remote)
  expect(await getMeta(BETA_READY_KEY)).toBe('1')
  expect(JSON.stringify([...rows])).toBe(before)
  expect(await db.outbox.count()).toBe(0)
  expect(await db.template_set.get('warm')).toMatchObject({ deleted_at: expect.any(String) })
  expect(await db.exercise.get(te.exercise_id)).toMatchObject({ warm_up: true })
  expect((await db.exercise.toArray()).find((ex) => ex.tracking_type === 'weight_reps' && !ex.parent_id)).toMatchObject({ target_reps: 10, min_reps: 7 })

  const template = (await db.template.toArray())[0]!
  await saveRows('template', [{ ...template, name: 'Beta edit' }])
  fetchSince.mockClear()
  expect(await push(remote)).toBe(0)
  await pull(remote)
  expect(upsert).not.toHaveBeenCalled()
  expect(fetchSince).not.toHaveBeenCalled()
  expect(await db.template.get(template.id)).toMatchObject({ name: 'Beta edit' })
  expect(await db.outbox.count()).toBe(0)
})

it('keeps existing local data intact if a snapshot fetch fails and retries without partial data', async () => {
  const { remote, fetchSince } = await sourceRemote()
  const before = await db.exercise.toArray()
  fetchSince.mockRejectedValueOnce(new Error('Network unavailable'))
  await expect(importBetaSnapshot(remote)).rejects.toThrow('Network unavailable')
  expect(await db.exercise.toArray()).toEqual(before)
  expect(await getMeta(BETA_READY_KEY)).toBeUndefined()
  await importBetaSnapshot(remote)
  expect(await getMeta(BETA_READY_KEY)).toBe('1')
})

it('blocks all live data, photo upload/delete and password writes before network requests', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  await expect(neonRemote.upsert('exercise', [{}])).rejects.toThrow('local beta preview')
  await expect(proxyChangePassword('old', 'new')).rejects.toThrow('local beta preview')
  await expect(addPhoto('u1', '2026-10-12', new Blob(), null)).rejects.toThrow('local beta preview')
  await expect(changePhotoPassphrase('u1', 'new')).rejects.toThrow('local beta preview')
  await expect(resetPhotoPassphrase('u1', 'new')).rejects.toThrow('local beta preview')
  await uploadPendingPhotos()
  await deletePendingPhotoObjects()
  expect(fetch).not.toHaveBeenCalled()
})
