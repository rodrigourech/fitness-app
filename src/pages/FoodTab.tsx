import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import Sheet from '../components/Sheet'
import { bodyWeightSeries } from '../lib/body'
import type { FoodCategory, FoodEntry, FoodEntryItem, FoodItem } from '../lib/db'
import {
  CALIBRATION_DAYS,
  CATEGORY_LABEL,
  PROTEIN_TARGET_G,
  addDaysKey,
  amountText,
  byDay,
  categoryAt,
  deleteFoodEntry,
  deleteFoodItem,
  kcalTarget,
  loadFood,
  localDay,
  portionOf,
  saveFoodEntry,
  saveFoodItem,
  stapleValues,
  totalsOf,
  weekRows,
} from '../lib/food'
import { MONTHS } from '../lib/forecast'

// Food tab, variant B (decision 1 November 2026): two numbers for the day, then Today (timeline), Week and Staples.
// Entries from the Food connector carry the badge «Claude».

type View = 'today' | 'week' | 'staples'
type SheetState = { kind: 'entry'; entry?: FoodEntry } | { kind: 'staples' } | { kind: 'item'; item?: FoodItem } | null

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CATEGORIES: FoodCategory[] = ['breakfast', 'lunch', 'dinner', 'snack', 'cheat']

function dayTitle(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDaysKey(today, -1)) return 'Yesterday'
  const d = new Date(`${day}T12:00:00`)
  return `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

function time(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function num(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export default function FoodTab({ userId }: { userId: string }) {
  const data = useLiveQuery(loadFood, [])
  const weights = useLiveQuery(bodyWeightSeries, [])
  const [view, setView] = useState<View>('today')
  const [today] = useState(() => localDay(new Date()))
  const [day, setDay] = useState(today)
  const [sheet, setSheet] = useState<SheetState>(null)
  if (data === undefined || weights === undefined) return null

  const days = byDay(data.entries)
  const list = days.get(day) ?? []
  const totals = totalsOf(list)
  const target = kcalTarget(data.entries, weights.map((p) => ({ date: p.entry.measured_on, kg: p.entry.weight_kg })), today)
  const proteinLeft = PROTEIN_TARGET_G - totals.protein

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-950 dark:bg-blue-950/50">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">kcal {day === today ? 'today' : dayTitle(day, today)}</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-blue-700 tabular-nums dark:text-blue-300">{num(totals.kcal)}</div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            of {num(target.kcal)} · {target.kind === 'start' ? `start target, ${Math.min(target.daysLogged, CALIBRATION_DAYS)}/${CALIBRATION_DAYS} days` : 'your target'}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-950 dark:bg-emerald-950/50">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Protein</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight text-emerald-700 tabular-nums dark:text-emerald-300">
            {totals.protein}<span className="ml-1 text-xs font-normal tracking-normal text-zinc-500">/ {PROTEIN_TARGET_G} g</span>
          </div>
          <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{proteinLeft <= 0 ? 'goal reached' : `${proteinLeft} g to go`}</div>
        </div>
      </div>

      <div role="tablist" aria-label="Food" className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
        {(['today', 'week', 'staples'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={`rounded-md py-1.5 text-sm font-semibold ${view === v ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {v === 'today' ? 'Day' : v === 'week' ? 'Week' : 'Staples'}
          </button>
        ))}
      </div>

      {view === 'today' && (
        <>
          <div className="flex items-center justify-between">
            <button aria-label="Previous day" onClick={() => setDay(addDaysKey(day, -1))} className="rounded-lg px-3 py-1.5 text-lg">‹</button>
            <span className="text-sm font-semibold">{dayTitle(day, today)}</span>
            <button aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDaysKey(day, 1))} className="rounded-lg px-3 py-1.5 text-lg disabled:opacity-30">›</button>
          </div>
          {list.length === 0 ? (
            <p className="card p-4 text-sm text-zinc-500 dark:text-zinc-400">Nothing logged. Tell Claude what you ate, or add it here.</p>
          ) : (
            <ol>{list.map((e, i) => <TimelineEntry key={e.id} entry={e} last={i === list.length - 1} onOpen={() => setSheet({ kind: 'entry', entry: e })} />)}</ol>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setSheet({ kind: 'entry' })} className="rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">+ Add entry</button>
            <button onClick={() => setSheet({ kind: 'staples' })} className="rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900">Add from staples</button>
          </div>
        </>
      )}

      {view === 'week' && <WeekView entries={data.entries} day={day} onOpenDay={(d) => { setDay(d); setView('today') }} />}
      {view === 'staples' && <StaplesView items={data.items} onOpen={(item) => setSheet({ kind: 'item', item })} />}

      {sheet?.kind === 'entry' && <EntrySheet userId={userId} day={day} entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'staples' && <StaplesSheet userId={userId} day={day} items={data.items} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'item' && <ItemSheet userId={userId} item={sheet.item} onClose={() => setSheet(null)} />}
    </div>
  )
}

