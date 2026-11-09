// Nutrition (decisions 1 November 2026): only kcal and protein. Entries come from the app (staples or manual) or from
// the Food connector (Claude). Nutrition is kept separate from everything else: the daily kcal target is set by hand
// (settings.ts) and the weight forecast uses body weight only, so gaps in logging change nothing outside this tab.
// Meal prep: every cooked portion becomes its own entry on the day it is eaten.
import { db, type FoodCategory, type FoodEntry, type FoodEntryItem, type FoodItem } from './db'
import { getNutrition, type NutritionTargets } from './settings'
import { saveRows } from './sync'

export const PROTEIN_TARGET_G = 140
const DAY = 86_400_000

export const CATEGORY_LABEL: Record<FoodCategory, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  cheat: 'Cheat meal',
  dessert: 'Dessert',
  drinks: 'Drinks',
}

export const CATEGORIES: FoodCategory[] = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drinks', 'cheat']

/** Usual time of a category, used when a portion is planned for another day. */
export const CATEGORY_TIME: Record<FoodCategory, string> = {
  breakfast: '08:00',
  lunch: '12:30',
  snack: '16:00',
  dinner: '19:00',
  dessert: '20:30',
  drinks: '21:00',
  cheat: '19:00',
}

/** Local day YYYY-MM-DD of a timestamp. */
export function localDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function addDaysKey(day: string, n: number): string {
  return localDay(new Date(Date.parse(`${day}T12:00:00`) + n * DAY))
}

/** Category by the time of day (default for a new entry). */
export function categoryAt(d: Date): FoodCategory {
  const h = d.getHours()
  return h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 18 ? 'snack' : 'dinner'
}

export interface Totals {
  kcal: number
  protein: number
  count: number
}

export function totalsOf(entries: Pick<FoodEntry, 'kcal' | 'protein_g'>[]): Totals {
  return {
    kcal: Math.round(entries.reduce((s, e) => s + e.kcal, 0)),
    protein: Math.round(entries.reduce((s, e) => s + e.protein_g, 0)),
    count: entries.length,
  }
}

export function active(entries: FoodEntry[]): FoodEntry[] {
  return entries.filter((e) => e.deleted_at === null).sort((a, b) => a.eaten_at.localeCompare(b.eaten_at))
}

export function byDay(entries: FoodEntry[]): Map<string, FoodEntry[]> {
  const out = new Map<string, FoodEntry[]>()
  for (const e of active(entries)) {
    const k = localDay(e.eaten_at)
    out.set(k, [...(out.get(k) ?? []), e])
  }
  return out
}

/** Monday of the week of a local day. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return addDaysKey(day, -((d.getDay() + 6) % 7))
}

export interface DayRow extends Totals {
  day: string
  cheat: number
  drinks: number
  /** At least one entry that is not an automatic daily entry (decision 2 November 2026) */
  filled: boolean
}

/** A day counts only with at least one entry besides the automatic daily ones (shake, espressos). */
export function isFilled(list: Pick<FoodEntry, 'source'>[]): boolean {
  return list.some((e) => e.source !== 'auto')
}

/** Monday to Sunday of the week containing the day. */
export function weekRows(entries: FoodEntry[], day: string): DayRow[] {
  const days = byDay(entries)
  const monday = mondayOf(day)
  return Array.from({ length: 7 }, (_, i) => {
    const k = addDaysKey(monday, i)
    const list = days.get(k) ?? []
    return { day: k, ...totalsOf(list), cheat: list.filter((e) => e.category === 'cheat').length, drinks: list.filter((e) => e.category === 'drinks').length, filled: isFilled(list) }
  })
}

/** Values of an amount of a staple: grams for per-100-g items, count for pieces and servings. */
export function stapleValues(item: Pick<FoodItem, 'basis' | 'kcal' | 'protein_g'>, quantity: number): { kcal: number; protein: number } {
  const f = item.basis === '100g' ? quantity / 100 : quantity
  return { kcal: Math.round(item.kcal * f), protein: Math.round(item.protein_g * f * 10) / 10 }
}

