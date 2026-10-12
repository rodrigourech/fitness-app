import { db, getMeta, SYNC_TABLES, type Exercise, type SyncTable, type TemplateExercise, type TemplateSet } from './db'
import type { RemoteApi } from './remote'
import { DEFAULT_MIN_REPS, DEFAULT_TARGET_REPS } from './training'

export const BETA_READY_KEY = 'beta_snapshot_ready'

/** Builds a complete local snapshot before exposing it to the UI. Never writes to the remote. */
export async function importBetaSnapshot(remote: RemoteApi): Promise<void> {
  if (await getMeta(BETA_READY_KEY) === '1') return
  const rows = new Map<SyncTable, Record<string, unknown>[]>()
  for (const table of SYNC_TABLES) {
    const all: Record<string, unknown>[] = []
    for (let offset = 0; ; offset += 500) {
      const page = await remote.fetchSince(table, '1970-01-01T00:00:00Z', 500, offset)
      all.push(...page.map(({ synced_at: _synced, ...row }) => row))
      if (page.length < 500) break
    }
    rows.set(table, all)
  }

  const exercises = rows.get('exercise') as unknown as Exercise[]
  const entries = rows.get('template_exercise') as unknown as TemplateExercise[]
  const sets = rows.get('template_set') as unknown as TemplateSet[]
  const warmEntries = new Set(sets.filter((s) => s.deleted_at === null && s.set_type === 'warmup').map((s) => s.template_exercise_id))
  const warmExercises = new Set(entries.filter((te) => te.deleted_at === null && warmEntries.has(te.id)).map((te) => te.exercise_id))
  const timestamp = new Date().toISOString()
  for (const ex of exercises) {
    if (ex.tracking_type === 'weight_reps' && !ex.parent_id) {
      ex.target_reps ??= DEFAULT_TARGET_REPS
      ex.min_reps ??= DEFAULT_MIN_REPS
    }
    ex.warm_up ??= warmExercises.has(ex.id) ? true : ex.parent_id ? null : false
  }
  // Matches migration 0014: legacy fixed rep targets keep their upper target but inherit the new minimum.
  for (const set of sets) {
    if (set.deleted_at !== null) continue
    if (set.set_type === 'warmup') set.deleted_at = timestamp
    else if (set.target_reps_min === set.target_reps_max) set.target_reps_min = null
  }

  await db.transaction('rw', [...SYNC_TABLES.map((table) => db.table(table)), db.meta, db.outbox, db.sync_state], async () => {
    for (const table of SYNC_TABLES) {
      await db.table(table).clear()
      await db.table(table).bulkPut(rows.get(table)!)
    }
    await db.outbox.clear()
    await db.sync_state.clear()
    await db.meta.put({ key: BETA_READY_KEY, value: '1' })
  })
}
