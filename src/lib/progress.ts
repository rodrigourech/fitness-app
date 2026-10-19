// Home › Your progress (decision 19 October 2026): tabs Volume and Body weight, range 1w · 1m · 3m · 6m · All.
// 1w shows the volume per workout and the weight per day; from 1m the volume per whole week and the 7-day average.
import { dayKey, weekStart, weeklyVolume, type SetInfo } from './analytics'
import type { BodyWeightPoint } from './body'

export type ProgressRange = '1w' | '1m' | '3m' | '6m' | 'all'
export const PROGRESS_RANGES: { key: ProgressRange; label: string }[] = [
  { key: '1w', label: '1w' },
  { key: '1m', label: '1m' },
  { key: '3m', label: '3m' },
  { key: '6m', label: '6m' },
  { key: 'all', label: 'All' },
]

const DAY = 86_400_000
const MONTHS: Record<'1m' | '3m' | '6m', number> = { '1m': 1, '3m': 3, '6m': 6 }

/** Start of the range (ms). Never before the first data: «All» and short histories start at the first entry. */
export function rangeFrom(range: ProgressRange, now: Date, first: number | null): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let from: number
  if (range === 'all') from = first ?? start.getTime() - 6 * DAY
  else if (range === '1w') from = start.getTime() - 6 * DAY
  else {
    start.setMonth(start.getMonth() - MONTHS[range])
    from = start.getTime()
  }
  return first !== null && first > from ? first : from
}

export interface VolumeBar {
  key: string
  /** Start of the week or day of the workout (YYYY-MM-DD) */
  date: string
  value: number
  /** Week still running */
  current: boolean
}

/** Volume bars: per workout for 1w, otherwise per whole week (oldest first). */
export function volumeBars(sets: SetInfo[], range: ProgressRange, now: Date, first: number | null): VolumeBar[] {
  const from = rangeFrom(range, now, first)
  if (range !== '1w') {
    const thisWeek = dayKey(weekStart(now))
    return weeklyVolume(sets, from, now).map((w) => ({ key: w.start, date: w.start, value: w.value, current: w.start === thisWeek }))
  }
  const byWorkout = new Map<string, VolumeBar>()
  for (const x of sets) {
    const s = x.set
    if (Date.parse(x.date) < from || x.trackingType !== 'weight_reps' || s.set_type !== 'working' || s.weight === null) continue
    const reps = s.reps ?? (s.reps_left ?? 0) + (s.reps_right ?? 0)
    const bar = byWorkout.get(x.workoutId) ?? { key: x.workoutId, date: dayKey(new Date(x.date)), value: 0, current: false }
    bar.value += s.weight * reps
    byWorkout.set(x.workoutId, bar)
  }
  return [...byWorkout.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface WeightPoint {
  date: string
  kg: number
  /** Measured value of the day (tooltip) */
  measured: number
}

/** Weight points oldest first: measured value per day for 1w, otherwise the 7-day average. */
export function weightPoints(series: BodyWeightPoint[], range: ProgressRange, now: Date): WeightPoint[] {
  const first = series.length ? Date.parse(`${series.at(-1)!.entry.measured_on}T00:00:00`) : null
  const from = rangeFrom(range, now, first)
  return series
    .filter((p) => Date.parse(`${p.entry.measured_on}T00:00:00`) >= from)
    .map((p) => ({ date: p.entry.measured_on, kg: Math.round((range === '1w' ? p.entry.weight_kg : p.avg7) * 10) / 10, measured: p.entry.weight_kg }))
    .reverse()
}