export function amountText(item: Pick<FoodItem, 'basis'>, quantity: number): string {
  return item.basis === '100g' ? `${quantity} g` : `${quantity} ${item.basis === 'piece' ? (quantity === 1 ? 'piece' : 'pieces') : quantity === 1 ? 'serving' : 'servings'}`
}

/** Eaten portion of a cooked total. */
export function portionOf(total: { kcal: number; protein: number }, cooked: number, eaten: number): { kcal: number; protein: number } {
  const f = cooked > 0 ? eaten / cooked : 1
  return { kcal: Math.round(total.kcal * f), protein: Math.round(total.protein * f * 10) / 10 }
}

export interface EntryDraft {
  eatenAt: string
  category: FoodCategory
  title: string
  detail?: string | null
  items?: FoodEntryItem[]
  kcal: number
  protein: number
  portionsCooked?: number | null
  portionsEaten?: number | null
}

export interface PortionSlot {
  day: string
  category: FoodCategory
}

/** Default plan for meal prep: the first portion as chosen, every further one on the following day at lunch. */
export function defaultPlan(day: string, category: FoodCategory, cooked: number): PortionSlot[] {
  return Array.from({ length: cooked }, (_, i) => (i === 0 ? { day, category } : { day: addDaysKey(day, i), category: 'lunch' as const }))
}

/** Timestamp of a planned portion: now for the current meal, otherwise the usual time of the category on that day. */
export function slotTime(slot: PortionSlot, now: Date): string {
  if (slot.day === localDay(now) && slot.category === categoryAt(now)) return now.toISOString()
  return new Date(`${slot.day}T${CATEGORY_TIME[slot.category]}:00`).toISOString()
}

/** One entry per cooked portion; values are the total divided by the portions (decision 1 November 2026). */
export function mealPrepDrafts(meal: { title: string; detail: string; items: FoodEntryItem[]; kcal: number; protein: number }, plan: PortionSlot[], now: Date): EntryDraft[] {
  const n = plan.length
  const share = portionOf({ kcal: meal.kcal, protein: meal.protein }, n, 1)
  return plan.map((slot, i) => ({
    eatenAt: slotTime(slot, now),
    category: slot.category,
    title: meal.title,
    detail: n > 1 ? `Portion ${i + 1} of ${n} · ${meal.detail}` : meal.detail,
    items: meal.items,
    kcal: share.kcal,
    protein: share.protein,
    portionsCooked: n > 1 ? n : null,
    portionsEaten: n > 1 ? 1 : null,
  }))
}

export async function saveFoodEntries(userId: string, drafts: EntryDraft[]): Promise<void> {
  await saveRows('food_entry', drafts.map((d) => entryRow(userId, d)))
}

export async function saveFoodEntry(userId: string, draft: EntryDraft, existing?: FoodEntry): Promise<void> {
  await saveRows('food_entry', [entryRow(userId, draft, existing)])
}

