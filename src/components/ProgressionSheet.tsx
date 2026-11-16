import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { progressPoints, type ProgressPoint } from '../lib/goal'
import { nextWeight } from '../lib/topset'
import { repetitionTargets } from '../lib/training'
import { effective, formatNumber, recentTrainingSessions } from '../lib/workout'
import Sheet from './Sheet'

// Progression sheet (decision 16 November 2026, design «A», replaces «Progression_Blatt_v2»): three labelled parts.
// Goal: a dashed card with the rule for the next weight and the progress from Min to Max reps; once reached it turns
// solid green with the next weight. Today: the reps of today's checked work sets (only in the workout). History: the
// last workouts without today. Opened from the progress button in the workout and from Stats › Progression.

export interface TodayGoal {
  weight: number
  /** Lowest reps of the checked deciding sets today, null before the first one */
  reps: number | null
  /** Reps of today's checked work sets in order */
  sets?: (number | null)[]
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

  const toGo = reps !== null ? Math.max(0, targets.target - reps) : null
  const history = points
  const label = (text: string) => <h3 className="mt-5 mb-2 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{text}</h3>

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="-mt-2 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
        {kind} · reps {targets.minimum}–{targets.target}
      </p>
      {advice === 'reduce' && (
        <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
          <span className="font-semibold">Check the weight.</span> Top set below Min reps twice at the same weight. Check rest, recovery and form before choosing a lighter weight.
        </p>
      )}

      {label('Goal')}
      {weight === null ? (
        <p className="text-lg font-semibold">No weight yet</p>
      ) : reached ? (
        <div className="rounded-2xl border border-emerald-600 bg-emerald-600/10 px-4 py-3 dark:border-emerald-500 dark:bg-emerald-900/50">
          <div className="text-xs font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">Goal reached</div>
          <div className="mt-0.5 text-2xl font-extrabold tracking-tight">{raiseToday ? `↑ Today ${nextText}` : `✓ Next workout ${nextText}`}</div>
          <div className="mt-0.5 text-sm text-emerald-800 tabular-nums dark:text-emerald-200">
            {eff.topSet ? 'Top set' : 'All sets'} {targets.target} reps at {formatNumber(weight)} kg
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border-[1.5px] border-dashed border-emerald-600 px-4 py-3 dark:border-emerald-400">
          <div className="text-xs font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">Goal for {nextText}</div>
          <div className="mt-0.5 text-xl font-extrabold tracking-tight tabular-nums">{targets.target} reps on {eff.topSet ? 'the top set' : 'all sets'}</div>
          <div className="mt-0.5 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
            at {formatNumber(weight)} kg{toGo !== null && <> · <b className="font-semibold text-zinc-900 dark:text-zinc-100">{toGo} {toGo === 1 ? 'rep' : 'reps'} to go</b></>}
          </div>
          <Progress min={targets.minimum} max={targets.target} reps={reps} />
        </div>
      )}

      {todayPoint && (
        <>
          {label('Today')}
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-zinc-100 px-4 py-3 dark:bg-zinc-800/70">
            <div className="min-w-0">
              <div className="text-2xl font-extrabold tracking-tight tabular-nums">{formatNumber(todayPoint.weight)} kg × {todayPoint.reps}</div>
              <div className="mt-0.5 truncate text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
                {eff.topSet ? 'top set' : 'lowest set'}
                {today?.sets && today.sets.length > 0 && <> · {today.sets.length} {today.sets.length === 1 ? 'set' : 'sets'} · {today.sets.map((r) => r ?? '–').join(' · ')}</>}
              </div>
            </div>
            {(todayPoint.reps ?? 0) >= targets.target
              ? <span className="shrink-0 rounded-full bg-emerald-600/15 px-2.5 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">✓ max</span>
              : <span className="shrink-0 rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-bold text-zinc-700 tabular-nums dark:bg-zinc-700 dark:text-zinc-200">{todayPoint.reps} / {targets.target}</span>}
          </div>
        </>
      )}

      {label('History')}
      {history.length === 0 ? (
        <p className="text-sm text-zinc-500">No earlier workout with this exercise.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {history.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 tabular-nums">
              <span className="text-zinc-500 dark:text-zinc-400">{dayFormat.format(new Date(p.date))}</span>
              <span className={(p.reps ?? 0) >= targets.target ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''}>
                {formatNumber(p.weight)} × {p.reps ?? '–'}
                {p.up && <span className="ml-1 font-bold text-emerald-700 dark:text-emerald-400" aria-label="weight up">↑</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
        {eff.topSet && "Back-off sets don't count. "}Twice below {targets.minimum} reps at the same weight: go lighter.
      </p>
    </Sheet>
  )
}

/** Progress from Min to Max reps as segments, filled up to the reference reps. */
function Progress({ min, max, reps }: { min: number; max: number; reps: number | null }) {
  const values = range(min, max)
  return (
    <div className="mt-2.5" aria-label={reps === null ? undefined : `${reps} of ${max} reps`}>
      <div className="flex gap-1">
        {values.map((n) => (
          <span key={n} className={`h-2.5 flex-1 rounded ${reps !== null && n <= reps ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-zinc-200 dark:bg-zinc-700'}`} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400"><span>{min}</span><span>{max}</span></div>
    </div>
  )
}

function range(min: number, max: number): number[] {
  const out: number[] = []
  for (let n = min; n <= Math.max(min, max); n++) out.push(n)
  return out
}

