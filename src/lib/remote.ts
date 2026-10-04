import type { SyncTable } from './db'
import { getJwt as proxyJwt } from './session'

export type RemoteRow = Record<string, unknown> & { id: string; updated_at: string; synced_at: string }

/** Server operations needed by the sync engine (injectable for tests). */
export interface RemoteApi {
  hasSession(): Promise<boolean>
  upsert(table: SyncTable, rows: object[]): Promise<void>
  /** Rows with synced_at > since, ordered by synced_at, at most `limit`, skipping `offset`. */
  fetchSince(table: SyncTable, since: string, limit: number, offset: number): Promise<RemoteRow[]>
}

export class RemoteError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

/** JWT from the auth proxy; proxy failures become RemoteError without status (shown as sync error). */
async function getJwt(force = false): Promise<string | null> {
  try {
    return await proxyJwt(force)
  } catch (err) {
    throw new RemoteError(err instanceof Error ? err.message : String(err))
  }
}

// Neon Data API (PostgREST-compatible). DATABASE_URL must never be used in the frontend.
const API = (import.meta.env.NEON_DATA_API_URL ?? '').replace(/\/+$/, '')

/** Calls the Data API with the user's JWT; retries once with a fresh JWT on 401. */
async function request(table: SyncTable, query: string, init: RequestInit = {}): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const jwt = await getJwt(attempt > 0)
    if (!jwt) throw new RemoteError('Session expired. Please sign in again.', 401)
    let res: Response
    try {
      res = await fetch(`${API}/${table}?${query}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${jwt}` },
      })
    } catch {
      throw new RemoteError(`${table}: Data API not reachable.`)
    }
    if (res.status === 401 && attempt === 0) continue
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null
      throw new RemoteError(`${table}: ${data?.message ?? res.statusText} (HTTP ${res.status})`, res.status)
    }
    return res
  }
  throw new RemoteError(`${table}: not authorized (HTTP 401)`, 401)
}

export const neonRemote: RemoteApi = {
  async hasSession() {
    return (await getJwt()) !== null
  },

  async upsert(table, rows) {
    await request(table, 'on_conflict=id', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    })
  },

  async fetchSince(table, since, limit, offset) {
    const query = new URLSearchParams({
      select: '*',
      synced_at: `gt.${since}`,
      order: 'synced_at.asc,id.asc',
      limit: String(limit),
      offset: String(offset),
    })
    const res = await request(table, query.toString())
    return (await res.json()) as RemoteRow[]
  },
}
