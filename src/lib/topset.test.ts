import { describe, expect, it } from 'vitest'
import { increaseMarks, recommendations, roundWeight, topIndex, warmUpWeight } from './topset'

describe('top set', () => {
  it('finds the first heaviest weight', () => {
    expect(topIndex([40, 50, 40])).toBe(1)
    expect(topIndex([20, 20, 15])).toBe(0)
    expect(topIndex([null, null])).toBe(-1)
  })

  it('rounds to 5 kg from 20 kg and to 0.5 kg below', () => {
    expect(roundWeight(34)).toBe(35)
    expect(roundWeight(42.5)).toBe(40)
    expect(roundWeight(17)).toBe(17)
    expect(roundWeight(3.8)).toBe(4)
  })

  it('recommends back-off sets at 80 % of today\'s top set', () => {
    expect(recommendations([40, 32, 32], true)).toEqual([
      { kind: 'top' }, { kind: 'weight', kg: 30, percent: 75 }, { kind: 'weight', kg: 30, percent: 75 }])
    expect(recommendations([32, 50, 32], true)[0]).toEqual({ kind: 'weight', kg: 40, percent: 80 })
    expect(recommendations([20, 20, 15], true)[2]).toEqual({ kind: 'weight', kg: 16, percent: 80 })
    expect(recommendations([null, null], true)).toEqual([null, null])
  })

  it('gives no recommendations without the top set setting', () => {
    expect(recommendations([5.5, 4.5, 4.5], false)).toEqual([null, null, null])
  })

  it('recommends about half of the top set for the warm-up', () => {
    expect(warmUpWeight([40, 50, 40])).toBe(25)
    expect(warmUpWeight([45, 45, 45])).toBe(20)
    expect(warmUpWeight([null])).toBeNull()
  })

  it('marks the top-weight fields with the setting on, every field without it', () => {
    const open = [false, false, false]
    expect(increaseMarks([36, 32, 32], [36, 32, 32], open, true)).toEqual([true, false, false])
    expect(increaseMarks([40, 32, 32], [36, 32, 32], open, true)).toEqual([false, false, false])
    expect(increaseMarks([36, 32, 32], [36, 32, 32], [true, false, false], true)).toEqual([false, false, false])
    expect(increaseMarks([45, 45, 45], [45, 45, 45], open, true)).toEqual([true, true, true])
    expect(increaseMarks([5.5, 4.5, 4.5], [4.5, 4.5, 4.5], open, false)).toEqual([false, true, true])
  })
})
