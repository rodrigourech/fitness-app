import { useLiveQuery } from 'dexie-react-hooks'
import { useWide } from '../lib/useWide'
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
import { entryTotal, formatQuantity, itemsLine, matchesItems, parseAmount, perUnitText, quantityTag, scaleItem, stepOf, unitLabel } from '../lib/foodAmount'
import { getNutrition, saveNutrition, type NutritionTargets } from '../lib/settings'
import { consumeItems } from '../lib/kitchen'
import { recipeFromEntry, saveRecipe } from '../lib/recipe'
import RecipesView from './food/RecipesView'
import KitchenView, { FridgeSection } from './food/KitchenView'
import SegmentTabs from '../components/SegmentTabs'
import { FoodPhotoImg, ProductPhotos } from '../components/FoodPhotos'
import { favourites, oneUnit, quickAdd, quickAddRecipe, searchFood } from '../lib/quickAdd'
import { perPortion } from '../lib/recipe'
import { offerUndo } from '../lib/undo'
import { db, type FoodPhoto, type Recipe } from '../lib/db'

// Food tab (decision 1 November 2026, sections since 20 November 2026): two numbers for the day, the day as a timeline,
// the week, recipes and the kitchen with fridge, stock and staples.
// Entries from the Food connector carry the badge «Claude», automatic daily entries the label «daily». Nutrition stays
// inside this tab: need and deficit goal are set by hand under Targets (decision 2 November 2026) and nothing here feeds
// the weight forecast. A past day with only automatic entries is «not filled in» and does not count. Meal prep plans
// every portion on its own day.

