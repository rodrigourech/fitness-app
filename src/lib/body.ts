import { db, type BodyCondition, type BodyWeight } from './db'
import { saveRows } from './sync'

export const CONDITION_LABEL: Record<BodyCondition, string> = {
  morning_fasted: 'Morning, fasted',
  after_workout: 'After workout',
  after_meal: 'After meal',
  other: 'Other',
}

/** Saves the weight for a day; an existing entry of that day is updated. */
export async function saveBodyWeight(
  userId: string,
  measuredOn: string,
  kg: number,
  condition: BodyCondition | null = null,
  note: string | null = null,
): Promise<void> {
  const existing = (await db.body_weight.where('measured_on').equals(measuredOn).toArray()).find((b) => b.deleted_at === null)
  const ts = new Date().toISOString()
  const row: BodyWeight = existing
    ? { ...existing, weight_kg: kg, condition, note }
    : {
        id: crypto.randomUUID(),
        user_id: userId,
        measured_on: measuredOn,
        weight_kg: kg,
        condition,
        note,
        created_at: ts,
        updated_at: ts,
        deleted_at: null,
      }
  await saveRows('body_weight', [row])
}

export async function deleteBodyWeight(b: BodyWeight): Promise<void> {
  await saveRows('body_weight', [{ ...b, deleted_at: new Date().toISOString() }])
}

export interface BodyWeightPoint {
  entry: BodyWeight
  /** Mean of all measurements of the last 7 days up to this day (missing days are skipped) */
  avg7: number
}

const DAY = 86_400_000

/** Entries newest first with the 7-day moving average; one entry per day (latest edit wins). */
export async function bodyWeightSeries(): Promise<BodyWeightPoint[]> {
  const byDay = new Map<string, BodyWeight>()
  for (const b of await db.body_weight.toArray()) {
    if (b.deleted_at !== null) continue
    const cur = byDay.get(b.measured_on)
    if (!cur || b.updated_at > cur.updated_at) byDay.set(b.measured_on, b)
  }
  const entries = [...byDay.values()].sort((a, b) => a.measured_on.localeCompare(b.measured_on))
  return entries
    .map((e) => {
      const t = Date.parse(e.measured_on)
      const window = entries.filter((x) => {
        const d = Date.parse(x.measured_on)
        return d <= t && d > t - 7 * DAY
      })
      return { entry: e, avg7: window.reduce((s, x) => s + x.weight_kg, 0) / window.length }
    })
    .reverse()
}

export function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
