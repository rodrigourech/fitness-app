// Body weight forecast for the goal card in Stats (decision 1 November 2026).
// Linear trend of the weigh-ins of the last 4 weeks (morning or unknown condition), with an 80 % confidence band
// of the trend line: t(0.9, n − 2) · s · √(1/n + (x − x̄)² / Sxx). Pure functions, testable without IndexedDB.

export interface WeighIn {
  /** YYYY-MM-DD */
  date: string
  kg: number
}

export interface Forecast {
  /** Trend value at day offset x (0 = today, negative = past) */
  at: (x: number) => number
  /** Half width of the 80 % band at day offset x */
  band: (x: number) => number
  /** Change per week in kg (negative = losing) */
  perWeek: number
  /** Day offset at which the trend reaches the goal; null if it never does within a year */
  goalInDays: number | null
  n: number
}

const DAY = 86_400_000
export const FORECAST_WINDOW_DAYS = 28
const MIN_POINTS = 4

// One-sided 90 % quantiles of the t distribution (two-sided 80 % band) for 1 to 30 degrees of freedom
const T90 = [3.078, 1.886, 1.638, 1.533, 1.476, 1.44, 1.415, 1.397, 1.383, 1.372, 1.363, 1.356, 1.35, 1.345, 1.341,
  1.337, 1.333, 1.33, 1.328, 1.325, 1.323, 1.321, 1.319, 1.318, 1.316, 1.315, 1.314, 1.313, 1.311, 1.31]

export function t90(df: number): number {
  return df < 1 ? Infinity : T90[df - 1] ?? 1.282
}

export function dayOffset(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY)
}

/** Trend of the last 4 weeks; null with fewer than 4 weigh-ins or less than 7 days between first and last. */
export function weightForecast(points: WeighIn[], today: string, goal: number | null): Forecast | null {
  const recent = points
    .map((p) => ({ x: dayOffset(p.date, today), y: p.kg }))
    .filter((p) => p.x <= 0 && p.x > -FORECAST_WINDOW_DAYS)
  const n = recent.length
  if (n < MIN_POINTS) return null
  const xs = recent.map((p) => p.x)
  if (Math.max(...xs) - Math.min(...xs) < 7) return null
  const xBar = xs.reduce((a, b) => a + b, 0) / n
  const yBar = recent.reduce((a, p) => a + p.y, 0) / n
  const sxx = recent.reduce((a, p) => a + (p.x - xBar) ** 2, 0)
  const slope = recent.reduce((a, p) => a + (p.x - xBar) * (p.y - yBar), 0) / sxx
  const intercept = yBar - slope * xBar
  const sse = recent.reduce((a, p) => a + (p.y - (intercept + slope * p.x)) ** 2, 0)
  const s = n > 2 ? Math.sqrt(sse / (n - 2)) : 0
  const t = t90(n - 2)
  const at = (x: number) => intercept + slope * x
  const band = (x: number) => t * s * Math.sqrt(1 / n + (x - xBar) ** 2 / sxx)
  let goalInDays: number | null = null
  if (goal !== null && slope !== 0) {
    const x = (goal - intercept) / slope
    if (x >= 0 && x <= 365) goalInDays = Math.round(x)
  }
  return { at, band, perWeek: slope * 7, goalInDays, n }
}

/** Three-letter months (Intl gives «Sept» in en-GB). */
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** «early Feb», «mid Feb», «late Feb»; with the year when it is not the year of today. */
export function roughDate(date: Date, today: Date): string {
  const d = date.getDate()
  const part = d <= 10 ? 'early' : d <= 20 ? 'mid' : 'late'
  const month = MONTHS[date.getMonth()]
  return `${part} ${month}${date.getFullYear() !== today.getFullYear() ? ` ${date.getFullYear()}` : ''}`
}

/** Share of the way from the first weigh-in to the goal, 0 to 100. */
export function goalProgress(start: number, now: number, goal: number): number {
  if (start === goal) return 100
  return Math.round(Math.min(100, Math.max(0, ((start - now) / (start - goal)) * 100)))
}
