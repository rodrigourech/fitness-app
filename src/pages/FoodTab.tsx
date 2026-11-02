import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import Sheet from '../components/Sheet'
import type { FoodCategory, FoodEntry, FoodEntryItem, FoodItem } from '../lib/db'
import {
  CATEGORIES,
  CATEGORY_LABEL,
  addDaysKey,
  amountText,
  byDay,
  categoryAt,
  defaultPlan,
  deleteFoodEntry,
  deleteFoodItem,
  ensureDailyEntries,
  isFilled,
  loadFood,
  localDay,
  mealPrepDrafts,
  saveFoodEntries,
  saveFoodEntry,
  saveFoodItem,
  stapleValues,
  totalsOf,
  weekRows,
  type PortionSlot,
} from '../lib/food'
import { MONTHS } from '../lib/forecast'
import { getNutrition, saveNutrition, type NutritionTargets } from '../lib/settings'

// Food tab, variant B (decision 1 November 2026): two numbers for the day, then Day (timeline), Week and Staples.
// Entries from the Food connector carry the badge «Claude», automatic daily entries the label «daily». Nutrition stays
// inside this tab: need and deficit goal are set by hand under Targets (decision 2 November 2026) and nothing here feeds
// the weight forecast. A past day with only automatic entries is «not filled in» and does not count. Meal prep plans
// every portion on its own day.

