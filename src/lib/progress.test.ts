import { describe, expect, it } from 'vitest'
import type { SetInfo } from './analytics'
import type { BodyWeightPoint } from './body'
import { rangeFrom, volumeBars, weightPoints } from './progress'

const now = new Date('2026-10-19T12:00:00')
const set = (workoutId: string, date: string, weight: number, reps: number): SetInfo => ({
  workoutId, date, exerciseId: 'e', mainId: 'e', trackingType: 'weight_reps', unilateral: false, primary: [], secondary: [],
  set: { set_type: 'working', weight, reps, reps_left: null, reps_right: null } as SetInfo['set'],
})
const sets = [
  set('a', '2026-09-28T09:00:00', 40, 10), set('b', '2026-10-12T09:00:00', 45, 10),
  set('c', '2026-10-15T09:00:00', 30, 10), set('d', '2026-10-19T09:00:00', 50, 10),
]

describe('your progress', () => {
  it('starts the range at the first data at the latest', () => {
    expect(new Date(rangeFrom('1w', now, null)).toDateString()).toBe(new Date('2026-10-13T00:00:00').toDateString())
    expect(new Date(rangeFrom('1m', now, null)).toDateString()).toBe(new Date('2026-09-19T00:00:00').toDateString())
    const first = Date.parse('2026-09-28T09:00:00')
    expect(rangeFrom('6m', now, first)).toBe(first)
    expect(rangeFrom('all', now, first)).toBe(first)
  })

  it('shows the volume per workout for 1w and per week otherwise, the running week marked', () => {
    expect(volumeBars(sets, '1w', now, null).map((b) => [b.date, b.value])).toEqual([['2026-10-15', 300], ['2026-10-19', 500]])
    const weeks = volumeBars(sets, 'all', now, Date.parse('2026-09-28T09:00:00'))
    expect(weeks.map((b) => b.value)).toEqual([400, 0, 750, 500])
    expect(weeks.map((b) => b.current)).toEqual([false, false, false, true])
  })

  it('shows the weight per day for 1w and the 7-day average otherwise', () => {
    const series = [
      { entry: { measured_on: '2026-10-18', weight_kg: 74.4 }, avg7: 74.2 },
      { entry: { measured_on: '2026-10-01', weight_kg: 73.0 }, avg7: 73.1 },
    ] as BodyWeightPoint[]
    expect(weightPoints(series, '1w', now)).toEqual([{ date: '2026-10-18', kg: 74.4, measured: 74.4 }])
    expect(weightPoints(series, '1m', now).map((p) => p.kg)).toEqual([73.1, 74.2])
  })
})
