import { describe, expect, it } from 'vitest'
import { MAIN_DAY_A, MAIN_DAY_B, suggestWorkout, type StartCard } from './home'

const cards: StartCard[] = [
  { id: 'run', name: 'Run', lastDone: null },
  { id: MAIN_DAY_B, name: 'Main Day B', lastDone: null },
  { id: MAIN_DAY_A, name: 'Main Day A', lastDone: null },
  { id: 'bonus', name: 'Bonus Day', lastDone: null },
]
const finished = (id: string, day: number) => ({ template_id: id, finished_at: `2026-10-${String(day).padStart(2, '0')}T12:00:00Z`, deleted_at: null })

describe('home workout suggestion', () => {
  it('starts with A independently of the manual workout order', () => {
    expect(suggestWorkout(cards, [])?.card.id).toBe(MAIN_DAY_A)
  })
  it('alternates after the latest completed main workout', () => {
    expect(suggestWorkout(cards, [finished(MAIN_DAY_A, 10), finished(MAIN_DAY_B, 9)])).toMatchObject({ card: { id: MAIN_DAY_B }, after: 'Main Day A' })
    expect(suggestWorkout(cards, [finished(MAIN_DAY_A, 10), finished(MAIN_DAY_B, 11)])?.card.id).toBe(MAIN_DAY_A)
  })
  it('ignores more recent bonus, run, unfinished and deleted workouts', () => {
    const history = [finished(MAIN_DAY_A, 8), finished('bonus', 9), finished('run', 10),
      { ...finished(MAIN_DAY_B, 11), deleted_at: '2026-10-12T12:00:00Z' },
      { ...finished(MAIN_DAY_B, 12), finished_at: null }]
    expect(suggestWorkout(cards, history)?.card.id).toBe(MAIN_DAY_B)
  })
  it('uses stable IDs after renaming a main template', () => {
    const renamed = cards.map(c => c.id === MAIN_DAY_A ? { ...c, name: 'Strength A' } : c)
    expect(suggestWorkout(renamed, [finished(MAIN_DAY_A, 10)])).toMatchObject({ card: { id: MAIN_DAY_B }, after: 'Strength A' })
  })
  it('never suggests an archived or deleted template absent from the active cards', () => {
    expect(suggestWorkout(cards.filter(c => c.id !== MAIN_DAY_B), [finished(MAIN_DAY_A, 10)])?.card.id).toBe(MAIN_DAY_A)
  })
  it('handles custom plans and an empty active list', () => {
    expect(suggestWorkout([cards[0]!], [])?.card.id).toBe('run')
    expect(suggestWorkout([], [])).toBeNull()
  })
})