function TimelineEntry({ entry: e, last, onOpen }: { entry: FoodEntry; last: boolean; onOpen: () => void }) {
  return (
    <li className="grid grid-cols-[2.75rem_0.75rem_1fr] gap-2">
      <span className="pt-3 text-right text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{time(e.eaten_at)}</span>
      <span className="flex flex-col items-center">
        <span className={`mt-4 h-2.5 w-2.5 rounded-full ${e.category === 'cheat' ? 'bg-orange-500' : 'bg-accent'}`} />
        {!last && <span className="w-0.5 flex-1 bg-zinc-200 dark:bg-zinc-800" />}
      </span>
      <button onClick={onOpen} className="card mb-2 p-3 text-left">
        <span className="block text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{CATEGORY_LABEL[e.category]}</span>
        <span className="mt-0.5 block font-semibold">
          {e.title}
          {e.source === 'claude' && <span className="ml-1.5 rounded-md bg-violet-50 px-1.5 py-px align-[1px] text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Claude</span>}
        </span>
        {e.detail && <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{e.detail}</span>}
        <span className="mt-1.5 flex gap-3 text-sm font-semibold tabular-nums">
          <span>{num(e.kcal)} kcal</span>
          <span className="text-emerald-700 dark:text-emerald-400">{Math.round(e.protein_g)} g protein</span>
        </span>
      </button>
    </li>
  )
}

function WeekView({ entries, day, onOpenDay }: { entries: FoodEntry[]; day: string; onOpenDay: (d: string) => void }) {
  const rows = weekRows(entries, day)
  const logged = rows.filter((r) => r.count > 0)
  const max = Math.max(3000, ...rows.map((r) => r.kcal))
  const avg = (f: (r: (typeof rows)[number]) => number) => (logged.length ? Math.round(logged.reduce((s, r) => s + f(r), 0) / logged.length) : 0)
  return (
    <>
      <section className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Week</h2>
          <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{logged.length ? `Ø ${num(avg((r) => r.kcal))} kcal · Ø ${avg((r) => r.protein)} g` : 'no entries'}</span>
        </div>
        <div className="mt-3 flex items-end gap-1">
          {rows.map((r) => (
            <button key={r.day} onClick={() => onOpenDay(r.day)} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] text-zinc-500 tabular-nums">{r.kcal ? `${(r.kcal / 1000).toFixed(1)}k` : ''}</span>
              <span className="flex h-28 items-end">
                <span className={`w-5 rounded-t-md rounded-b-sm ${r.day === day ? 'bg-[var(--viz-s1)]' : 'bg-[var(--viz-s1)] opacity-55'}`} style={{ height: `${Math.max(r.kcal ? 4 : 0, (r.kcal / max) * 112)}px` }} />
              </span>
              <span className={`text-[11px] font-semibold tabular-nums ${r.protein >= PROTEIN_TARGET_G ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500'}`}>{r.count ? `${r.protein} g` : '–'}</span>
              <span className="text-[11px] text-zinc-500">{WEEKDAY[new Date(`${r.day}T12:00:00`).getDay()]}</span>
              <span className="h-3.5 text-[10px] font-semibold text-orange-600">{r.cheat ? 'cheat' : ''}</span>
            </button>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <Tile label={`Days ≥ ${PROTEIN_TARGET_G} g protein`} value={`${rows.filter((r) => r.protein >= PROTEIN_TARGET_G).length}`} unit="/ 7" />
        <Tile label="Cheat meals" value={String(rows.reduce((s, r) => s + r.cheat, 0))} />
      </div>
    </>
  )
}

function Tile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="card p-3">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums">{value}{unit && <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span>}</div>
    </div>
  )
}

function basisText(i: FoodItem): string {
  if (i.basis === '100g') return `per 100 g${i.package_g ? ` · pack ${i.package_g} g` : ''}`
  return `per ${i.basis}${i.piece_g ? ` (${i.piece_g} g)` : ''}`
}

function StaplesView({ items, onOpen }: { items: FoodItem[]; onOpen: (i?: FoodItem) => void }) {
  return (
    <>
      <section className="card px-4 py-1">
        <div className="grid grid-cols-[1fr_3.5rem_4rem] gap-2 border-b border-zinc-100 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
          <span>Food</span><span className="text-right">kcal</span><span className="text-right">Protein</span>
        </div>
        {items.length === 0 && <p className="py-3 text-sm text-zinc-500">No staples yet.</p>}
        {items.map((i) => (
          <button key={i.id} onClick={() => onOpen(i)} className="grid w-full grid-cols-[1fr_3.5rem_4rem] items-center gap-2 border-b border-zinc-100 py-2.5 text-left last:border-0 dark:border-zinc-800">
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{i.name}</span>
              <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{[i.store, basisText(i)].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="text-right text-sm tabular-nums">{Math.round(i.kcal)}</span>
            <span className="text-right text-sm tabular-nums">{i.protein_g} g</span>
          </button>
        ))}
      </section>
      <button onClick={() => onOpen()} className="rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900">+ Add staple</button>
      <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">New products also via Claude, e.g. with a photo of the label.</p>
    </>
  )
}

// --- sheets ----------------------------------------------------------------------------------

function localInput(iso: string): string {
  const d = new Date(iso)
  return `${localDay(d)}T${time(iso)}`
}

function defaultTime(day: string): string {
  const now = new Date()
  return day === localDay(now) ? localInput(now.toISOString()) : `${day}T12:00`
}

function Label({ text, children }: { text: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-zinc-500 dark:text-zinc-400">{text}</span>{children}</label>
}

const input = 'rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm tabular-nums dark:border-zinc-700'

function CategoryPicker({ value, onChange }: { value: FoodCategory; onChange: (c: FoodCategory) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CATEGORIES.map((c) => (
        <button key={c} type="button" aria-pressed={value === c} onClick={() => onChange(c)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${value === c ? 'border-accent bg-accent-soft text-accent-ink' : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'}`}>
          {CATEGORY_LABEL[c]}
        </button>
      ))}
    </div>
  )
}

function EntrySheet({ userId, day, entry, onClose }: { userId: string; day: string; entry?: FoodEntry; onClose: () => void }) {
  const [when, setWhen] = useState(entry ? localInput(entry.eaten_at) : defaultTime(day))
  const [category, setCategory] = useState<FoodCategory>(entry?.category ?? categoryAt(new Date(when)))
  const [title, setTitle] = useState(entry?.title ?? '')
  const [kcal, setKcal] = useState(entry ? String(Math.round(entry.kcal)) : '')
  const [protein, setProtein] = useState(entry ? String(entry.protein_g) : '')
  const k = Number(kcal.replace(',', '.'))
  const p = Number(protein.replace(',', '.') || '0')
  const valid = kcal !== '' && Number.isFinite(k) && k >= 0 && Number.isFinite(p) && p >= 0 && when !== ''
  const save = () => void saveFoodEntry(userId, { eatenAt: new Date(when).toISOString(), category, title, kcal: k, protein: p, items: entry?.items,
    detail: entry?.detail, portionsCooked: entry?.portions_cooked, portionsEaten: entry?.portions_eaten }, entry).then(onClose)
  return (
    <Sheet title={entry ? 'Edit entry' : 'Add entry'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CategoryPicker value={category} onChange={setCategory} />
        <Label text="What"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Döner, chicken with rice" className={input} /></Label>
        <div className="grid grid-cols-2 gap-2">
          <Label text="kcal"><input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} className={input} /></Label>
          <Label text="Protein g"><input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} className={input} /></Label>
        </div>
        <Label text="Time"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className={input} /></Label>
        {entry && entry.items.length > 0 && <ItemList items={entry.items} entry={entry} />}
        <div className="mt-1 flex gap-2">
          {entry && <button onClick={() => void deleteFoodEntry(entry).then(onClose)} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-400">Delete</button>}
          <button disabled={!valid} onClick={save} className="ml-auto rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40">Save</button>
        </div>
      </div>
    </Sheet>
  )
}

function ItemList({ items, entry }: { items: FoodEntryItem[]; entry: FoodEntry }) {
  return (
    <div className="rounded-xl bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
      {items.map((i, n) => (
        <div key={n} className="flex justify-between gap-2 py-0.5 tabular-nums">
          <span>{i.name}, {i.amount}{i.source === 'estimate' && <span className="ml-1 text-violet-600">estimate</span>}</span>
          <span className="shrink-0">{Math.round(i.kcal)} kcal · {i.protein_g} g</span>
        </div>
      ))}
      {entry.portions_cooked && <div className="mt-1 text-zinc-500">{entry.portions_eaten ?? 1} of {entry.portions_cooked} portions</div>}
    </div>
  )
}

function StaplesSheet({ userId, day, items, onClose }: { userId: string; day: string; items: FoodItem[]; onClose: () => void }) {
  const [when] = useState(defaultTime(day))
  const [category, setCategory] = useState<FoodCategory>(categoryAt(new Date(when)))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [cooked, setCooked] = useState(1)
  const [eaten, setEaten] = useState(1)
  const chosen = items.flatMap((i) => {
    const q = Number((amounts[i.id] ?? '').replace(',', '.'))
    return q > 0 ? [{ item: i, q, ...stapleValues(i, q) }] : []
  })
  const total = { kcal: chosen.reduce((s, c) => s + c.kcal, 0), protein: chosen.reduce((s, c) => s + c.protein, 0) }
  const portion = portionOf(total, cooked, Math.min(eaten, cooked))
  const save = () => void saveFoodEntry(userId, {
    eatenAt: new Date(when).toISOString(),
    category,
    title: chosen.map((c) => c.item.name.split(',')[0]).join(', '),
    detail: [cooked > 1 ? `${eaten} of ${cooked} portions` : null, chosen.map((c) => `${c.item.name.split(',')[0]} ${amountText(c.item, c.q)}`).join(' · ')].filter(Boolean).join(' · '),
    items: chosen.map((c) => ({ name: c.item.name, food_item_id: c.item.id, amount: amountText(c.item, c.q), kcal: c.kcal, protein_g: c.protein, source: 'staple' as const })),
    kcal: portion.kcal,
    protein: portion.protein,
    portionsCooked: cooked > 1 ? cooked : null,
    portionsEaten: cooked > 1 ? Math.min(eaten, cooked) : null,
  }).then(onClose)
  const stepper = (label: string, v: number, set: (n: number) => void, min: number, max: number) => (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <button type="button" disabled={v <= min} onClick={() => set(v - 1)} className="h-8 w-8 rounded-md bg-zinc-100 disabled:opacity-30 dark:bg-zinc-800">−</button>
        <b className="w-6 text-center tabular-nums">{v}</b>
        <button type="button" disabled={v >= max} onClick={() => set(v + 1)} className="h-8 w-8 rounded-md bg-zinc-100 disabled:opacity-30 dark:bg-zinc-800">+</button>
      </span>
    </div>
  )
  return (
    <Sheet title="Add from staples" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CategoryPicker value={category} onChange={setCategory} />
        <div className="flex flex-col">
          {items.map((i) => (
            <label key={i.id} className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
              <span className="min-w-0 text-sm"><span className="block truncate">{i.name}</span><span className="block text-xs text-zinc-500">{basisText(i)}</span></span>
              <span className="flex items-center gap-1.5">
                <input inputMode="decimal" aria-label={`${i.name} amount`} value={amounts[i.id] ?? ''} placeholder="0"
                  onChange={(e) => setAmounts({ ...amounts, [i.id]: e.target.value })} className="w-16 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-right text-sm tabular-nums dark:border-zinc-700" />
                <span className="w-6 text-xs text-zinc-500">{i.basis === '100g' ? 'g' : '×'}</span>
              </span>
            </label>
          ))}
        </div>
        {stepper('Portions cooked', cooked, (n) => { setCooked(n); setEaten(Math.min(eaten, n)) }, 1, 6)}
        {cooked > 1 && stepper('Portions eaten now', eaten, setEaten, 1, cooked)}
        <div className="rounded-xl bg-zinc-100 p-3 text-sm tabular-nums dark:bg-zinc-800">
          {cooked > 1 && <div className="text-xs text-zinc-500">Total {num(total.kcal)} kcal · {Math.round(total.protein)} g</div>}
          <div className="font-semibold">Your portion {num(portion.kcal)} kcal · {Math.round(portion.protein)} g protein</div>
        </div>
        <button disabled={chosen.length === 0} onClick={save} className="rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40">Save</button>
      </div>
    </Sheet>
  )
}

function ItemSheet({ userId, item, onClose }: { userId: string; item?: FoodItem; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? '')
  const [store, setStore] = useState(item?.store ?? '')
  const [basis, setBasis] = useState<FoodItem['basis']>(item?.basis ?? '100g')
  const [kcal, setKcal] = useState(item ? String(item.kcal) : '')
  const [protein, setProtein] = useState(item ? String(item.protein_g) : '')
  const [pieceG, setPieceG] = useState(item?.piece_g ? String(item.piece_g) : '')
  const [packageG, setPackageG] = useState(item?.package_g ? String(item.package_g) : '')
  const n = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const k = n(kcal)
  const p = n(protein)
  const valid = name.trim() !== '' && k !== null && k >= 0 && p !== null && p >= 0
  const save = () => void saveFoodItem(userId, { name, store: store.trim() || null, basis, kcal: k!, protein_g: p!, piece_g: n(pieceG), package_g: n(packageG) }, item).then(onClose)
  return (
    <Sheet title={item ? 'Edit staple' : 'Add staple'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Label text="Name"><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></Label>
        <Label text="Store"><input value={store} onChange={(e) => setStore(e.target.value)} placeholder="optional" className={input} /></Label>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 text-xs dark:bg-zinc-800">
          {(['100g', 'piece', 'serving'] as const).map((b) => (
            <button key={b} type="button" aria-pressed={basis === b} onClick={() => setBasis(b)} className={`rounded-md py-1.5 ${basis === b ? 'bg-white font-semibold shadow-sm dark:bg-zinc-700' : 'text-zinc-500'}`}>
              {b === '100g' ? 'per 100 g' : b === 'piece' ? 'per piece' : 'per serving'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Label text="kcal"><input inputMode="decimal" value={kcal} onChange={(e) => setKcal(e.target.value)} className={input} /></Label>
          <Label text="Protein g"><input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} className={input} /></Label>
          <Label text={basis === '100g' ? 'Package g' : 'Grams per piece'}>
            <input inputMode="decimal" value={basis === '100g' ? packageG : pieceG} onChange={(e) => (basis === '100g' ? setPackageG : setPieceG)(e.target.value)} placeholder="optional" className={input} />
          </Label>
        </div>
        <div className="mt-1 flex gap-2">
          {item && <button onClick={() => void deleteFoodItem(item).then(onClose)} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-400">Delete</button>}
          <button disabled={!valid} onClick={save} className="ml-auto rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40">Save</button>
        </div>
      </div>
    </Sheet>
  )
}
