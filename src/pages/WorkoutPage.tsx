import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import AppBar from '../components/AppBar'
import CrowdPicker from '../components/CrowdPicker'
import ExerciseSheet from '../components/ExerciseSheet'
import ExercisePicker from '../components/ExercisePicker'
import Field from '../components/Field'
import Popover from '../components/Popover'
import RestTimer from '../components/RestTimer'
import SyncBadge from '../components/SyncBadge'
import InfoPage from './InfoPage'
import { useNow } from '../hooks/useNow'
import { useSwipeDown } from '../hooks/useSwipeDown'
import { startRest, stopRest } from '../lib/rest'
import { db, displayName, type Exercise, type ExerciseLink, type Workout, type WorkoutExercise, type WorkoutSet } from '../lib/db'
import { linkLabel, linksFor } from '../lib/exercise'
import { bestBefore, recordsOf, type Best } from '../lib/stats'
import { belowMinimum, progressionAdvice, type ProgressionAdvice } from '../lib/progression'
import { repetitionTargets, type RepetitionTargets } from '../lib/training'
import { increaseMarks, recommendations, warmUpWeight, type Recommendation } from '../lib/topset'
import { DEFAULT_TRAINING_SHARES, getTrainingShares, type TrainingShares } from '../lib/settings'
import {
  addExerciseToWorkout,
  addSet,
  applyPace,
  cancelWorkout,
  describeSet,
  effective,
  finishWorkout,
  formatDuration,
  formatNumber,
  openSetCount,
  paceSeconds,
  parseDuration,
  parseNumber,
  recentTrainingSessions,
  removeLastSet,
  unskipExercise,
  toggleSetDone,
  updateSet,
  updateWorkout,
} from '../lib/workout'

interface Props {
  workout: Workout
  onReauth: () => void
  /** Shrinks the workout to a bar so the rest of the app can be used */
  onMinimize: () => void
}

interface ExerciseBlock {
  we: WorkoutExercise
  exercise: Exercise | undefined
  name: string
  /** Variant name shown below the main exercise */
  variant: string | null
  topSet: boolean
  weightStep: number | null
  trackingType: string
  sets: WorkoutSet[]
  previous: WorkoutSet[]
  links: ExerciseLink[]
  best: Best
  advice: ProgressionAdvice
  targets: RepetitionTargets
}

async function loadBlocks(workoutId: string, templateId: string | null): Promise<ExerciseBlock[]> {
  const [wes, exercises] = await Promise.all([
    db.workout_exercise.where('workout_id').equals(workoutId).toArray(),
    db.exercise.toArray(),
  ])
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const active = wes.filter((we) => we.deleted_at === null).sort((a, b) => a.position - b.position)
  const allSets = await db.workout_set.where('workout_exercise_id').anyOf(active.map((we) => we.id)).toArray()
  return Promise.all(
    active.map(async (we) => {
      const exercise = byId.get(we.exercise_id)
      // Previous and progression use the last performances of this exercise in any workout
      const sessions = await recentTrainingSessions(we.exercise_id, undefined, workoutId)
      // Warm-up set W first, then the work sets (decision 18 October 2026)
      const sets = allSets.filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null)
        .sort((a, b) => Number(a.set_type === 'working') - Number(b.set_type === 'working') || a.position - b.position)
      const te = templateId ? await db.template_exercise.where('template_id').equals(templateId).filter((row) => row.exercise_id === we.exercise_id && row.deleted_at === null).first() : undefined
      const planned = te ? await db.template_set.where('template_exercise_id').equals(te.id).toArray() : []
      const defaults = exercise ? repetitionTargets(exercise, byId, planned) : { target: 10, minimum: 7 }
      const targets = { target: we.target_reps ?? defaults.target, minimum: we.min_reps ?? defaults.minimum }
      const eff = exercise ? effective(exercise, byId) : undefined
      return {
        we,
        exercise,
        name: exercise ? (exercise.parent_id ? byId.get(exercise.parent_id)?.name ?? displayName(exercise, byId) : exercise.name) : 'Unknown exercise',
        variant: exercise?.parent_id && byId.has(exercise.parent_id) ? exercise.name : null,
        topSet: eff?.topSet ?? false,
        weightStep: eff?.weightStep ?? null,
        trackingType: eff?.trackingType ?? 'weight_reps',
        sets,
        previous: sessions[0]?.sets ?? [],
        links: exercise ? await linksFor(exercise) : [],
        best: await bestBefore(we.exercise_id, workoutId),
        advice: eff?.trackingType === 'weight_reps' ? progressionAdvice(sessions, targets, eff.isUnilateral, sets.filter((s) => s.set_type === 'working').length, eff.topSet) : null,
        targets,
      }
    }),
  )
}

