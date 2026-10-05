// Helpers for the charts in components/Charts.tsx.

/** Round axis ticks (1, 2, 2.5, 5 x 10^n) covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) {
    const v = max || 1
    return [0, v]
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag
  const out: number[] = []
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.999; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

export function formatShortDate(ms: number): string {
  return shortDate.format(ms)
}