function entryRow(userId: string, draft: EntryDraft, existing?: FoodEntry): FoodEntry {
  const ts = new Date().toISOString()
  return {
    ...(existing ?? { id: crypto.randomUUID(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null, source: 'app' as const }),
    eaten_at: draft.eatenAt,
    category: draft.category,
    title: draft.title.trim() || CATEGORY_LABEL[draft.category],
    detail: draft.detail?.trim() || null,
    items: draft.items ?? existing?.items ?? [],
    kcal: Math.max(0, Math.round(draft.kcal)),
    protein_g: Math.max(0, Math.round(draft.protein * 10) / 10),
    portions_cooked: draft.portionsCooked ?? null,
    portions_eaten: draft.portionsEaten ?? null,
  }
}

// --- automatic daily entries (decision 2 November 2026) -----------------------------------------
// The ESN shake (every day, 08:00) and 2 espressos with milk (Monday to Friday, 09:30; 3 until 9 November 2026) are entered automatically for the
// current day once a sync has run, so both devices know the server state first. The id is derived from user, day and
// kind, so two devices create the same row and a deleted row is never created again.

export const SHAKE_STAPLE_ID = 'c5a0f6d1-0001-4f00-8000-00000000000a'
const ESPRESSO = { kcal: 37, protein: 2 } // 2 × (espresso 2 kcal + 2 tbsp milk 2.5 % about 16 kcal, 1 g protein)

/** Name-based UUID (version 5 layout) from SHA-1. */
export async function stableUuid(name: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`fitness-app/${name}`))).slice(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Drafts of the automatic entries for a day according to the settings. */
export function dailyDrafts(day: string, targets: Pick<NutritionTargets, 'shake' | 'espresso'>, shake?: Pick<FoodItem, 'name' | 'kcal' | 'protein_g'>): (EntryDraft & { kind: 'shake' | 'espresso' })[] {
  const weekday = new Date(`${day}T12:00:00`).getDay()
  const out: (EntryDraft & { kind: 'shake' | 'espresso' })[] = []
  if (targets.shake) {
    const kcal = shake?.kcal ?? 167
    const protein = shake?.protein_g ?? 34.5
    out.push({ kind: 'shake', eatenAt: new Date(`${day}T08:00:00`).toISOString(), category: 'breakfast', title: shake?.name ?? 'ESN shake, water',
      items: [{ name: shake?.name ?? 'ESN shake, water', food_item_id: SHAKE_STAPLE_ID, amount: '1 serving', kcal, protein_g: protein, source: 'staple' }], kcal, protein })
  }
  if (targets.espresso && weekday >= 1 && weekday <= 5) {
    out.push({ kind: 'espresso', eatenAt: new Date(`${day}T09:30:00`).toISOString(), category: 'snack', title: '2 espressos with milk', detail: '2 tbsp milk each',
      items: [{ name: 'Espresso with milk', food_item_id: null, amount: '2 ×', kcal: ESPRESSO.kcal, protein_g: ESPRESSO.protein, source: 'staple' }], kcal: ESPRESSO.kcal, protein: ESPRESSO.protein })
  }
  return out
}

/** Creates the automatic entries of a day that do not exist yet (deleted ones stay deleted). Returns the number created. */
export async function ensureDailyEntries(userId: string, day: string, targets: Pick<NutritionTargets, 'shake' | 'espresso'>): Promise<number> {
  const shake = await db.food_item.get(SHAKE_STAPLE_ID)
  const rows: FoodEntry[] = []
  for (const d of dailyDrafts(day, targets, shake && shake.deleted_at === null ? shake : undefined)) {
    const id = await stableUuid(`${userId}/${day}/${d.kind}`)
    if (await db.food_entry.get(id)) continue
    const row = entryRow(userId, d)
    rows.push({ ...row, id, source: 'auto' })
  }
  if (rows.length) await saveRows('food_entry', rows)
  return rows.length
}

let dailyRunning = false
/** Adds today's automatic entries according to the settings (called after each successful sync). */
export async function addDailyEntries(userId: string, now = new Date()): Promise<void> {
  if (dailyRunning) return
  dailyRunning = true
  try {
    await ensureDailyEntries(userId, localDay(now), await getNutrition())
  } catch (err) {
    console.error('Daily food entries failed', err)
  } finally {
    dailyRunning = false
  }
}

export async function deleteFoodEntry(entry: FoodEntry): Promise<void> {
  await saveRows('food_entry', [{ ...entry, deleted_at: new Date().toISOString() }])
}

export async function saveFoodItem(userId: string, item: Pick<FoodItem, 'name' | 'store' | 'basis' | 'kcal' | 'protein_g' | 'piece_g' | 'package_g'>, existing?: FoodItem): Promise<void> {
  const ts = new Date().toISOString()
  const row: FoodItem = {
    ...(existing ?? { id: crypto.randomUUID(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null, note: null }),
    ...item,
    name: item.name.trim(),
  }
  await saveRows('food_item', [row])
}

export async function deleteFoodItem(item: FoodItem): Promise<void> {
  await saveRows('food_item', [{ ...item, deleted_at: new Date().toISOString() }])
}

export async function loadFood(): Promise<{ entries: FoodEntry[]; items: FoodItem[] }> {
  const [entries, items] = await Promise.all([db.food_entry.toArray(), db.food_item.toArray()])
  return { entries, items: items.filter((i) => i.deleted_at === null).sort((a, b) => a.name.localeCompare(b.name)) }
}
