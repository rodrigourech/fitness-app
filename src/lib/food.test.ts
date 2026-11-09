import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db, type FoodEntry } from './db'
import { amountText, categoryAt, dailyDrafts, defaultPlan, ensureDailyEntries, isFilled, localDay, mealPrepDrafts, mondayOf, portionOf, saveFoodEntries, saveFoodEntry, slotTime, stableUuid, stapleValues, totalsOf, weekRows } from './food'
import { DEFAULT_NUTRITION, getNutrition, parseNutrition } from './settings'

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
    const rows = weekRows([entry('2026-10-26', 500), entry('2026-10-26', 700, 40, 'cheat'), entry('2026-11-01', 300), entry('2026-11-01', 630, 8, 'drinks'), entry('2026-11-01', 210, 2, 'drinks')], '2026-11-01')
    expect(rows).toHaveLength(7)
    expect(rows[0]).toMatchObject({ day: '2026-10-26', kcal: 1200, protein: 70, cheat: 1, drinks: 0 })
    expect(rows[6]).toMatchObject({ kcal: 1140, cheat: 0, drinks: 2 })
    expect(totalsOf([])).toEqual({ kcal: 0, protein: 0, count: 0 })
  })

  it('meal prep: one entry per portion on its own day', () => {
    const now = new Date(2026, 10, 1, 19, 5)
    const plan = defaultPlan('2026-11-01', 'dinner', 3)
    expect(plan).toEqual([{ day: '2026-11-01', category: 'dinner' }, { day: '2026-11-02', category: 'lunch' }, { day: '2026-11-03', category: 'lunch' }])
    const drafts = mealPrepDrafts({ title: 'Beef mince, rice', detail: 'Beef mince 500 g · Rice 225 g', items: [], kcal: 1743, protein: 117.6 }, plan, now)
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toMatchObject({ eatenAt: now.toISOString(), category: 'dinner', kcal: 581, protein: 39.2, portionsCooked: 3, portionsEaten: 1, detail: 'Portion 1 of 3 · Beef mince 500 g · Rice 225 g' })
    expect(localDay(drafts[1]!.eatenAt)).toBe('2026-11-02')
    expect(new Date(drafts[1]!.eatenAt).getHours()).toBe(12)
    expect(drafts[2]!.detail).toMatch(/^Portion 3 of 3/)
    // a single portion stays a normal entry
    expect(mealPrepDrafts({ title: 'x', detail: 'd', items: [], kcal: 500, protein: 30 }, [{ day: '2026-11-01', category: 'snack' }], now)[0]).toMatchObject({ portionsCooked: null, detail: 'd', kcal: 500 })
    expect(new Date(slotTime({ day: '2026-11-01', category: 'drinks' }, now)).getHours()).toBe(21)
  })

  it('nutrition targets are set by hand, invalid values fall back', async () => {
    expect(parseNutrition({ needKcal: 2500.4, deficitKcal: 400, proteinG: 150, shake: false })).toEqual({ needKcal: 2500, deficitKcal: 400, proteinG: 150, shake: false, espresso: true })
    expect(parseNutrition({ needKcal: 800, deficitKcal: -5 })).toMatchObject({ needKcal: 2400, deficitKcal: 400 })
    expect(parseNutrition({ kcal: 2000 })).toEqual(DEFAULT_NUTRITION)
    expect(await getNutrition()).toEqual(DEFAULT_NUTRITION)
  })

  it('daily entries: shake every day, espressos Monday to Friday, created once, deleted stays deleted', async () => {
    expect(dailyDrafts('2026-11-02', { shake: true, espresso: true }).map((d) => d.kind)).toEqual(['shake', 'espresso'])
    expect(dailyDrafts('2026-11-01', { shake: true, espresso: true }).map((d) => d.kind)).toEqual(['shake'])
    expect(dailyDrafts('2026-11-09', { shake: false, espresso: true })[0]).toMatchObject({ title: '2 espressos with milk', kcal: 37, protein: 2 })
    expect(dailyDrafts('2026-11-02', { shake: false, espresso: false })).toEqual([])
    expect(await stableUuid('a')).toBe(await stableUuid('a'))
    expect(await stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await db.food_entry.clear()
    expect(await ensureDailyEntries('u9', '2026-11-03', { shake: true, espresso: true })).toBe(2)
    expect(await ensureDailyEntries('u9', '2026-11-03', { shake: true, espresso: true })).toBe(0)
    const rows = await db.food_entry.toArray()
    expect(rows.every((r) => r.source === 'auto')).toBe(true)
    expect(rows.map((r) => r.kcal).sort()).toEqual([167, 37].sort())
    await db.food_entry.update(rows[0]!.id, { deleted_at: '2026-11-03T10:00:00Z' })
    expect(await ensureDailyEntries('u9', '2026-11-03', { shake: true, espresso: true })).toBe(0)
    expect(isFilled(rows)).toBe(false)
    expect(isFilled([...rows, { source: 'app' }])).toBe(true)
    const week = weekRows([...rows.map((r) => ({ ...r, deleted_at: null })), entry('2026-11-04', 1800)], '2026-11-03')
    expect(week.find((r) => r.day === '2026-11-03')).toMatchObject({ filled: false, kcal: 204 })
    expect(week.find((r) => r.day === '2026-11-04')).toMatchObject({ filled: true })
    await db.food_entry.clear()
    await db.outbox.clear()
  })

  it('saves an entry for sync', async () => {
    await saveFoodEntry('u1', { eatenAt: '2026-11-01T11:30:00Z', category: 'lunch', title: ' ', kcal: 571.4, protein: 63.26 })
    const [row] = await db.food_entry.toArray()
    expect(row).toMatchObject({ title: 'Lunch', kcal: 571, protein_g: 63.3, source: 'app' })
    expect(await db.outbox.where('table').equals('food_entry').count()).toBe(1)
    await saveFoodEntries('u1', [{ eatenAt: '2026-11-02T11:30:00Z', category: 'lunch', title: 'a', kcal: 1, protein: 1 }, { eatenAt: '2026-11-03T11:30:00Z', category: 'lunch', title: 'a', kcal: 1, protein: 1 }])
    expect(await db.food_entry.count()).toBe(3)
  })
})
