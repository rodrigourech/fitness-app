import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { progressPoints, type ProgressPoint } from '../lib/goal'
import { nextWeight } from '../lib/topset'
import { repetitionTargets } from '../lib/training'
import { effective, formatNumber, recentTrainingSessions } from '../lib/workout'
import Sheet from './Sheet'

// Progression sheet (decision 5 November 2026, mockup «Progression_Blatt_v2»): one statement, the reps of the deciding
// set on a bar from Min to Max reps, and the last workouts. Opened from the progress button in the workout and from
// Stats › Progression.

export interface TodayGoal {
  weight: number
  /** Lowest reps of the checked deciding sets today, null before the first one */
  reps: number | null
}

interface Props {
  exerciseId: string
  /** Stats: the main exercise with all variants; workout: the exact exercise */
  includeVariants?: boolean
  today?: TodayGoal | null
  /** Workout advice: raise the weight today, or the top set fell below Min reps twice */
  advice?: 'increase' | 'reduce' | null
  onClose: () => void
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

async function load(exerciseId: string, includeVariants: boolean) {
  const all = await db.exercise.toArray()
  const byId = new Map(all.map((e) => [e.id, e]))
  const ex = byId.get(exerciseId)
  if (!ex) return null
  const ids = includeVariants ? [ex.id, ...all.filter((e) => e.parent_id === ex.id && e.deleted_at === null).map((e) => e.id)] : [ex.id]
  const sessions = (await Promise.all(ids.map((id) => recentTrainingSessions(id, undefined, undefined, 6))))
    .flat()
    .sort((a, b) => b.workout.started_at.localeCompare(a.workout.started_at))
  const seen = new Set<string>()
  const unique = sessions.filter((s) => (seen.has(s.workout.id) ? false : (seen.add(s.workout.id), true))).slice(0, 6)
  const eff = effective(ex, byId)
  return {
    ex,
    main: ex.parent_id ? byId.get(ex.parent_id) ?? ex : ex,
    eff,
    targets: repetitionTargets(ex, byId),
    points: progressPoints(unique.map((s) => ({ date: s.workout.started_at, sets: s.sets })), eff.topSet, eff.isUnilateral),
  }
}

export default function ProgressionSheet({ exerciseId, includeVariants = false, today = null, advice = null, onClose }: Props) {
  const data = useLiveQuery(() => load(exerciseId, includeVariants), [exerciseId, includeVariants])
  if (data === undefined) return null
  if (data === null) return <Sheet title="Progression" onClose={onClose}><p className="text-zinc-500">Exercise not found.</p></Sheet>
  const { ex, main, eff, targets, points } = data
  const title = ex.parent_id && !includeVariants ? `${main.name} · ${ex.name}` : main.name
  // The reference is today's checked deciding set when there is one, else the last workout
  const todayPoint: ProgressPoint | null = today && today.reps !== null ? { date: 'today', weight: today.weight, reps: today.reps, up: false } : null
  const ref = todayPoint ?? points[0] ?? null
  const weight = today?.weight ?? ref?.weight ?? null
  const step = eff.weightStep
  const next = weight !== null && step ? nextWeight(weight, step) : null
  const nextText = next !== null ? `${formatNumber(next)} kg` : 'heavier'
  const reps = ref && ref.weight === weight ? ref.reps : null
  const reached = reps !== null && reps >= targets.target
  // Raise today: the last workout reached Max reps, the sheet opens before today's top set is done
  const raiseToday = advice === 'increase' && reached && !todayPoint
  const kind = eff.topSet ? 'Top set' : 'All sets'

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="-mt-2 mb-4 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
        {kind}{weight !== null && ` · ${formatNumber(weight)} kg`} · reps {targets.minimum}–{targets.target}
      </p>
      {weight === null ? (
        <p className="mb-4 text-lg font-semibold">No weight yet</p>
      ) : raiseToday ? (
        <p className="mb-3 text-2xl font-bold text-emerald-700 dark:text-emerald-400">↑ Today {nextText}</p>
      ) : reached ? (
        <p className="mb-3 text-2xl font-bold text-emerald-700 dark:text-emerald-400">✓ Next workout {nextText}</p>
      ) : reps === null ? (
        <p className="mb-3 text-2xl font-bold">{targets.target} reps for <span className="text-emerald-700 dark:text-emerald-400">↑ {nextText}</span></p>
      ) : (
        <p className="mb-3 text-2xl font-bold tabular-nums">
          {targets.target - reps} {targets.target - reps === 1 ? 'rep' : 'reps'} to <span className="text-emerald-700 dark:text-emerald-400">↑ {nextText}</span>
        </p>
      )}
      {advice === 'reduce' && (
        <p className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
          <span className="font-semibold">Check the weight.</span> Top set below Min reps twice at the same weight. Check rest, recovery and form before choosing a lighter weight.
        </p>
      )}
      {weight !== null && <RepsBar min={targets.minimum} max={targets.target} reps={reps} label={todayPoint ? 'today' : 'last'} nextText={nextText} />}

      <Rules topSet={eff.topSet} />

      <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-zinc-500 dark:text-zinc-400">LAST WORKOUTS · {kind.toUpperCase()}</h3>
      {points.length === 0 && !todayPoint ? (
        <p className="text-sm text-zinc-500">No earlier workout with this exercise.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {[...(todayPoint ? [todayPoint] : []), ...points].map((p, i) => (
            <li key={i} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2 px-3 py-2.5 tabular-nums">
              <span className="text-zinc-500 dark:text-zinc-400">{p.date === 'today' ? 'Today' : dayFormat.format(new Date(p.date))}</span>
              <Dots min={targets.minimum} max={targets.target} reps={p.reps} />
              <span className="text-right">
                {formatNumber(p.weight)} × {p.reps ?? '–'}
                {p.up && <span className="ml-1 font-bold text-emerald-700 dark:text-emerald-400" aria-label="weight up">↑</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}

/** The progression rule in short (decision 9 November 2026); without a top set every set decides. */
function Rules({ topSet }: { topSet: boolean }) {
  const rows: [string, string][] = [
    ['bg-emerald-600', topSet ? 'Top set reaches max reps' : 'All sets reach max reps'],
    ...(topSet ? [['bg-zinc-400', "Back-off sets don't count"] as [string, string]] : []),
    ['bg-orange-500', 'Twice below the range: go lighter'],
  ]
  return (
    <div className="mt-4 flex flex-col gap-1.5 rounded-xl bg-zinc-100 p-3 text-sm dark:bg-zinc-800/70">
      <span className="font-semibold">How to go up</span>
      {rows.map(([dot, text]) => (
        <span key={text} className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
          {text}
        </span>
      ))}
    </div>
  )
}

/** Boxes from Min to Max reps: green up to the reference reps, Max outlined as the goal. */
function RepsBar({ min, max, reps, label, nextText }: { min: number; max: number; reps: number | null; label: string; nextText: string }) {
  const values = range(min, max)
  const reached = reps !== null && reps >= max
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${values.length}, minmax(0, 1fr))` }}>
      {values.map((n) => {
        const filled = reps !== null && n <= reps
        const goal = n === max && !reached
        return (
          <div key={n} className="flex flex-col items-center gap-1">
            <span
              className={`flex h-9 w-full items-center justify-center rounded-lg text-sm font-semibold tabular-nums ${
                filled ? 'bg-emerald-500 text-white dark:bg-emerald-600'
                  : goal ? 'border-2 border-emerald-700 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400'
                  : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              }`}
            >
              {n}
            </span>
            <span className="h-3.5 text-[11px] whitespace-nowrap text-zinc-500 dark:text-zinc-400">
              {n === max && !reached ? `↑ ${nextText}` : reps !== null && n === Math.min(Math.max(reps, min), max) ? label : ''}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function Dots({ min, max, reps }: { min: number; max: number; reps: number | null }) {
  return (
    <span className="flex gap-[3px]" aria-hidden="true">
      {range(min, max).map((n) => (
        <span key={n} className={`h-2.5 w-2.5 rounded-[3px] ${reps !== null && n <= reps ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
      ))}
    </span>
  )
}

function range(min: number, max: number): number[] {
  const out: number[] = []
  for (let n = min; n <= Math.max(min, max); n++) out.push(n)
  return out
}

