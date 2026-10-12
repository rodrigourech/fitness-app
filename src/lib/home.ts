import type { Workout } from './db'

export interface StartCard {
  id: string
  name: string
  lastDone: string | null
  exerciseCount?: number
}

// Stable IDs from migration 0013: renaming either template does not break the rotation.
export const MAIN_DAY_A = '3f38b1e8-3677-5043-9738-2205e2547f79'
export const MAIN_DAY_B = '1986dd1e-bcef-5189-8211-8ec6fc78ccc2'

type History = Pick<Workout, 'template_id' | 'finished_at' | 'deleted_at'>

/** Only completed, non-deleted main workouts advance the A/B rotation. */
export function suggestWorkout(cards: StartCard[], history: History[]): { card: StartCard; after: string | null } | null {
  const a = cards.find(c => c.id === MAIN_DAY_A) ?? cards.find(c => c.name.trim().toLowerCase() === 'main day a')
  const b = cards.find(c => c.id === MAIN_DAY_B) ?? cards.find(c => c.name.trim().toLowerCase() === 'main day b')
  if (!a || !b) {
    const card = a ?? b ?? cards[0]
    return card ? { card, after: null } : null
  }
  const last = history
    .filter(w => w.deleted_at === null && w.finished_at !== null && (w.template_id === a.id || w.template_id === b.id))
    .sort((x, y) => Date.parse(y.finished_at!) - Date.parse(x.finished_at!))[0]
  if (!last) return { card: a, after: null }
  return last.template_id === a.id ? { card: b, after: a.name } : { card: a, after: b.name }
}
