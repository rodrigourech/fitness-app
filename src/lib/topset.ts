// Top set and recommended weights (decisions 18 and 19 October 2026).
// Per exercise the setting «Top set» decides the scheme. On: the heaviest set is the top set and every other work set
// is recommended at the back-off share of today's top set. Off: equal sets, no recommendations for work sets.
// With a weight step the app walks down from the top set in whole steps, so every recommendation exists on the
// machine; without one it estimates (5 kg from 20 kg, 1 kg below) and marks the value with ≈.
// The app never changes a field by itself: recommendations are shown and taken over with a tap.

export interface Suggestion {
  kg: number
  /** True without a weight step: the weight may not exist on the machine */
  estimate: boolean
}

export type Recommendation =
  | { kind: 'top'; next: number | null }
  | { kind: 'weight'; kg: number; estimate: boolean }
  | null

/** Shown value: whole kg from 10 kg, 0.5 kg below (labels of stacks such as 4.5, 9, 13.5 → 14). */
export function displayWeight(kg: number): number {
  return kg >= 10 ? Math.round(kg) : Math.round(kg * 2) / 2
}

/** Estimate without a weight step: 5 kg from 20 kg, 1 kg below; exact halves round down. */
export function estimateWeight(kg: number): number {
  const step = kg >= 20 ? 5 : 1
  return Math.ceil(kg / step - 0.5) * step
}

/** Weight near share × top. With a step: whole steps down from the top set, the lighter one on a tie. */
export function shareOf(top: number, share: number, step: number | null): Suggestion {
  const target = top * share
  if (!step || step <= 0) return { kg: estimateWeight(target), estimate: true }
  const maxSteps = Math.max(0, Math.ceil(top / step) - 1)
  const steps = Math.min(maxSteps, Math.max(0, Math.floor((top - target) / step + 0.5)))
  return { kg: displayWeight(top - steps * step), estimate: false }
}

/** Index of the first heaviest weight, or -1 without any weight above 0. */
export function topIndex(weights: (number | null)[]): number {
  let best = -1
  weights.forEach((w, i) => {
    if (w !== null && w > 0 && (best === -1 || w > weights[best]!)) best = i
  })
  return best
}

/**
 * Recommendations for the work sets of the running workout from the weights in the fields now.
 * increase: the top set should be raised; with a step the next weight is offered.
 */
export function recommendations(current: (number | null)[], topSet: boolean, backOff: number, step: number | null, increase = false): Recommendation[] {
  const top = topSet ? topIndex(current) : -1
  if (top === -1) return current.map(() => null)
  const topKg = current[top]!
  const back = shareOf(topKg, backOff, step)
  const next = increase && step ? displayWeight(topKg + step) : null
  return current.map((_, i) => (i === top ? { kind: 'top', next } : { kind: 'weight', kg: back.kg, estimate: back.estimate }))
}

/** Recommended warm-up weight from the heaviest weight in the fields. */
export function warmUpWeight(current: (number | null)[], warmUp: number, step: number | null): Suggestion | null {
  const top = topIndex(current)
  return top === -1 ? null : shareOf(current[top]!, warmUp, step)
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
