import { describe, expect, it } from 'vitest'
import { adjacentSwaps, dropIndex, gapOf, moveById, moveItem, placeholderTop, shiftFor, type Slot } from './reorder'

// Three cards of 80 px with a gap of 12 px, and one taller card
const slots: Slot[] = [
  { top: 0, height: 80 },
  { top: 92, height: 80 },
  { top: 184, height: 80 },
  { top: 276, height: 140 },
]

describe('moveItem', () => {
  it('moves down and up', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('keeps the list for the same index and clamps the target', () => {
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 9)).toEqual(['b', 'c', 'a'])
  })
  it('does not mutate the input', () => {
    const list = ['a', 'b']
    moveItem(list, 0, 1)
    expect(list).toEqual(['a', 'b'])
  })
})

describe('moveById', () => {
  it('moves one place and refuses moves past the ends', () => {
    expect(moveById(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveById(['a', 'b', 'c'], 'a', -1)).toBeNull()
    expect(moveById(['a', 'b', 'c'], 'c', 1)).toBeNull()
  })
})

describe('dropIndex', () => {
  it('stays in place for small offsets', () => {
    expect(dropIndex(slots, 1, 0)).toBe(1)
    expect(dropIndex(slots, 1, 40)).toBe(1)
    expect(dropIndex(slots, 1, -40)).toBe(1)
  })
  it('passes a neighbour once the centre crosses its centre', () => {
    // centre of item 1 is 132, centre of item 2 is 224
    expect(dropIndex(slots, 1, 93)).toBe(2)
    expect(dropIndex(slots, 1, -93)).toBe(0)
  })
  it('respects different heights and clamps at the ends', () => {
    // centre of the tall item 3 is 346
    expect(dropIndex(slots, 0, 300)).toBe(2)
    expect(dropIndex(slots, 0, 320)).toBe(3)
    expect(dropIndex(slots, 0, 5000)).toBe(3)
    expect(dropIndex(slots, 3, -5000)).toBe(0)
  })
})

describe('shiftFor and placeholderTop', () => {
  const distance = slots[0]!.height + gapOf(slots)
  it('measures the gap', () => {
    expect(gapOf(slots)).toBe(12)
    expect(gapOf([{ top: 0, height: 10 }])).toBe(0)
  })
  it('moves the items between source and target aside', () => {
    // item 0 dragged to slot 2: items 1 and 2 move up
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, distance))).toEqual([0, -92, -92, 0])
    // item 3 dragged to slot 1: items 1 and 2 move down
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 152))).toEqual([0, 152, 152, 0])
  })
  it('places the drop slot where the dragged item will land', () => {
    expect(placeholderTop(slots, 1, 1)).toBe(92)
    expect(placeholderTop(slots, 0, 2)).toBe(184)
    expect(placeholderTop(slots, 0, 3)).toBe(336)
    expect(placeholderTop(slots, 3, 0)).toBe(0)
  })
})

describe('adjacentSwaps', () => {
  it('turns one order into another with neighbour swaps', () => {
    const from = ['a', 'b', 'c', 'd']
    const to = ['c', 'a', 'd', 'b']
    let list = [...from]
    for (const s of adjacentSwaps(from, to)) list = moveById(list, s.id, s.direction)!
    expect(list).toEqual(to)
    expect(adjacentSwaps(from, from)).toEqual([])
    expect(adjacentSwaps(['a', 'b', 'c'], ['c', 'a', 'b'])).toHaveLength(2)
  })
})
