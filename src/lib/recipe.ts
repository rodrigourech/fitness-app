// Recipes (decision Rodrigo 19 November 2026, spec «Feature Rezepte, Kochmodus und Kitchen», migration 0052).
// A recipe keeps its ingredients with the values for the whole recipe at its base portions. Amounts are only shown
// scaled (never stored scaled): grams and millilitres rounded to 5, pieces and servings to 0.5. Cooked portions are
// logged as entries on their days or put into the fridge, where they count only once eaten. Stock is taken once when
// cooking, for all portions, never again when a fridge portion is eaten.
import { db, type FoodCategory, type FoodEntryItem, type FridgeItem, type ProteinType, type Recipe, type RecipeCategory, type RecipeItem, type RecipeStep } from './db'
import { addDaysKey, localDay, mealPrepDrafts, saveFoodEntries, slotTime, type EntryDraft, type PortionSlot } from './food'
import { consumeItems } from './kitchen'
import { saveRows } from './sync'

export const RECIPE_CATEGORIES: RecipeCategory[] = ['meal', 'dessert', 'snack']
export const RECIPE_CATEGORY_LABEL: Record<RecipeCategory, string> = { meal: 'Meals', dessert: 'Desserts', snack: 'Snacks' }
export const PROTEIN_TYPES: ProteinType[] = ['beef', 'chicken', 'pork', 'fish', 'veggie', 'mixed']
export const PROTEIN_LABEL: Record<ProteinType, string> = { beef: 'Beef', chicken: 'Chicken', pork: 'Pork', fish: 'Fish', veggie: 'Veggie', mixed: 'Mixed' }
/** Dot colours of the protein types (spec section 3); mixed grey */
export const PROTEIN_COLOR: Record<ProteinType, string> = { beef: '#b4532a', chicken: '#d39a2a', pork: '#b5677a', fish: '#3a7ca5', veggie: '#5a8f4e', mixed: '#9ca3af' }

const r1 = (n: number) => Math.round(n * 10) / 10

/** kcal and protein per portion of a recipe. */
export function perPortion(recipe: Pick<Recipe, 'items' | 'portions'>): { kcal: number; protein: number } {
  const p = recipe.portions > 0 ? recipe.portions : 1
  return {
    kcal: Math.round(recipe.items.reduce((s, i) => s + i.kcal, 0) / p),
    protein: r1(recipe.items.reduce((s, i) => s + i.protein_g, 0) / p),
  }
}

/** Rounded amount: grams and millilitres to 5 (at least 1 for small amounts), pieces and servings to 0.5. */
export function roundAmount(qty: number, unit: RecipeItem['unit']): number {
  if (unit === 'g' || unit === 'ml') return qty < 10 ? Math.max(1, Math.round(qty)) : Math.round(qty / 5) * 5
  return Math.max(0.5, Math.round(qty * 2) / 2)
}

function fmt(n: number): string {
  return String(r1(n))
}

const UNIT_LABEL: Record<NonNullable<RecipeItem['unit']>, [string, string]> = { g: ['g', 'g'], ml: ['ml', 'ml'], piece: ['piece', 'pieces'], serving: ['serving', 'servings'] }

/** Display of an ingredient at a factor (chosen / base portions): weight at the far right, grey hint before it. */
export function itemAmount(item: RecipeItem, factor: number): { hint: string | null; amount: string | null } {
  if (item.to_taste || item.qty === null || item.unit === null) return { hint: null, amount: null }
  const qty = roundAmount(item.qty * factor, item.unit)
  const [one, many] = UNIT_LABEL[item.unit]
  const amount = `${fmt(qty)} ${qty === 1 ? one : many}`
  const hint = item.hint ? `${fmt(Math.round(item.hint.n * factor * 2) / 2 || 0.5)} ${item.hint.label}` : null
  return { hint, amount }
}

/** One line of the ingredient list as text: «3 Becher · 510 g», or «nach Geschmack». */
export function itemLine(item: RecipeItem, factor: number): string {
  const a = itemAmount(item, factor)
  if (!a.amount) return 'nach Geschmack'
  return a.hint ? `${a.hint} · ${a.amount}` : a.amount
}

export type StepPart = { text: string } | { amount: string }

