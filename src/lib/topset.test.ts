import { describe, expect, it } from 'vitest'
import { displayWeight, estimateWeight, increaseMarks, nextWeight, poundStep, recommendations, shareOf, topIndex, warmUpWeight } from './topset'

describe('top set', () => {
  it('finds the first heaviest weight', () => {
    expect(topIndex([40, 50, 40])).toBe(1)
    expect(topIndex([20, 20, 15])).toBe(0)
    expect(topIndex([null, null])).toBe(-1)
  })

  it('shows whole kg from 10 kg like the labels of a stack', () => {
    expect(displayWeight(31.5)).toBe(32)
    expect(displayWeight(40.5)).toBe(41)
    expect(displayWeight(4.5)).toBe(4.5)
  })

  it('estimates without a step: 5 kg from 20 kg, 1 kg below, halves down', () => {
    expect(estimateWeight(30.6)).toBe(30)
    expect(estimateWeight(42.5)).toBe(40)
    expect(estimateWeight(11.9)).toBe(12)
  })

  it('walks down from the top set in whole steps, the lighter one on a tie', () => {
    expect(shareOf(40, 0.85, 10)).toEqual({ kg: 30, estimate: false })
    expect(shareOf(36, 0.85, 4.5)).toEqual({ kg: 32, estimate: false })
    expect(shareOf(45, 0.85, 4.5)).toEqual({ kg: 36, estimate: false })
    expect(shareOf(39, 0.85, 7)).toEqual({ kg: 32, estimate: false })
    expect(shareOf(10, 0.5, 10)).toEqual({ kg: 10, estimate: false })
    expect(shareOf(36, 0.85, null)).toEqual({ kg: 30, estimate: true })
  })

  it('computes pound stacks on the 5 lb grid so every value matches a kg label', () => {
    expect(poundStep(4.5)).toBe(10)
    expect(poundStep(6.8)).toBe(15)
    expect(poundStep(5)).toBeNull()
    expect(poundStep(2)).toBeNull()
    expect(poundStep(null)).toBeNull()
    expect(shareOf(45, 0.85, 6.8)).toEqual({ kg: 39, estimate: false })
    expect(shareOf(52, 0.85, 6.8)).toEqual({ kg: 45, estimate: false })
    expect(shareOf(36, 0.85, 4.5)).toEqual({ kg: 32, estimate: false })
    expect(shareOf(9, 0.5, 4.5)).toEqual({ kg: 4.5, estimate: false })
    expect(nextWeight(39, 6.8)).toBe(45)
    expect(nextWeight(45, 6.8)).toBe(52)
    expect(nextWeight(36, 4.5)).toBe(41)
    expect(nextWeight(40, 10)).toBe(50)
  })

  it('recommends back-off sets and the next top-set weight with a step', () => {
    expect(recommendations([36, 32, 32], true, 0.85, 4.5, true)).toEqual([
      { kind: 'top', next: 41 }, { kind: 'weight', kg: 32, estimate: false }, { kind: 'weight', kg: 32, estimate: false }])
    expect(recommendations([36, 32], true, 0.85, null, true)).toEqual([
      { kind: 'top', next: null }, { kind: 'weight', kg: 30, estimate: true }])
    expect(recommendations([5.5, 4.5, 4.5], false, 0.85, 4.5)).toEqual([null, null, null])
    expect(recommendations([null, null], true, 0.85, 5)).toEqual([null, null])
  })

  it('recommends the warm-up at its share', () => {
    expect(warmUpWeight([40, 50, 40], 0.5, 10)).toEqual({ kg: 20, estimate: false })
    expect(warmUpWeight([40, 40], 0.5, null)).toEqual({ kg: 20, estimate: true })
    expect(warmUpWeight([null], 0.5, 5)).toBeNull()
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
