import { db, SYNC_TABLES, type OutboxEntry, type SyncTable } from './db'
import { RemoteError, neonRemote, type RemoteApi, type RemoteRow } from './remote'

// Sync engine, see docs/03_datenmodell.md, section "Synchronisation".
// Push: outbox rows in dependency order as upserts; the server trigger rejects older states.
// Pull: rows with synced_at newer than the last cursor (minus overlap); newer updated_at wins.

const PUSH_BATCH = 200
const PULL_PAGE = 500
const PULL_OVERLAP_MS = 5 * 60 * 1000
const EPOCH = '1970-01-01T00:00:00Z'

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'signed_out' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  lastSuccess: string | null
  error: string | null
}

// --- local writes -----------------------------------------------------------

type SyncRow = { id: string; updated_at: string }

/** Saves rows locally and queues them for sync. Sets updated_at to now. */
export async function saveRows<T extends SyncRow>(table: SyncTable, rows: T[]): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction('rw', db.table(table), db.outbox, async () => {
    for (const row of rows) row.updated_at = now
    await db.table(table).bulkPut(rows)
    await enqueue(table, rows.map((r) => r.id), now)
  })
  requestSync()
}

async function enqueue(table: SyncTable, ids: string[], now: string): Promise<void> {
  const existing = await db.outbox.where('[table+row_id]').anyOf(ids.map((id) => [table, id])).toArray()
  const queued = new Set(existing.map((e) => e.row_id))
  const fresh: OutboxEntry[] = ids.filter((id) => !queued.has(id)).map((row_id) => ({ table, row_id, queued_at: now }))
  if (fresh.length) await db.outbox.bulkAdd(fresh)
}

// --- push / pull -------------------------------------------------------------

function ts(value: string): number {
  return Date.parse(value)
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function push(remote: RemoteApi): Promise<number> {
  const entries = await db.outbox.orderBy('seq').toArray()
  let pushed = 0
  for (const table of SYNC_TABLES) {
    const tableEntries = entries.filter((e) => e.table === table)
    for (const batch of chunks(tableEntries, PUSH_BATCH)) {
      const rows = (await db.table(table).bulkGet(batch.map((e) => e.row_id))) as (SyncRow | undefined)[]
      const present = rows.filter((r): r is SyncRow => r !== undefined)
      // Rows with different column sets (e.g. created before a schema change) are sent separately,
      // so a missing column is left untouched on the server instead of being set to null.
      const groups = new Map<string, SyncRow[]>()
      for (const r of present) {
        const key = Object.keys(r).sort().join(',')
        groups.set(key, [...(groups.get(key) ?? []), r])
      }
      for (const group of groups.values()) await remote.upsert(table, group)

      // Remove only entries whose row was not changed again while the request ran
      const sent = new Map(present.map((r) => [r.id, r.updated_at]))
      await db.transaction('rw', db.table(table), db.outbox, async () => {
        const current = (await db.table(table).bulkGet(batch.map((e) => e.row_id))) as (SyncRow | undefined)[]
        const done = batch.filter((e, i) => {
          const row = current[i]
          return row === undefined || sent.get(e.row_id) === row.updated_at
        })
        await db.outbox.bulkDelete(done.map((e) => e.seq!))
      })
      pushed += present.length
    }
  }
  return pushed
}

export async function pull(remote: RemoteApi): Promise<number> {
  let merged = 0
  for (const table of SYNC_TABLES) {
    const state = await db.sync_state.get(table)
    const since = state ? new Date(ts(state.last_synced_at) - PULL_OVERLAP_MS).toISOString() : EPOCH
    let cursor = state?.last_synced_at ?? EPOCH
    for (let offset = 0; ; offset += PULL_PAGE) {
      const page = await remote.fetchSince(table, since, PULL_PAGE, offset)
      if (page.length === 0) break
      merged += await mergeRows(table, page)
      for (const r of page) if (ts(r.synced_at) > ts(cursor)) cursor = r.synced_at
      if (page.length < PULL_PAGE) break
    }
    if (!state || cursor !== state.last_synced_at) await db.sync_state.put({ table, last_synced_at: cursor })
  }
  return merged
}

async function mergeRows(table: SyncTable, remoteRows: RemoteRow[]): Promise<number> {
  return db.transaction('rw', db.table(table), async () => {
    const local = (await db.table(table).bulkGet(remoteRows.map((r) => r.id))) as (SyncRow | undefined)[]
    const newer = remoteRows
      .filter((r, i) => {
        const l = local[i]
        return l === undefined || ts(r.updated_at) > ts(l.updated_at)
      })
      .map(({ synced_at: _synced, ...row }) => row)
    if (newer.length) await db.table(table).bulkPut(newer)
    return newer.length
  })
}

// --- orchestration -------------------------------------------------------------

let status: SyncStatus = { phase: 'idle', lastSuccess: null, error: null }
const listeners = new Set<() => void>()
let running: Promise<void> | null = null
let again = false
let debounce: ReturnType<typeof setTimeout> | undefined

function setStatus(next: Partial<SyncStatus>) {
  status = { ...status, ...next }
  listeners.forEach((l) => l())
}

export function getSyncStatus(): SyncStatus {
  return status
}

export function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Runs one push and pull cycle. Concurrent calls are coalesced. */
export async function syncNow(remote: RemoteApi = neonRemote): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      if (!navigator.onLine) {
        setStatus({ phase: 'offline' })
        return
      }
      setStatus({ phase: 'syncing', error: null })
      try {
        if (!(await remote.hasSession())) {
          setStatus({ phase: 'signed_out' })
          return
        }
        await push(remote)
        await pull(remote)
        setStatus({ phase: 'idle', lastSuccess: new Date().toISOString() })
      } catch (err) {
        console.error('Sync failed', err)
        if (err instanceof RemoteError && (err.status === 401 || err.status === 403)) {
          setStatus({ phase: 'signed_out', error: err.message })
        } else {
          setStatus({ phase: 'error', error: err instanceof Error ? err.message : String(err) })
        }
        return
      }
    } while (again)
  })().finally(() => {
    running = null
  })
  return running
}

/** Debounced sync after local changes. */
export function requestSync(delayMs = 3000): void {
  clearTimeout(debounce)
  debounce = setTimeout(() => void syncNow(), delayMs)
}

/** Starts background sync: now, when back online, when the app becomes visible, and every 5 minutes. */
export function startBackgroundSync(): () => void {
  const onOnline = () => void syncNow()
  const onOffline = () => setStatus({ phase: 'offline' })
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow()
  }
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const timer = setInterval(() => void syncNow(), 5 * 60 * 1000)
  void syncNow()
  return () => {
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    clearInterval(timer)
    clearTimeout(debounce)
  }
}