/** Step text with the placeholders {item id} replaced by the scaled amounts (shown bold). */
export function stepParts(step: RecipeStep, items: RecipeItem[], factor: number): StepPart[] {
  const out: StepPart[] = []
  const re = /\{([a-z0-9]+)\}/gi
  let last = 0
  for (let m = re.exec(step.text); m; m = re.exec(step.text)) {
    if (m.index > last) out.push({ text: step.text.slice(last, m.index) })
    const item = items.find((i) => i.id === m![1])
    const a = item ? itemAmount(item, factor) : null
    if (a?.amount) out.push({ amount: a.amount })
    last = m.index + m[0].length
  }
  if (last < step.text.length) out.push({ text: step.text.slice(last) })
  // Two spaces where a placeholder without amount was removed
  return out.map((p) => ('text' in p ? { text: p.text.replace(/\s{2,}/g, ' ') } : p))
}

/** Items of the whole cooked amount (cooked portions), as stored in entries. */
export function cookedItems(recipe: Recipe, cooked: number): FoodEntryItem[] {
  const f = cooked / (recipe.portions > 0 ? recipe.portions : 1)
  return recipe.items
    .filter((i) => !i.to_taste || i.kcal > 0)
    .map((i) => ({
      name: i.name,
      food_item_id: i.food_item_id,
      amount: itemAmount(i, f).amount ?? '',
      kcal: Math.round(i.kcal * f),
      protein_g: r1(i.protein_g * f),
      source: i.source,
    }))
}

/** Values of the whole cooked amount. */
export function cookedTotals(recipe: Recipe, cooked: number): { kcal: number; protein: number } {
  const p = perPortion(recipe)
  return { kcal: p.kcal * cooked, protein: r1(p.protein * cooked) }
}

export type PlanSlot = PortionSlot | { day: string; category: 'fridge' }

export function isFridge(slot: PlanSlot): slot is { day: string; category: 'fridge' } {
  return slot.category === 'fridge'
}

/** Default plan (spec section 6): first portion now, further ones at lunch on the following days. */
export function defaultRecipePlan(today: string, category: FoodCategory, portions: number): PlanSlot[] {
  return Array.from({ length: portions }, (_, i) => (i === 0 ? { day: today, category } : { day: addDaysKey(today, i), category: 'lunch' as const }))
}

/** Day by which fridge portions should be eaten: cooked day plus keeps_days. */
export function eatBy(cookedDay: string, keepsDays: number): string {
  return addDaysKey(cookedDay, Math.max(1, keepsDays))
}

export type FreshState = 'ok' | 'today' | 'expired'

/** Fridge and stock dates: orange on the last day, red afterwards. */
export function freshState(eatByDay: string | null, today: string): FreshState {
  if (!eatByDay) return 'ok'
  return eatByDay < today ? 'expired' : eatByDay === today ? 'today' : 'ok'
}

export interface RecipeLog {
  drafts: EntryDraft[]
  fridge: Omit<FridgeItem, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'> | null
}

/** Entries for the planned portions and one fridge row for the others; values per portion of the cooked amount. */
export function planRecipe(recipe: Recipe, plan: PlanSlot[], now: Date): RecipeLog {
  const cooked = plan.length
  const items = cookedItems(recipe, cooked)
  const total = cookedTotals(recipe, cooked)
  const eat = plan.filter((s): s is PortionSlot => !isFridge(s))
  const fridgeCount = cooked - eat.length
  const detail = items.filter((i) => i.amount).slice(0, 4).map((i) => `${i.name.split(',')[0]} ${i.amount}`).join(' · ')
  // mealPrepDrafts divides the total by the plan length, so pass the share of the eaten portions
  const eatenShare = { kcal: Math.round((total.kcal * eat.length) / cooked), protein: r1((total.protein * eat.length) / cooked) }
  const drafts = eat.length ? mealPrepDrafts({ title: recipe.name, detail, items, ...eatenShare }, eat, now) : []
  if (cooked > 1) {
    drafts.forEach((d, i) => {
      d.detail = `Portion ${i + 1} of ${cooked} · ${detail}`
      d.portionsCooked = cooked
      d.portionsEaten = 1
    })
  }
  const per = { kcal: Math.round(total.kcal / cooked), protein: r1(total.protein / cooked) }
  const fridge = fridgeCount > 0
    ? { recipe_id: recipe.id, title: recipe.name, portions: fridgeCount, kcal: per.kcal, protein_g: per.protein,
        items: cookedItems(recipe, 1),
        cooked_at: now.toISOString(), eat_by: eatBy(localDay(now), recipe.keeps_days) }
    : null
  return { drafts, fridge }
}