type View = 'today' | 'week' | 'staples'
type SheetState = { kind: 'entry'; entry?: FoodEntry } | { kind: 'staples' } | { kind: 'item'; item?: FoodItem } | { kind: 'targets' } | null

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOT: Partial<Record<FoodCategory, string>> = { cheat: 'bg-orange-500', dessert: 'bg-pink-600', drinks: 'bg-amber-600' }
/** Days ahead that can be planned and browsed (meal prep). */
const PLAN_DAYS = 6

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
  const targets = useLiveQuery(getNutrition, [])
  const [view, setView] = useState<View>('today')
  const [today] = useState(() => localDay(new Date()))
  const [day, setDay] = useState(today)
  const [sheet, setSheet] = useState<SheetState>(null)
  if (data === undefined || targets === undefined) return null

  const days = byDay(data.entries)
  const list = days.get(day) ?? []
  const totals = totalsOf(list)
  const counted = day >= today || isFilled(list)
  const proteinLeft = targets.proteinG - totals.protein

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Food</h1>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[13px] font-semibold shadow-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" /></svg>
            −{num(targets.deficitKcal)} kcal / day
          </span>
          <button onClick={() => setSheet({ kind: 'targets' })} aria-label="Edit nutrition targets"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <KcalTile label={`kcal ${day === today ? 'today' : day === addDaysKey(today, -1) ? 'yesterday' : dayTitle(day, today)}`} eaten={totals.kcal} targets={targets} counted={counted} />
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-950 dark:bg-emerald-950/50">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Protein</div>
          <div className="mt-1 text-[28px] leading-9 font-semibold tracking-tight whitespace-nowrap text-emerald-700 tabular-nums dark:text-emerald-300">
            {totals.protein}<span className="ml-1 text-xs font-normal tracking-normal text-zinc-500">/ {targets.proteinG} g</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-emerald-700/15">
            <div className="h-full rounded-full bg-emerald-700 dark:bg-emerald-400" style={{ width: `${Math.min(100, (totals.protein / targets.proteinG) * 100)}%` }} />
          </div>
          <div className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{proteinLeft <= 0 ? 'goal reached' : `${proteinLeft} g to go`}</div>
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
            <button aria-label="Next day" disabled={day >= addDaysKey(today, PLAN_DAYS)} onClick={() => setDay(addDaysKey(day, 1))} className="rounded-lg px-3 py-1.5 text-lg disabled:opacity-30">›</button>
          </div>
          {list.length > 0 && !counted && (
            <p className="rounded-xl bg-orange-50 px-3 py-2.5 text-sm text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
              <b>Not filled in.</b> Only the daily entries are logged, so this day does not count in the week and the averages.
            </p>
          )}
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

      {view === 'week' && <WeekView entries={data.entries} day={day} today={today} targets={targets} onOpenDay={(d) => { setDay(d); setView('today') }} />}
      {view === 'staples' && <StaplesView items={data.items} onOpen={(item) => setSheet({ kind: 'item', item })} />}

      {sheet?.kind === 'entry' && <EntrySheet userId={userId} day={day} entry={sheet.entry} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'staples' && <StaplesSheet userId={userId} day={day} today={today} items={data.items} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'item' && <ItemSheet userId={userId} item={sheet.item} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'targets' && <TargetsSheet userId={userId} targets={targets} today={today} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Eaten against need: blue = eaten, orange = deficit up to the need, dark tick = target (need − deficit goal). */
function KcalTile({ label, eaten, targets, counted }: { label: string; eaten: number; targets: NutritionTargets; counted: boolean }) {
  const need = targets.needKcal
  const deficit = need - eaten
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / need) * 100))}%`
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-950 dark:bg-blue-950/50">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-1 text-[28px] leading-9 font-semibold tracking-tight whitespace-nowrap text-blue-700 tabular-nums dark:text-blue-300">
        {num(eaten)}<span className="ml-1 text-xs font-normal tracking-normal text-zinc-500">/ {num(need)} need</span>
      </div>
      <div className="relative mt-2 h-1.5 rounded-full bg-blue-700/10" role="img" aria-label={`${num(eaten)} of ${num(need)} kcal eaten, target ${num(need - targets.deficitKcal)}`}>
        {counted && <>
          <span className="absolute inset-y-0 left-0 rounded-l-full bg-[var(--viz-s1)]" style={{ width: pct(eaten) }} />
          {deficit > 0 && <span className="absolute inset-y-0 right-0 rounded-r-full bg-amber-500" style={{ left: pct(eaten) }} />}
          <span className="absolute -inset-y-1 w-0.5 bg-zinc-900/55 dark:bg-zinc-100/60" style={{ left: pct(need - targets.deficitKcal) }} />
        </>}
      </div>
      <div className="mt-1.5 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        {!counted ? 'not counted'
          : deficit >= 0 ? <><b className="font-semibold text-amber-700 dark:text-amber-400">−{num(deficit)} kcal</b> deficit</>
          : <><b className="font-semibold text-red-700 dark:text-red-400">+{num(-deficit)} kcal</b> surplus</>}
      </div>
    </div>
  )
}

function TimelineEntry({ entry: e, last, onOpen }: { entry: FoodEntry; last: boolean; onOpen: () => void }) {
  return (
    <li className="grid grid-cols-[2.75rem_0.75rem_1fr] gap-2">
      <span className="pt-3 text-right text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{time(e.eaten_at)}</span>
      <span className="flex flex-col items-center">
        <span className={`mt-4 h-2.5 w-2.5 rounded-full ${e.source === 'auto' ? 'bg-zinc-400' : (DOT[e.category] ?? 'bg-accent')}`} />
        {!last && <span className="w-0.5 flex-1 bg-zinc-200 dark:bg-zinc-800" />}
      </span>
      <button onClick={onOpen} className="card mb-2 p-3 text-left">
        <span className="block text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{CATEGORY_LABEL[e.category]}</span>
        <span className="mt-0.5 block font-semibold">
          {e.title}
          {e.source === 'auto' && <span className="ml-1.5 rounded-md bg-zinc-100 px-1.5 py-px align-[1px] text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">daily</span>}
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

function WeekView({ entries, day, today, targets, onOpenDay }: { entries: FoodEntry[]; day: string; today: string; targets: NutritionTargets; onOpenDay: (d: string) => void }) {
  const rows = weekRows(entries, day)
  const target = targets.needKcal - targets.deficitKcal
  const counted = rows.filter((r) => r.count > 0 && (r.filled || r.day >= today))
  const past = counted.filter((r) => r.day < today)
  const max = Math.max(3000, target * 1.2, ...rows.map((r) => r.kcal))
  const avg = (list: typeof rows, f: (r: (typeof rows)[number]) => number) => (list.length ? Math.round(list.reduce((s, r) => s + f(r), 0) / list.length) : 0)
  const deficit = avg(past, (r) => targets.needKcal - r.kcal)
  return (
    <>
      <section className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Week</h2>
          <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{counted.length ? `Ø ${num(avg(counted, (r) => r.kcal))} kcal · Ø ${avg(counted, (r) => r.protein)} g · ${counted.length} of 7 days` : 'no entries'}</span>
        </div>
        <div className="mt-3 flex items-end gap-1">
          {rows.map((r) => {
            const notFilled = r.count > 0 && !r.filled && r.day < today
            return (
              <button key={r.day} onClick={() => onOpenDay(r.day)} className="flex flex-1 flex-col items-center gap-1">
                <span className="h-3 text-[10px] text-zinc-500 tabular-nums">{r.kcal && !notFilled ? `${(r.kcal / 1000).toFixed(1)}k` : ''}</span>
                <span className="relative flex h-28 w-full items-end justify-center">
                  <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-zinc-500/40" style={{ bottom: `${(target / max) * 112}px` }} />
                  {notFilled
                    ? <span className="h-28 w-5 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700" />
                    : <span className={`w-5 rounded-t-md rounded-b-sm ${r.day === day ? 'bg-[var(--viz-s1)]' : 'bg-[var(--viz-s1)] opacity-55'}`} style={{ height: `${Math.max(r.kcal ? 4 : 0, (r.kcal / max) * 112)}px` }} />}
                </span>
                <span className={`text-[11px] font-semibold tabular-nums ${!notFilled && r.protein >= targets.proteinG ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500'}`}>{r.count && !notFilled ? `${r.protein} g` : '–'}</span>
                <span className="text-[11px] text-zinc-500">{WEEKDAY[new Date(`${r.day}T12:00:00`).getDay()]}</span>
                <span className={`h-3.5 text-[10px] font-semibold whitespace-nowrap ${notFilled ? 'text-zinc-400' : r.cheat ? 'text-orange-600' : 'text-amber-700 dark:text-amber-500'}`}>{notFilled ? 'not filled' : r.cheat ? 'cheat' : r.drinks ? 'drinks' : ''}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">Dashed line · target {num(target)} kcal</p>
      </section>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Ø deficit per day" value={!past.length ? '–' : deficit >= 0 ? `−${num(deficit)}` : `+${num(-deficit)}`} unit="kcal" />
        <Tile label={`≥ ${targets.proteinG} g protein`} value={String(counted.filter((r) => r.protein >= targets.proteinG).length)} unit={`/ ${counted.length}`} />
        <Tile label="Cheat meals" value={String(rows.reduce((s, r) => s + r.cheat, 0))} />
        <Tile label="Drink nights" value={String(rows.filter((r) => r.drinks > 0).length)} />
      </div>
    </>
  )
}

