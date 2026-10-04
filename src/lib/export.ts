import { db, displayName, SYNC_TABLES, type Exercise } from './db'

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

/** All synchronised tables (without deleted rows) as one JSON file. */
export async function exportJson(): Promise<void> {
  const data: Record<string, unknown[]> = {}
  for (const t of SYNC_TABLES) data[t] = (await db.table(t).toArray()).filter((r: { deleted_at: string | null }) => r.deleted_at === null)
  download(`fitness-app-${stamp()}.json`, 'application/json', JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2))
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per set of finished workouts, for Excel, Python or Power BI. */
export async function exportSetsCsv(): Promise<void> {
  const exercises = await db.exercise.toArray()
  const byId = new Map<string, Exercise>(exercises.map((e) => [e.id, e]))
  const workouts = new Map(
    (await db.workout.toArray()).filter((w) => w.deleted_at === null && w.finished_at !== null).map((w) => [w.id, w]),
  )
  const wes = new Map((await db.workout_exercise.toArray()).filter((we) => we.deleted_at === null && workouts.has(we.workout_id)).map((we) => [we.id, we]))
  const sets = (await db.workout_set.toArray()).filter((s) => s.deleted_at === null && wes.has(s.workout_exercise_id))
  const header = ['date', 'started_at', 'workout', 'exercise', 'exercise_position', 'set', 'set_type', 'weight_kg', 'reps', 'reps_left', 'reps_right', 'rir', 'duration_s', 'distance_km']
  const rows = sets
    .map((s) => {
      const we = wes.get(s.workout_exercise_id)!
      const w = workouts.get(we.workout_id)!
      const ex = byId.get(we.exercise_id)
      return [w.started_at.slice(0, 10), w.started_at, w.template_name_snapshot, ex ? displayName(ex, byId) : we.exercise_id, we.position, s.position, s.set_type, s.weight, s.reps, s.reps_left, s.reps_right, s.rir, s.duration_s, s.distance_km]
    })
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])) || Number(a[4]) - Number(b[4]) || Number(a[5]) - Number(b[5]))
  download(`fitness-app-sets-${stamp()}.csv`, 'text/csv', [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'))
}
