import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type SyncTable } from './db'
import type { RemoteApi, RemoteRow } from './remote'
import { pull, push, saveRows } from './sync'

type Row = Record<string, unknown> & { id: string; updated_at: string }

/** In-memory stand-in for the Data API including the server-side last-write-wins trigger. */
class FakeServer implements RemoteApi {
  tables = new Map<string, Map<string, RemoteRow>>()
  upserts: { table: string; ids: string[] }[] = []
  clock = Date.parse('2026-10-05T10:00:00Z')
  beforeUpsert: (() => Promise<void>) | null = null

  private table(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, new Map())
    return this.tables.get(name)!
  }
  async hasSession() {
    return true
  }
  async upsert(table: SyncTable, rows: object[]) {
    if (this.beforeUpsert) await this.beforeUpsert()
    const t = this.table(table)
    this.upserts.push({ table, ids: rows.map((r) => (r as Row).id) })
    for (const r of rows as Row[]) {
      const old = t.get(r.id)
      if (old && Date.parse(r.updated_at) < Date.parse(old.updated_at)) continue
      this.clock += 1000
      // Postgres returns timestamps with +00:00, the client stores Z or +02:00
      t.set(r.id, { ...r, synced_at: new Date(this.clock).toISOString().replace('Z', '+00:00') })
    }
  }
  async fetchSince(table: SyncTable, since: string, limit: number, offset: number) {
    return [...this.table(table).values()]
      .filter((r) => Date.parse(r.synced_at) > Date.parse(since))
      .sort((a, b) => Date.parse(a.synced_at) - Date.parse(b.synced_at) || a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
  }
  /** Simulates a change made on another device. */
  serverWrite(table: string, row: Row) {
    this.clock += 1000
    this.table(table).set(row.id, { ...row, synced_at: new Date(this.clock).toISOString() })
  }
}

const base = { user_id: 'u1', created_at: '2026-10-04T00:00:00+02:00', deleted_at: null }
const template = (id: string, name: string, updated_at: string) => ({ ...base, id, name, note: null, updated_at })
const tExercise = (id: string, template_id: string) => ({
  ...base,
  id,
  template_id,
  exercise_id: 'e1',
  position: 1,
  rest_s: 90,
  comment: null,
  updated_at: '2026-10-04T00:00:00+02:00',
})

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('push', () => {
  it('sends parents before children and empties the outbox', async () => {
    const server = new FakeServer()
    await saveRows('template_exercise', [tExercise('te1', 't1')])
    await saveRows('template', [template('t1', 'DAY1', '')])
    await push(server)
    expect(server.upserts.map((u) => u.table)).toEqual(['template', 'template_exercise'])
    expect(await db.outbox.count()).toBe(0)
  })

  it('keeps a row queued if it changed while the request was running', async () => {
    const server = new FakeServer()
    await saveRows('template', [template('t1', 'DAY1', '')])
    server.beforeUpsert = async () => {
      server.beforeUpsert = null
      await new Promise((r) => setTimeout(r, 5))
      await saveRows('template', [template('t1', 'DAY1 neu', '')])
    }
    await push(server)
    expect(await db.outbox.count()).toBe(1)
    await push(server)
    expect(await db.outbox.count()).toBe(0)
    expect(server.tables.get('template')!.get('t1')!.name).toBe('DAY1 neu')
  })

  it('does not overwrite a newer server row with an older local one', async () => {
    const server = new FakeServer()
    server.serverWrite('template', template('t1', 'vom iPhone', '2026-10-05T12:00:00Z'))
    await db.template.put(template('t1', 'alt', '2026-10-05T11:00:00Z'))
    await db.outbox.add({ table: 'template', row_id: 't1', queued_at: '' })
    await push(server)
    expect(server.tables.get('template')!.get('t1')!.name).toBe('vom iPhone')
  })
})

describe('pull', () => {
  it('takes newer remote rows, keeps newer local rows, across time zone formats', async () => {
    const server = new FakeServer()
    server.serverWrite('template', template('t1', 'remote neuer', '2026-10-05T10:00:00+00:00'))
    server.serverWrite('template', template('t2', 'remote aelter', '2026-10-05T10:00:00+00:00'))
    // 11:30+02:00 = 09:30Z (older than remote), 12:30+02:00 = 10:30Z (newer than remote)
    await db.template.put(template('t1', 'lokal aelter', '2026-10-05T11:30:00+02:00'))
    await db.template.put(template('t2', 'lokal neuer', '2026-10-05T12:30:00+02:00'))
    await pull(server)
    expect((await db.template.get('t1'))!.name).toBe('remote neuer')
    expect((await db.template.get('t2'))!.name).toBe('lokal neuer')
    expect(await db.template.get('t1')).not.toHaveProperty('synced_at')
  })

  it('advances the cursor and fetches only new rows on the next run', async () => {
    const server = new FakeServer()
    server.serverWrite('template', template('t1', 'a', '2026-10-05T10:00:00Z'))
    expect(await pull(server)).toBe(1)
    const cursor = (await db.sync_state.get('template'))!.last_synced_at
    expect(cursor).toBe(server.tables.get('template')!.get('t1')!.synced_at)
    // Unchanged row is fetched again inside the overlap window but not re-applied
    expect(await pull(server)).toBe(0)
    server.serverWrite('template', template('t2', 'b', '2026-10-05T10:05:00Z'))
    expect(await pull(server)).toBe(1)
  })

  it('pages through more rows than one page', async () => {
    const server = new FakeServer()
    for (let i = 0; i < 1203; i++) {
      server.serverWrite('workout_set', { ...base, id: `s${String(i).padStart(4, '0')}`, updated_at: '2026-10-05T10:00:00Z' })
    }
    expect(await pull(server)).toBe(1203)
    expect(await db.workout_set.count()).toBe(1203)
  })
})

describe('round trip', () => {
  it('a change on device A reaches device B', async () => {
    const server = new FakeServer()
    await saveRows('template', [template('t1', 'DAY1', '')])
    await push(server)
    // Device B = fresh local database
    await db.delete()
    await db.open()
    await pull(server)
    expect((await db.template.get('t1'))!.name).toBe('DAY1')
  })
})
