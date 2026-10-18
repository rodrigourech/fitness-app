import { describe, expect, it } from 'vitest'
import { hasTopSet, increaseMarks, recommendations, roundWeight, topIndex, warmUpWeight } from './topset'

describe('top set', () => {
  it('finds the first heaviest weight', () => {
    expect(topIndex([40, 50, 40])).toBe(1)
    expect(topIndex([20, 20, 15])).toBe(0)
    expect(topIndex([null, null])).toBe(-1)
    expect(hasTopSet([40, 50, 40])).toBe(true)
    expect(hasTopSet([4.5, 4.5, 4.5])).toBe(false)
  })

  it('rounds to 5 kg from 20 kg and to 0.5 kg below', () => {
    expect(roundWeight(48)).toBe(50)
    expect(roundWeight(22.5)).toBe(25)
    expect(roundWeight(19.5)).toBe(19.5)
    expect(roundWeight(2.3)).toBe(2.5)
  })

  it('keeps every set at its ratio to the top set from last time', () => {
    expect(recommendations([40, 60, 40], [40, 50, 40])).toEqual([
      { kind: 'weight', kg: 50, percent: 80 }, { kind: 'top', badge: true }, { kind: 'weight', kg: 50, percent: 80 }])
    expect(recommendations([30, 25, 25], [25, 25, 25])).toEqual([
      { kind: 'top', badge: true }, { kind: 'weight', kg: 30, percent: 100 }, { kind: 'weight', kg: 30, percent: 100 }])
    expect(recommendations([4.5, 4.5, 4.5], [4.5, 4.5, 4.5])[1]).toEqual({ kind: 'weight', kg: 4.5, percent: 100 })
    expect(recommendations([4.5, 4.5], [4.5, 4.5])[0]).toEqual({ kind: 'top', badge: false })
    // An extra set takes the ratio of the last set; no history gives no recommendation
    expect(recommendations([20, 20, 15, 15], [20, 20, 15])[3]).toEqual({ kind: 'weight', kg: 15, percent: 75 })
    expect(recommendations([20, 20], [])).toEqual([{ kind: 'top', badge: false }, null])
    expect(recommendations([null, null], [20, 20])).toEqual([null, null])
  })

  it('recommends about half of the top set for the warm-up', () => {
    expect(warmUpWeight([40, 50, 40])).toBe(25)
    expect(warmUpWeight([45, 45, 45])).toBe(25)
    expect(warmUpWeight([null])).toBeNull()
  })

  it('marks the top-weight fields until raised or checked', () => {
    expect(increaseMarks([40, 50, 40], [40, 50, 40], [false, false, false])).toEqual([false, true, false])
    expect(increaseMarks([40, 60, 40], [40, 50, 40], [false, false, false])).toEqual([false, false, false])
    expect(increaseMarks([40, 50, 40], [40, 50, 40], [false, true, false])).toEqual([false, false, false])
    expect(increaseMarks([25, 25, 25], [25, 25, 25], [false, false, false])).toEqual([true, true, true])
  })
})
