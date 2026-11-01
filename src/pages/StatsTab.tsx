import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Heatmap, Sparkline } from '../components/Charts'
import Popover from '../components/Popover'
import { CROWD_LABEL, CROWD_SLOTS, WEEKDAYS, crowdGrid, loadAnalytics, weeklyGoal, type AnalyticsData } from '../lib/analytics'
import { bodyWeightSeries, todayLocal, type BodyWeightPoint } from '../lib/body'
import { CALIBRATION_DAYS, PROTEIN_TARGET_G, addDaysKey, byDay, kcalTarget, loadFood, localDay, totalsOf, weekRows } from '../lib/food'
import { MONTHS, dayOffset, goalProgress, roughDate, weightForecast, type Forecast } from '../lib/forecast'
import { loadPlanProgress, type PlanProgressRow, type ProgressStatus } from '../lib/planProgress'
import { formatMinutes, formatTopSet, workoutReports, type WorkoutReport } from '../lib/report'
import { DEFAULT_WEEKLY_GOAL, getGoalWeight, getWeeklyGoal, saveGoalWeight, saveWeeklyGoal, type WeeklyGoal } from '../lib/settings'
import { formatDuration, paceSeconds } from '../lib/workout'
import { ChangeChips, ReportView } from './ReportPage'

// Stats as one overview (decision 1 November 2026): goal weight with forecast, progression of the current plan,
// training summary, latest reports and the gym crowd (collapsed). Two and three columns on wide screens.

const DAY = 86_400_000

function Card({ title, aside, className = '', children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <span className="text-xs text-zinc-500 dark:text-zinc-400">{aside}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
}

function Tile({ label, value, unit, sub, tone }: { label: string; value: string; unit?: string; sub?: ReactNode; tone?: 'green' }) {
  return (
    <div className="min-w-0 rounded-xl bg-zinc-100 p-3 dark:bg-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-0.5 text-2xl leading-tight font-semibold tracking-tight tabular-nums ${tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
        {value}{unit && <span className="ml-1 text-xs font-normal tracking-normal text-zinc-500 dark:text-zinc-400">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  )
}

export default function StatsTab({ userId }: { userId: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const [allReports, setAllReports] = useState(false)
  // Fixed per visit of the tab, so all cards use the same reference time
  const [now] = useState(() => new Date())

  if (open) return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <button onClick={() => setOpen(null)} className="self-start rounded-lg bg-zinc-200/70 px-3 py-1.5 text-sm font-semibold dark:bg-zinc-800">‹ {allReports ? 'Reports' : 'Stats'}</button>
      <ReportView workoutId={open} />
    </div>
  )
  if (allReports) return (
    <div className="mx-auto flex max-w-xl flex-col gap-3">
      <button onClick={() => setAllReports(false)} className="self-start rounded-lg bg-zinc-200/70 px-3 py-1.5 text-sm font-semibold dark:bg-zinc-800">‹ Stats</button>
      <ReportList onOpen={setOpen} />
    </div>
  )
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
      <GoalWeightCard userId={userId} className="lg:col-span-3" />
      <ProgressionCard now={now} className="lg:col-span-3" />
      <TrainingCard userId={userId} now={now} />
      <NutritionCard />
      <ReportList limit={3} onOpen={setOpen} onAll={() => setAllReports(true)} />
      <CrowdCard className="lg:col-span-3" />
    </div>
  )
}

// --- goal weight and forecast ----------------------------------------------------------------

type ChartRange = '1m' | '3m' | '6m' | 'all'
const CHART_RANGES: { key: ChartRange; label: string; days: number | null }[] = [
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 91 },
  { key: '6m', label: '6m', days: 182 },
  { key: 'all', label: 'All', days: null },
]

/** Weigh-ins that count for the trend: morning fasted or without a condition. */
function trendPoints(series: BodyWeightPoint[]) {
  return series
    .filter((p) => p.entry.condition === null || p.entry.condition === 'morning_fasted')
    .map((p) => ({ date: p.entry.measured_on, kg: p.entry.weight_kg }))
}

function addDays(date: string, days: number): Date {
  return new Date(Date.parse(`${date}T12:00:00`) + days * DAY)
}

