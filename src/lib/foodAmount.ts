// Quantities of food entries (decision 19 November 2026): «What» names the food, the quantity stays a separate value
// that can always be changed. kcal and protein follow the quantity in proportion to the stored values of each item.
// No schema change: the quantity is read from the item's amount text («250 g», «2 ×», «1 serving», «1 tsp»).

import type { FoodEntry, FoodEntryItem } from './db'

export interface Amount {
  quantity: number
  unit: string
}

/** Quantity and unit of an amount text, null if it does not start with a number. */
export function parseAmount(amount: string): Amount | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(.*?)\s*$/.exec(amount)
  if (!m) return null
  const quantity = Number(m[1]!.replace(',', '.'))
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return { quantity, unit: singular(m[2] ?? '') }
}

const PLURAL: Record<string, string> = { piece: 'pieces', serving: 'servings', portion: 'portions', slice: 'slices', scoop: 'scoops' }
const SINGULAR = Object.fromEntries(Object.entries(PLURAL).map(([one, many]) => [many, one]))

function singular(unit: string): string {
  return SINGULAR[unit] ?? unit
}

export function formatQuantity(quantity: number): string {
  return String(Math.round(quantity * 100) / 100)
}

/** Amount text in the stored form: «2 ×», «250 g», «1 serving», «2 servings». */
export function formatAmount(quantity: number, unit: string): string {
  const u = quantity === 1 ? unit : (PLURAL[unit] ?? unit)
  return u ? `${formatQuantity(quantity)} ${u}` : formatQuantity(quantity)
}

/** Unit shown next to a quantity field. */
export function unitLabel(unit: string, quantity: number): string {
  return quantity === 1 ? unit : (PLURAL[unit] ?? unit)
}

/** Step of the − and + buttons: 10 for grams and millilitres, otherwise 1. */
export function stepOf(unit: string): number {
  return unit === 'g' || unit === 'ml' ? 10 : 1
}

/** Item at a new quantity; kcal and protein in proportion to the item as stored. */
export function scaleItem(item: FoodEntryItem, quantity: number): FoodEntryItem {
  const a = parseAmount(item.amount)
  if (!a) return item
  const f = Math.max(0, quantity) / a.quantity
  return {
    ...item,
    amount: formatAmount(Math.max(0, quantity), a.unit),
    kcal: Math.round(item.kcal * f * 10) / 10,
    protein_g: Math.round(item.protein_g * f * 10) / 10,
  }
}

export function itemsTotal(items: FoodEntryItem[]): { kcal: number; protein: number } {
  return {
    kcal: Math.round(items.reduce((s, i) => s + i.kcal, 0)),
    protein: Math.round(items.reduce((s, i) => s + i.protein_g, 0) * 10) / 10,
  }
}

/** Eaten values of an entry: items total, divided by the cooked portions and times the eaten ones. */
export function entryTotal(items: FoodEntryItem[], cooked: number | null, eaten: number | null): { kcal: number; protein: number } {
  const t = itemsTotal(items)
  const f = cooked && cooked > 1 ? (eaten ?? 1) / cooked : 1
  return { kcal: Math.round(t.kcal * f), protein: Math.round(t.protein * f * 10) / 10 }
}

/** True if the stored values of the entry equal what its items give (then the sheet calculates automatically). */
export function matchesItems(entry: Pick<FoodEntry, 'items' | 'kcal' | 'protein_g' | 'portions_cooked' | 'portions_eaten'>): boolean {
  if (entry.items.length === 0 || entry.items.some((i) => parseAmount(i.amount) === null)) return false
  const t = entryTotal(entry.items, entry.portions_cooked, entry.portions_eaten)
  return Math.abs(t.kcal - entry.kcal) <= 1 && Math.abs(t.protein - entry.protein_g) <= 0.6
}

/** Quantity mark next to the name in the list: the amount of a single item, else the portions. */
export function quantityTag(entry: Pick<FoodEntry, 'items' | 'portions_cooked' | 'portions_eaten'>): string | null {
  if (entry.portions_cooked && entry.portions_cooked > 1) return `${entry.portions_eaten ?? 1} of ${entry.portions_cooked} portions`
  if (entry.items.length === 1) {
    const a = parseAmount(entry.items[0]!.amount)
    return a ? formatAmount(a.quantity, a.unit) : entry.items[0]!.amount || null
  }
  return entry.items.length > 1 ? '1 portion' : null
}

/** Values per unit of an item: «18.5 kcal · 1 g each» or «58 kcal · 8 g per 100 g». */
export function perUnitText(item: FoodEntryItem): string | null {
  const a = parseAmount(item.amount)
  if (!a) return null
  const base = a.unit === 'g' || a.unit === 'ml' ? 100 : 1
  const kcal = Math.round((item.kcal / a.quantity) * base * 10) / 10
  const protein = Math.round((item.protein_g / a.quantity) * base * 10) / 10
  return base === 100 ? `${kcal} kcal · ${protein} g per 100 ${a.unit}` : `${kcal} kcal · ${protein} g each`
}

/** Short ingredient line «Chicken breast 200 g · Rice 90 g» for the detail of an entry. */
export function itemsLine(items: FoodEntryItem[]): string {
  return items.map((i) => `${i.name.split(',')[0]} ${i.amount}`.trim()).join(' · ')
}
