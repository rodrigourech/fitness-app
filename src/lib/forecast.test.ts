import { describe, expect, it } from 'vitest'
import { goalProgress, roughDate, t90, weightForecast } from './forecast'

// Rodrigo's weigh-ins of October 2026 (morning, fasted)
const OCT = [
  ['2026-10-05', 86.6], ['2026-10-06', 86.2], ['2026-10-08', 85.8], ['2026-10-09', 86.4], ['2026-10-13', 85.6],
  ['2026-10-19', 85.8], ['2026-10-22', 85.3], ['2026-10-23', 85.1], ['2026-10-27', 85.7], ['2026-10-29', 85.3], ['2026-11-01', 85.7],
].map(([date, kg]) => ({ date: date as string, kg: kg as number }))

describe('weightForecast', () => {
  it('fits the trend of the last 4 weeks', () => {
    const f = weightForecast(OCT, '2026-11-01', 82)!
    expect(f.n).toBe(11)
    expect(f.perWeek).toBeCloseTo(-0.242, 2)
    expect(f.at(0)).toBeCloseTo(85.27, 1)
    expect(f.goalInDays).toBeGreaterThan(85)
    expect(f.goalInDays).toBeLessThan(100)
  })

  it('band grows with distance from the data', () => {
    const f = weightForecast(OCT, '2026-11-01', 82)!
    expect(f.band(60)).toBeGreaterThan(f.band(0))
    expect(f.band(60)).toBeCloseTo(1.15, 1)
  })

  it('ignores weigh-ins older than 4 weeks and needs at least 4 points over 7 days', () => {
    expect(weightForecast(OCT.slice(0, 3), '2026-11-01', 82)).toBeNull()
    expect(weightForecast(OCT.slice(-4), '2026-11-01', 82)).not.toBeNull()
    expect(weightForecast(OCT.slice(-2).concat(OCT.slice(-2)), '2026-11-01', 82)).toBeNull()
  })

  it('has no goal date when the trend goes the wrong way or there is no goal', () => {
    const up = OCT.map((p, i) => ({ ...p, kg: 80 + i * 0.1 }))
    expect(weightForecast(up, '2026-11-01', 75)!.goalInDays).toBeNull()
    expect(weightForecast(OCT, '2026-11-01', null)!.goalInDays).toBeNull()
  })
})

describe('helpers', () => {
  it('t quantiles', () => {
    expect(t90(9)).toBeCloseTo(1.383)
    expect(t90(100)).toBeCloseTo(1.282)
  })
  it('roughDate', () => {
    const today = new Date(2026, 10, 1)
    expect(roughDate(new Date(2027, 1, 4), today)).toBe('early Feb 2027')
    expect(roughDate(new Date(2026, 11, 28), today)).toBe('late Dec')
    expect(roughDate(new Date(2026, 11, 15), today)).toBe('mid Dec')
  })
  it('goalProgress', () => {
    expect(goalProgress(88.2, 85.5, 82)).toBe(44)
    expect(goalProgress(88.2, 89, 82)).toBe(0)
    expect(goalProgress(88.2, 81, 82)).toBe(100)
  })
})