export default function WorkoutPage({ workout, onReauth, onMinimize }: Props) {
  const blocks = useLiveQuery(() => loadBlocks(workout.id, workout.template_id), [workout.id, workout.template_id])
  const shares = useLiveQuery(getTrainingShares, []) ?? DEFAULT_TRAINING_SHARES
  // One legend for the whole workout when any exercise shows recommendations (decision 19 October 2026)
  const legend = blocks?.some((b) => b.trackingType === 'weight_reps' && (b.topSet || b.sets.some((s) => s.set_type === 'warmup')))
  const estimated = blocks?.some((b) => b.trackingType === 'weight_reps' && !b.weightStep && (b.topSet || b.sets.some((s) => s.set_type === 'warmup')))
  const exercises = useLiveQuery(() => db.exercise.toArray(), [])
  const now = useNow(1000)
  const [sheet, setSheet] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [info, setInfo] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'finish'; open: number } | { kind: 'cancel' }>(null)
  const byId = new Map((exercises ?? []).map((e) => [e.id, e]))

  async function askFinish() {
    setConfirm({ kind: 'finish', open: await openSetCount(workout.id) })
  }

  async function doFinish() {
    await stopRest()
    await finishWorkout(workout)
  }

  async function doCancel() {
    await stopRest()
    await cancelWorkout(workout)
  }

  const elapsed = Math.max(0, Math.floor((now - Date.parse(workout.started_at)) / 1000))
  const swipe = useSwipeDown(onMinimize)

  if (info) return <InfoPage onDone={() => setInfo(false)} />

  return (
    <main className="mx-auto max-w-xl px-4 pb-32">
      <RestTimer />
      {/* Drag handle: swipe down to minimise */}
      <div {...swipe} className="-mx-4 flex touch-none justify-center pt-[max(env(safe-area-inset-top),0.5rem)] pb-1" aria-hidden="true">
        <span className="h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
      </div>
      <AppBar>
        <button onClick={() => setInfo(true)} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Info
        </button>
        <SyncBadge onReauth={onReauth} />
      </AppBar>
      <header {...swipe} className="mb-4 flex touch-none items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onMinimize}
            aria-label="Minimise workout"
            title="Minimise"
            className="-ml-1 rounded-md p-1 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div>
          <h1 className="text-2xl font-semibold tracking-tight">{workout.template_name_snapshot ?? 'Workout'}</h1>
          <p className="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">{formatDuration(elapsed)}</p>
          </div>
        </div>
      </header>

      {blocks === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : (
        <div className="flex flex-col gap-4">
          {legend && <Legend shares={shares} estimated={estimated ?? false} />}
          {blocks.map((b) => (
            <ExerciseCard key={b.we.id} block={b} byId={byId} shares={shares} onOpen={setSheet} />
          ))}
        </div>
      )}

      <button
        onClick={() => setPicking(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
      >
        + Add exercise
      </button>

      <div className="mt-6">
        <CrowdPicker value={workout.crowd_level ?? null} onChange={(v) => void updateWorkout(workout, { crowd_level: v })} />
      </div>

      <button onClick={() => void askFinish()} className="mt-6 w-full rounded-lg bg-accent px-4 py-3 font-semibold text-accent-fg">
        Finish workout
      </button>

      <button
        onClick={() => setConfirm({ kind: 'cancel' })}
        className="mt-2 w-full rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400"
      >
        Discard workout
      </button>

      {confirm && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setConfirm(null)}>
          <div
            className="w-full rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-sm sm:rounded-2xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {confirm.kind === 'finish' ? (
              <>
                <h2 className="mb-2 text-lg font-semibold">Finish workout?</h2>
                <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">
                  {confirm.open === 0
                    ? 'All sets are checked.'
                    : `${confirm.open} unchecked ${confirm.open === 1 ? 'set' : 'sets'} will be discarded.`}
                </p>
                <button onClick={() => void doFinish()} className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-accent-fg">
                  Finish
                </button>
              </>
            ) : (
              <>
                <h2 className="mb-2 text-lg font-semibold">Discard workout?</h2>
                <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">All sets of this workout will be discarded.</p>
                <button onClick={() => void doCancel()} className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">
                  Discard
                </button>
              </>
            )}
            <button onClick={() => setConfirm(null)} className="mt-2 w-full rounded-lg px-4 py-3 text-sm text-zinc-600 dark:text-zinc-300">
              Back
            </button>
          </div>
        </div>
      )}

      {sheet && <ExerciseSheet exerciseId={sheet} onClose={() => setSheet(null)} />}
      {picking && (
        <ExercisePicker
          userId={workout.user_id}
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false)
            void addExerciseToWorkout(workout, id)
          }}
        />
      )}
    </main>
  )
}

