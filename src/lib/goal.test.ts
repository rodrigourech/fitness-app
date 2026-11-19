import { describe, expect, it } from 'vitest'
import { decidingIndexes, decidingReps, goalState, historyBars, prefillSource, progressPoints, startReps } from './goal'

type S = { set_type: 'working' | 'warmup'; weight: number | null; reps: number | null; reps_left: number | null; reps_right: number | null; completed_at: string | null; position: number }
const set = (position: number, weight: number, reps: number | null, done = false, type: S['set_type'] = 'working'): S => ({
  set_type: type, weight, reps, reps_left: null, reps_right: null, completed_at: done ? '2026-11-05T10:00:00Z' : null, position,
})
const targets = { target: 12, minimum: 8 }

describe('goal (decision 5 November 2026)', () => {
  it('decides on the top set only when top set is on, else on every work set', () => {
    const work = [set(1, 20, 10), set(2, 15, 10), set(3, 15, 10)]
    expect(decidingIndexes(work, true)).toEqual([0])
    expect(decidingIndexes(work, false)).toEqual([0, 1, 2])
    expect(decidingReps([set(1, 20, 11), set(2, 20, 9)], true, false)).toBe(9)
  })

  it('goal line: weight, next step and reached only when every deciding set is checked at Max reps', () => {
    const open = goalState([set(1, 5, 6, false, 'warmup'), set(2, 20, 12), set(3, 15, 10)], true, false, targets, 5)
    expect(open).toMatchObject({ weight: 20, target: 12, next: 25, reached: false, todayReps: null })
    const done = goalState([set(2, 20, 12, true), set(3, 15, 9, true)], true, false, targets, 5)
    expect(done).toMatchObject({ reached: true, todayReps: 12 })
    // Without a top set every set must reach Max reps; without a step the next weight is unknown
    expect(goalState([set(1, 20, 12, true), set(2, 20, 11, true)], false, false, targets, null)).toMatchObject({ reached: false, next: null, todayReps: 11 })
    expect(goalState([set(1, 0, 10)], true, false, targets, 5)).toBeNull()
  })

  it('start reps: last time plus one, at most Max reps; after Max reps the middle of the range', () => {
    expect(startReps(10, targets, 10)).toBe(11)
    expect(startReps(11, targets, 10)).toBe(12)
    expect(startReps(12, targets, 10)).toBe(10)
    expect(startReps(null, targets, 10)).toBe(10)
    expect(startReps(5, targets, 10)).toBe(8)
  })

  it('progress points mark a weight increase against the workout before', () => {
    const points = progressPoints(
      [
        { date: '2026-11-05', sets: [set(1, 20, 10), set(2, 15, 10)] },
        { date: '2026-10-26', sets: [set(1, 15, 12), set(2, 12, 12)] },
      ],
      true,
      false,
    )
    expect(points).toEqual([
      { date: '2026-11-05', weight: 20, reps: 10, up: true },
      { date: '2026-10-26', weight: 15, reps: 12, up: false },
    ])
  })
})

describe('dumbbell pairs (decision 5 November 2026)', () => {
  it('doubles the step of one dumbbell when both hands hold one', async () => {
    const { pairStep } = await import('./workout')
    expect(pairStep(2, 'dumbbell', false)).toBe(4)
    expect(pairStep(2, 'dumbbell', true)).toBe(2)
    expect(pairStep(5, 'plate_loaded', false)).toBe(5)
    expect(pairStep(null, 'dumbbell', false)).toBeNull()
  })
})

describe('warm-up of plate-loaded machines (decision 5 November 2026)', () => {
  it('uses the back-off weight for 4–5 reps on plate-loaded machines, else the warm-up share', async () => {
    const { warmUpPlan } = await import('./workout')
    expect(warmUpPlan('plate_loaded', { warmUp: 50, backOff: 85 })).toEqual({ share: 0.85, reps: 4, hint: '4–5' })
    expect(warmUpPlan('pin_loaded', { warmUp: 50, backOff: 85 })).toEqual({ share: 0.5, reps: 6, hint: '6–7' })
  })
})

describe('history bars', () => {
  const set = (position: number, weight: number, reps: number) => ({ set_type: 'working' as const, position, weight, reps, reps_left: null, reps_right: null, completed_at: 'x' })
  it('splits top set and back-off sets, oldest first', () => {
    const sessions = [
      { date: '2026-10-29', sets: [set(1, 50, 8), set(2, 40, 8)] },
      { date: '2026-10-22', sets: [set(1, 40, 10), set(2, 50, 9), set(3, 40, 7)] },
    ]
    const b = historyBars(sessions, true, false)
    expect(b.top).toEqual([{ date: '2026-10-22', kg: 50, reps: 9 }, { date: '2026-10-29', kg: 50, reps: 8 }])
    expect(b.other).toEqual([{ date: '2026-10-22', kg: 40, reps: 7 }, { date: '2026-10-29', kg: 40, reps: 8 }])
  })
  it('shows the lowest set and set 1 without a top set', () => {
    const b = historyBars([{ date: 'd', sets: [set(1, 25, 12), set(2, 25, 10), set(3, 25, 11)] }], false, false)
    expect(b.top).toEqual([{ date: 'd', kg: 25, reps: 10 }])
    expect(b.other).toEqual([{ date: 'd', kg: 25, reps: 12 }])
  })
})

describe('prefillSource (own weight jumps)', () => {
  const w = (weight: number, reps: number, position: number) => ({ set_type: 'working' as const, weight, reps, reps_left: null, reps_right: null, completed_at: 'x', position })
  const t = { minimum: 6, target: 10 }
  it('keeps an own jump that reached Min', () => {
    expect(prefillSource([[w(55, 6, 1), w(45, 10, 2)], [w(50, 8, 1), w(42.5, 10, 2)]], true, false, t)).toBe(0)
  })
  it('goes back to the old weight if the own jump stayed below Min', () => {
    expect(prefillSource([[w(55, 4, 1), w(45, 10, 2)], [w(50, 8, 1), w(42.5, 10, 2)]], true, false, t)).toBe(1)
  })
  it('back-off sets do not count with a top set', () => {
    expect(prefillSource([[w(55, 7, 1), w(45, 3, 2)], [w(50, 8, 1), w(42.5, 10, 2)]], true, false, t)).toBe(0)
  })
  it('without top set every set counts', () => {
    expect(prefillSource([[w(55, 8, 1), w(55, 5, 2)], [w(50, 8, 1), w(50, 8, 2)]], false, false, t)).toBe(1)
  })
  it('a jump the app suggested is not skipped', () => {
    expect(prefillSource([[w(55, 4, 1)], [w(50, 10, 1)]], true, false, t)).toBe(0)
  })
  it('skips several failed own jumps in a row', () => {
    expect(prefillSource([[w(60, 3, 1)], [w(55, 4, 1)], [w(50, 8, 1)]], true, false, t)).toBe(2)
  })
  it('unilateral counts the weaker side', () => {
    const u = (weight: number, l: number, r: number) => ({ set_type: 'working' as const, weight, reps: null, reps_left: l, reps_right: r, completed_at: 'x', position: 1 })
    expect(prefillSource([[u(20, 8, 5)], [u(18, 8, 8)]], true, true, t)).toBe(1)
  })
})
