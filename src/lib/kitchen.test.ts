import { describe, expect, it } from 'vitest'
import type { InventoryItem } from './db'
import { deduct, defaultShelfDays, needOf, needsReview, stockAmount, visibleStock } from './kitchen'

const now = new Date('2026-11-20T12:00:00')
function item(id: string, qty: number | null, best: string | null, extra: Partial<InventoryItem> = {}): InventoryItem {
  return { id, user_id: 'u', created_at: '2026-11-15T10:00:00Z', updated_at: '2026-11-15T10:00:00Z', deleted_at: null, food_item_id: 'mince', name: 'Hack', location: 'fridge',
    unit: 'g', qty_initial: qty, qty_left: qty, tracked: true, best_before: best, opened_at: null, last_used_at: '2026-11-19T10:00:00Z', note: null, ...extra }
}

describe('kitchen stock (decision 19 November 2026)', () => {
  it('reads stock units from entry amounts', () => {
    expect(needOf({ food_item_id: 'a', amount: '250 g' })).toEqual({ food_item_id: 'a', qty: 250, unit: 'g' })
    expect(needOf({ food_item_id: 'a', amount: '2 pieces' })).toEqual({ food_item_id: 'a', qty: 2, unit: 'piece' })
    expect(needOf({ food_item_id: 'a', amount: '2 ×' })).toEqual({ food_item_id: 'a', qty: 2, unit: 'piece' })
    expect(needOf({ food_item_id: 'a', amount: '1 serving' })).toBeNull()
    expect(needOf({ food_item_id: null, amount: '250 g' })).toBeNull()
  })

  it('takes the oldest stock first and never goes below zero', () => {
    const stock = [item('new', 500, '2026-11-25'), item('old', 200, '2026-11-21')]
    const d = deduct(stock, [{ food_item_id: 'mince', qty: 250, unit: 'g' }], 'meal', 'e1', now)
    expect(d.items.map((i) => [i.id, i.qty_left])).toEqual([['old', 0], ['new', 450]])
    expect(d.moves.map((m) => m.delta)).toEqual([-200, -50])
    const all = deduct(stock, [{ food_item_id: 'mince', qty: 900, unit: 'g' }], 'meal', null, now)
    expect(all.items.every((i) => i.qty_left === 0)).toBe(true)
  })

  it('skips missing items and other units; presence-only items are only marked as used', () => {
    expect(deduct([item('a', 500, null)], [{ food_item_id: 'other', qty: 100, unit: 'g' }], 'meal', null, now).items).toEqual([])
    expect(deduct([item('a', 500, null)], [{ food_item_id: 'mince', qty: 1, unit: 'piece' }], 'meal', null, now).items).toEqual([])
    const oil = item('oil', null, null, { tracked: false, unit: null, food_item_id: 'oil' })
    const d = deduct([oil], [{ food_item_id: 'oil', qty: 2, unit: 'piece' }], 'meal', null, now)
    expect(d.moves).toEqual([])
    expect(d.items[0]!.last_used_at).toBe(now.toISOString())
  })

  it('review: expired or seven days without movement; empty items vanish after the day', () => {
    expect(needsReview(item('a', 100, '2026-11-19'), now)).toBe(true)
    expect(needsReview(item('a', 100, null, { last_used_at: '2026-11-12T10:00:00Z' }), now)).toBe(true)
    expect(needsReview(item('a', 100, null), now)).toBe(false)
    const empty = item('e', 0, null, { last_used_at: '2026-11-19T10:00:00Z' })
    const emptyToday = item('t', 0, null, { last_used_at: '2026-11-20T09:00:00' })
    expect(visibleStock([empty, emptyToday], '2026-11-20').map((i) => i.id)).toEqual(['t'])
  })

  it('usual shelf life and amount text', () => {
    expect(defaultShelfDays('Rindshackfleisch')).toBe(2)
    expect(defaultShelfDays('Pouletoberschenkel')).toBe(4)
    expect(defaultShelfDays('Skyr Nature')).toBe(3)
    expect(defaultShelfDays('Reis')).toBeNull()
    expect(stockAmount(250, 'g')).toBe('250 g')
    expect(stockAmount(null, null)).toBe('in stock')
  })
})
