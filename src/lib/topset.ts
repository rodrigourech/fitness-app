// Top set and recommended weights (decisions 18 October 2026).
// Per exercise the setting «Top set» decides the scheme. On: the heaviest set is the top set and every other
// work set is recommended at 85 % of today's top set (back-off). Off: equal sets, no recommendations.
// The app never changes a field by itself: recommendations are shown and taken over with a tap.

export type Recommendation = { kind: 'top' } | { kind: 'weight'; kg: number; percent: number } | null

export const BACK_OFF_SHARE = 0.85
export const WARM_UP_SHARE = 0.5

/** Rounds to 5 kg from 20 kg, below that to 0.5 kg; exact halves round down (the lighter weight). */
export function roundWeight(kg: number): number {
  const step = kg >= 20 ? 5 : 0.5
  return Math.ceil(kg / step - 0.5) * step
}

/** Index of the first heaviest weight, or -1 without any weight above 0. */
export function topIndex(weights: (number | null)[]): number {
  let best = -1
  weights.forEach((w, i) => {
    if (w !== null && w > 0 && (best === -1 || w > weights[best]!)) best = i
  })
  return best
}

/** Recommendations for the work sets of the running workout from the weights in the fields now. */
export function recommendations(current: (number | null)[], topSet: boolean): Recommendation[] {
  const top = topSet ? topIndex(current) : -1
  if (top === -1) return current.map(() => null)
  const kg = roundWeight(current[top]! * BACK_OFF_SHARE)
  const percent = Math.round((kg / current[top]!) * 100)
  return current.map((_, i) => (i === top ? { kind: 'top' } : { kind: 'weight', kg, percent }))
}

/** Recommended warm-up weight: about half of the heaviest weight in the fields. */
export function warmUpWeight(current: (number | null)[]): number | null {
  const top = topIndex(current)
  return top === -1 ? null : roundWeight(current[top]! * WARM_UP_SHARE)
}

/**
 * Weight fields marked while «Increase weight» applies, until the weight is raised or the set is checked.
 * Top set on: the sets that carried the top weight last time. Off: every set.
 */
export function increaseMarks(current: (number | null)[], previous: (number | null)[], done: boolean[], topSet: boolean): boolean[] {
  const prevTop = topIndex(previous)
  const topKg = prevTop === -1 ? null : previous[prevTop]!
  return current.map((kg, i) => {
    const before = previous[i] ?? previous.at(-1) ?? null
    if (done[i] || before === null) return false
    if (topSet && before !== topKg) return false
    return kg === null || kg <= before
  })
}
