import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import { ColumnChart, GoalColumns, Heatmap, HBarChart, LineChart, SideChart, Sparkline } from '../components/Charts'
import Popover from '../components/Popover'
import { formatShortDate } from '../lib/chart'
import { readyToIncrease } from '../lib/progression'
import { DEFAULT_WEEKLY_GOAL, getWeeklyGoal, saveWeeklyGoal, type WeeklyGoal } from '../lib/settings'
import {
  CROWD_LABEL,
  CROWD_SLOTS,
  RANGE_LABEL,
  WEEKDAYS,
  crowdGrid,
  dayKey,
  loadAnalytics,
  muscleLabel,
  rangeStart,
  setsPerMuscle,
  sideComparison,
  progressOverview,
  progressSeries,
  weekStart,
  weeklyGoal,
  weeklyVolume,
  type AnalyticsData,
  type GoalWeek,
  type Metric,
  type Range,
} from '../lib/analytics'

const RANGES: Range[] = ['1m', '3m', '1y', 'all']
// Columns show the last 12 weeks, the day calendar the last 4
const GOAL_WEEKS = 12
const CALENDAR_WEEKS = 4

function kg(v: number): string {
  return `${Math.round(v).toLocaleString('en-GB')} kg`
}

function compactKg(v: number): string {
  return v >= 1000 ? `${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k` : String(Math.round(v))
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="relative card p-4">
      <h2 className="pr-14 font-semibold">{title}</h2>
      {subtitle && <p className="pr-14 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-zinc-500 dark:text-zinc-400">{children}</p>
}

export default function StatsTab({ userId }: { userId: string }) {
  const data = useLiveQuery(loadAnalytics, [])
  const [range, setRange] = useState<Range>('3m')
  // Fixed per visit of the tab, so all cards use the same reference time
  const [now] = useState(() => new Date())

  if (data === undefined) return <p className="text-zinc-500">Loading …</p>
  if (data.workouts.length === 0) return <Empty>No finished workouts yet.</Empty>

  const from = rangeStart(range, now, data.workouts)

  return (
    <div className="flex flex-col gap-4">
      <GoalCard data={data} now={now} userId={userId} />

      <div role="radiogroup" aria-label="Time range" className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
        {RANGES.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={range === r}
            onClick={() => setRange(r)}
            className={`rounded-md py-1.5 text-xs font-semibold ${
              range === r ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      <ReadyCard />
      <StrengthCard data={data} from={from} />
      <VolumeCard data={data} from={from} now={now} />
      <MuscleCard data={data} now={now} />
      <SideCard data={data} from={from} />
      <CrowdCard data={data} from={from} />
    </div>
  )
}

// --- weekly goal ----------------------------------------------------------------------

function GoalCard({ data, now, userId }: { data: AnalyticsData; now: Date; userId: string }) {
  const goal = useLiveQuery(getWeeklyGoal, []) ?? DEFAULT_WEEKLY_GOAL
  const [editing, setEditing] = useState(false)
  const summary = weeklyGoal(data.workouts, GOAL_WEEKS, now, goal)
  const tw = summary.thisWeek
  const subtitle = `${goal.strength} strength ${goal.strength === 1 ? 'workout' : 'workouts'}${
    goal.run > 0 ? ` and ${goal.run} ${goal.run === 1 ? 'run' : 'runs'} per week (Mon–Sun)` : ' per week (Mon–Sun), running optional'
  }`

  return (
    <Card title="Weekly goal" subtitle={subtitle}>
      {editing ? (
        <GoalEditor goal={goal} onSave={(g) => void saveWeeklyGoal(userId, g).then(() => setEditing(false))} onCancel={() => setEditing(false)} />
      ) : (
        <button onClick={() => setEditing(true)} className="absolute top-3 right-3 rounded-md bg-zinc-100 px-2.5 py-1 text-sm font-medium dark:bg-zinc-800">
          Edit
        </button>
      )}
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-4xl font-semibold tabular-nums">{summary.streak}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{summary.streak === 1 ? 'week' : 'weeks'} in a row</div>
        </div>
        <div className="text-right text-sm tabular-nums">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">This week</div>
          <div>
            Strength {tw.strength}/{goal.strength} · Run {goal.run > 0 ? `${tw.run}/${goal.run}` : tw.run}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))_1.25rem] gap-[2px] text-[11px]">
        <span />
        {WEEKDAYS.map((d) => (
          <span key={d} className="text-center text-zinc-500 dark:text-zinc-400">
            {d[0]}
          </span>
        ))}
        <span />
        {summary.weeks.slice(-CALENDAR_WEEKS).map((w) => (
          <GoalRow key={w.start} week={w} />
        ))}
      </div>
      <div className="mt-4">
        <GoalColumns
          label={`Strength workouts and runs per week, last ${GOAL_WEEKS} weeks`}
          goal={goal.strength}
          legend={['Strength', 'Run']}
          columns={summary.weeks.map((w) => {
            const ms = Date.parse(`${w.start}T12:00:00`)
            return {
              key: w.start,
              label: formatShortDate(ms),
              a: w.strength,
              b: w.run,
              met: w.met,
              tooltip: (
                <>
                  <div className="font-semibold">Week of {formatShortDate(ms)}</div>
                  <div className="text-zinc-500 dark:text-zinc-400">
                    {w.strength} strength · {w.run} {w.run === 1 ? 'run' : 'runs'}
                    {w.met ? ' · goal met' : ''}
                  </div>
                </>
              ),
            }
          })}
        />
      </div>
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
        <button type="button" aria-label={`${label} minus`} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>
          −
        </button>
        <span className="w-16 text-center text-sm font-semibold tabular-nums">{format(value)}</span>
        <button type="button" aria-label={`${label} plus`} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>
          +
        </button>
      </div>
    </div>
  )
}

function GoalEditor({ goal, onSave, onCancel }: { goal: WeeklyGoal; onSave: (g: WeeklyGoal) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(goal)
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl bg-zinc-100/70 p-3 dark:bg-zinc-800/60">
      <Stepper label="Strength per week" value={draft.strength} min={1} max={7} format={String} onChange={(n) => setDraft({ ...draft, strength: n })} />
      <Stepper
        label="Runs per week"
        value={draft.run}
        min={0}
        max={7}
        format={(n) => (n === 0 ? 'optional' : String(n))}
        onChange={(n) => setDraft({ ...draft, run: n })}
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">Set runs to optional if running should not count. Runs still appear in the calendar.</p>
      <div className="mt-1 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded-lg py-2 text-sm">
          Cancel
        </button>
        <button onClick={() => onSave(draft)} className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg">
          Save
        </button>
      </div>
    </div>
  )
}

function GoalRow({ week }: { week: GoalWeek }) {
  return (
    <div className="contents">
      <span className={`self-center tabular-nums ${week.current ? 'font-semibold' : 'text-zinc-500 dark:text-zinc-400'}`}>
        {formatShortDate(Date.parse(`${week.start}T12:00:00`))}
      </span>
      {week.days.map((d) => {
        const bg =
          d.strength && d.run
            ? 'linear-gradient(135deg, var(--viz-s1) 0 calc(50% - 1px), var(--viz-surface) calc(50% - 1px) calc(50% + 1px), var(--viz-s2) calc(50% + 1px))'
            : d.strength
              ? 'var(--viz-s1)'
              : d.run
                ? 'var(--viz-s2)'
                : 'var(--viz-empty)'
        const kind = d.strength && d.run ? 'strength and run' : d.strength ? 'strength' : d.run ? 'run' : 'rest'
        return (
          <span
            key={d.date}
            title={`${d.date}: ${kind}`}
            className={`h-5 rounded-[4px] ${d.future ? 'opacity-40' : ''}`}
            style={{ background: bg }}
          />
        )
      })}
      <span className="self-center text-center font-semibold" aria-label={week.met ? 'goal met' : 'goal not met'}>
        {week.met ? '✓' : ''}
      </span>
    </div>
  )
}

// --- ready to increase ----------------------------------------------------------------

function ReadyCard() {
  const ready = useLiveQuery(readyToIncrease, [])
  if (ready === undefined) return null
  return (
    <Card title="Ready to increase" subtitle="Last workout: every working set hit the target reps and the last set had RIR ≥ 2">
      {ready.length === 0 ? (
        <Empty>Nothing yet. The hint needs target reps in the workout and RIR on the last set.</Empty>
      ) : (
        <ul className="flex flex-col">
          {ready.map((r) => (
            <li key={r.exerciseId} className="flex items-baseline justify-between gap-3 border-t border-zinc-100 py-2 first:border-t-0 dark:border-zinc-800">
              <span className="min-w-0">
                <span className="block truncate text-sm">{r.name}</span>
                <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  last {r.lastWeight} kg × {r.reps.join(' · ')}
                </span>
              </span>
              <span className="shrink-0 rounded-md bg-accent-soft px-2 py-1 text-sm font-semibold text-accent-ink tabular-nums">
                Increase weight
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

// --- strength ----------------------------------------------------------------------------

const METRIC_LABEL: Record<Metric, string> = { weight: 'Weight', e1rm: 'Est. 1RM' }

function formatKg(v: number): string {
  return `${Math.round(v * 10) / 10} kg`
}

function formatChange(v: number): string {
  const r = Math.round(v * 10) / 10
  return r === 0 ? '±0 kg' : `${r > 0 ? '+' : '−'}${Math.abs(r)} kg`
}

function OneRmHelp() {
  return (
    <span className="block w-60 text-left text-sm leading-snug font-normal">
      <span className="mb-1 block font-semibold">1RM – One-Rep Max</span>
      The heaviest weight you could lift exactly once with clean technique. The app estimates it from your
      working sets with the Epley formula: weight × (1 + reps / 30). Example: 30 kg × 10 reps ≈ 40 kg. It makes
      more reps at the same weight visible as progress.
    </span>
  )
}

function StrengthCard({ data, from }: { data: AnalyticsData; from: number }) {
  const [metric, setMetric] = useState<Metric>('weight')
  const [open, setOpen] = useState<string | null>(null)
  const rows = progressOverview(data, from, metric)

  return (
    <Card
      title="Strength"
      subtitle={metric === 'weight' ? 'Heaviest working set per workout' : 'Best estimated 1RM per workout (working sets)'}
    >
      <div className="mb-3 flex items-center gap-2">
        <div role="radiogroup" aria-label="Metric" className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {(['weight', 'e1rm'] as Metric[]).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={metric === m}
              onClick={() => setMetric(m)}
              className={`rounded-md py-1.5 text-xs font-semibold ${
                metric === m ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {METRIC_LABEL[m]}
            </button>
          ))}
        </div>
        <Popover
          hover
          align="right"
          label={<>1RM ⓘ</>}
          ariaLabel="What is 1RM?"
          triggerClassName="text-xs text-zinc-500 underline decoration-dotted underline-offset-2 dark:text-zinc-400"
        >
          <OneRmHelp />
        </Popover>
      </div>

      {rows.length === 0 ? (
        <Empty>No weight training in this period.</Empty>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.mainId} className="border-t border-zinc-100 first:border-t-0 dark:border-zinc-800">
              <button
                onClick={() => setOpen(open === r.mainId ? null : r.mainId)}
                aria-expanded={open === r.mainId}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-3 py-2 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.name}</span>
                  <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{formatChange(r.change)}</span>
                </span>
                <Sparkline values={r.points.map((p) => p.value)} width={72} />
                <span className="text-right text-sm font-semibold tabular-nums">{formatKg(r.latest)}</span>
              </button>
              {open === r.mainId && <StrengthDetail data={data} mainId={r.mainId} from={from} metric={metric} />}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Change since the first workout in the period. Tap an exercise for details.</p>
    </Card>
  )
}

function StrengthDetail({ data, mainId, from, metric }: { data: AnalyticsData; mainId: string; from: number; metric: Metric }) {
  const [variantId, setVariantId] = useState<string | null>(null)
  const option = data.exercises.find((e) => e.mainId === mainId)
  if (!option) return null
  const series = progressSeries(data.sets, mainId, variantId, from, metric)
  const best = series.reduce<(typeof series)[number] | null>((b, p) => (b === null || p.value > b.value ? p : b), null)

  return (
    <div className="pb-3">
      {option.variants.length > 0 && (
        <select
          aria-label="Variant"
          value={variantId ?? ''}
          onChange={(e) => setVariantId(e.target.value || null)}
          className="mb-2 w-full rounded-lg border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="">All variants</option>
          <option value={option.mainId}>Main only</option>
          {option.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}
      {series.length === 0 ? (
        <Empty>No sets in this period.</Empty>
      ) : (
        <>
          {best && (
            <p className="mb-1 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
              Best in period{' '}
              {metric === 'weight'
                ? `${best.weight} kg × ${best.reps} (${formatShortDate(Date.parse(best.date))})`
                : `${formatKg(best.value)} (${best.weight} kg × ${best.reps}, ${formatShortDate(Date.parse(best.date))})`}
            </p>
          )}
          <LineChart
            label={`${METRIC_LABEL[metric]} of ${option.name}`}
            formatY={(v) => String(Math.round(v * 10) / 10)}
            // Weight only changes on an increase: steps; the labels show the reps at that weight
            step={metric === 'weight'}
            points={series.map((p) => ({
              x: Date.parse(p.date),
              y: p.value,
              label: metric === 'weight' ? p.repsList.join('·') : `×${p.reps}`,
              tooltip: (
                <>
                  <div className="font-semibold">{formatKg(p.value)}</div>
                  <div className="text-zinc-500 dark:text-zinc-400">
                    {formatShortDate(Date.parse(p.date))} ·{' '}
                    {metric === 'weight' ? `${p.weight} kg × ${p.repsList.join(' · ')}` : `${p.weight} kg × ${p.reps}`}
                    {metric === 'weight' && ` · est. 1RM ${Math.round(p.e1rm)} kg`}
                  </div>
                  {p.exerciseId !== option.mainId && <div className="text-zinc-500 dark:text-zinc-400">{data.names.get(p.exerciseId)}</div>}
                </>
              ),
            }))}
          />
        </>
      )}
    </div>
  )
}

// --- volume --------------------------------------------------------------------------------

function VolumeCard({ data, from, now }: { data: AnalyticsData; from: number; now: Date }) {
  const weeks = weeklyVolume(data.sets, from, now)
  const total = weeks.reduce((s, w) => s + w.value, 0)
  return (
    <Card title="Volume per week" subtitle="Weight × reps of working sets; one-sided sets count both sides">
      {total === 0 ? (
        <Empty>No volume in this period.</Empty>
      ) : (
        <>
          <div className="mb-1 text-sm tabular-nums">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Average </span>
            <span className="font-semibold">{kg(total / weeks.length)}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400"> per week</span>
          </div>
          <ColumnChart
            label="Training volume per week"
            formatY={compactKg}
            columns={weeks.map((w) => {
              const ms = Date.parse(`${w.start}T12:00:00`)
              return {
                key: w.start,
                label: formatShortDate(ms),
                value: w.value,
                tooltip: (
                  <>
                    <div className="font-semibold">{kg(w.value)}</div>
                    <div className="text-zinc-500 dark:text-zinc-400">Week of {formatShortDate(ms)}</div>
                  </>
                ),
              }
            })}
          />
        </>
      )}
    </Card>
  )
}

// --- sets per muscle group -------------------------------------------------------------

function MuscleCard({ data, now }: { data: AnalyticsData; now: Date }) {
  const [offset, setOffset] = useState(0)
  const start = weekStart(now)
  start.setDate(start.getDate() - 7 * offset)
  const key = dayKey(start)
  const rows = setsPerMuscle(data.sets, key)
  const label = offset === 0 ? 'This week' : offset === 1 ? 'Last week' : `Week of ${formatShortDate(start.getTime())}`
  const nav = 'h-8 w-8 rounded-md bg-zinc-100 text-sm disabled:opacity-30 dark:bg-zinc-800'

  return (
    <Card title="Sets per muscle group" subtitle="Working sets: primary muscle 1, secondary 0.5">
      <div className="mb-3 flex items-center justify-between">
        <button aria-label="Previous week" onClick={() => setOffset(offset + 1)} className={nav}>
          ‹
        </button>
        <span className="text-sm font-medium">{label}</span>
        <button aria-label="Next week" disabled={offset === 0} onClick={() => setOffset(offset - 1)} className={nav}>
          ›
        </button>
      </div>
      {rows.length === 0 ? (
        <Empty>No working sets in this week.</Empty>
      ) : (
        <HBarChart
          bars={rows.map((r) => ({
            key: r.muscle,
            label: muscleLabel(r.muscle),
            value: r.sets,
            valueLabel: r.sets.toLocaleString('en-GB', { maximumFractionDigits: 1 }),
          }))}
        />
      )}
    </Card>
  )
}

// --- side comparison ---------------------------------------------------------------------

function SideCard({ data, from }: { data: AnalyticsData; from: number }) {
  const rows = sideComparison(data.sets, from)
  return (
    <Card title="Left vs right" subtitle="Total reps per side of one-sided working sets">
      {rows.length === 0 ? (
        <Empty>No one-sided sets in this period.</Empty>
      ) : (
        <SideChart
          pairs={rows.map((r) => {
            const pct = Math.round(Math.abs(r.diff) * 100)
            return {
              key: r.exerciseId,
              label: data.names.get(r.exerciseId) ?? 'Unknown exercise',
              left: r.left,
              right: r.right,
              note: pct === 0 ? `even · ${r.sets} sets` : `${r.diff < 0 ? 'right' : 'left'} ${pct} % weaker · ${r.sets} sets`,
            }
          })}
        />
      )}
    </Card>
  )
}

// --- gym crowd ------------------------------------------------------------------------------

function CrowdCard({ data, from }: { data: AnalyticsData; from: number }) {
  const grid = crowdGrid(data.workouts, from)
  const slot = (i: number) => CROWD_SLOTS[i]!.label
  return (
    <Card title="Gym crowd" subtitle="Average rating by weekday and time of leaving (1 = empty, 5 = packed)">
      {grid.ratings === 0 ? (
        <Empty>No ratings yet. Rate the crowd at the end of a workout.</Empty>
      ) : (
        <>
          {grid.best && (
            <p className="mb-3 text-sm">
              Quietest so far: <span className="font-semibold">{WEEKDAYS[grid.best.weekday]} {slot(grid.best.slot)}</span>
              <span className="text-zinc-500 dark:text-zinc-400">
                {' '}
                · {CROWD_LABEL[Math.round(grid.best.avg!)]} ({grid.best.avg!.toFixed(1)}, {grid.best.count}{' '}
                {grid.best.count === 1 ? 'rating' : 'ratings'})
              </span>
            </p>
          )}
          <Heatmap
            rows={[...WEEKDAYS]}
            cols={CROWD_SLOTS.map((s) => s.label)}
            legend={['Empty', 'Packed']}
            cells={grid.cells.map((row) =>
              row.map((c) => ({
                key: `${c.weekday}-${c.slot}`,
                level: c.avg === null ? null : Math.min(5, Math.max(1, Math.round(c.avg))),
                text: c.avg === null ? '' : c.avg.toFixed(1).replace(/\.0$/, ''),
                tooltip:
                  c.avg === null
                    ? `${WEEKDAYS[c.weekday]} ${slot(c.slot)}: no ratings`
                    : `${WEEKDAYS[c.weekday]} ${slot(c.slot)}: ${c.avg.toFixed(1)} (${CROWD_LABEL[Math.round(c.avg)]}), ${c.count} ${c.count === 1 ? 'rating' : 'ratings'}`,
              })),
            )}
          />
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {grid.ratings} {grid.ratings === 1 ? 'rating' : 'ratings'} in this period. Times are when the workout was finished.
          </p>
        </>
      )}
    </Card>
  )
}
