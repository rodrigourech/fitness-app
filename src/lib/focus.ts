import type { WorkoutSet } from './db'
import { formatNumber } from './workout'

// Focus view of a running workout (decision 5 November 2026, variant B): only the next open exercise is expanded,
// finished exercises collapse to a green line, the others are one line each. Swiping left skips an exercise, swiping
// right (or «Restore») brings it back.

type Set = Pick<WorkoutSet, 'set_type' | 'weight' | 'reps' | 'reps_left' | 'reps_right' | 'duration_s' | 'distance_km' | 'completed_at'>

/** All work sets are checked (at least one). Warm-up sets do not count. */
export function exerciseDone(sets: Set[]): boolean {
  const working = sets.filter((s) => s.set_type === 'working')
  return working.length > 0 && working.every((s) => s.completed_at !== null)
}

/** The exercise in focus: the first one that is neither skipped nor done, or null when all are. */
export function focusId(cards: { id: string; skipped: boolean; done: boolean }[]): string | null {
  return cards.find((c) => !c.skipped && !c.done)?.id ?? null
}

/** A card is open by the user's own choice, else when it is in focus. */
export function cardOpen(id: string, focus: string | null, override: boolean | undefined): boolean {
  return override ?? id === focus
}

function one(s: Set): string | null {
  const reps = s.reps ?? (s.reps_left !== null || s.reps_right !== null ? `${s.reps_left ?? '–'}/${s.reps_right ?? '–'}` : null)
  if (s.weight !== null && reps !== null) return `${formatNumber(s.weight)} × ${reps}`
  if (reps !== null) return `${reps} reps`
  if (s.duration_s !== null) return `${Math.round(s.duration_s / 60)} min`
  if (s.distance_km !== null) return `${formatNumber(s.distance_km)} km`
  return null
}

/** Green line of a finished exercise: the checked work sets («32 × 11 · 25 × 10»). */
export function doneSummary(sets: Set[]): string {
  const done = sets.filter((s) => s.set_type === 'working' && s.completed_at !== null)
  const parts = done.map(one)
  if (parts.some((p) => p === null)) return `${done.length} ${done.length === 1 ? 'set' : 'sets'} done`
  return parts.join(' · ')
}

/** Line of an exercise still to do: number of work sets and the heaviest planned weight («3 × 30 kg»). */
export function todoSummary(sets: Set[]): string {
  const working = sets.filter((s) => s.set_type === 'working')
  const weight = Math.max(0, ...working.map((s) => s.weight ?? 0))
  const n = working.length
  if (!n) return 'No sets'
  return weight > 0 ? `${n} × ${formatNumber(weight)} kg` : `${n} ${n === 1 ? 'set' : 'sets'}`
}

/** Horizontal swipe direction once the finger is lifted, null below the threshold or for a mostly vertical move. */
export function swipeDirection(dx: number, dy: number, threshold = 80): 'left' | 'right' | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) < 1.5 * Math.abs(dy)) return null
  return dx < 0 ? 'left' : 'right'
}
