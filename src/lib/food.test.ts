import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db, type FoodEntry } from './db'
import { addDaysKey, amountText, categoryAt, kcalTarget, mondayOf, portionOf, saveFoodEntry, stapleValues, START_TARGET_KCAL, totalsOf, weekRows } from './food'

const base = { user_id: 'u', created_at: '', updated_at: '', deleted_at: null }
function entry(day: string, kcal: number, protein = 30, category: FoodEntry['category'] = 'lunch'): FoodEntry {
  return { ...base, id: crypto.randomUUID(), eaten_at: new Date(`${day}T12:00:00`).toISOString(), category, title: 'x', detail: null, items: [], kcal, protein_g: protein,
    portions_cooked: null, portions_eaten: null, source: 'app' }
}

describe('food', () => {
  it('staple values and portions', () => {
    expect(stapleValues({ basis: '100g', kcal: 170, protein_g: 20 }, 250)).toEqual({ kcal: 425, protein: 50 })
    expect(stapleValues({ basis: 'piece', kcal: 84, protein_g: 7.5 }, 2)).toEqual({ kcal: 168, protein: 15 })
    expect(portionOf({ kcal: 1035, protein: 62 }, 2, 1)).toEqual({ kcal: 518, protein: 31 })
    expect(amountText({ basis: 'piece' }, 1)).toBe('1 piece')
    expect(amountText({ basis: '100g' }, 150)).toBe('150 g')
  })

  it('category by time and week from Monday', () => {
    expect(categoryAt(new Date(2026, 10, 1, 8))).toBe('breakfast')
    expect(categoryAt(new Date(2026, 10, 1, 19))).toBe('dinner')
    expect(mondayOf('2026-11-01')).toBe('2026-10-26')
    const rows = weekRows([entry('2026-10-26', 500), entry('2026-10-26', 700, 40, 'cheat'), entry('2026-11-01', 300)], '2026-11-01')
    expect(rows).toHaveLength(7)
    expect(rows[0]).toMatchObject({ day: '2026-10-26', kcal: 1200, protein: 70, cheat: 1 })
    expect(totalsOf([])).toEqual({ kcal: 0, protein: 0, count: 0 })
  })

  it('target: start value until 14 days are logged, then maintenance from intake and weight trend minus 400', () => {
    const today = '2026-11-20'
    const weights = Array.from({ length: 10 }, (_, i) => ({ date: addDaysKey(today, -27 + i * 3), kg: 86 - i * 0.15 }))
    const few = Array.from({ length: 10 }, (_, i) => entry(addDaysKey(today, -1 - i), 2300))
    expect(kcalTarget(few, weights, today)).toMatchObject({ kind: 'start', kcal: START_TARGET_KCAL, daysLogged: 10 })
    const many = Array.from({ length: 20 }, (_, i) => entry(addDaysKey(today, -1 - i), 2300))
    const t = kcalTarget(many, weights, today)
    // 0.05 kg per day lost → 385 kcal per day on top of 2 300
    expect(t.kind).toBe('measured')
    expect(t.maintenance).toBeGreaterThanOrEqual(2680)
    expect(t.maintenance).toBeLessThanOrEqual(2690)
    expect(t.kcal).toBe(t.maintenance! - 400)
  })

  it('saves an entry for sync', async () => {
    await saveFoodEntry('u1', { eatenAt: '2026-11-01T11:30:00Z', category: 'lunch', title: ' ', kcal: 571.4, protein: 63.26 })
    const [row] = await db.food_entry.toArray()
    expect(row).toMatchObject({ title: 'Lunch', kcal: 571, protein_g: 63.3, source: 'app' })
    expect(await db.outbox.where('table').equals('food_entry').count()).toBe(1)
  })
})