function TargetsSheet({ userId, targets, today, onClose }: { userId: string; targets: NutritionTargets; today: string; onClose: () => void }) {
  const [draft, setDraft] = useState(targets)
  const [need, setNeed] = useState(String(targets.needKcal))
  const [protein, setProtein] = useState(String(targets.proteinG))
  const save = (next: NutritionTargets) => {
    setDraft(next)
    void saveNutrition(userId, next).then(() => ensureDailyEntries(userId, today, next))
  }
  const field = (value: string, set: (v: string) => void, apply: (n: number) => void, label: string, unit: string) => (
    <span className="flex items-center gap-1.5">
      <input inputMode="numeric" aria-label={label} value={value} onChange={(e) => set(e.target.value)}
        onBlur={() => { const n = Number(value.replace(/\s/g, '')); if (Number.isFinite(n) && n > 0) apply(n) }}
        className="w-20 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-right text-sm tabular-nums dark:border-zinc-700" />
      <span className="w-7 text-xs text-zinc-500">{unit}</span>
    </span>
  )
  const toggle = (on: boolean, set: (v: boolean) => void, label: string) => (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)}
      className={`relative h-[26px] w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-emerald-600' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
      <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  )
  const row = 'flex items-center justify-between gap-3 border-b border-zinc-100 py-2.5 last:border-0 dark:border-zinc-800'
  return (
    <Sheet title="Nutrition targets" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <section className="rounded-xl border border-zinc-200 px-3 dark:border-zinc-700">
          <div className={row}>
            <span><span className="block text-sm font-semibold">Daily need</span><span className="block text-xs text-zinc-500">Maintenance, set by hand</span></span>
            <span className="flex items-center gap-1.5">
              <button aria-label="Need 50 kcal less" onClick={() => { const n = Math.max(1200, draft.needKcal - 50); setNeed(String(n)); save({ ...draft, needKcal: n }) }} className="h-8 w-8 rounded-md bg-zinc-100 text-lg leading-none dark:bg-zinc-800">−</button>
              <input inputMode="numeric" aria-label="Daily need" value={need} onChange={(e) => setNeed(e.target.value)}
                onBlur={() => { const n = Number(need.replace(/\s/g, '')); if (Number.isFinite(n) && n > 0) save({ ...draft, needKcal: n }) }}
                className="w-16 rounded-lg border border-zinc-300 bg-transparent px-1.5 py-1.5 text-center text-sm tabular-nums dark:border-zinc-700" />
              <button aria-label="Need 50 kcal more" onClick={() => { const n = Math.min(5000, draft.needKcal + 50); setNeed(String(n)); save({ ...draft, needKcal: n }) }} className="h-8 w-8 rounded-md bg-zinc-100 text-lg leading-none dark:bg-zinc-800">+</button>
            </span>
          </div>
          <div className="border-b border-zinc-100 py-2.5 dark:border-zinc-800">
            <span className="block text-sm font-semibold">Deficit goal per day</span>
            <div className="mt-2 grid grid-cols-5 gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
              {[300, 400, 500, 600, 750].map((v) => (
                <button key={v} aria-pressed={draft.deficitKcal === v} onClick={() => save({ ...draft, deficitKcal: v })}
                  className={`rounded-md py-1.5 tabular-nums ${draft.deficitKcal === v ? 'bg-white font-semibold shadow-sm dark:bg-zinc-700' : 'text-zinc-500'}`}>{v}</button>
              ))}
            </div>
          </div>
          <div className={row}>
            <span><span className="block text-sm font-semibold">Daily target</span><span className="block text-xs text-zinc-500">Need − deficit goal</span></span>
            <b className="text-sm tabular-nums">{num(draft.needKcal - draft.deficitKcal)} kcal</b>
          </div>
          <div className={row}>
            <span className="text-sm font-semibold">Protein goal</span>
            {field(protein, setProtein, (n) => save({ ...draft, proteinG: n }), 'Protein goal', 'g')}
          </div>
        </section>
        <p className="rounded-xl bg-zinc-100 p-3 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          Estimate of your need: Mifflin-St Jeor with 85.7 kg, 182 cm, 25 years × 1.3 (desk job, about 5 500 steps) = 2 440 kcal. Change it if your weight trend says otherwise. Nothing here changes the weight forecast.
        </p>
        <section className="rounded-xl border border-zinc-200 px-3 dark:border-zinc-700">
          <div className="pt-2.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Added automatically</div>
          <div className={row}>
            <span><span className="block text-sm font-semibold">ESN shake, water</span><span className="block text-xs text-zinc-500">every day · 08:00</span></span>
            {toggle(draft.shake, (v) => save({ ...draft, shake: v }), 'ESN shake every day')}
          </div>
          <div className={row}>
            <span><span className="block text-sm font-semibold">3 espressos with milk</span><span className="block text-xs text-zinc-500">Mon–Fri · 09:30 · 55 kcal · 3 g</span></span>
            {toggle(draft.espresso, (v) => save({ ...draft, espresso: v }), 'Espressos Monday to Friday')}
          </div>
          <p className="pb-2.5 text-xs text-zinc-500 dark:text-zinc-400">Change or delete them on a day that differs. A day with only these entries counts as not filled in.</p>
        </section>
      </div>
    </Sheet>
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

function StaplesSheet({ userId, day, today, items, onClose }: { userId: string; day: string; today: string; items: FoodItem[]; onClose: () => void }) {
  const [now] = useState(() => new Date())
  const [first, setFirst] = useState<PortionSlot>(() => ({ day, category: day === today ? categoryAt(now) : 'lunch' }))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [plan, setPlan] = useState<PortionSlot[]>(() => defaultPlan(day, first.category, 1))
  const chosen = items.flatMap((i) => {
    const q = Number((amounts[i.id] ?? '').replace(',', '.'))
    return q > 0 ? [{ item: i, q, ...stapleValues(i, q) }] : []
  })
  const total = { kcal: chosen.reduce((s, c) => s + c.kcal, 0), protein: chosen.reduce((s, c) => s + c.protein, 0) }
  const slots = [first, ...plan.slice(1)]
  const drafts = mealPrepDrafts({
    title: chosen.map((c) => c.item.name.split(',')[0]).join(', '),
    detail: chosen.map((c) => `${c.item.name.split(',')[0]} ${amountText(c.item, c.q)}`).join(' · '),
    items: chosen.map((c) => ({ name: c.item.name, food_item_id: c.item.id, amount: amountText(c.item, c.q), kcal: c.kcal, protein_g: c.protein, source: 'staple' as const })),
    kcal: total.kcal,
    protein: total.protein,
  }, slots, now)
  const cooked = slots.length
  const setCooked = (n: number) => setPlan(n > plan.length ? [...plan, ...defaultPlan(first.day, first.category, n).slice(plan.length)] : plan.slice(0, n))
  const setSlot = (i: number, slot: PortionSlot) => (i === 0 ? setFirst(slot) : setPlan(plan.map((p, j) => (j === i ? slot : p))))
  const save = () => void saveFoodEntries(userId, drafts).then(onClose)
  const days = [...new Set([day, ...Array.from({ length: PLAN_DAYS + 3 }, (_, i) => addDaysKey(today, i - 2))])].sort()
  return (
    <Sheet title="Add from staples" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CategoryPicker value={first.category} onChange={(c) => setFirst({ ...first, category: c })} />
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
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">Cooked portions</span>
          <span className="flex items-center gap-2">
            <button type="button" aria-label="Fewer portions" disabled={cooked <= 1} onClick={() => setCooked(cooked - 1)} className="h-8 w-8 rounded-md bg-zinc-100 disabled:opacity-30 dark:bg-zinc-800">−</button>
            <b className="w-6 text-center tabular-nums">{cooked}</b>
            <button type="button" aria-label="More portions" disabled={cooked >= 6} onClick={() => setCooked(cooked + 1)} className="h-8 w-8 rounded-md bg-zinc-100 disabled:opacity-30 dark:bg-zinc-800">+</button>
          </span>
        </div>
        {cooked > 1 && (
          <div className="rounded-xl border border-zinc-200 px-3 py-1 dark:border-zinc-700">
            <div className="pt-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">When do you eat them?</div>
            {slots.map((slot, i) => (
              <div key={i} className="flex items-center justify-between gap-2 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">Portion {i + 1}</span>
                  <span className="block text-xs text-zinc-500 tabular-nums">{num(drafts[i]?.kcal ?? 0)} kcal · {Math.round(drafts[i]?.protein ?? 0)} g</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <select aria-label={`Portion ${i + 1} day`} value={slot.day} onChange={(e) => setSlot(i, { ...slot, day: e.target.value })} className={select}>
                    {days.map((d) => <option key={d} value={d}>{dayTitle(d, today)}</option>)}
                  </select>
                  <select aria-label={`Portion ${i + 1} meal`} value={slot.category} onChange={(e) => setSlot(i, { ...slot, category: e.target.value as FoodCategory })} className={select}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="rounded-xl bg-zinc-100 p-3 text-sm tabular-nums dark:bg-zinc-800">
          {cooked > 1 ? (
            <>
              <div className="text-xs text-zinc-500">Total {num(total.kcal)} kcal · {Math.round(total.protein)} g</div>
              <div className="font-semibold">Per portion {num(drafts[0]?.kcal ?? 0)} kcal · {Math.round(drafts[0]?.protein ?? 0)} g protein</div>
              <div className="mt-0.5 text-xs text-zinc-500">Each portion becomes its own entry and counts on its day. Move or delete one later if plans change.</div>
            </>
          ) : (
            <div className="font-semibold">{num(total.kcal)} kcal · {Math.round(total.protein)} g protein</div>
          )}
        </div>
        <button disabled={chosen.length === 0} onClick={save} className="rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-40">
          {cooked > 1 ? `Save ${cooked} entries · ${num(total.kcal)} kcal` : 'Save'}
        </button>
      </div>
    </Sheet>
  )
}

const select = 'rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-xs dark:border-zinc-700'

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