function GoalWeightCard({ userId, className }: { userId: string; className?: string }) {
  const series = useLiveQuery(bodyWeightSeries, [])
  const goal = useLiveQuery(getGoalWeight, [])
  const [editing, setEditing] = useState(false)
  const [range, setRange] = useState<ChartRange>('3m')
  if (series === undefined || goal === undefined) return null
  const today = todayLocal()
  const latest = series[0]
  const first = series[series.length - 1]

  if (!latest || !first) return (
    <Card title="Body weight" className={className}><Empty>Log your weight in Body to see the trend and a forecast.</Empty></Card>
  )

  const now = latest.avg7
  const forecast = weightForecast(trendPoints(series), today, goal)
  const editor = editing && <GoalWeightEditor value={goal ?? Math.round(now)} onSave={(kg) => void saveGoalWeight(userId, kg).then(() => setEditing(false))} onCancel={() => setEditing(false)} />
  const editButton = (
    <button onClick={() => setEditing(true)} className="ml-2 rounded-lg border border-zinc-200 px-2 py-0.5 align-middle text-sm font-semibold tracking-normal text-accent-ink dark:border-zinc-700">
      {goal === null ? 'Set goal' : 'Edit'}
    </button>
  )
  const startDate = new Date(`${first.entry.measured_on}T12:00:00`)
  const expected = !forecast ? 'more weigh-ins needed'
    : forecast.goalInDays === null ? 'not on the current trend'
      : roughDate(addDays(today, forecast.goalInDays), addDays(today, 0))

  return (
    <section className={`card grid gap-5 p-4 lg:grid-cols-[320px_1fr] lg:items-center lg:p-6 ${className}`}>
      <div>
        <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{goal === null ? 'Body weight' : 'Goal'}</div>
        <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums lg:text-4xl">
          {now.toFixed(1)}
          {goal !== null && <><span className="mx-1.5 font-normal text-zinc-400">→</span>{goal} kg</>}
          {goal === null && <span className="ml-1 text-base font-normal text-zinc-500">kg</span>}
          {editButton}
        </div>
        {editor}
        {goal !== null && (
          <>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {Math.abs(now - goal).toFixed(1)} kg to go · {goalProgress(first.entry.weight_kg, now, goal)} % done since {shortDay.format(startDate)}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-emerald-700 dark:bg-emerald-500" style={{ width: `${goalProgress(first.entry.weight_kg, now, goal)}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
                {goal} kg expected
                <Popover hover ariaLabel="About the forecast" label={<span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">i</span>}>
                  <span className="block w-60 text-left text-sm leading-snug">
                    Line: trend of your morning weigh-ins of the last 4 weeks. Grey area: 80 % range of that trend; it narrows with more weigh-ins.
                  </span>
                </Popover>
              </span>
              <span className="font-semibold">{expected}</span>
            </div>
          </>
        )}
        <p className="sr-only">7-day average {now.toFixed(1)} kg</p>
      </div>
      <div>
        <div role="radiogroup" aria-label="Time range" className="mb-2 grid grid-cols-4 gap-1 rounded-lg bg-zinc-100 p-1 lg:ml-auto lg:w-56 dark:bg-zinc-800">
          {CHART_RANGES.map((r) => (
            <button key={r.key} role="radio" aria-checked={range === r.key} onClick={() => setRange(r.key)}
              className={`rounded-md py-1 text-xs ${range === r.key ? 'bg-white font-semibold shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {r.label}
            </button>
          ))}
        </div>
        <WeightGoalChart series={series} goal={goal} forecast={forecast} today={today} rangeDays={CHART_RANGES.find((r) => r.key === range)!.days} />
      </div>
    </section>
  )
}

function GoalWeightEditor({ value, onSave, onCancel }: { value: number; onSave: (kg: number) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(String(value))
  const kg = Number(draft.replace(',', '.'))
  const valid = Number.isFinite(kg) && kg >= 30 && kg <= 300
  return (
    <div className="mt-3 flex items-center gap-2">
      <input aria-label="Goal weight in kg" inputMode="decimal" value={draft} onChange={(e) => setDraft(e.target.value)}
        className="w-24 rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-zinc-700" />
      <span className="text-sm text-zinc-500">kg</span>
      <button onClick={onCancel} className="ml-auto rounded-lg px-3 py-1.5 text-sm">Cancel</button>
      <button disabled={!valid} onClick={() => onSave(kg)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-40">Save</button>
    </div>
  )
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/**
 * 7-day average, trend of the last 4 weeks up to the goal and the 80 % band to the right edge, clipped at the goal
 * (decisions 1 November 2026). The goal line is the bottom of the chart; month ticks on the axis.
 */
function WeightGoalChart({ series, goal, forecast, today, rangeDays }: {
  series: BodyWeightPoint[]
  goal: number | null
  forecast: Forecast | null
  today: string
  rangeDays: number | null
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const height = width < 500 ? 160 : 200
  const history = [...series].reverse().map((p) => ({ x: dayOffset(p.entry.measured_on, today), y: p.avg7 }))
  const firstX = history[0]!.x
  const x0 = rangeDays === null ? firstX : Math.max(firstX, -rangeDays)
  const goalX = forecast?.goalInDays ?? null
  const x1 = forecast ? Math.min(240, goalX !== null ? goalX + 42 : 60) : 7
  const shown = history.filter((p) => p.x >= x0)
  const values = [...shown.map((p) => p.y), ...(forecast ? [forecast.at(0) + forecast.band(0)] : [])]
  const lo = goal !== null && goal <= Math.min(...values) ? goal : Math.floor(Math.min(...values) - 0.5)
  const hi = Math.ceil(Math.max(...values) + 0.3)
  const pl = 30
  const pr = goal !== null ? 50 : 12
  const pt = 8
  const pb = 22
  const X = (x: number) => pl + ((x - x0) / Math.max(1, x1 - x0)) * (width - pl - pr)
  const Y = (y: number) => pt + ((hi - y) / Math.max(0.1, hi - lo)) * (height - pt - pb)
  const clampY = (y: number) => Math.min(hi, Math.max(lo, y))

  const ticks: number[] = []
  for (let v = Math.ceil(lo / 2) * 2; v <= hi; v += 2) if (goal === null || v - goal >= 1) ticks.push(v)
  const months: { x: number; label: string }[] = []
  const start = addDays(today, x0)
  for (let d = new Date(start.getFullYear(), start.getMonth() + (start.getDate() === 1 ? 0 : 1), 1); ; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const x = Math.round((d.getTime() - Date.parse(`${today}T00:00:00`)) / DAY)
    if (x > x1) break
    months.push({ x, label: MONTHS[d.getMonth()]! })
  }
  const axisY = goal !== null ? Y(goal) : height - pb

  let band = ''
  let trend = ''
  if (forecast && width > 0) {
    const steps = 40
    const xs = Array.from({ length: steps + 1 }, (_, i) => (x1 * i) / steps)
    const upper = xs.map((x) => `${X(x).toFixed(1)},${Y(clampY(forecast.at(x) + forecast.band(x))).toFixed(1)}`)
    const lower = xs.map((x) => `${X(x).toFixed(1)},${Y(clampY(forecast.at(x) - forecast.band(x))).toFixed(1)}`).reverse()
    band = [...upper, ...lower].join(' ')
    const end = goalX !== null ? Math.min(goalX, x1) : x1
    trend = `${X(0).toFixed(1)},${Y(clampY(forecast.at(0))).toFixed(1)} ${X(end).toFixed(1)},${Y(clampY(forecast.at(end))).toFixed(1)}`
  }
  const last = history[history.length - 1]!

  return (
    <div ref={ref} className="w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Body weight, 7-day average, with trend and goal">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={pl} x2={width - pr} y1={Y(v)} y2={Y(v)} stroke="var(--viz-grid)" strokeWidth={0.8} />
              <text x={pl - 6} y={Y(v) + 3.5} fontSize={10} textAnchor="end" fill="var(--viz-muted)">{v}</text>
            </g>
          ))}
          {band && <polygon points={band} fill="var(--viz-muted)" fillOpacity={0.16} />}
          {goal === null && <line x1={pl} x2={width - pr} y1={axisY} y2={axisY} stroke="var(--viz-grid)" />}
          {months.map((m) => (
            <g key={m.x}>
              <line x1={X(m.x)} x2={X(m.x)} y1={axisY} y2={axisY + 5} stroke="var(--viz-muted)" />
              <text x={X(m.x)} y={height - 4} fontSize={10} textAnchor="middle" fill="var(--viz-muted)">{m.label}</text>
            </g>
          ))}
          <polyline fill="none" stroke="var(--viz-s1)" strokeWidth={2.4} strokeLinejoin="round" points={shown.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')} />
          {trend && <polyline fill="none" stroke="var(--viz-s1)" strokeOpacity={0.5} strokeWidth={2} points={trend} />}
          <circle cx={X(last.x)} cy={Y(last.y)} r={4} fill="var(--viz-s1)" />
          {goal !== null && (
            <g className="text-emerald-700 dark:text-emerald-400">
              <line x1={pl} x2={width - pr} y1={axisY} y2={axisY} stroke="currentColor" strokeWidth={1.2} />
              <text x={width - pr + 6} y={axisY + 4} fontSize={11} fontWeight={600} fill="currentColor">{goal} kg</text>
              {goalX !== null && goalX <= x1 && <circle cx={X(goalX)} cy={axisY} r={4} fill="var(--viz-surface)" stroke="currentColor" strokeWidth={2} />}
            </g>
          )}
        </svg>
      )}
    </div>
  )
}

// --- progression ----------------------------------------------------------------------------

const STATUS: Record<ProgressStatus, { label: string; className: string }> = {
  strong: { label: 'Strong', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  good: { label: 'Good', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  stalled: { label: 'Stalled', className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  flat: { label: 'Flat', className: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' },
  lower: { label: 'Lower', className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  new: { label: 'New', className: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
}

const shortDay = { format: (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}` }

function changeText(r: PlanProgressRow): string {
  if (r.status === 'stalled' && r.since) return `since ${shortDay.format(new Date(r.since))}`
  if (!r.latest) return 'first workout'
  if (r.changePct === null) return ''
  return r.changePct === 0 ? '±0 %' : `${r.changePct > 0 ? '+' : '−'}${Math.abs(r.changePct)} %`
}

function ProgressionCard({ now, className }: { now: Date; className?: string }) {
  const rows = useLiveQuery(() => loadPlanProgress(now), [now])
  if (rows === undefined) return null
  return (
    <Card title="Progression" aside={<><span className="hidden sm:inline">Top set per workout · current plan · </span>since start</>} className={className}>
      {rows.length === 0 ? <Empty>No exercises in the active workouts.</Empty> : (
        <table className="w-full text-[13px] tabular-nums">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <th className="py-1.5 pr-2 font-medium">Exercise</th>
              <th className="px-1 py-1.5 font-medium">Start</th>
              <th className="px-1 py-1.5 font-medium">Today</th>
              <th className="hidden px-1 py-1.5 font-medium sm:table-cell">Trend</th>
              <th className="hidden px-1 py-1.5 text-right font-medium sm:table-cell">Change</th>
              <th className="py-1.5 pl-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mainId} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                <td className="py-2 pr-2">
                  <span className="block font-semibold">{r.title}</span>
                  {r.subtitle && <span className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">{r.subtitle}</span>}
                </td>
                <td className="px-1 py-2 whitespace-nowrap text-zinc-500 dark:text-zinc-400">{r.first && r.series.length > 1 ? formatTopSet(r.first, r.unilateral) : '–'}</td>
                <td className="px-1 py-2 font-semibold whitespace-nowrap">{r.latest ? formatTopSet(r.latest, r.unilateral) : '–'}</td>
                <td className="hidden px-1 py-2 sm:table-cell">{r.series.length > 1 ? <Sparkline values={r.series} width={110} height={26} /> : <span className="text-zinc-400">–</span>}</td>
                <td className="hidden px-1 py-2 text-right whitespace-nowrap text-zinc-500 sm:table-cell dark:text-zinc-400">{changeText(r)}</td>
                <td className="py-2 pl-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[r.status].className}`}>{STATUS[r.status].label}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  )
}

// --- training ---------------------------------------------------------------------------------

function TrainingCard({ userId, now }: { userId: string; now: Date }) {
  const data = useLiveQuery(loadAnalytics, [])
  const goal = useLiveQuery(getWeeklyGoal, []) ?? DEFAULT_WEEKLY_GOAL
  const [editing, setEditing] = useState(false)
  if (data === undefined) return null
  const strength = data.workouts.filter((w) => w.strength).sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const first = strength[0]
  if (!first) return <Card title="Training"><Empty>No finished workouts yet.</Empty></Card>
  const weeks = Math.max(1, Math.ceil((now.getTime() - Date.parse(first.startedAt)) / (7 * DAY)))
  const summary = weeklyGoal(data.workouts, weeks, now, goal)
  const met = summary.weeks.filter((w) => w.met).length
  const minutes = strength.map((w) => (Date.parse(w.finishedAt) - Date.parse(w.startedAt)) / 60_000).filter((m) => m > 0)
  const avg = minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null
  const since = new Date(first.startedAt)
  return (
    <Card title="Training" aside={`since ${shortDay.format(since)}`}>
      <div className="grid grid-cols-2 gap-2.5">
        <Tile label="Training since" value={shortDay.format(since)} sub={`${weeks} ${weeks === 1 ? 'week' : 'weeks'}`} />
        <Tile label="Workouts" value={String(strength.length)} sub="finished" />
        <Tile label="Per week" value={(strength.length / weeks).toFixed(1)} sub={
          <button onClick={() => setEditing(true)} className="text-left underline decoration-dotted underline-offset-2">{met} of {weeks} weeks at goal ({goal.strength})</button>
        } />
        <Tile label="Avg duration" value={avg === null ? '–' : String(avg)} unit={avg === null ? undefined : 'min'} />
      </div>
      {editing && <WeeklyGoalEditor goal={goal} onSave={(g) => void saveWeeklyGoal(userId, g).then(() => setEditing(false))} onCancel={() => setEditing(false)} />}
    </Card>
  )
}

function Stepper({ label, value, min, max, format, onChange }: {
  label: string
  value: number
  min: number
  max: number
  format: (n: number) => string
  onChange: (n: number) => void
}) {
  const btn = 'h-9 w-9 rounded-md bg-zinc-100 text-lg disabled:opacity-30 dark:bg-zinc-800'
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`${label} minus`} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>−</button>
        <span className="w-16 text-center text-sm font-semibold tabular-nums">{format(value)}</span>
        <button type="button" aria-label={`${label} plus`} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>+</button>
      </div>
    </div>
  )
}

function WeeklyGoalEditor({ goal, onSave, onCancel }: { goal: WeeklyGoal; onSave: (g: WeeklyGoal) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(goal)
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-xl bg-zinc-100/70 p-3 dark:bg-zinc-800/60">
      <Stepper label="Strength per week" value={draft.strength} min={1} max={7} format={String} onChange={(n) => setDraft({ ...draft, strength: n })} />
      <Stepper label="Runs per week" value={draft.run} min={0} max={7} format={(n) => (n === 0 ? 'optional' : String(n))} onChange={(n) => setDraft({ ...draft, run: n })} />
      <div className="mt-1 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-lg py-2 text-sm">Cancel</button>
        <button onClick={() => onSave(draft)} className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg">Save</button>
      </div>
    </div>
  )
}

// --- nutrition ------------------------------------------------------------------------------

function NutritionCard() {
  const data = useLiveQuery(loadFood, [])
  const weights = useLiveQuery(bodyWeightSeries, [])
  if (data === undefined || weights === undefined) return null
  const today = localDay(new Date(`${todayLocal()}T12:00:00`))
  const days = byDay(data.entries)
  const last7 = [...days.entries()].filter(([k]) => k <= today && k > addDaysKey(today, -7)).map(([, list]) => totalsOf(list))
  const avg = (f: (t: { kcal: number; protein: number }) => number) => Math.round(last7.reduce((s, t) => s + f(t), 0) / Math.max(1, last7.length))
  const target = kcalTarget(data.entries, weights.map((p) => ({ date: p.entry.measured_on, kg: p.entry.weight_kg })), today)
  const cheat = weekRows(data.entries, today).reduce((s, r) => s + r.cheat, 0)
  return (
    <Card title="Nutrition" aside="last 7 days">
      {last7.length === 0 ? <Empty>No entries yet. Log meals in Food or tell Claude.</Empty> : (
        <div className="grid grid-cols-2 gap-2.5">
          <Tile label="Avg kcal" value={String(avg((t) => t.kcal))} sub={`target ${target.kcal}${target.kind === 'start' ? ' (start)' : ''}`} />
          <Tile label="Avg protein" value={String(avg((t) => t.protein))} unit="g" sub={`goal ≥ ${PROTEIN_TARGET_G} g`} tone={avg((t) => t.protein) >= PROTEIN_TARGET_G ? 'green' : undefined} />
          <Tile label="Cheat meals" value={String(cheat)} sub="this week" />
          <Tile label="Days logged" value={String(last7.length)} unit="/ 7" sub={target.kind === 'start' ? `${Math.min(target.daysLogged, CALIBRATION_DAYS)}/${CALIBRATION_DAYS} for your target` : 'target from your data'} />
        </div>
      )}
    </Card>
  )
}

// --- reports ------------------------------------------------------------------------------------

const monthShort = { format: (d: Date) => MONTHS[d.getMonth()]! }

function ReportRow({ report: r, onOpen }: { report: WorkoutReport; onOpen: (id: string) => void }) {
  const t = r.totals
  const d = new Date(r.workout.started_at)
  const pace = paceSeconds(t.runS, t.distanceKm)
  return (
    <button onClick={() => onOpen(r.workout.id)} className="flex w-full items-center gap-3 border-b border-zinc-100 py-2.5 text-left last:border-0 dark:border-zinc-800">
      <span className="w-10 shrink-0 rounded-lg bg-zinc-100 py-1 text-center dark:bg-zinc-800">
        <span className="block text-[15px] leading-tight font-semibold tabular-nums">{d.getDate()}</span>
        <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">{monthShort.format(d)}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{r.name}</span>
        <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
          {r.kind === 'run'
            ? `${t.distanceKm.toFixed(1)} km · ${formatDuration(t.runS)}${pace !== null ? ` · ${formatDuration(pace)} /km` : ''}`
            : `${formatMinutes(t.durationS)} · ${t.sets} sets`}
        </span>
      </span>
      {r.kind === 'strength' && <ChangeChips report={r} />}
    </button>
  )
}

function ReportList({ limit, onOpen, onAll, className = '' }: { limit?: number; onOpen: (id: string) => void; onAll?: () => void; className?: string }) {
  const reports = useLiveQuery(workoutReports, [])
  if (reports === undefined) return null
  const shown = limit ? reports.slice(0, limit) : reports
  return (
    <Card title="Workout reports" className={className}
      aside={onAll && reports.length > shown.length ? <button onClick={onAll} className="font-medium">All {reports.length} ›</button> : `${reports.length} workouts`}>
      {shown.length === 0 ? <Empty>No finished workouts yet.</Empty> : shown.map((r) => <ReportRow key={r.workout.id} report={r} onOpen={onOpen} />)}
    </Card>
  )
}

// --- gym crowd ----------------------------------------------------------------------------------

function CrowdCard({ className = '' }: { className?: string }) {
  const data = useLiveQuery(loadAnalytics, [])
  if (data === undefined) return null
  return <CrowdDetails data={data} className={className} />
}

function CrowdDetails({ data, className }: { data: AnalyticsData; className: string }) {
  const grid = crowdGrid(data.workouts, 0)
  const slot = (i: number) => CROWD_SLOTS[i]!.label
  const quietest = grid.best ? `quietest so far: ${WEEKDAYS[grid.best.weekday]} ${slot(grid.best.slot)}` : ''
  return (
    <details className={`card group p-4 ${className}`}>
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-sm font-semibold">Gym crowd</span>
          <span className="hidden truncate text-xs text-zinc-500 sm:inline dark:text-zinc-400">{quietest}</span>
        </span>
        <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400"><span className="group-open:hidden">Show ›</span><span className="hidden group-open:inline">Hide</span></span>
      </summary>
      <div className="mt-3">
        {grid.ratings === 0 ? <Empty>No ratings yet. Rate the crowd at the end of a workout.</Empty> : (
          <>
            <Heatmap
              rows={[...WEEKDAYS]}
              cols={CROWD_SLOTS.map((s) => s.label)}
              legend={['Empty', 'Packed']}
              cells={grid.cells.map((row) =>
                row.map((c) => ({
                  key: `${c.weekday}-${c.slot}`,
                  level: c.avg === null ? null : Math.min(5, Math.max(1, Math.ceil(c.avg / 2))),
                  text: c.avg === null ? '' : c.avg.toFixed(1).replace(/\.0$/, ''),
                  tooltip: c.avg === null
                    ? `${WEEKDAYS[c.weekday]} ${slot(c.slot)}: no ratings`
                    : `${WEEKDAYS[c.weekday]} ${slot(c.slot)}: ${c.avg.toFixed(1)} (${CROWD_LABEL[Math.round(c.avg)]}), ${c.count} ${c.count === 1 ? 'rating' : 'ratings'}`,
                })),
              )}
            />
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {grid.ratings} {grid.ratings === 1 ? 'rating' : 'ratings'}, 1 = empty, 10 = packed. Times are when the workout was finished.
            </p>
          </>
        )}
      </div>
    </details>
  )
}
