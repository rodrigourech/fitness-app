import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import Sheet from '../../components/Sheet'
import { useSwipeX } from '../../hooks/useSwipeX'
import { db, type FoodCategory, type FoodItem, type FridgeItem, type InventoryItem, type StockLocation } from '../../lib/db'
import { CATEGORIES, CATEGORY_LABEL, categoryAt, localDay } from '../../lib/food'
import { LOCATIONS, LOCATION_LABEL, addStock, closeStock, keepStock, needsReview, setStockLeft, stockAmount, stockState, visibleStock } from '../../lib/kitchen'
import { discardFridge, eatFromFridge, freshState } from '../../lib/recipe'

// Kitchen (spec section 7) and the fridge section in the Day view (section 6). Stock is grouped by Fridge, Freezer and
// Shelf; cooked portions sit on top of the fridge as «Cooked». Each row: name, at the right the starting amount in grey
// and what is left in bold, a bar for the share left, below the date and the last use. Orange on the last day, red
// afterwards. Items expired or not moved for seven days are offered for review (Keep, Used up, Discard).

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function weekday(day: string): string {
  return WEEKDAY[new Date(`${day}T12:00:00`).getDay()]!
}

function shortDate(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return `${d.getDate()} ${MONTH[d.getMonth()]}`
}

const STATE_TEXT = { ok: 'text-zinc-500 dark:text-zinc-400', today: 'font-semibold text-orange-600 dark:text-orange-400', expired: 'font-semibold text-red-600 dark:text-red-400' }

function SwipeRow({ children, left, onLeft, right, onRight }: { children: React.ReactNode; left?: string; onLeft?: () => void; right?: string; onRight?: () => void }) {
  const swipe = useSwipeX((dir) => (dir === 'left' ? onLeft?.() : onRight?.()), { left: !!onLeft, right: !!onRight })
  return (
    <li className="relative touch-pan-y" {...swipe.handlers}>
      {swipe.dx !== 0 && (
        <div aria-hidden="true" className={`absolute inset-0 flex items-center rounded-2xl px-5 text-sm font-semibold text-white ${swipe.dx < 0 ? 'justify-end bg-red-600' : 'justify-start bg-emerald-600'}`}>
          {swipe.dx < 0 ? left : right}
        </div>
      )}
      <div className="relative" style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : { transition: 'transform 150ms ease-out' }}>{children}</div>
    </li>
  )
}

function Confirm({ title, text, action, danger = true, onCancel, onConfirm }: { title: string; text: string; action: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">{text}</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">Cancel</button>
        <button onClick={onConfirm} className={`rounded-xl py-3 text-sm font-semibold text-white ${danger ? 'bg-red-600' : 'bg-emerald-600'}`}>{action}</button>
      </div>
    </Sheet>
  )
}

// --- fridge portions (Day view and Kitchen) --------------------------------------------------------------