/** Logs a cooked recipe: entries, fridge portions and the stock taken once for everything cooked. */
export async function logRecipe(userId: string, recipe: Recipe, plan: PlanSlot[], now = new Date()): Promise<{ entries: number; fridge: number }> {
  const { drafts, fridge } = planRecipe(recipe, plan, now)
  if (drafts.length) await saveFoodEntries(userId, drafts)
  if (fridge) {
    const ts = now.toISOString()
    await saveRows('fridge_item', [{ ...fridge, id: crypto.randomUUID(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null }])
  }
  await consumeItems(userId, cookedItems(recipe, plan.length), 'recipe', null, now)
  return { entries: drafts.length, fridge: fridge?.portions ?? 0 }
}

/** Eats one fridge portion: one entry, one portion less (the row is removed at 0). No stock is taken. */
export async function eatFromFridge(userId: string, item: FridgeItem, category: FoodCategory, eatenAt: string): Promise<void> {
  await saveFoodEntries(userId, [{ eatenAt, category, title: item.title, detail: 'From the fridge', items: item.items, kcal: item.kcal, protein: item.protein_g }])
  const left = Math.max(0, item.portions - 1)
  await saveRows('fridge_item', [{ ...item, portions: left, deleted_at: left === 0 ? new Date().toISOString() : null }])
}

export async function discardFridge(item: FridgeItem): Promise<void> {
  await saveRows('fridge_item', [{ ...item, deleted_at: new Date().toISOString() }])
}

/** Puts cooked portions straight into the fridge, without a plan (spec: «Put in fridge» from the detail). */
export async function putInFridge(userId: string, recipe: Recipe, portions: number, now = new Date()): Promise<void> {
  await logRecipe(userId, recipe, Array.from({ length: portions }, () => ({ day: localDay(now), category: 'fridge' as const })), now)
}

export function newRecipe(userId: string, category: RecipeCategory = 'meal'): Recipe {
  const ts = new Date().toISOString()
  return { id: crypto.randomUUID(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null, name: '', lang: 'de', category,
    protein_type: category === 'meal' ? 'mixed' : null, portions: 1, prep_min: null, meal_prep: false, keeps_days: 3, notes: null, items: [], steps: [] }
}

export async function saveRecipe(recipe: Recipe): Promise<void> {
  await saveRows('recipe', [{ ...recipe, name: recipe.name.trim(), protein_type: recipe.category === 'meal' ? recipe.protein_type ?? 'mixed' : null }])
}

/** Soft delete with undo (spec section 3); entries already logged stay as they are. */
export async function deleteRecipe(recipe: Recipe): Promise<() => Promise<void>> {
  await saveRows('recipe', [{ ...recipe, deleted_at: new Date().toISOString() }])
  return async () => {
    const current = await db.recipe.get(recipe.id)
    if (current) await saveRows('recipe', [{ ...current, deleted_at: null }])
  }
}

/** «Save as recipe» from a logged meal: its items become the ingredients (amounts parsed back where possible). */
export function recipeFromEntry(userId: string, entry: { title: string; items: FoodEntryItem[]; portions_cooked: number | null }): Recipe {
  const r = newRecipe(userId)
  r.name = entry.title
  r.portions = entry.portions_cooked && entry.portions_cooked > 1 ? entry.portions_cooked : 1
  r.meal_prep = r.portions > 1
  r.items = entry.items.map((i, n) => {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|ml|pieces?|Stück|servings?|Portion(?:en)?|×)?/i.exec(i.amount)
    const qty = m ? Number(m[1]!.replace(',', '.')) : null
    const u = (m?.[2] ?? '').toLowerCase()
    const unit: RecipeItem['unit'] = !m ? null : u === 'ml' ? 'ml' : u.startsWith('serving') || u.startsWith('portion') ? 'serving' : u === 'g' || u === '' ? 'g' : 'piece'
    return { id: `i${n + 1}`, name: i.name, food_item_id: i.food_item_id ?? null, qty, unit, hint: null, to_taste: false, kcal: i.kcal, protein_g: i.protein_g, source: i.source }
  })
  return r
}

/** Search and filter of the recipe list. */
export function filterRecipes(recipes: Recipe[], category: RecipeCategory, protein: ProteinType | 'all', query: string): Recipe[] {
  const q = query.trim().toLowerCase()
  return recipes
    .filter((r) => r.deleted_at === null && r.category === category)
    .filter((r) => category !== 'meal' || protein === 'all' || r.protein_type === protein)
    .filter((r) => !q || r.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Time of a planned slot (re-exported for the planning sheet). */
export { slotTime }
