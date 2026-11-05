import { describe, expect, it } from 'vitest'
import { decidingIndexes, decidingReps, goalState, progressPoints, startReps } from './goal'

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