export function FridgeSection({ userId, today, compact = false }: { userId: string; today: string; compact?: boolean }) {
  const items = useLiveQuery(() => db.fridge_item.toArray(), [])
  const [eat, setEat] = useState<FridgeItem | null>(null)
  const [discard, setDiscard] = useState<FridgeItem | null>(null)
  const live = (items ?? []).filter((f) => f.deleted_at === null && f.portions > 0).sort((a, b) => a.eat_by.localeCompare(b.eat_by))
  if (live.length === 0) return null
  return (
    <section aria-label="In the fridge" className="flex flex-col gap-2">
      <h3 className="text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{compact ? 'Cooked' : 'In the fridge'}</h3>
      <ul className="flex flex-col gap-2">
        {live.map((f) => {
          const state = freshState(f.eat_by, today)
          return (
            <SwipeRow key={f.id} left="Discard" onLeft={() => setDiscard(f)}>
              <div className="card flex items-center gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{f.title}</span>
                  <span className={`block text-sm ${STATE_TEXT[state]}`}>
                    {f.portions} {f.portions === 1 ? 'portion' : 'portions'} · {state === 'today' ? 'eat today' : state === 'expired' ? 'expired' : `cooked ${weekday(localDay(f.cooked_at))} · eat by ${weekday(f.eat_by)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-sm text-zinc-500 tabular-nums dark:text-zinc-400">{Math.round(f.kcal)} kcal<br />{Math.round(f.protein_g)} g</span>
                <button onClick={() => setEat(f)} className="shrink-0 rounded-xl bg-zinc-900 px-3 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">Eat</button>
              </div>
            </SwipeRow>
          )
        })}
      </ul>
      {eat && <EatSheet userId={userId} item={eat} onClose={() => setEat(null)} />}
      {discard && (
        <Confirm title="Discard portions?" text={`${discard.portions} ${discard.portions === 1 ? 'portion' : 'portions'} of «${discard.title}» leave the fridge without an entry.`} action="Discard"
          onCancel={() => setDiscard(null)} onConfirm={() => { void discardFridge(discard); setDiscard(null) }} />
      )}
    </section>
  )
}

function EatSheet({ userId, item, onClose }: { userId: string; item: FridgeItem; onClose: () => void }) {
  const [now] = useState(() => new Date())
  const [category, setCategory] = useState<FoodCategory>(categoryAt(now))
  const [timeText, setTimeText] = useState(() => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
  const save = async () => {
    const [h, m] = timeText.split(':').map(Number)
    const at = new Date(now)
    at.setHours(h ?? now.getHours(), m ?? now.getMinutes(), 0, 0)
    await eatFromFridge(userId, item, category, at.toISOString())
    onClose()
  }
  return (
    <Sheet title={`Eat ${item.title}`} onClose={onClose}>
      <p className="-mt-1 text-sm text-zinc-500 dark:text-zinc-400">1 portion · {Math.round(item.kcal)} kcal · {Math.round(item.protein_g)} g protein. Stock was taken when cooking.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {CATEGORIES.filter((c) => c !== 'drinks').map((c) => (
          <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${category === c ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-center justify-between text-sm font-semibold">
        Time
        <input type="time" value={timeText} onChange={(e) => setTimeText(e.target.value)} className="h-10 w-32 rounded-lg border border-zinc-200 bg-white px-2 text-base dark:border-zinc-700 dark:bg-zinc-900" />
      </label>
      <button onClick={() => void save()} className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">Log as {CATEGORY_LABEL[category].toLowerCase()}</button>
    </Sheet>
  )
}

// --- kitchen stock ------------------------------------------------------------------------------------------

export default function KitchenView({ userId, today, onStaples }: { userId: string; today: string; onStaples: () => void }) {
  const stock = useLiveQuery(() => db.inventory_item.toArray(), [])
  const staples = useLiveQuery(() => db.food_item.toArray(), [])
  const [adding, setAdding] = useState(false)
  const [review, setReview] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [confirm, setConfirm] = useState<{ item: InventoryItem; action: 'used_up' | 'discard' } | null>(null)
  const [now] = useState(() => new Date())
  if (stock === undefined || staples === undefined) return null
  const items = visibleStock(stock, today)
  const toCheck = items.filter((i) => needsReview(i, now))

  return (
    <div className="flex flex-col gap-3">
      {toCheck.length > 0 && (
        <button onClick={() => setReview(true)} className="flex items-center justify-between rounded-xl bg-orange-50 px-3 py-2.5 text-left text-sm text-orange-800 dark:bg-orange-950/50 dark:text-orange-300">
          <span><b>{toCheck.length} {toCheck.length === 1 ? 'item' : 'items'} to check</b></span>
          <span className="font-semibold">Review ›</span>
        </button>
      )}
      {LOCATIONS.map((loc) => {
        const list = items.filter((i) => i.location === loc).sort((a, b) => (a.best_before ?? '9999').localeCompare(b.best_before ?? '9999') || a.name.localeCompare(b.name))
        return (
          <section key={loc} aria-label={LOCATION_LABEL[loc]} className="flex flex-col gap-2">
            <h3 className="flex items-baseline gap-2 text-sm font-bold">{LOCATION_LABEL[loc]} <span className="text-xs font-normal text-zinc-400">{list.length}</span></h3>
            {loc === 'fridge' && <FridgeSection userId={userId} today={today} compact />}
            {list.length === 0 ? (
              loc !== 'fridge' && <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing here.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {list.map((i) => (
                  <SwipeRow key={i.id} left="Delete" onLeft={() => setConfirm({ item: i, action: 'discard' })} right="Used up" onRight={() => setConfirm({ item: i, action: 'used_up' })}>
                    <StockRow item={i} today={today} onOpen={() => setEditing(i)} />
                  </SwipeRow>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setAdding(true)} className="rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">+ Add</button>
        <button onClick={onStaples} className="rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900">Staples ›</button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Tip: send Claude a receipt or a photo of what you bought, it books it in after you confirm.</p>

      {adding && <AddStockSheet userId={userId} staples={staples.filter((s) => s.deleted_at === null)} onClose={() => setAdding(false)} />}
      {editing && <EditStockSheet userId={userId} item={editing} onClose={() => setEditing(null)} />}
      {review && <ReviewSheet userId={userId} items={toCheck} today={today} onClose={() => setReview(false)} />}
      {confirm && (
        <Confirm title={confirm.action === 'used_up' ? 'Used up?' : 'Delete item?'} danger={confirm.action !== 'used_up'}
          text={`«${confirm.item.name}» leaves the stock.`} action={confirm.action === 'used_up' ? 'Used up' : 'Delete'}
          onCancel={() => setConfirm(null)} onConfirm={() => { void closeStock(userId, confirm.item, confirm.action); setConfirm(null) }} />
      )}
    </div>
  )
}

function StockRow({ item: i, today, onOpen }: { item: InventoryItem; today: string; onOpen: () => void }) {
  const state = stockState(i, today)
  const share = i.tracked && i.qty_initial ? Math.max(0, Math.min(1, (i.qty_left ?? 0) / i.qty_initial)) : 1
  const bar = state === 'expired' ? 'bg-red-500' : state === 'today' ? 'bg-orange-500' : 'bg-emerald-500'
  // Booking sets last_used_at too; only a later use counts as «used»
  const last = i.last_used_at && i.last_used_at !== i.created_at ? localDay(i.last_used_at) : null
  const added = localDay(i.created_at)
  return (
    <button onClick={onOpen} className="card flex w-full flex-col gap-1.5 p-3 text-left">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-semibold">{i.name}</span>
        <span className="shrink-0 tabular-nums">
          {i.tracked ? <><span className="text-sm text-zinc-500 dark:text-zinc-400">{stockAmount(i.qty_initial, i.unit)} · </span><b>{stockAmount(i.qty_left, i.unit)}</b></> : <span className="text-sm text-zinc-500 dark:text-zinc-400">in stock</span>}
        </span>
      </span>
      {i.tracked && (
        <span className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
          <span className={`block h-full rounded-full ${bar}`} style={{ width: `${share * 100}%` }} />
        </span>
      )}
      <span className={`text-xs ${STATE_TEXT[state]}`}>
        {i.best_before ? (state === 'today' ? 'use by today' : state === 'expired' ? `expired ${shortDate(i.best_before)}` : `use by ${shortDate(i.best_before)}`) : 'no date'}
        <span className="text-zinc-500 dark:text-zinc-400"> · {last ? `used ${last === today ? 'today' : shortDate(last)}` : `added ${added === today ? 'today' : shortDate(added)}`}</span>
      </span>
    </button>
  )
}

function AddStockSheet({ userId, staples, onClose }: { userId: string; staples: FoodItem[]; onClose: () => void }) {
  const [stapleId, setStapleId] = useState('')
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<'g' | 'ml' | 'piece'>('g')
  const [tracked, setTracked] = useState(true)
  const [location, setLocation] = useState<StockLocation>('fridge')
  const [best, setBest] = useState('')
  const field = 'h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base dark:border-zinc-700 dark:bg-zinc-900'
  const staple = staples.find((s) => s.id === stapleId)
  const label = staple?.name ?? name
  const q = Number(qty.replace(',', '.'))
  const valid = label.trim() && (!tracked || q > 0)
  const save = async () => {
    await addStock(userId, { name: label, food_item_id: staple?.id ?? null, location, unit: tracked ? unit : null, qty: tracked ? q : null, tracked, best_before: best || null })
    onClose()
  }
  return (
    <Sheet title="Add to kitchen" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <select aria-label="Staple" value={stapleId} onChange={(e) => { setStapleId(e.target.value); const s = staples.find((x) => x.id === e.target.value); if (s) setUnit(s.basis === '100g' ? 'g' : 'piece') }} className={field}>
          <option value="">Other product</option>
          {staples.map((s) => <option key={s.id} value={s.id}>{s.name}{s.store ? ` (${s.store})` : ''}</option>)}
        </select>
        {!staple && <input aria-label="Name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className={field} />}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!tracked} onChange={(e) => setTracked(!e.target.checked)} /> Only in stock yes or no (oil, spices, sauces)</label>
        {tracked && (
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <input aria-label="Amount" inputMode="decimal" placeholder={staple?.package_g ? `Pack ${staple.package_g}` : 'Amount'} value={qty} onChange={(e) => setQty(e.target.value)} className={field} />
            <select aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as 'g' | 'ml' | 'piece')} className={field}>
              <option value="g">g</option><option value="ml">ml</option><option value="piece">pieces</option>
            </select>
          </div>
        )}
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900" role="group" aria-label="Place">
          {LOCATIONS.map((l) => (
            <button key={l} aria-pressed={location === l} onClick={() => setLocation(l)}
              className={`rounded-md py-1.5 text-sm font-semibold ${location === l ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>{LOCATION_LABEL[l]}</button>
          ))}
        </div>
        <label className="flex items-center justify-between text-sm font-semibold">Use by <input type="date" value={best} onChange={(e) => setBest(e.target.value)} className="h-10 rounded-lg border border-zinc-200 bg-white px-2 text-base dark:border-zinc-700 dark:bg-zinc-900" /></label>
        <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">Without a date fresh food gets the usual time: mince and fish 2 days, chicken and pork 4, open dairy 3, vegetables 5.</p>
        <button disabled={!valid} onClick={() => void save()} className="rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg disabled:opacity-40">Add</button>
      </div>
    </Sheet>
  )
}

function EditStockSheet({ userId, item, onClose }: { userId: string; item: InventoryItem; onClose: () => void }) {
  const [left, setLeft] = useState(item.qty_left === null ? '' : String(item.qty_left))
  const [confirm, setConfirm] = useState<'used_up' | 'discard' | null>(null)
  const save = async () => {
    const v = Number(left.replace(',', '.'))
    if (item.tracked && Number.isFinite(v)) await setStockLeft(userId, item, v)
    onClose()
  }
  if (confirm) {
    return <Confirm title={confirm === 'used_up' ? 'Used up?' : 'Discard?'} danger={confirm === 'discard'} text={`«${item.name}» leaves the stock.`} action={confirm === 'used_up' ? 'Used up' : 'Discard'}
      onCancel={() => setConfirm(null)} onConfirm={() => { void closeStock(userId, item, confirm); onClose() }} />
  }
  return (
    <Sheet title={item.name} onClose={onClose}>
      {item.tracked && (
        <label className="flex items-center justify-between text-sm font-semibold">Left ({item.unit === 'piece' ? 'pieces' : item.unit})
          <input inputMode="decimal" value={left} onChange={(e) => setLeft(e.target.value)} className="h-10 w-28 rounded-lg border border-zinc-200 bg-white px-2 text-right text-base tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => setConfirm('used_up')} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">Used up</button>
        <button onClick={() => setConfirm('discard')} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold text-red-600 dark:border-zinc-700 dark:text-red-400">Discard</button>
      </div>
      {item.tracked && <button onClick={() => void save()} className="mt-2 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">Save</button>}
    </Sheet>
  )
}

function ReviewSheet({ userId, items, today, onClose }: { userId: string; items: InventoryItem[]; today: string; onClose: () => void }) {
  return (
    <Sheet title="Items to check" onClose={onClose}>
      <p className="-mt-1 text-sm text-zinc-500 dark:text-zinc-400">Past their date or not used for a week.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id} className="rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/70">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{i.name}</span>
              <span className={`text-xs ${STATE_TEXT[stockState(i, today)]}`}>{i.best_before ? `use by ${shortDate(i.best_before)}` : 'no date'}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button onClick={() => void keepStock(i)} className="rounded-lg bg-white py-2 text-sm font-semibold dark:bg-zinc-900">Keep</button>
              <button onClick={() => void closeStock(userId, i, 'used_up')} className="rounded-lg bg-white py-2 text-sm font-semibold dark:bg-zinc-900">Used up</button>
              <button onClick={() => void closeStock(userId, i, 'discard')} className="rounded-lg bg-white py-2 text-sm font-semibold text-red-600 dark:bg-zinc-900 dark:text-red-400">Discard</button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-zinc-500">All checked.</li>}
      </ul>
    </Sheet>
  )
}
