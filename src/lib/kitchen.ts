// Kitchen stock (decision Rodrigo 19 November 2026, spec section 7, migration 0052).
// Bought food is booked in (by chat from a receipt or photo, or by hand) and taken off automatically when an entry with
// a staple is saved, oldest stock first (FIFO), and once for all portions when a recipe is cooked. Stock never goes
// below zero; without a matching item nothing happens and nothing is reported. Items that are only present yes/no
// (oil, spices, sauces) are never counted down. An item at zero disappears after the end of that day.
import { db, type FoodEntryItem, type InventoryItem, type InventoryMove, type StockLocation, type StockReason } from './db'
import { localDay, addDaysKey } from './food'
import { saveRows } from './sync'

export const LOCATIONS: StockLocation[] = ['fridge', 'freezer', 'shelf']
export const LOCATION_LABEL: Record<StockLocation, string> = { fridge: 'Fridge', freezer: 'Freezer', shelf: 'Shelf' }
const DAY = 86_400_000
/** Review when an item was not moved for this many days (spec: 7 days without movement) */
export const REVIEW_AFTER_DAYS = 7

export interface Need {
  food_item_id: string
  qty: number
  unit: 'g' | 'ml' | 'piece'
}

/** Amount of an entry item in stock units: «250 g», «2 pieces», «2 ×», «1.5 Stück». Servings are not stock units. */
export function needOf(item: Pick<FoodEntryItem, 'food_item_id' | 'amount'>): Need | null {
  if (!item.food_item_id) return null
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|ml|pieces?|Stück|×|x)?(?=\s|$)/i.exec(item.amount ?? '')
  if (!m) return null
  const qty = Number(m[1]!.replace(',', '.'))
  if (!(qty > 0)) return null
  const u = (m[2] ?? '').toLowerCase()
  const unit = u === 'g' ? 'g' : u === 'ml' ? 'ml' : u ? 'piece' : null
  return unit ? { food_item_id: item.food_item_id, qty, unit } : null
}

export interface Deduction {
  items: InventoryItem[]
  moves: Omit<InventoryMove, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'>[]
}

/** Oldest stock first: best-before date, then booking time. */
function fifo(a: InventoryItem, b: InventoryItem): number {
  const da = a.best_before ?? '9999-12-31'
  const dbb = b.best_before ?? '9999-12-31'
  return da !== dbb ? da.localeCompare(dbb) : a.created_at.localeCompare(b.created_at)
}

/** Takes the needs off the stock (pure): FIFO, never below zero, untracked items untouched, missing items skipped. */
export function deduct(stock: InventoryItem[], needs: Need[], reason: StockReason, entryId: string | null, now: Date): Deduction {
  const changed = new Map<string, InventoryItem>()
  const moves: Deduction['moves'] = []
  const ts = now.toISOString()
  for (const need of needs) {
    let rest = need.qty
    const candidates = stock
      .map((s) => changed.get(s.id) ?? s)
      .filter((s) => s.deleted_at === null && s.tracked && s.food_item_id === need.food_item_id && s.unit === need.unit && (s.qty_left ?? 0) > 0)
      .sort(fifo)
    for (const s of candidates) {
      if (rest <= 0) break
      const take = Math.min(rest, s.qty_left ?? 0)
      const next = { ...s, qty_left: Math.round(((s.qty_left ?? 0) - take) * 10) / 10, last_used_at: ts }
      changed.set(s.id, next)
      moves.push({ item_id: s.id, delta: -take, reason, food_entry_id: entryId })
      rest -= take
    }
    // Presence-only items are marked as used, not counted
    for (const s of stock.filter((x) => x.deleted_at === null && !x.tracked && x.food_item_id === need.food_item_id)) {
      changed.set(s.id, { ...(changed.get(s.id) ?? s), last_used_at: ts })
    }
  }
  return { items: [...changed.values()], moves }
}

