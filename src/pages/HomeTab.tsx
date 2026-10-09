import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ColumnChart, LineChart } from '../components/Charts'
import { loadAnalytics, weeklyGoal, weeklyVolume } from '../lib/analytics'
import { readyToIncrease } from '../lib/progression'
import { bodyWeightSeries } from '../lib/body'
import { finishedWorkouts } from '../lib/history'
import { getWeeklyGoal } from '../lib/settings'
import { formatDuration } from '../lib/workout'

// Start page (decision 9 October 2026): weekly goal, start or resume, last workout, body weight, shortcuts.

export interface StartCard {
  id: string
  name: string
  lastDone: string | null
}

export type HomeTarget = 'templates' | 'history' | 'stats' | 'body' | 'trash' | 'account'

interface Props {
  cards: StartCard[] | undefined
  running: boolean
  onStart: (templateId: string) => void
  onResume?: () => void
  onOpen: (target: HomeTarget) => void
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

async function loadSummary() {
  const [data, goal, workouts, weights] = await Promise.all([loadAnalytics(), getWeeklyGoal(), finishedWorkouts(), bodyWeightSeries()])
  const now = new Date()
  const week = weeklyGoal(data.workouts, 1, now, goal)
  const from = now.getTime() - 12 * 7 * 86_400_000
  const goal12 = weeklyGoal(data.workouts, 12, now, goal)
  return {
    volume: weeklyVolume(data.sets, from, now),
    sessions: goal12.weeks.map((w) => ({ start: w.start, value: w.strength + w.run })),
    weightSeries: weights.filter((w) => Date.parse(w.entry.measured_on) >= now.getTime() - 90 * 86_400_000).reverse(),
    ready: await readyToIncrease(), goal, week: week.thisWeek, streak: week.streak, last: workouts[0] ?? null, weight: weights[0] ?? null, weightWeekAgo: weights.find((w) => Date.parse(w.entry.measured_on) <= Date.now() - 7 * 86_400_000) ?? null }
}

export default function HomeTab({ cards, running, onStart, onResume, onOpen }: Props) {
  const s = useLiveQuery(loadSummary, [])

  return (
    <div className="flex flex-col gap-3">
      {running ? (
        <button onClick={onResume} className="w-full rounded-xl bg-accent py-4 text-base font-semibold text-accent-fg">
          Resume running workout
        </button>
      ) : (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Start a workout</h2>
          {cards === undefined ? (
            <p className="text-zinc-500">Loading …</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-zinc-500">No active workouts.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {cards.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onStart(c.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg bg-zinc-100 px-3 py-3 text-left dark:bg-zinc-800"
                  >
                    <span className="font-semibold">{c.name}</span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {c.lastDone ? `last ${dayFormat.format(new Date(c.lastDone))}` : 'never'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {s && (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => onOpen('stats')} className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-left dark:border-blue-900 dark:bg-blue-950/60">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">This week</span>
            <span className="block text-2xl font-semibold text-blue-700 tabular-nums dark:text-blue-300">
              {s.week.strength}/{s.goal.strength}
              <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">strength</span>
            </span>
            <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
              {s.goal.run > 0 ? `${s.week.run}/${s.goal.run} run · ` : s.week.run ? `${s.week.run} run · ` : ''}
              {s.week.met ? 'goal met' : `streak ${s.streak} ${s.streak === 1 ? 'week' : 'weeks'}`}
            </span>
          </button>
          <button onClick={() => onOpen('body')} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-left dark:border-emerald-900 dark:bg-emerald-950/60">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Body weight</span>
            {s.weight ? (
              <>
                <span className="block text-2xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">{s.weight.entry.weight_kg.toFixed(1)} kg</span>
                <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                  7-day avg {s.weight.avg7.toFixed(1)}
                  {s.weightWeekAgo && ` · ${signed(s.weight.avg7 - s.weightWeekAgo.avg7)} in 7 days`}
                </span>
              </>
            ) : (
              <span className="block text-sm font-medium text-accent-ink">Log weight</span>
            )}
          </button>
        </div>
      )}

      {s && s.ready.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/50">
          <h2 className="mb-1 text-sm font-semibold text-amber-800 dark:text-amber-300">↑ Increase weight next time</h2>
          <ul className="text-sm">
            {s.ready.map((r) => (
              <li key={r.exerciseId} className="py-0.5">
                {r.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s && <TrendCard s={s} />}

      {s?.last && (
        <button onClick={() => onOpen('history')} className="card p-3 text-left">
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Last workout</span>
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-semibold">{s.last.workout.template_name_snapshot ?? 'Workout'}</span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{dayFormat.format(new Date(s.last.workout.started_at))}</span>
          </span>
          <span className="mt-1 flex gap-4 text-sm text-zinc-600 tabular-nums dark:text-zinc-300">
            <span>{s.last.durationS !== null ? formatDuration(s.last.durationS) : '–'}</span>
            <span>{Math.round(s.last.volume).toLocaleString('en-GB')} kg</span>
            <span>
              {s.last.exercises} {s.last.exercises === 1 ? 'exercise' : 'exercises'} · {s.last.sets} sets
            </span>
          </span>
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['templates', 'Workouts'],
            ['body', 'Log weight'],
            ['stats', 'Stats'],
            ['history', 'History'],
            ['trash', 'Trash'],
            ['account', 'Change password'],
          ] as const
        ).map(([target, label]) => (
          <button key={target} onClick={() => onOpen(target)} className="card py-2.5 text-sm font-medium">
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function signed(v: number): string {
  const r = Math.round(v * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)} kg`
}

type Trend = 'weight' | 'volume' | 'sessions'
const TRENDS: { key: Trend; label: string }[] = [
  { key: 'weight', label: 'Body weight' },
  { key: 'volume', label: 'Volume' },
  { key: 'sessions', label: 'Workouts' },
]

/** Small switchable chart on the start page. */
function TrendCard({ s }: { s: Awaited<ReturnType<typeof loadSummary>> }) {
  const [trend, setTrend] = useState<Trend>(() => {
    try {
      const v = localStorage.getItem('home-trend')
      return v === 'volume' || v === 'sessions' ? v : 'weight'
    } catch {
      return 'weight'
    }
  })
  function pick(t: Trend) {
    setTrend(t)
    try {
      localStorage.setItem('home-trend', t)
    } catch {
      // per-device convenience only
    }
  }
  const weekLabel = (start: string) => dayFormat.format(new Date(`${start}T12:00:00`))
  return (
    <section className="card p-3">
      <div role="tablist" className="mb-2 grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {TRENDS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={trend === t.key}
            onClick={() => pick(t.key)}
            className={`rounded-md py-1.5 text-xs font-semibold ${trend === t.key ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {trend === 'weight' ? (
        s.weightSeries.length < 2 ? (
          <p className="py-6 text-center text-sm text-zinc-500">Log your weight on a few days to see the trend.</p>
        ) : (
          <LineChart
            label="7-day average body weight, last 90 days"
            formatY={(v) => `${v.toFixed(1)}`}
            height={160}
            points={s.weightSeries.map((p) => ({
              x: Date.parse(`${p.entry.measured_on}T12:00:00`),
              y: Math.round(p.avg7 * 10) / 10,
              tooltip: `${dayFormat.format(new Date(`${p.entry.measured_on}T12:00:00`))}: ${p.entry.weight_kg.toFixed(1)} kg (avg ${p.avg7.toFixed(1)})`,
            }))}
          />
        )
      ) : (
        <ColumnChart
          label={trend === 'volume' ? 'Training volume per week, last 12 weeks' : 'Workouts per week, last 12 weeks'}
          height={150}
          formatY={(v) => (trend === 'volume' ? (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))) : String(v))}
          columns={(trend === 'volume' ? s.volume : s.sessions).map((w) => ({
            key: w.start,
            label: weekLabel(w.start),
            value: w.value,
            tooltip: `Week of ${weekLabel(w.start)}: ${trend === 'volume' ? `${Math.round(w.value).toLocaleString('en-GB')} kg` : `${w.value} ${w.value === 1 ? 'workout' : 'workouts'}`}`,
          }))}
        />
      )}
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {trend === 'weight' ? '7-day average, last 90 days' : 'Last 12 weeks'}
      </p>
    </section>
  )
}
