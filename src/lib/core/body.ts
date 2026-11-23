// Body weight series without database access (shared by the app and the Food connector, decision 23 November 2026).
import type { BodyWeight } from '../db'
import type { WeighIn } from '../forecast'

export interface BodyWeightPoint {
  entry: BodyWeight
  /** Mean of all measurements of the last 7 days up to this day (missing days are skipped) */
  avg7: number
}

const DAY = 86_400_000

/** Entries newest first with the 7-day moving average; one entry per day (latest edit wins), deleted rows skipped. */
export function weightSeries(rows: BodyWeight[]): BodyWeightPoint[] {
  const byDay = new Map<string, BodyWeight>()
  for (const b of rows) {
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

/** Weigh-ins for the trend and forecast in Stats: morning fasted or without a condition (decision 1 November 2026). */
export function trendWeighIns(series: BodyWeightPoint[]): WeighIn[] {
  return series
    .filter((p) => p.entry.condition === null || p.entry.condition === 'morning_fasted')
    .map((p) => ({ date: p.entry.measured_on, kg: p.entry.weight_kg }))
}
