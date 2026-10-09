import { useLiveQuery } from 'dexie-react-hooks'
import { loadAnalytics, weeklyGoal } from '../lib/analytics'
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
  const week = weeklyGoal(data.workouts, 1, new Date(), goal)
  return { goal, week: week.thisWeek, streak: week.streak, last: workouts[0] ?? null, weight: weights[0] ?? null, weightWeekAgo: weights.find((w) => Date.parse(w.entry.measured_on) <= Date.now() - 7 * 86_400_000) ?? null }
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
          <button onClick={() => onOpen('stats')} className="card p-3 text-left">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">This week</span>
            <span className="block text-2xl font-semibold tabular-nums">
              {s.week.strength}/{s.goal.strength}
              <span className="ml-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">strength</span>
            </span>
            <span className="block text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
              {s.goal.run > 0 ? `${s.week.run}/${s.goal.run} run · ` : s.week.run ? `${s.week.run} run · ` : ''}
              {s.week.met ? 'goal met' : `streak ${s.streak} ${s.streak === 1 ? 'week' : 'weeks'}`}
            </span>
          </button>
          <button onClick={() => onOpen('body')} className="card p-3 text-left">
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">Body weight</span>
            {s.weight ? (
              <>
                <span className="block text-2xl font-semibold tabular-nums">{s.weight.entry.weight_kg.toFixed(1)} kg</span>
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
