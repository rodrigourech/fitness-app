import { useLiveQuery } from 'dexie-react-hooks'
import { Fragment, useState } from 'react'
import { db } from '../lib/db'
import { decidingIndexes, historyBars, repsOf, type HistoryBar } from '../lib/goal'
import { nextWeight } from '../lib/topset'
import { repetitionTargets } from '../lib/training'
import { effective, formatNumber, recentTrainingSessions } from '../lib/workout'
import ProgressionRules from './ProgressionRules'
import Sheet from './Sheet'

// Progression sheet (decision 19 November 2026, design «Progression_einfach»): one row per set, marked as in the
// workout (TOP orange, BACK dashed orange, SET grey), with its weight and the goal reps; below the next weight. The
// last workouts and today show in the history chart (reps as bars, kg above), switchable between the counting set and
// the others. Opened from the progress button in the workout and from Stats › Progression.

export interface TodayGoal {
  weight: number
  /** Lowest reps of the checked deciding sets today, null before the first one */
  reps: number | null
  /** Reps of today's checked work sets in order */
  sets?: (number | null)[]
  /** Today's work sets in order: weight, reps (one-sided: weaker side) and whether they are checked */
  work?: { weight: number | null; reps: number | null; done: boolean }[]
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

async function load(exerciseId: string, includeVariants: boolean) {
  const all = await db.exercise.toArray()
  const byId = new Map(all.map((e) => [e.id, e]))
  const ex = byId.get(exerciseId)
  if (!ex) return null
  const ids = includeVariants ? [ex.id, ...all.filter((e) => e.parent_id === ex.id && e.deleted_at === null).map((e) => e.id)] : [ex.id]
  const sessions = (await Promise.all(ids.map((id) => recentTrainingSessions(id, undefined, undefined, 8))))
    .flat()
    .sort((a, b) => b.workout.started_at.localeCompare(a.workout.started_at))
  const seen = new Set<string>()
  const unique = sessions.filter((s) => (seen.has(s.workout.id) ? false : (seen.add(s.workout.id), true))).slice(0, 8)
  const eff = effective(ex, byId)
  return {
    ex,
    main: ex.parent_id ? byId.get(ex.parent_id) ?? ex : ex,
    eff,
    targets: repetitionTargets(ex, byId),
    bars: historyBars(unique.map((s) => ({ date: s.workout.started_at, sets: s.sets })), eff.topSet, eff.isUnilateral),
    last: (unique[0]?.sets ?? []).filter((s) => s.set_type === 'working' && s.deleted_at === null).sort((a, b) => a.position - b.position),
  }
}

export default function ProgressionSheet({ exerciseId, includeVariants = false, today = null, advice = null, onClose }: Props) {
  const data = useLiveQuery(() => load(exerciseId, includeVariants), [exerciseId, includeVariants])
  const [view, setView] = useState<'top' | 'other'>('top')
  const [rules, setRules] = useState(false)
  if (data === undefined) return null
  if (data === null) return <Sheet title="Progression" onClose={onClose}><p className="text-zinc-500">Exercise not found.</p></Sheet>
  const { ex, main, eff, targets, bars, last } = data
  const title = ex.parent_id && !includeVariants ? `${main.name} · ${ex.name}` : main.name
  const unilateral = eff.isUnilateral

  // Rows: today's work sets in the workout, else the sets of the last workout
  const work = today?.work ?? last.map((s) => ({ weight: s.weight, reps: repsOf(s, unilateral), done: true }))
  const counting = new Set(decidingIndexes(work, eff.topSet))
  const top = Math.max(0, ...work.map((s) => s.weight ?? 0))
  const step = eff.weightStep
  const next = top > 0 && step ? `${formatNumber(nextWeight(top, step))} kg` : 'heavier'
  const hit = (s: (typeof work)[number]) => s.done && (s.reps ?? 0) >= targets.target
  const countingSets = work.filter((_, i) => counting.has(i))
  const reached = countingSets.length > 0 && countingSets.every(hit)
  const anyCountingDone = countingSets.some((s) => s.done)
  // Last workout reached Max: raise today, as long as no counting set is checked yet
  const raiseToday = advice === 'increase' && today !== null && !anyCountingDone

  // History with today: the counting sets once checked, else an open bar
  const inWorkout = today !== null
  const todayBar = (which: 'top' | 'other'): HistoryBar => {
    const pick = work.filter((_, i) => (which === 'top' ? counting.has(i) : eff.topSet ? !counting.has(i) : i === 0)).filter((s) => s.done)
    const reps = pick.map((s) => s.reps).filter((r): r is number => r !== null)
    const kg = Math.max(0, ...pick.map((s) => s.weight ?? 0))
    return { date: 'today', kg: kg > 0 ? kg : null, reps: reps.length ? Math.min(...reps) : null }
  }
  const series = view === 'top' ? bars.top : bars.other
  const shown = inWorkout ? [...series.slice(-7), todayBar(view)] : series.slice(-8)
  const viewLabels = eff.topSet ? ['Top set', 'Back-off'] : [unilateral ? 'Weaker side' : 'Lowest set', 'Set 1']

  return (
    <Sheet title={title} onClose={onClose}>
      <p className="-mt-2 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
        {targets.minimum}–{targets.target} reps{step ? ` · step ${formatNumber(step)} kg` : ''}{unilateral ? ' · weaker side counts' : ''}
      </p>
      {advice === 'reduce' && (
        <p className="mt-3 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
          <span className="font-semibold">Below Min twice.</span> Go one step lighter, unless rest or form was off.
        </p>
      )}

      {work.length === 0 || top <= 0 ? (
        <p className="mt-4 text-sm text-zinc-500">No weight yet. Log a workout first.</p>
      ) : (
        <div className="mt-4 grid grid-cols-[64px_1fr_auto] items-center gap-x-3 gap-y-2">
          <span />
          <span className="text-[11px] font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Weight</span>
          <span className="text-right text-[11px] font-bold tracking-wide text-emerald-700 uppercase dark:text-emerald-400">Goal</span>
          {work.map((s, i) => {
            const isTop = eff.topSet && counting.has(i)
            const isBack = eff.topSet && !counting.has(i)
            const tag = isTop
              ? 'border border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300'
              : isBack ? 'border border-dashed border-orange-400 text-orange-700 dark:text-orange-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
            return (
              <Fragment key={i}>
                <span className={`flex h-8 items-center justify-center rounded-md text-xs font-extrabold tracking-wide ${tag}`}>{isTop ? 'TOP' : isBack ? 'BACK' : `SET ${i + 1}`}</span>
                <span className={`text-lg font-bold tabular-nums ${isBack ? 'text-zinc-400 dark:text-zinc-500' : ''}`}>
                  {s.weight === null ? '–' : formatNumber(s.weight)}<span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">kg</span>
                </span>
                {isBack ? (
                  <span className="text-right text-xs text-zinc-500 dark:text-zinc-400">doesn't count</span>
                ) : (
                  <span className={`justify-self-end rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${hit(s) && inWorkout ? 'bg-emerald-600 text-white dark:bg-emerald-500' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                    {hit(s) && inWorkout ? '✓ ' : '⚑ '}{targets.target} reps{unilateral ? ' each side' : ''}
                  </span>
                )}
              </Fragment>
            )
          })}
          <div className="col-span-full mt-1 flex items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {raiseToday ? 'Last time all at Max · go up today' : reached && inWorkout ? 'Goal reached · next workout' : reached ? 'Last time all at Max · go up' : eff.topSet ? 'Next weight once TOP hits the goal' : 'Next weight once every set hits the goal'}
            </span>
            <span className={`shrink-0 rounded-lg px-3 py-1.5 text-base font-extrabold tabular-nums ${reached || raiseToday ? 'bg-emerald-600 text-white dark:bg-emerald-500' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
              {reached || raiseToday ? `↑ ${next}` : `→ ${next}`}
            </span>
          </div>
        </div>
      )}

      <div className="mt-6 mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">History</h3>
        <span className="inline-flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800" role="group" aria-label="History view">
          {(['top', 'other'] as const).map((v, i) => (
            <button key={v} onClick={() => setView(v)} aria-pressed={view === v}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${view === v ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {viewLabels[i]}
            </button>
          ))}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">No earlier workout with this exercise.</p>
      ) : (
        <HistoryChart bars={shown} minimum={targets.minimum} target={targets.target} neutral={eff.topSet && view === 'other'} />
      )}
      <button onClick={() => setRules(true)} className="mt-4 text-sm font-semibold text-accent">How progression works ›</button>
      {rules && <ProgressionRules onClose={() => setRules(false)} />}
    </Sheet>
  )
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (d: Date) => `${d.getDate()} ${MONTH[d.getMonth()]}`

/**
 * Bars of the last workouts (decision 19 November 2026): height and the number inside = reps, the grey label above =
 * kg, dashed line = goal (Max reps). Green once Max is reached; back-off sets dashed orange as in the workout; today
 * marked, and an open dashed bar while its sets are not checked yet.
 */
function HistoryChart({ bars, minimum, target, neutral }: { bars: HistoryBar[]; minimum: number; target: number; neutral: boolean }) {
  const W = 340
  const H = 176
  const left = 24
  const bottom = 22
  const topPad = 30
  const values = bars.map((b) => b.reps).filter((r): r is number => r !== null)
  const base = Math.min(minimum, ...values) - 2
  const top = Math.max(target, ...values) + 0.4
  const y = (r: number) => topPad + ((top - r) / (top - base)) * (H - topPad - bottom)
  const bw = (W - left) / Math.max(bars.length, 1)
  const ticks = []
  for (let r = base + 1; r <= Math.floor(top); r++) ticks.push(r)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Reps and weight of the last workouts">
      {ticks.map((r) => (
        <g key={r}>
          <line x1={left} x2={W} y1={y(r)} y2={y(r)} className={r === target ? 'stroke-emerald-500' : 'stroke-zinc-200 dark:stroke-zinc-800'} strokeDasharray={r === target ? '4 4' : undefined} />
          <text x={left - 5} y={y(r) + 3.5} textAnchor="end" fontSize="10" className={r === target ? 'fill-emerald-600 font-bold dark:fill-emerald-400' : 'fill-zinc-400 dark:fill-zinc-500'}>{r}</text>
        </g>
      ))}
      <text x={0} y={12} fontSize="9.5" className="fill-zinc-400 dark:fill-zinc-500">reps</text>
      {bars.map((b, i) => {
        const cx = left + i * bw + bw / 2
        const w = Math.min(30, bw * 0.66)
        const isToday = b.date === 'today'
        const label = isToday ? 'Today' : shortDay(new Date(b.date))
        if (b.reps === null) {
          return (
            <g key={i}>
              {isToday && <rect x={cx - w / 2} y={y(target)} width={w} height={H - bottom - y(target)} rx={5} className="fill-none stroke-zinc-400 dark:stroke-zinc-600" strokeDasharray="3 3" />}
              <text x={cx} y={isToday ? (y(target) + H - bottom) / 2 + 3 : H - bottom - 4} textAnchor="middle" fontSize="10" className="fill-zinc-400 dark:fill-zinc-500">{isToday ? 'open' : '–'}</text>
              <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" className={isToday ? 'fill-zinc-900 font-bold dark:fill-zinc-100' : 'fill-zinc-400 dark:fill-zinc-500'}>{label}</text>
            </g>
          )
        }
        const reached = b.reps >= target
        const fill = neutral ? 'fill-orange-50 stroke-orange-400 dark:fill-orange-500/10' : reached ? 'fill-emerald-600 dark:fill-emerald-500' : 'fill-accent'
        const kgText = b.kg === null ? '' : `${formatNumber(b.kg)} kg`
        const chip = Math.max(30, kgText.length * 5.6 + 8)
        return (
          <g key={i}>
            <rect x={cx - w / 2} y={y(b.reps)} width={w} height={H - bottom - y(b.reps)} rx={5} className={fill} strokeDasharray={neutral ? '3 3' : undefined}
              strokeWidth={isToday && !neutral ? 0 : undefined} />
            {isToday && <rect x={cx - w / 2 - 2} y={y(b.reps) - 2} width={w + 4} height={H - bottom - y(b.reps) + 2} rx={6} className="fill-none stroke-zinc-900 dark:stroke-zinc-100" strokeWidth={1.5} />}
            <text x={cx} y={y(b.reps) + 13} textAnchor="middle" fontSize="11" fontWeight="800" className={neutral ? 'fill-orange-700 dark:fill-orange-300' : 'fill-white'}>{b.reps}</text>
            {kgText && (
              <g>
                <rect x={cx - chip / 2} y={y(b.reps) - 19} width={chip} height={15} rx={4} className="fill-zinc-100 dark:fill-zinc-800" />
                <text x={cx} y={y(b.reps) - 8} textAnchor="middle" fontSize="9.5" fontWeight="700" className="fill-zinc-700 dark:fill-zinc-200">{kgText}</text>
              </g>
            )}
            <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" className={isToday ? 'fill-zinc-900 font-bold dark:fill-zinc-100' : 'fill-zinc-400 dark:fill-zinc-500'}>{label}</text>
          </g>
        )
      })}
    </svg>
  )
}
