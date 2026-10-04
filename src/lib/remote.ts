import type { SyncTable } from './db'
import { neon } from './neon'

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

export const neonRemote: RemoteApi = {
  async hasSession() {
    const { data } = await neon.auth.getSession()
    return Boolean(data?.user?.id)
  },

  async upsert(table, rows) {
    const { error, status } = await neon.from(table).upsert(rows, { onConflict: 'id' })
    if (error) throw new RemoteError(`${table}: ${error.message}`, status)
  },

  async fetchSince(table, since, limit, offset) {
    const { data, error, status } = await neon
      .from(table)
      .select('*')
      .gt('synced_at', since)
      .order('synced_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1)
    if (error) throw new RemoteError(`${table}: ${error.message}`, status)
    return (data ?? []) as RemoteRow[]
  },
}