async function apply(userId: string, d: Deduction, now: Date): Promise<void> {
  if (d.items.length) await saveRows('inventory_item', d.items)
  if (d.moves.length) {
    const ts = now.toISOString()
    await saveRows('inventory_move', d.moves.map((m) => ({ ...m, id: crypto.randomUUID(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null })))
  }
}

/** Takes the staples of entry items off the stock. Returns the changed items (for a «… left» note). */
export async function consumeItems(userId: string, items: Pick<FoodEntryItem, 'food_item_id' | 'amount'>[], reason: StockReason, entryId: string | null, now = new Date()): Promise<InventoryItem[]> {
  const needs = items.map(needOf).filter((n): n is Need => n !== null)
  if (needs.length === 0) return []
  const stock = await db.inventory_item.toArray()
  const d = deduct(stock, needs, reason, entryId, now)
  await apply(userId, d, now)
  return d.items
}

/** Usual shelf life in days when no date is known (spec section 7); null for dry goods without a limit. */
export function defaultShelfDays(name: string): number | null {
  const n = name.toLowerCase()
  if (/hack|mince|fisch|fish|lachs|salmon|thun/.test(n)) return 2
  if (/poulet|chicken|huhn|schwein|pork|geschnetzel|speck|bacon|rind|beef|steak/.test(n)) return 4
  if (/skyr|quark|joghurt|yogurt|milch|milk|rahm|cream|crème|käse|cheese/.test(n)) return 3
  if (/gemüse|broccoli|brokkoli|tomate|tomato|zwiebel|onion|paprika|salat|bohnen|beans|zucchini|karotte|spinat|kartoffel|potato|avocado/.test(n)) return 5
  return null
}

export type StockState = 'ok' | 'today' | 'expired'

export function stockState(item: Pick<InventoryItem, 'best_before'>, today: string): StockState {
  if (!item.best_before) return 'ok'
  return item.best_before < today ? 'expired' : item.best_before === today ? 'today' : 'ok'
}

/** «Items to check»: expired, or not moved for seven days (spec section 7). */
export function needsReview(item: InventoryItem, now: Date): boolean {
  if (item.deleted_at !== null) return false
  if (stockState(item, localDay(now)) === 'expired') return true
  const last = Date.parse(item.last_used_at ?? item.created_at)
  return now.getTime() - last >= REVIEW_AFTER_DAYS * DAY
}

/** Items shown: not deleted, and items at zero only until the end of the day they ran out. */
export function visibleStock(items: InventoryItem[], today: string): InventoryItem[] {
  return items.filter((i) => i.deleted_at === null && !(i.tracked && (i.qty_left ?? 0) <= 0 && localDay(i.last_used_at ?? i.updated_at) < today))
}

/** Removes items that ran out before today (spec: «bei 0 nach Tagesende entfernen»). */
export async function cleanUpStock(now = new Date()): Promise<number> {
  const today = localDay(now)
  const gone = (await db.inventory_item.toArray()).filter((i) => i.deleted_at === null && i.tracked && (i.qty_left ?? 0) <= 0 && localDay(i.last_used_at ?? i.updated_at) < today)
  if (gone.length) await saveRows('inventory_item', gone.map((i) => ({ ...i, deleted_at: now.toISOString() })))
  return gone.length
}

export interface StockDraft {
  name: string
  food_item_id: string | null
  location: StockLocation
  unit: InventoryItem['unit']
  qty: number | null
  tracked: boolean
  best_before: string | null
}

/** Books an item in (purchase); without a date the usual shelf life applies for fresh food. */
export async function addStock(userId: string, d: StockDraft, now = new Date()): Promise<InventoryItem> {
  const ts = now.toISOString()
  const shelf = d.best_before ? null : defaultShelfDays(d.name)
  const item: InventoryItem = {
    id: crypto.randomUUID(), user_id: userId, created_at: ts, updated_at: ts, deleted_at: null,
    food_item_id: d.food_item_id, name: d.name.trim(), location: d.location,
    unit: d.tracked ? d.unit : null, qty_initial: d.tracked ? d.qty : null, qty_left: d.tracked ? d.qty : null, tracked: d.tracked,
    best_before: d.best_before ?? (shelf !== null && d.location !== 'freezer' ? addDaysKey(localDay(now), shelf) : null),
    opened_at: null, last_used_at: ts, note: null,
  }
  await saveRows('inventory_item', [item])
  if (d.tracked && d.qty) await apply(userId, { items: [], moves: [{ item_id: item.id, delta: d.qty, reason: 'purchase', food_entry_id: null }] }, now)
  return item
}

/** Correction of the amount left (never below zero). */
export async function setStockLeft(userId: string, item: InventoryItem, left: number, now = new Date()): Promise<void> {
  const value = Math.max(0, Math.round(left * 10) / 10)
  const delta = value - (item.qty_left ?? 0)
  await saveRows('inventory_item', [{ ...item, qty_left: value, last_used_at: now.toISOString() }])
  if (delta !== 0) await apply(userId, { items: [], moves: [{ item_id: item.id, delta, reason: 'correction', food_entry_id: null }] }, now)
}

/** «Used up» or «Discard»: the item leaves the stock with a move for the rest. */
export async function closeStock(userId: string, item: InventoryItem, reason: 'used_up' | 'discard', now = new Date()): Promise<void> {
  await saveRows('inventory_item', [{ ...item, qty_left: item.tracked ? 0 : null, deleted_at: now.toISOString(), last_used_at: now.toISOString() }])
  const rest = item.qty_left ?? 0
  if (item.tracked && rest > 0) await apply(userId, { items: [], moves: [{ item_id: item.id, delta: -rest, reason, food_entry_id: null }] }, now)
}

/** «Keep» in the review: counts as checked today. */
export async function keepStock(item: InventoryItem, now = new Date()): Promise<void> {
  await saveRows('inventory_item', [{ ...item, last_used_at: now.toISOString() }])
}

/** Amount text of a stock item: «250 g», «3 pieces»; presence-only items «in stock». */
export function stockAmount(qty: number | null, unit: InventoryItem['unit']): string {
  if (qty === null || unit === null) return 'in stock'
  const v = Math.round(qty * 10) / 10
  return unit === 'piece' ? `${v} ${v === 1 ? 'piece' : 'pieces'}` : `${v} ${unit}`
}