// Navigation variant B (decision 20 November 2026): the switch Today · Recipes · Kitchen sits directly under the title;
// goals, kcal and protein belong to Today only. The week is a Day | Week toggle inside Today on the phone and its own
// column on the laptop; staples are reached from Kitchen.
type Section = 'today' | 'recipes' | 'kitchen'
const SECTIONS = [
  { key: 'today', label: 'Today', icon: 'sun' },
  { key: 'recipes', label: 'Recipes', icon: 'book' },
  { key: 'kitchen', label: 'Kitchen', icon: 'fridge' },
] as const
type SheetState = { kind: 'entry'; entry?: FoodEntry } | { kind: 'staples'; preset?: string } | { kind: 'item'; item?: FoodItem; name?: string } | { kind: 'targets' } | null

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
  const [section, setSection] = useState<Section>('today')
  const [week, setWeek] = useState(false)
  const [staples, setStaples] = useState(false)
  const [today] = useState(() => localDay(new Date()))
  const [day, setDay] = useState(today)
  const [sheet, setSheet] = useState<SheetState>(null)
  const wide = useWide()
  if (data === undefined || targets === undefined) return null

  const days = byDay(data.entries)
  const list = days.get(day) ?? []
  const totals = totalsOf(list)
  const counted = day >= today || isFilled(list)
  const weekView = <WeekView entries={data.entries} day={day} today={today} targets={targets} onOpenDay={(d) => { setDay(d); setWeek(false) }} />

  const dayColumn = (
    <>
      <KcalCard label={`kcal ${day === today ? 'today' : day === addDaysKey(today, -1) ? 'yesterday' : dayTitle(day, today)}`} eaten={totals.kcal} targets={targets} counted={counted} />
      <ProteinRow eaten={totals.protein} minimum={targets.proteinG} />
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
      {day === today && <FridgeSection userId={userId} today={today} />}
      {list.length === 0 ? (
        <p className="card p-4 text-sm text-zinc-500 dark:text-zinc-400">Nothing logged. Tell Claude what you ate, or add it here.</p>
      ) : (
        <ol>{list.map((e, i) => <TimelineEntry key={e.id} entry={e} last={i === list.length - 1} onOpen={() => setSheet({ kind: 'entry', entry: e })} />)}</ol>
      )}
      <QuickAdd userId={userId} day={day} today={today} items={data.items} entries={data.entries}
        onOpenItem={(item) => setSheet({ kind: 'staples', preset: item.id })}
        onNewProduct={(name) => setSheet({ kind: 'item', name })}
        onFreeEntry={() => setSheet({ kind: 'entry' })}
        onAllStaples={() => setSheet({ kind: 'staples' })} />
    </>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Food</h1>
        <span className="flex items-center gap-2">
          <button onClick={() => setSheet({ kind: 'targets' })} aria-label="Edit nutrition targets"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </button>
        </span>
      </div>
      <div className={wide ? 'max-w-md' : undefined}>
        <SegmentTabs label="Food" items={[...SECTIONS]} value={section} onChange={(k) => { setSection(k); setStaples(false) }} />
      </div>

      {section === 'today' && (
        <>
          <DailyGoals targets={targets} />
          {wide ? (
            // Laptop: day on the left, the week always visible on the right (decision 3 November 2026)
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-6">
              <div className="flex flex-col gap-3">{dayColumn}</div>
              <section aria-label="Week" className="flex flex-col gap-3">{weekView}</section>
            </div>
          ) : (
            <>
              <div role="radiogroup" aria-label="Day or week" className="flex self-end rounded-full bg-zinc-200/80 p-0.5 text-xs font-semibold dark:bg-zinc-900">
                {([false, true] as const).map((w) => (
                  <button key={String(w)} role="radio" aria-checked={week === w} onClick={() => setWeek(w)}
                    className={`rounded-full px-3 py-1 ${week === w ? 'bg-white text-accent-ink shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>
                    {w ? 'Week' : 'Day'}
                  </button>
                ))}
              </div>
              {week ? weekView : dayColumn}
            </>
          )}
        </>
      )}
      {section === 'recipes' && <RecipesView userId={userId} />}
      {section === 'kitchen' && !staples && <KitchenView userId={userId} today={today} onStaples={() => setStaples(true)} />}
      {section === 'kitchen' && staples && (
        <>
          <button onClick={() => setStaples(false)} className="self-start text-sm font-semibold text-accent">‹ Kitchen</button>
          <StaplesView items={data.items} onOpen={(item) => setSheet({ kind: 'item', item })} />
        </>
      )}

      {sheet?.kind === 'entry' && <EntrySheet userId={userId} day={day} entry={sheet.entry} staples={data.items} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'staples' && <StaplesSheet userId={userId} day={day} today={today} items={data.items} preset={sheet.preset} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'item' && <ItemSheet userId={userId} item={sheet.item} initialName={sheet.name} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'targets' && <TargetsSheet userId={userId} targets={targets} today={today} onClose={() => setSheet(null)} />}
    </div>
  )
}

/** Status pill in the deficit footer: goal kept, short of the deficit goal, or over the need. */
const PILL = 'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums'

/**
 * Daily goals under the title as three tinted tiles (decision 16 November 2026, design «A»): kcal goal (need minus
 * deficit goal), deficit goal and protein minimum, each in the colour it has in the cards below.
 */
function DailyGoals({ targets }: { targets: NutritionTargets }) {
  const tile = (label: string, value: string, unit: string, tone: string) => (
    <div className={`min-w-0 rounded-2xl border px-3 py-2 ${tone}`}>
      <div className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-[22px] leading-7 font-bold tracking-tight whitespace-nowrap tabular-nums">
        {value}<span className="ml-1 text-xs font-normal tracking-normal text-zinc-500 dark:text-zinc-400">{unit}</span>
      </div>
    </div>
  )
  return (
    <section aria-label="Daily goals">
      <div className="mb-1.5 text-xs font-semibold text-zinc-500 dark:text-zinc-400">Daily goals</div>
      <div className="grid grid-cols-3 gap-2">
        {tile('Calories', num(targets.needKcal - targets.deficitKcal), 'kcal', 'border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-950 dark:bg-blue-950/50')}
        {tile('Deficit', `≥ ${num(targets.deficitKcal)}`, 'kcal', 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400')}
        {tile('Protein', `≥ ${targets.proteinG}`, 'g', 'border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/50 dark:text-emerald-300')}
      </div>
    </section>
  )
}

/**
 * kcal of a day (decision 15 November 2026, design «A», replaces the tiles of the same day): Eaten and Need side by
 * side (the goal value stands only under the title), a bar up to the need with blue = eaten, light blue = eaten over the goal but still below the need (soft, not
 * an alarm), red = eaten over the need (surplus), orange = current deficit up to the need (same colour as the deficit
 * below) and a dashed line at the goal (need minus deficit goal). Separated by a line the deficit against the deficit
 * goal. The goals themselves stand under the title, so the card has no status sentence.
 */
function KcalCard({ label, eaten, targets, counted }: { label: string; eaten: number; targets: NutritionTargets; counted: boolean }) {
  const need = targets.needKcal
  const deficitGoal = targets.deficitKcal
  const goal = need - deficitGoal
  const deficit = need - eaten
  const overGoal = counted && eaten > goal
  const overNeed = counted && eaten > need
  const scale = Math.max(need, eaten)
  const at = (n: number) => Math.max(0, Math.min(100, (n / scale) * 100))
  const stat = (title: string, value: string, tone: string, align: string) => (
    <div className={`min-w-0 ${align}`}>
      <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{title}</div>
      <div className={`text-2xl leading-8 font-bold tracking-tight whitespace-nowrap tabular-nums ${tone}`}>{value}</div>
    </div>
  )
  return (
    <section className="card p-4">
      <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{label}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {stat('Eaten', num(eaten), overNeed ? 'text-red-700 dark:text-red-400' : 'text-blue-700', 'text-left')}
        {stat('Need', num(need), 'text-zinc-500 dark:text-zinc-400', 'text-right')}
      </div>
      <div className="relative mt-3 h-3" role="img" aria-label={`${num(eaten)} kcal eaten, goal ${num(goal)}, need ${num(need)}`}>
        <div className="absolute inset-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          {counted && <>
            <span className="absolute inset-y-0 left-0 bg-blue-600 dark:bg-blue-500" style={{ width: `${at(Math.min(eaten, goal))}%` }} />
            {overGoal && <span className="absolute inset-y-0 bg-blue-300 dark:bg-blue-300/45" style={{ left: `${at(goal)}%`, width: `${at(Math.min(eaten, need)) - at(goal)}%` }} />}
            {overNeed && <span className="absolute inset-y-0 bg-red-600 dark:bg-red-500" style={{ left: `${at(need)}%`, width: `${at(eaten) - at(need)}%` }} />}
            {deficit > 0 && <span className="absolute inset-y-0 right-0 bg-amber-500 dark:bg-amber-400" style={{ left: `${at(eaten)}%` }} />}
          </>}
        </div>
        <span className="absolute -inset-y-1.5 -ml-px border-l-2 border-dashed border-zinc-900 dark:border-zinc-100" style={{ left: `${at(goal)}%` }} aria-hidden="true" />
      </div>
      <div className="relative mt-1.5 h-4 text-[11px] text-zinc-500 dark:text-zinc-400" aria-hidden="true">
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${at(goal)}%` }}>goal</span>
        {at(goal) < 85 && <span className="absolute right-0">need</span>}
      </div>
      {!counted && <div className="mt-1.5 text-sm text-zinc-500">Not counted, the day is not filled in</div>}
      {counted && (
        <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2.5 tabular-nums dark:border-zinc-800">
          {deficit >= 0
            ? <span className="text-sm text-zinc-500 dark:text-zinc-400">Deficit <b className="text-base font-bold text-amber-600 dark:text-amber-400">{num(deficit)}</b> kcal</span>
            : <span className="text-sm text-zinc-500 dark:text-zinc-400">Surplus <b className="text-base font-bold text-red-700 dark:text-red-400">{num(-deficit)}</b> kcal</span>}
          {deficit >= deficitGoal
            ? <span className={`${PILL} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300`}>Goal kept</span>
            : deficit < 0 ? <span className={`${PILL} bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300`}>Over need</span>
            : <span className={`${PILL} bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300`}>{num(deficitGoal - deficit)} short</span>}
        </div>
      )}
    </section>
  )
}

/** Protein of a day as a minimum to reach (decision 15 November 2026); the bar is full at the minimum. */
function ProteinRow({ eaten, minimum }: { eaten: number; minimum: number }) {
  return (
    <section className="card flex items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">Protein</div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-emerald-700/15">
          <div className="h-full rounded-full bg-emerald-600 dark:bg-emerald-400" style={{ width: `${Math.min(100, (eaten / minimum) * 100)}%` }} />
        </div>
      </div>
      <div className="shrink-0 text-2xl font-bold text-emerald-700 tabular-nums dark:text-emerald-300">
        {eaten}<span className="ml-0.5 text-xs font-normal text-zinc-500"> g</span>
      </div>
    </section>
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
          {quantityTag(e) && <span className="ml-1.5 rounded-full bg-indigo-50 px-1.5 py-px align-[1px] text-[11px] font-bold whitespace-nowrap text-indigo-700 tabular-nums dark:bg-indigo-950 dark:text-indigo-300">{quantityTag(e)}</span>}
          {e.source === 'auto' && <span className="ml-1.5 rounded-md bg-zinc-100 px-1.5 py-px align-[1px] text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">daily</span>}
          {e.source === 'claude' && <span className="ml-1.5 rounded-md bg-violet-50 px-1.5 py-px align-[1px] text-[10px] font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">Claude</span>}
        </span>
        {(e.detail || (e.items.length === 1 && perUnitText(e.items[0]!))) && (
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{e.detail || perUnitText(e.items[0]!)}</span>
        )}
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
            <span className="text-sm font-semibold">Protein minimum</span>
            {field(protein, setProtein, (n) => save({ ...draft, proteinG: n }), 'Protein minimum', 'g')}
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
            <span><span className="block text-sm font-semibold">2 espressos with milk</span><span className="block text-xs text-zinc-500">Mon–Fri · 09:30 · 37 kcal · 2 g</span></span>
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

/** Local date and time of a timestamp for the separate date and time fields. */
function localParts(iso: string): { date: string; time: string } {
  return { date: localDay(new Date(iso)), time: time(iso) }
}

function defaultParts(day: string): { date: string; time: string } {
  const now = new Date()
  return day === localDay(now) ? localParts(now.toISOString()) : { date: day, time: '12:00' }
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

/**
 * Add or edit an entry (decision 19 November 2026): «What» names the food, the quantity is its own field. With items,
 * kcal and protein follow the quantities automatically (one item: − / + quantity; several: one amount per ingredient,
 * plus the eaten portions of a meal prep). «Enter values by hand» switches to free values. Date and time are separate.
 */
function EntrySheet({ userId, day, entry, staples, onClose }: { userId: string; day: string; entry?: FoodEntry; staples: FoodItem[]; onClose: () => void }) {
  const start = entry ? localParts(entry.eaten_at) : defaultParts(day)
  const [date, setDate] = useState(start.date)
  const [clock, setClock] = useState(start.time)
  const [category, setCategory] = useState<FoodCategory>(entry?.category ?? categoryAt(new Date(`${start.date}T${start.time}`)))
  const [title, setTitle] = useState(entry?.title ?? '')
  // Items as stored are the base of the proportional calculation, so repeated changes never drift
  const [base, setBase] = useState<FoodEntryItem[]>(entry?.items ?? [])
  const [amounts, setAmounts] = useState<string[]>(() => (entry?.items ?? []).map((i) => { const a = parseAmount(i.amount); return a ? formatQuantity(a.quantity) : '' }))
  const cooked = entry?.portions_cooked ?? null
  const [eaten, setEaten] = useState(entry?.portions_eaten ?? 1)
  const [manual, setManual] = useState(() => !entry || !matchesItems(entry))
  const [kcal, setKcal] = useState(entry ? String(Math.round(entry.kcal)) : '')
  const [protein, setProtein] = useState(entry ? String(entry.protein_g) : '')
  const [adding, setAdding] = useState('')

  const items = base.map((item, i) => {
    const q = Number((amounts[i] ?? '').replace(',', '.'))
    return parseAmount(item.amount) && Number.isFinite(q) && amounts[i] !== '' ? scaleItem(item, q) : item
  })
  const calculable = items.length > 0 && base.every((i) => parseAmount(i.amount) !== null)
  const auto = calculable && !manual
  const computed = entryTotal(items, cooked, cooked && cooked > 1 ? eaten : null)
  const k = auto ? computed.kcal : Number(kcal.replace(',', '.'))
  const p = auto ? computed.protein : Number(protein.replace(',', '.') || '0')
  const valid = (auto || kcal !== '') && Number.isFinite(k) && k >= 0 && Number.isFinite(p) && p >= 0 && date !== '' && clock !== ''
  const changedAmounts = items.some((it, i) => it.amount !== (entry?.items[i]?.amount ?? it.amount)) || items.length !== (entry?.items.length ?? 0)
  const detail = changedAmounts && items.length > 1
    ? `${cooked && cooked > 1 ? `Portion ${eaten} of ${cooked} · ` : ''}${itemsLine(items)}`
    : entry?.detail

  const setAmount = (i: number, value: string) => setAmounts(amounts.map((a, j) => (j === i ? value : a)))
  const stepAmount = (i: number, dir: 1 | -1) => {
    const unit = parseAmount(base[i]!.amount)!.unit
    const step = stepOf(unit)
    const now = Number((amounts[i] ?? '0').replace(',', '.')) || 0
    setAmount(i, formatQuantity(Math.max(step === 1 ? 1 : step, Math.round((now + dir * step) / step) * step)))
  }
  const addStaple = (id: string) => {
    const staple = staples.find((x) => x.id === id)
    if (!staple) return
    const q = staple.basis === '100g' ? 100 : 1
    const v = stapleValues(staple, q)
    setBase([...base, { name: staple.name, food_item_id: staple.id, amount: amountText(staple, q), kcal: v.kcal, protein_g: v.protein, source: 'staple' }])
    setAmounts([...amounts, String(q)])
    if (!entry || base.length === 0) setManual(false)
    if (!title.trim()) setTitle(staple.name)
    setAdding('')
  }
  // A new entry takes its staples off the kitchen stock (decision 19 November 2026); edits do not take again
  const save = () => void saveFoodEntry(userId, { eatenAt: new Date(`${date}T${clock}`).toISOString(), category, title, kcal: k, protein: p, items,
    detail, portionsCooked: cooked, portionsEaten: cooked && cooked > 1 ? eaten : entry?.portions_eaten }, entry)
    .then(() => (entry ? undefined : consumeItems(userId, items, 'meal', null)))
    .then(onClose)
  const [savedRecipe, setSavedRecipe] = useState(false)
  const saveAsRecipe = () => {
    if (!entry) return
    void saveRecipe(recipeFromEntry(userId, entry)).then(() => setSavedRecipe(true))
  }

  return (
    <Sheet title={entry ? 'Edit entry' : 'Add entry'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <CategoryPicker value={category} onChange={setCategory} />
        <Label text="What"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Döner, chicken with rice" className={input} /></Label>

        {items.length === 1 && parseAmount(base[0]!.amount) && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Quantity</span>
            <div className="flex items-center gap-3">
              <Stepper value={amounts[0] ?? ''} onChange={(v) => setAmount(0, v)} onStep={(d) => stepAmount(0, d)} label={base[0]!.name} />
              <span className="min-w-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                {unitLabel(parseAmount(base[0]!.amount)!.unit, Number(amounts[0]) || 0)} · {perUnitText(base[0]!)}
              </span>
            </div>
          </div>
        )}

        {(items.length > 1 || (items.length === 1 && !parseAmount(base[0]!.amount))) && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Ingredients</span>
            <div className="rounded-xl border border-zinc-200 px-3 dark:border-zinc-700">
              {items.map((it, i) => {
                const a = parseAmount(base[i]!.amount)
                return (
                  <div key={i} className="flex items-center justify-between gap-3 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
                    <span className="min-w-0 text-sm">
                      <span className="block truncate">{it.name}{it.source === 'estimate' && <span className="ml-1 text-[11px] text-violet-600 dark:text-violet-400">estimate</span>}</span>
                      <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{Math.round(it.kcal)} kcal · {Math.round(it.protein_g * 10) / 10} g</span>
                    </span>
                    {a ? (
                      <span className="flex shrink-0 items-center gap-1.5">
                        <input inputMode="decimal" aria-label={`${it.name} amount`} value={amounts[i] ?? ''} onChange={(e) => setAmount(i, e.target.value)}
                          className="w-16 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-right text-sm tabular-nums dark:border-zinc-700" />
                        <span className="w-12 truncate text-xs text-zinc-500 dark:text-zinc-400">{unitLabel(a.unit, Number(amounts[i]) || 0)}</span>
                      </span>
                    ) : <span className="shrink-0 text-xs text-zinc-500">{it.amount}</span>}
                  </div>
                )
              })}
              {staples.length > 0 && (
                <select aria-label="Add ingredient" value={adding} onChange={(e) => addStaple(e.target.value)}
                  className="my-1.5 w-full bg-transparent py-1 text-sm font-semibold text-accent">
                  <option value="">+ Add ingredient</option>
                  {staples.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}

        {cooked !== null && cooked > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Portions</span>
            <Stepper value={String(eaten)} onChange={(v) => setEaten(Math.min(cooked, Math.max(1, Number(v) || 1)))} onStep={(d) => setEaten(Math.min(cooked, Math.max(1, eaten + d)))} label="Portions" />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">of {cooked} cooked</span>
          </div>
        )}

        {items.length === 0 && staples.length > 0 && (
          <select aria-label="Add from staples" value={adding} onChange={(e) => addStaple(e.target.value)} className={`${input} text-zinc-600 dark:text-zinc-300`}>
            <option value="">From staples (optional)</option>
            {staples.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        )}

        <div className="grid grid-cols-2 gap-2">
          {auto ? (
            <>
              <Label text="kcal · auto"><span className={`${input} border-dashed bg-zinc-50 dark:bg-zinc-900`}>{num(computed.kcal)}</span></Label>
              <Label text="Protein g · auto"><span className={`${input} border-dashed bg-zinc-50 dark:bg-zinc-900`}>{Math.round(computed.protein)}</span></Label>
            </>
          ) : (
            <>
              <Label text="kcal"><input inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} className={input} /></Label>
              <Label text="Protein g"><input inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} className={input} /></Label>
            </>
          )}
        </div>
        {calculable && (
          <button type="button" onClick={() => { if (auto) { setKcal(String(computed.kcal)); setProtein(String(computed.protein)) } setManual(auto) }}
            className="-mt-1 self-start text-xs font-semibold text-accent">
            {auto ? 'Enter values by hand' : 'Calculate from quantities'}
          </button>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Label text="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} /></Label>
          <Label text="Time"><input type="time" value={clock} onChange={(e) => setClock(e.target.value)} className={`${input} w-32`} /></Label>
        </div>
        <div className="mt-1 flex gap-2">
          {entry && <button onClick={() => void deleteFoodEntry(entry).then(onClose)} className="rounded-lg px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-400">Delete</button>}
          {entry && entry.items.length > 0 && (
            <button disabled={savedRecipe} onClick={saveAsRecipe} className="rounded-lg px-3 py-2 text-sm font-semibold text-accent disabled:text-emerald-700 dark:disabled:text-emerald-400">
              {savedRecipe ? 'Saved as recipe' : 'Save as recipe'}
            </button>
          )}
          <button disabled={!valid} onClick={save} className="ml-auto rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-fg disabled:opacity-40">Save</button>
        </div>
      </div>
    </Sheet>
  )
}

/** Number field with − and + around it. */
function Stepper({ value, onChange, onStep, label }: { value: string; onChange: (v: string) => void; onStep: (dir: 1 | -1) => void; label: string }) {
  const btn = 'h-9 w-9 text-lg font-semibold text-accent'
  return (
    <span className="flex shrink-0 items-center overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
      <button type="button" aria-label={`Less ${label}`} onClick={() => onStep(-1)} className={btn}>−</button>
      <input inputMode="decimal" aria-label={`${label} quantity`} value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 w-14 border-x border-zinc-200 bg-transparent text-center text-sm font-semibold tabular-nums dark:border-zinc-700" />
      <button type="button" aria-label={`More ${label}`} onClick={() => onStep(1)} className={btn}>+</button>
    </span>
  )
}

function StaplesSheet({ userId, day, today, items: all, preset, onClose }: { userId: string; day: string; today: string; items: FoodItem[]; preset?: string; onClose: () => void }) {
  const [now] = useState(() => new Date())
  const [first, setFirst] = useState<PortionSlot>(() => ({ day, category: day === today ? categoryAt(now) : 'lunch' }))
  // Opened from a favourite or a search hit: that staple first with one unit filled in
  const presetItem = all.find((i) => i.id === preset)
  const [amounts, setAmounts] = useState<Record<string, string>>(() => (presetItem ? { [presetItem.id]: String(oneUnit(presetItem)) } : {}))
  const items = presetItem ? [presetItem, ...all.filter((i) => i.id !== presetItem.id)] : all
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
  // Staples come off the kitchen stock once for everything cooked
  const save = () => void saveFoodEntries(userId, drafts).then(() => consumeItems(userId, drafts[0]?.items ?? [], 'meal', null)).then(onClose)
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

function ItemSheet({ userId, item, initialName, onClose }: { userId: string; item?: FoodItem; initialName?: string; onClose: () => void }) {
  const [name, setName] = useState(item?.name ?? initialName ?? '')
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
        {/* Package and nutrition label photos (decision 22 November 2026), possible once the staple is saved */}
        {item ? <ProductPhotos userId={userId} foodItemId={item.id} name={item.name} /> : <p className="text-xs text-zinc-500 dark:text-zinc-400">Photos of the package and the nutrition label can be added after saving.</p>}
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

/** Search with «+» for a new product, favourites below (decision 22 November 2026, variant B). «+» on a row adds one
 * unit at once with undo, the name opens the amount sheet. Recipes in the search log one portion. */
function QuickAdd({ userId, day, today, items, entries, onOpenItem, onNewProduct, onFreeEntry, onAllStaples }: {
  userId: string
  day: string
  today: string
  items: FoodItem[]
  entries: FoodEntry[]
  onOpenItem: (item: FoodItem) => void
  onNewProduct: (name: string) => void
  onFreeEntry: () => void
  onAllStaples: () => void
}) {
  const [query, setQuery] = useState('')
  const recipes = useLiveQuery(() => db.recipe.toArray(), []) ?? []
  const packs = useLiveQuery(async () => {
    const map = new Map<string, FoodPhoto>()
    for (const p of await db.food_photo.toArray()) if (p.kind === 'pack' && p.food_item_id && p.deleted_at === null && !map.has(p.food_item_id)) map.set(p.food_item_id, p)
    return map
  }, [])
  const fav = favourites(entries, items, today)
  const hits = searchFood(query, items, recipes)
  const searching = query.trim() !== ''

  const add = async (item: FoodItem) => {
    const undo = await quickAdd(userId, item, day)
    offerUndo(`Added ${item.name.split(',')[0]} · ${basisText(item)}`, item.id, undo)
  }
  const addRecipe = async (r: Recipe) => {
    await quickAddRecipe(userId, r, day)
    offerUndo(`Logged 1 portion · ${r.name}`, r.id)
    setQuery('')
  }
  const row = (item: FoodItem) => (
    <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
      {packs?.get(item.id) && <FoodPhotoImg photo={packs.get(item.id)!} alt="" className="h-9 w-9 shrink-0 rounded-lg" />}
      <button onClick={() => onOpenItem(item)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-semibold">{item.name}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{basisText(item)}{item.store ? ` · ${item.store}` : ''}</span>
      </button>
      <button onClick={() => void add(item)} aria-label={`Add ${item.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl text-accent-ink">+</button>
    </li>
  )

  return (
    <section aria-label="Add food" className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-300 bg-white px-3 focus-within:border-accent dark:border-zinc-700 dark:bg-zinc-900">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search food or recipe" aria-label="Search food or recipe"
            className="min-w-0 flex-1 bg-transparent text-base outline-none" />
        </label>
        <button onClick={() => onNewProduct(query.trim())} aria-label="New product" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-2xl font-light text-accent-fg">+</button>
      </div>
      {searching ? (
        <div className="card overflow-hidden">
          {hits.items.length > 0 && <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{hits.items.slice(0, 8).map(row)}</ul>}
          {hits.recipes.length > 0 && (
            <>
              <div className="px-3 pt-2.5 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Recipes</div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {hits.recipes.slice(0, 5).map((r) => {
                  const p = perPortion(r)
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{r.name}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">1 portion · {num(p.kcal)} kcal · {Math.round(p.protein)} g</span>
                      </span>
                      <button onClick={() => void addRecipe(r)} aria-label={`Log 1 portion of ${r.name}`} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xl text-accent-ink">+</button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          <button onClick={() => onNewProduct(query.trim())} className="flex w-full items-center gap-3 border-t border-zinc-100 px-3 py-3 text-left text-sm font-semibold text-accent dark:border-zinc-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-xl text-accent-ink">+</span>
            New product «{query.trim()}»
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between px-0.5 pt-1">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Favourites</h3>
            <span className="text-xs text-zinc-400">most added, {60} days</span>
          </div>
          {fav.length > 0
            ? <ul className="card divide-y divide-zinc-100 overflow-hidden dark:divide-zinc-800">{fav.map(row)}</ul>
            : <p className="card p-3 text-sm text-zinc-500 dark:text-zinc-400">Staples you add often appear here.</p>}
          <div className="flex justify-between px-0.5 text-sm">
            <button onClick={onAllStaples} className="font-semibold text-accent">Several staples</button>
            <button onClick={onFreeEntry} className="font-semibold text-accent">Free entry</button>
          </div>
        </>
      )}
    </section>
  )
}