function ExerciseCard({ block, byId, shares, onOpen }: { block: ExerciseBlock; byId: Map<string, Exercise>; shares: TrainingShares; onOpen: (exerciseId: string) => void }) {
  const { we, exercise, name, variant, topSet, weightStep, sets, previous, links, best, advice, targets } = block
  const eff = exercise
    ? effective(exercise, byId)
    : { trackingType: 'weight_reps', isUnilateral: false, floor: null, seat: null, footPosition: null, setupNote: null, focusMuscles: [] as string[], focusCue: null, restS: null }

  if (we.skipped_at)
    return (
      <section className="card flex items-center justify-between gap-3 p-3 opacity-70">
        <span className="min-w-0">
          <span className="block truncate font-semibold line-through decoration-zinc-400">{name}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Skipped in this workout</span>
        </span>
        <button onClick={() => void unskipExercise(we)} className="shrink-0 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium dark:bg-zinc-800">
          Undo
        </button>
      </section>
    )

  const prevWorking = previous.filter((s) => s.set_type === 'working')
  const prevWarmup = previous.filter((s) => s.set_type === 'warmup')
  let workingNo = 0
  let warmupNo = 0

  const tt = eff.trackingType
  // Top set and Rec. kg (decision 18 October 2026): computed live from the weights in the fields
  const working = sets.filter((s) => s.set_type === 'working')
  const current = working.map((s) => s.weight)
  const before = prevWorking.map((s) => s.weight)
  const marks = tt === 'weight_reps' && advice === 'increase' ? increaseMarks(current, before, working.map((s) => s.completed_at !== null), topSet) : []
  const recs = tt === 'weight_reps' ? recommendations(current, topSet, shares.backOff / 100, weightStep, marks.some(Boolean)) : []
  const warmKg = tt === 'weight_reps' ? warmUpWeight(current, shares.warmUp / 100, weightStep) : null
  // The column only appears when it has something to say (warm-up set or top set)
  const showRec = tt === 'weight_reps' && (sets.some((s) => s.set_type === 'warmup') || recs.some((r) => r !== null))
  const cols =
    tt === 'duration'
      ? 'grid-cols-[1.75rem_1fr_6rem_2.75rem]'
      : tt === 'distance_duration'
        ? 'grid-cols-[1.75rem_1fr_3.25rem_4rem_4rem_2.5rem]'
        : eff.isUnilateral
          ? showRec ? 'grid-cols-[1.75rem_1fr_3rem_3.25rem_2.75rem_2.75rem_2.5rem]' : 'grid-cols-[1.75rem_1fr_3.75rem_3.25rem_3.25rem_2.75rem]'
          : showRec ? 'grid-cols-[1.75rem_1fr_3rem_4rem_3.25rem_2.5rem]' : 'grid-cols-[1.75rem_1fr_4.5rem_3.75rem_2.75rem]'

  return (
    <section className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onOpen(we.exercise_id)} className="text-left">
          <h2 className="font-semibold underline-offset-2 hover:underline">
            {name} <span className="text-zinc-400">›</span>
          </h2>
          {variant && <p className="text-sm text-zinc-700 dark:text-zinc-300">{variant}</p>}
        </button>
        <span className="flex shrink-0 items-center gap-1">
          <VideoButton links={links} />
        </span>
      </div>
      {eff.setupNote && <p className="text-sm whitespace-pre-line text-zinc-500 dark:text-zinc-400">{eff.setupNote}</p>}
      {tt === 'weight_reps' && (
        <>
          {advice === 'increase' && <p className="mt-2 rounded-md bg-orange-50 px-2 py-1 text-sm text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            <span className="font-semibold">Increase weight</span><span className="text-xs"> · raise the marked weight</span>
          </p>}
          {advice === 'reduce' && <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="font-semibold">Reduce weight</p>
            <p className="text-xs">Top set below Min Reps twice at the same weight. Check rest, recovery and form before choosing a lighter weight.</p>
          </div>}
        </>
      )}


      <div className={`mt-3 grid ${cols} items-center gap-x-1 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400`}>
        <span className="text-center">Set</span>
        <span>Previous</span>
        {showRec && <span className="text-center">Rec. kg</span>}
        {tt === 'duration' && <span className="text-center">Time</span>}
        {tt === 'distance_duration' && (
          <>
            <span className="text-center">km</span>
            <span className="text-center">Time</span>
            <span className="text-center">Pace /km</span>
          </>
        )}
        {tt === 'weight_reps' && (
          <>
            <span className="text-center">kg</span>
            {eff.isUnilateral ? (
              <>
                <span className="text-center">L</span>
                <span className="text-center">R</span>
              </>
            ) : (
              <span className="text-center">Reps</span>
            )}
          </>
        )}
        <span />

        {sets.map((s) => {
          const warm = s.set_type === 'warmup'
          const prev = warm ? prevWarmup[warmupNo++] : prevWorking[workingNo++]
          const label = warm ? 'W' : String(workingNo)
          const rec: RecCellValue = !showRec ? undefined : warm ? (warmKg === null ? null : { kind: 'warm', kg: warmKg.kg, estimate: warmKg.estimate }) : recs[workingNo - 1] ?? null
          return (
            <SetRow
              key={s.id}
              set={s}
              label={label}
              rec={rec}
              mark={!warm && (marks[workingNo - 1] ?? false)}
              previous={compactPrevious(prev, tt, eff.isUnilateral)}
              trackingType={tt}
              unilateral={eff.isUnilateral}
              restSeconds={we.rest_s ?? eff.restS}
              minimum={tt === 'weight_reps' && !warm ? targets.minimum : null}
              records={recordsOf(s, best)}
            />
          )
        })}
      </div>

      <div className="mt-2 flex gap-2">
        <button onClick={() => void addSet(we)} className="flex-1 rounded-lg bg-zinc-100 py-2 text-sm font-medium dark:bg-zinc-800">
          + Add set
        </button>
        {/* No skip button: an exercise without a checked set counts as skipped when the workout is finished */}
        {working.length > 1 && (
          <button
            onClick={() => void removeLastSet(we)}
            className="rounded-lg px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400"
          >
            Remove set
          </button>
        )}
      </div>
    </section>
  )
}

