// Top set and recommended weights (decision 18 October 2026).
// The top set is the heaviest work set; every other set keeps its ratio to the top set from the last workout.
// The app never changes a field by itself: recommendations are shown and taken over with a tap.

export type Recommendation =
  | { kind: 'top'; badge: boolean }
  | { kind: 'weight'; kg: number; percent: number }
  | null

export const WARM_UP_SHARE = 0.5

/** Rounds to 5 kg from 20 kg, below that to 0.5 kg. */
export function roundWeight(kg: number): number {
  return kg >= 20 ? Math.round(kg / 5) * 5 : Math.round(kg * 2) / 2
}

/** Index of the first heaviest weight, or -1 without any weight above 0. */
export function topIndex(weights: (number | null)[]): number {
  let best = -1
  weights.forEach((w, i) => {
    if (w !== null && w > 0 && (best === -1 || w > weights[best]!)) best = i
  })
  return best
}

/** True if the work sets do not all carry the same weight (only then a TOP badge is shown). */
export function hasTopSet(weights: (number | null)[]): boolean {
  const set = new Set(weights.filter((w): w is number => w !== null && w > 0))
  return set.size > 1
}

/**
 * Recommendations for the work sets of the running workout.
 * current: weights in the fields now; previous: work-set weights of the last workout.
 */
export function recommendations(current: (number | null)[], previous: (number | null)[]): Recommendation[] {
  const top = topIndex(current)
  const prevTop = topIndex(previous)
  if (top === -1) return current.map(() => null)
  const topKg = current[top]!
  const badge = hasTopSet(current)
  return current.map((_, i) => {
    if (i === top) return { kind: 'top', badge }
    if (prevTop === -1) return null
    const before = previous[i] ?? previous.at(-1) ?? null
    if (before === null || before <= 0) return null
    const ratio = before / previous[prevTop]!
    const kg = ratio === 1 ? topKg : roundWeight(topKg * ratio)
    return { kind: 'weight', kg, percent: Math.round(ratio * 100) }
  })
}

/** Recommended warm-up weight: about half of the current top set. */
export function warmUpWeight(current: (number | null)[]): number | null {
  const top = topIndex(current)
  return top === -1 ? null : roundWeight(current[top]! * WARM_UP_SHARE)
}

/**
 * Sets whose weight field is marked while «Increase weight» applies: the sets that carried the top weight last
 * time, as long as their weight was not raised and the set is not checked.
 */
export function increaseMarks(current: (number | null)[], previous: (number | null)[], done: boolean[]): boolean[] {
  const prevTop = topIndex(previous)
  if (prevTop === -1) return current.map(() => false)
  const topKg = previous[prevTop]!
  return current.map((kg, i) => previous[i] === topKg && !done[i] && (kg === null || kg <= topKg))
}
