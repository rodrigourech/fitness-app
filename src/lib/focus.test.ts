import { describe, expect, it } from 'vitest'
import { cardOpen, doneSummary, exerciseDone, focusId, isExtra, swipeDirection, todoSummary } from './focus'

const s = (weight: number | null, reps: number | null, done: boolean, type: 'working' | 'warmup' = 'working') => ({
  set_type: type, weight, reps, reps_left: null, reps_right: null, duration_s: null, distance_km: null,
  completed_at: done ? '2026-11-05T18:00:00Z' : null,
})

describe('focus view (decision 5 November 2026, variant B)', () => {
  it('an exercise is done when every work set is checked; the warm-up does not count', () => {
    expect(exerciseDone([s(20, 6, false, 'warmup'), s(40, 10, true), s(34, 10, true)])).toBe(true)
    expect(exerciseDone([s(40, 10, true), s(34, 10, false)])).toBe(false)
    expect(exerciseDone([s(20, 6, true, 'warmup')])).toBe(false)
  })

  it('focus is the first exercise neither skipped nor done; the user can open or close any card', () => {
    const cards = [{ id: 'a', skipped: false, done: true }, { id: 'b', skipped: true, done: false }, { id: 'c', skipped: false, done: false }]
    expect(focusId(cards)).toBe('c')
    expect(focusId([{ id: 'a', skipped: false, done: true }])).toBeNull()
    expect(cardOpen('c', 'c', undefined)).toBe(true)
    expect(cardOpen('c', 'c', false)).toBe(false)
    expect(cardOpen('a', 'c', true)).toBe(true)
    expect(cardOpen('a', 'c', undefined)).toBe(false)
  })

  it('summaries: checked work sets for done, sets and weight for to do', () => {
    expect(doneSummary([s(25, 6, true, 'warmup'), s(32, 11, true), s(25, 10, true)])).toBe('32 × 11 · 25 × 10')
    expect(todoSummary([s(25, 6, false, 'warmup'), s(32, 10, false), s(25, 10, false), s(25, 10, false)])).toBe('3 × 32 kg')
    expect(todoSummary([s(null, null, false)])).toBe('1 set')
    expect(doneSummary([s(null, null, true), s(null, null, true)])).toBe('2 sets done')
  })

  it('swipe: at least 80 px and clearly horizontal', () => {
    expect(swipeDirection(-100, 10)).toBe('left')
    expect(swipeDirection(120, -20)).toBe('right')
    expect(swipeDirection(-60, 0)).toBeNull()
    expect(swipeDirection(-100, 90)).toBeNull()
  })

  it('extra exercises are marked by the slot comment «Extra»', () => {
    expect(isExtra('Extra')).toBe(true)
    expect(isExtra(' extra, skip if short on time')).toBe(true)
    expect(isExtra('Darf entfallen')).toBe(false)
    expect(isExtra(null)).toBe(false)
    expect(isExtra('Extraordinary')).toBe(false)
  })
})
