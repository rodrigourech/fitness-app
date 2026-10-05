import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState, type ReactNode } from 'react'
import { ColumnChart, Heatmap, HBarChart, LineChart, SideChart } from '../components/Charts'
import { formatShortDate } from '../lib/chart'
import {
  CROWD_LABEL,
  CROWD_SLOTS,
  RANGE_LABEL,
  WEEKDAYS,
  WEEKLY_GOAL,
  crowdGrid,
  dayKey,
  loadAnalytics,
  muscleLabel,
  rangeStart,
  setsPerMuscle,
  sideComparison,
  strengthSeries,
  weekStart,
  weeklyGoal,
  weeklyVolume,
  type AnalyticsData,
  type GoalWeek,
  type Range,
} from '../lib/analytics'

const RANGES: Range[] = ['1m', '3m', '1y', 'all']
const GOAL_WEEKS = 8

function kg(v: number): string {
  return `${Math.round(v).toLocaleString('en-GB')} kg`
}

function compactKg(v: number): string {
  return v >= 1000 ? `${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}k` : String(Math.round(v))
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="font-semibold">{title}</h2>
      {subtitle && <p className="text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-4 text-sm text-neutral-500 dark:text-neutral-400">{children}</p>
}

export default function StatsTab() {
  const data = useLiveQuery(loadAnalytics, [])
  const [range, setRange] = useState<Range>('3m')
  // Fixed per visit of the tab, so all cards use the same reference time
  const [now] = useState(() => new Date())

  if (data === undefined) return <p className="text-neutral-500">Loading …</p>
  if (data.workouts.length === 0) return <Empty>No finished workouts yet.</Empty>

  const from = rangeStart(range, now, data.workouts)

  return (
    <div className="flex flex-col gap-4">
      <GoalCard data={data} now={now} />

      <div role="radiogroup" aria-label="Time range" className="grid grid-cols-4 gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
        {RANGES.map((r) => (
          <button
            key={r}
            role="radio"
            aria-checked={range === r}
            onClick={() => setRange(r)}
            className={`rounded-md py-1.5 text-xs font-semibold ${
              range === r ? 'bg-white shadow-sm dark:bg-neutral-700' : 'text-neutral-500 dark:text-neutral-400'
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      <StrengthCard data={data} from={from} />
      <VolumeCard data={data} from={from} now={now} />
      <MuscleCard data={data} now={now} />
      <SideCard data={data} from={from} />
      <CrowdCard data={data} from={from} />
    </div>
  )
}

// --- weekly goal ----------------------------------------------------------------------

function GoalCard({ data, now }: { data: AnalyticsData; now: Date }) {
  const goal = weeklyGoal(data.workouts, GOAL_WEEKS, now)
  const tw = goal.thisWeek
  return (
    <Card title="Weekly goal" subtitle={`${WEEKLY_GOAL.strength} strength workouts and ${WEEKLY_GOAL.run} run per week (Mon–Sun)`}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-4xl font-semibold tabular-nums">{goal.streak}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400">{goal.streak === 1 ? 'week' : 'weeks'} in a row</div>
        </div>
        <div className="text-right text-sm tabular-nums">
          <div className="text-xs text-neutral-500 dark:text-neutral-400">This week</div>
          <div>
            Strength {tw.strength}/{WEEKLY_GOAL.strength} · Run {tw.run}/{WEEKLY_GOAL.run}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-[3.25rem_repeat(7,minmax(0,1fr))_1.25rem] gap-[2px] text-[11px]">
        <span />
        {WEEKDAYS.map((d) => (
          <span key={d} className="text-center text-neutral-500 dark:text-neutral-400">
            {d[0]}
          </span>
        ))}
        <span />
        {goal.weeks.map((w) => (
          <GoalRow key={w.start} week={w} />
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-s1)' }} /> Strength
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-s2)' }} /> Run
        </span>
        <span>✓ goal met</span>
      </div>
    </Card>
  )
}

function GoalRow({ week }: { week: GoalWeek }) {
  return (
    <div className="contents">
      <span className={`self-center tabular-nums ${week.current ? 'font-semibold' : 'text-neutral-500 dark:text-neutral-400'}`}>
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

// --- strength ----------------------------------------------------------------------------

function StrengthCard({ data, from }: { data: AnalyticsData; from: number }) {
  // Default: the exercise with the most working sets
  const defaultMain = useMemo(() => {
    const count = new Map<string, number>()
    for (const x of data.sets) if (x.trackingType === 'weight_reps') count.set(x.mainId, (count.get(x.mainId) ?? 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }, [data])
  const [mainId, setMainId] = useState<string | null>(null)
  const [variantId, setVariantId] = useState<string | null>(null)
  const main = mainId ?? defaultMain
  const option = data.exercises.find((e) => e.mainId === main)

  if (!option) {
    return (
      <Card title="Strength">
        <Empty>No weight training recorded yet.</Empty>
      </Card>
    )
  }

  const series = strengthSeries(data.sets, option.mainId, variantId, from)
  const first = series[0]
  const last = series.at(-1)
  const select = 'min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950'

  return (
    <Card title="Strength" subtitle="Best estimated 1RM per workout (Epley, working sets)">
      <div className="mb-3 flex gap-2">
        <select
          aria-label="Exercise"
          value={option.mainId}
          onChange={(e) => {
            setMainId(e.target.value)
            setVariantId(null)
          }}
          className={select}
        >
          {data.exercises.map((e) => (
            <option key={e.mainId} value={e.mainId}>
              {e.name}
            </option>
          ))}
        </select>
        {option.variants.length > 0 && (
          <select aria-label="Variant" value={variantId ?? ''} onChange={(e) => setVariantId(e.target.value || null)} className={select}>
            <option value="">All variants</option>
            <option value={option.mainId}>Main only</option>
            {option.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {series.length === 0 ? (
        <Empty>No sets in this period.</Empty>
      ) : (
        <>
          <div className="mb-1 flex gap-6 text-sm tabular-nums">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Latest</div>
              <div className="text-xl font-semibold">{kg(last!.e1rm)}</div>
            </div>
            {series.length > 1 && (
              <div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">Change</div>
                <div className="text-xl font-semibold">
                  {last!.e1rm >= first!.e1rm ? '+' : '−'}
                  {kg(Math.abs(last!.e1rm - first!.e1rm))}
                </div>
              </div>
            )}
          </div>
          <LineChart
            label={`Estimated 1RM of ${option.name}`}
            formatY={(v) => String(Math.round(v))}
            points={series.map((p) => ({
              x: Date.parse(p.date),
              y: p.e1rm,
              tooltip: (
                <>
                  <div className="font-semibold">{kg(p.e1rm)}</div>
                  <div className="text-neutral-500 dark:text-neutral-400">
                    {formatShortDate(Date.parse(p.date))} · {p.weight} kg × {p.reps}
                  </div>
                  {p.exerciseId !== option.mainId && <div className="text-neutral-500 dark:text-neutral-400">{data.names.get(p.exerciseId)}</div>}
                </>
              ),
            }))}
          />
        </>
      )}
    </Card>
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
            <span className="text-xs text-neutral-500 dark:text-neutral-400">Average </span>
            <span className="font-semibold">{kg(total / weeks.length)}</span>
            <span className="text-xs text-neutral-500 dark:text-neutral-400"> per week</span>
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
                    <div className="text-neutral-500 dark:text-neutral-400">Week of {formatShortDate(ms)}</div>
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
  const nav = 'h-8 w-8 rounded-md bg-neutral-100 text-sm disabled:opacity-30 dark:bg-neutral-800'

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
              <span className="text-neutral-500 dark:text-neutral-400">
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
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            {grid.ratings} {grid.ratings === 1 ? 'rating' : 'ratings'} in this period. Times are when the workout was finished.
          </p>
        </>
      )}
    </Card>
  )
}