function VideoButton({ links }: { links: ExerciseLink[] }) {
  if (links.length === 0) return null
  const cls = 'shrink-0 rounded-md bg-sky-100 px-2.5 py-1 text-sm font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-300'
  if (links.length === 1) {
    const l = links[0]!
    return (
      <a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Video: ${linkLabel(l)}`} className={cls}>
        ▶ Video
      </a>
    )
  }
  return (
    <Popover label={`▶ Videos (${links.length})`} ariaLabel="Choose a video" triggerClassName={cls} align="right">
      {(close) => (
        <span className="flex flex-col">
          <span className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Choose a video</span>
          {links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className="truncate rounded-md px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ▶ {linkLabel(l)}
            </a>
          ))}
        </span>
      )}
    </Popover>
  )
}

type RecCellValue = Recommendation | { kind: 'warm'; kg: number; estimate: boolean } | undefined

/** Previous column: compact «40 × 9» for weight and reps (room for Rec. kg). */
function compactPrevious(s: WorkoutSet | undefined, trackingType: string, unilateral: boolean): [string, string] {
  if (!s || trackingType !== 'weight_reps') return describeSet(s, trackingType, unilateral)
  const reps = unilateral ? `${s.reps_left ?? '–'}/${s.reps_right ?? '–'}` : `${s.reps ?? '–'}`
  return [s.weight === null ? reps : `${s.weight} × ${reps}`, '']
}

/** Rec. kg: TOP (or ↑ next weight while the top set should be raised), back-off dashed orange, warm-up dashed blue. */
function RecCell({ rec, raise, onUse }: { rec: RecCellValue; raise: boolean; onUse: (kg: number) => void }) {
  if (rec === undefined) return null
  if (rec === null) return <span />
  const solid = 'flex h-10 items-center justify-center rounded-md border border-orange-500 bg-orange-50 text-sm font-extrabold tracking-wide text-orange-700 tabular-nums dark:bg-orange-500/10 dark:text-orange-300'
  if (rec.kind === 'top') {
    if (!raise) return <span className={solid}>TOP</span>
    const next = rec.next
    return next === null
      ? <span className={solid} aria-label="Raise the weight">↑</span>
      : <button onClick={() => onUse(next)} aria-label={`Use ${next} kg`} className={solid}>↑ {next}</button>
  }
  const kg = rec.kg
  const tone = rec.kind === 'warm' ? 'border-sky-400 text-sky-700 dark:text-sky-300' : 'border-orange-400 text-orange-700 dark:text-orange-300'
  return (
    <button onClick={() => onUse(kg)} aria-label={`Use recommended ${kg} kg`} className={`flex h-10 items-center justify-center rounded-md border border-dashed text-sm font-semibold tabular-nums ${tone}`}>
      {rec.estimate ? `≈ ${kg}` : kg}
    </button>
  )
}

/** One legend per workout: colours and the shares from Training settings. */
function Legend({ shares, estimated }: { shares: TrainingShares; estimated: boolean }) {
  const swatch = 'mr-1 inline-block h-2.5 w-3.5 rounded-sm align-[-1px]'
  return (
    <p className="card flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">
      <span><i className={`${swatch} border border-orange-500 bg-orange-100 dark:bg-orange-500/20`} />Top set</span>
      <span><i className={`${swatch} border border-dashed border-orange-400`} />Back-off {shares.backOff} %</span>
      <span><i className={`${swatch} border border-dashed border-sky-400`} />Warm-up {shares.warmUp} %</span>
      {estimated && <span className="text-orange-700 dark:text-orange-300">≈ estimated, no weight step</span>}
    </p>
  )
}

interface SetRowProps {
  set: WorkoutSet
  label: string
  /** Rec. kg cell; undefined for exercises without weight */
  rec: RecCellValue
  /** Weight field marked orange with ↑ while the weight should be raised */
  mark: boolean
  previous: [string, string]
  trackingType: string
  unilateral: boolean
  restSeconds: number | null
  /** Minimum reps; entered reps below it are marked orange */
  minimum: number | null
  records: string[]
}

function SetRow({ set, label, rec, mark, previous, trackingType, unilateral, restSeconds, minimum, records }: SetRowProps) {
  const done = set.completed_at !== null

  function numberCommit(field: 'weight' | 'reps' | 'reps_left' | 'reps_right' | 'distance_km', integer: boolean) {
    return (input: string) => {
      const n = parseNumber(input)
      if (n === undefined || (integer && n !== null && !Number.isInteger(n))) return false
      void updateSet(set, { [field]: n })
      return true
    }
  }

  function paceCommit(input: string) {
    const pace = parseDuration(input)
    if (pace === undefined) return false
    if (pace === null) return true
    const patch = applyPace(pace, set.distance_km, set.duration_s)
    if (Object.keys(patch).length) void updateSet(set, patch)
    return true
  }

  function durationCommit(input: string) {
    const n = parseDuration(input)
    if (n === undefined) return false
    void updateSet(set, { duration_s: n })
    return true
  }

  async function toggle() {
    // An empty warm-up weight takes the recommendation when the set is checked
    if (set.completed_at === null && set.weight === null && rec?.kind === 'warm') await updateSet(set, { weight: rec.kg })
    const nowDone = await toggleSetDone(set)
    if (nowDone && restSeconds) await startRest(restSeconds)
  }

  const warm = set.set_type === 'warmup'
  const top = rec?.kind === 'top'
  const rowTone = done ? 'bg-emerald-50 dark:bg-emerald-950/40' : warm ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : top ? 'bg-orange-50 dark:bg-orange-500/10' : ''

  return (
    <>
      <span
        title={records.length ? `Personal record: ${records.join(', ')}` : undefined}
        className={`flex h-10 flex-col items-center justify-center rounded-md text-sm leading-none font-medium text-zinc-700 dark:text-zinc-200 ${rowTone}`}
      >
        {label}
        {records.length > 0 && <span className="mt-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">PR</span>}
      </span>
      <span className="min-w-0 truncate text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        {previous[1] ? `${previous[0]} ${previous[1]}` : previous[0]}
      </span>
      <RecCell rec={rec} raise={mark} onUse={(kg) => void updateSet(set, { weight: kg })} />
      {trackingType === 'duration' && (
        <Field label="Time" inputMode="text" placeholder="mm:ss" value={formatDuration(set.duration_s)} onCommit={durationCommit} />
      )}
      {trackingType === 'distance_duration' && (
        <>
          <Field label="Distance km" inputMode="decimal" value={formatNumber(set.distance_km)} onCommit={numberCommit('distance_km', false)} />
          <Field label="Time" inputMode="text" placeholder="mm:ss" value={formatDuration(set.duration_s)} onCommit={durationCommit} />
          <Field
            label="Pace per km"
            inputMode="text"
            placeholder="mm:ss"
            value={formatDuration(paceSeconds(set.duration_s, set.distance_km))}
            onCommit={paceCommit}
          />
        </>
      )}
      {trackingType === 'weight_reps' && (
        <>
          <span className="relative">
            <Field label="Weight kg" inputMode="decimal" value={formatNumber(set.weight)} onCommit={numberCommit('weight', false)} mark={mark}
              placeholder={warm && rec?.kind === 'warm' ? (rec.estimate ? `≈ ${rec.kg}` : String(rec.kg)) : undefined} />
            {mark && <span aria-hidden="true" className="pointer-events-none absolute top-0 right-1 text-[11px] font-extrabold text-orange-500">↑</span>}
          </span>
          {unilateral ? (
            <>
              <Field label="Reps left" inputMode="numeric" value={formatNumber(set.reps_left)} onCommit={numberCommit('reps_left', true)} warn={belowMinimum(set.reps_left, minimum)} />
              <Field label="Reps right" inputMode="numeric" value={formatNumber(set.reps_right)} onCommit={numberCommit('reps_right', true)} warn={belowMinimum(set.reps_right, minimum)} />
            </>
          ) : (
            <Field label="Reps" inputMode="numeric" value={formatNumber(set.reps)} onCommit={numberCommit('reps', true)} warn={belowMinimum(set.reps, minimum)} />
          )}
        </>
      )}
      <button
        aria-label={done ? 'Mark set as not done' : 'Mark set as done'}
        aria-pressed={done}
        onClick={() => void toggle()}
        className={`flex h-10 items-center justify-center rounded-md text-lg font-bold ${
          done ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
        }`}
      >
        ✓
      </button>
    </>
  )
}

