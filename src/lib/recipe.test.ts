import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type InventoryItem, type Recipe } from './db'
import { addStock } from './kitchen'
import { deleteRecipe, eatFromFridge, filterRecipes, freshState, itemLine, logRecipe, perPortion, planRecipe, recipeFromEntry, roundAmount, stepParts } from './recipe'
import seed from './recipe.seed.test.json'

const base = { user_id: 'u', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', deleted_at: null, lang: 'de', keeps_days: 3 }
const recipes = (seed as Omit<Recipe, keyof typeof base>[]).map((r) => ({ ...base, ...r }) as Recipe)
const pasta = recipes[0]!
const chicken = recipes[1]!

beforeEach(async () => {
  await Promise.all([db.food_entry.clear(), db.fridge_item.clear(), db.inventory_item.clear(), db.inventory_move.clear(), db.recipe.clear(), db.outbox.clear()])
})

describe('recipes (decision 19 November 2026)', () => {
  it('values per portion match the seed of the Food chat', () => {
    expect(perPortion(pasta)).toEqual({ kcal: 943, protein: 80.7 })
    expect(perPortion(chicken)).toEqual({ kcal: 688, protein: 57.7 })
  })

  it('scales amounts with rounding: grams to 5, pieces to 0.5; hints scale too', () => {
    expect(roundAmount(83.3, 'g')).toBe(85)
    expect(roundAmount(8, 'g')).toBe(8)
    expect(roundAmount(1.3, 'piece')).toBe(1.5)
    const skyr = pasta.items.find((i) => i.id === 'i3')!
    expect(itemLine(skyr, 1)).toBe('1 Becher · 170 g')
    expect(itemLine(skyr, 3)).toBe('3 Becher · 510 g')
    expect(itemLine(pasta.items.find((i) => i.id === 'i8')!, 3)).toBe('nach Geschmack')
    expect(itemLine(pasta.items.find((i) => i.id === 'i6')!, 1)).toBe('1.5 Zehen · 8 g')
  })

  it('step text shows the scaled amounts', () => {
    expect(stepParts(pasta.steps[0]!, pasta.items, 2)).toEqual([{ text: 'Pasta ' }, { amount: '140 g' }, { text: ' in gesalzenem Wasser kochen, etwas Pastawasser beiseitestellen.' }])
  })

  it('filters by category, protein type and name', () => {
    expect(filterRecipes(recipes, 'meal', 'beef', '').map((r) => r.name)).toEqual(['Beef Tacos', 'Rindshack mit Reis und Bohnen', 'Rindshack mit Tomaten, Reis und Quark', 'Türkische Pasta mit Skyr'])
    expect(filterRecipes(recipes, 'snack', 'all', 'toast')).toHaveLength(1)
  })

  it('plans portions on days and in the fridge; fridge portions do not count yet', () => {
    const now = new Date('2026-11-20T12:00:00')
    const plan = planRecipe(chicken, [{ day: '2026-11-20', category: 'lunch' }, { day: '2026-11-21', category: 'lunch' }, { day: '2026-11-20', category: 'fridge' }], now)
    expect(plan.drafts).toHaveLength(2)
    expect(plan.drafts[0]).toMatchObject({ kcal: 688, portionsCooked: 3, portionsEaten: 1 })
    expect(plan.fridge).toMatchObject({ portions: 1, kcal: 688, protein_g: 57.7, eat_by: '2026-11-23' })
  })

  it('cooking takes stock once; eating from the fridge logs an entry and takes nothing', async () => {
    const now = new Date('2026-11-20T12:00:00')
    await addStock('u', { name: 'Rindshack (Denner)', food_item_id: '6dd50bc6-0741-43f3-8a4e-85518128a28c', location: 'fridge', unit: 'g', qty: 500, tracked: true, best_before: '2026-11-22' }, now)
    await logRecipe('u', pasta, [{ day: '2026-11-20', category: 'lunch' }, { day: '2026-11-20', category: 'fridge' }], now)
    const stock = (await db.inventory_item.toArray()) as InventoryItem[]
    expect(stock[0]!.qty_left).toBe(0)
    const fridge = (await db.fridge_item.toArray())[0]!
    expect(fridge.portions).toBe(1)
    await eatFromFridge('u', fridge, 'dinner', '2026-11-21T19:00:00.000Z')
    expect((await db.fridge_item.get(fridge.id))!.deleted_at).not.toBeNull()
    expect(await db.food_entry.count()).toBe(2)
    expect((await db.inventory_item.toArray())[0]!.qty_left).toBe(0)
  })

  it('delete with undo; fresh states', async () => {
    await db.recipe.put(pasta)
    const undo = await deleteRecipe(pasta)
    expect((await db.recipe.get(pasta.id))!.deleted_at).not.toBeNull()
    await undo()
    expect((await db.recipe.get(pasta.id))!.deleted_at).toBeNull()
    expect(freshState('2026-11-22', '2026-11-21')).toBe('ok')
    expect(freshState('2026-11-21', '2026-11-21')).toBe('today')
    expect(freshState('2026-11-20', '2026-11-21')).toBe('expired')
  })

  it('save as recipe from a logged meal', () => {
    const r = recipeFromEntry('u', { title: 'Bowl', portions_cooked: null, items: [{ name: 'Skyr', food_item_id: 'x', amount: '200 g', kcal: 116, protein_g: 22, source: 'staple' }, { name: 'Egg', food_item_id: 'e', amount: '2 pieces', kcal: 168, protein_g: 15, source: 'staple' }] })
    expect(r.items.map((i) => [i.qty, i.unit])).toEqual([[200, 'g'], [2, 'piece']])
    expect(perPortion(r)).toEqual({ kcal: 284, protein: 37 })
  })
})
