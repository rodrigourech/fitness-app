import type { FoodEntry, FoodItem, Recipe } from './db'
import { logRecipe } from './recipe'
import { addDaysKey, amountText, categoryAt, localDay, mealPrepDrafts, saveFoodEntries, deleteFoodEntry, stapleValues } from './food'
import { consumeItems } from './kitchen'

// Search and favourites under the day in Food (decision Rodrigo 22 November 2026, variant B «Liste mit +»):
// favourites are the staples added most often in the last 60 days (automatic daily entries do not count), only from
// snack-like entries: breakfast, snack, dessert and drinks, not from lunch, dinner or cheat meals, so cooking
// ingredients like rice or chicken stay out (decision Rodrigo 23 November 2026);
// «+» adds one unit at once (100 g or 1 piece or serving) with undo, the name opens the amount sheet.

export const FAVOURITE_DAYS = 60
export const FAVOURITE_COUNT = 6
/** Categories whose entries count for the favourites (shakes, snacks, fruit, crispbread with cottage cheese) */
export const FAVOURITE_CATEGORIES: readonly FoodEntry['category'][] = ['breakfast', 'snack', 'dessert', 'drinks']

/** Default quantity for one tap: 100 g for products per 100 g, otherwise 1 piece or serving. */
export function oneUnit(item: Pick<FoodItem, 'basis'>): number {
  return item.basis === '100g' ? 100 : 1
}

/** The staples used most often in snack-like entries of the last days, most used first (ties by name). */
export function favourites(entries: FoodEntry[], items: FoodItem[], today: string, n = FAVOURITE_COUNT, days = FAVOURITE_DAYS): FoodItem[] {
  const from = addDaysKey(today, -days)
  const live = new Map(items.filter((i) => i.deleted_at === null).map((i) => [i.id, i]))
  const count = new Map<string, number>()
  for (const e of entries) {
    if (e.deleted_at !== null || e.source === 'auto' || !FAVOURITE_CATEGORIES.includes(e.category)) continue
    const day = localDay(e.eaten_at)
    if (day < from || day > today) continue
    for (const id of new Set(e.items.map((i) => i.food_item_id).filter((id): id is string => !!id && live.has(id)))) {
      count.set(id, (count.get(id) ?? 0) + 1)
    }
  }
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || live.get(a[0])!.name.localeCompare(live.get(b[0])!.name))
    .slice(0, n)
    .map(([id]) => live.get(id)!)
}

function matches(name: string, query: string): boolean {
  const n = name.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => n.includes(w))
}

/** Staples and recipes whose name contains every word of the query. */
export function searchFood(query: string, items: FoodItem[], recipes: Recipe[]): { items: FoodItem[]; recipes: Recipe[] } {
  if (!query.trim()) return { items: [], recipes: [] }
  return {
    items: items.filter((i) => i.deleted_at === null && matches(`${i.name} ${i.store ?? ''}`, query)).sort((a, b) => a.name.localeCompare(b.name)),
    recipes: recipes.filter((r) => r.deleted_at === null && matches(r.name, query)).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Logs one unit of a staple on the shown day as the current meal; returns the undo. */
export async function quickAdd(userId: string, item: FoodItem, day: string, now = new Date()): Promise<() => Promise<void>> {
  const q = oneUnit(item)
  const v = stapleValues(item, q)
  const category = day === localDay(now) ? categoryAt(now) : 'snack'
  const [row] = await saveFoodEntries(userId, mealPrepDrafts({
    title: item.name.split(',')[0]!,
    detail: `${item.name.split(',')[0]} ${amountText(item, q)}`,
    items: [{ name: item.name, food_item_id: item.id, amount: amountText(item, q), kcal: v.kcal, protein_g: v.protein, source: 'staple' }],
    kcal: v.kcal,
    protein: v.protein,
  }, [{ day, category }], now))
  await consumeItems(userId, row!.items, 'meal', row!.id, now)
  return () => deleteFoodEntry(row!)
}

/** Logs one portion of a recipe on the shown day as the current meal (search hit). */
export async function quickAddRecipe(userId: string, recipe: Recipe, day: string, now = new Date()): Promise<void> {
  await logRecipe(userId, recipe, [{ day, category: day === localDay(now) ? categoryAt(now) : 'snack' }], now)
}
