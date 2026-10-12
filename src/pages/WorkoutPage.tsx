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
import { compareRepetitions, progressionAdvice, type ProgressionAdvice } from '../lib/progression'
import { repetitionTargets, type RepetitionTargets } from '../lib/training'
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
  sets: WorkoutSet[]
  previous: WorkoutSet[]
  links: ExerciseLink[]
  best: Best
  advice: ProgressionAdvice
  targets: RepetitionTargets
  warmUp: boolean
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
      const sessions = await recentTrainingSessions(we.exercise_id, templateId, workoutId)
      const sets = allSets.filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null && s.set_type === 'working').sort((a, b) => a.position - b.position)
      const te = templateId ? await db.template_exercise.where('template_id').equals(templateId).filter((row) => row.exercise_id === we.exercise_id && row.deleted_at === null).first() : undefined
      const planned = te ? await db.template_set.where('template_exercise_id').equals(te.id).toArray() : []
      const defaults = exercise ? repetitionTargets(exercise, byId, planned) : { target: 10, minimum: 7 }
      const targets = { target: we.target_reps ?? defaults.target, minimum: we.min_reps ?? defaults.minimum }
      const eff = exercise ? effective(exercise, byId) : undefined
      return {
        we,
        exercise,
        name: exercise ? displayName(exercise, byId) : 'Unknown exercise',
        sets,
        previous: sessions[0]?.sets ?? [],
        links: exercise ? await linksFor(exercise) : [],
        best: await bestBefore(we.exercise_id, workoutId),
        advice: eff?.trackingType === 'weight_reps' ? progressionAdvice(sessions, targets, eff.isUnilateral, sets.length) : null,
        targets,
        warmUp: we.warm_up ?? eff?.warmUp ?? false,
      }
    }),
  )
}

export default function WorkoutPage({ workout, onReauth, onMinimize }: Props) {
  const blocks = useLiveQuery(() => loadBlocks(workout.id, workout.template_id), [workout.id, workout.template_id])
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
        <button onClick={() => void askFinish()} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg">
          Finish
        </button>
      </header>

      {blocks === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : (
        <div className="flex flex-col gap-4">
          {blocks.map((b) => (
            <ExerciseCard key={b.we.id} block={b} byId={byId} onOpen={setSheet} />
          ))}
        </div>
      )}

      <button
        onClick={() => setPicking(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
      >
        + Add exercise
      </button>

      <label className="mt-6 flex flex-col gap-1">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Workout note</span>
        <textarea
          defaultValue={workout.note ?? ''}
          onBlur={(e) => void updateWorkout(workout, { note: e.target.value.trim() || null })}
          rows={2}
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700"
        />
      </label>

      <div className="mt-6">
        <CrowdPicker value={workout.crowd_level ?? null} onChange={(v) => void updateWorkout(workout, { crowd_level: v })} />
      </div>

      <button
        onClick={() => setConfirm({ kind: 'cancel' })}
        className="mt-6 w-full rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400"
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

function ExerciseCard({ block, byId, onOpen }: { block: ExerciseBlock; byId: Map<string, Exercise>; onOpen: (exerciseId: string) => void }) {
  const { we, exercise, name, sets, previous, links, best, advice, targets, warmUp } = block
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
  const comparison = compareRepetitions(sets, previous, eff.isUnilateral)
  const cols =
    tt === 'duration'
      ? 'grid-cols-[1.5rem_1fr_6rem_2.75rem]'
      : tt === 'distance_duration'
        ? 'grid-cols-[1.5rem_1fr_3.25rem_4rem_4rem_2.5rem]'
        : eff.isUnilateral
          ? 'grid-cols-[1.5rem_1fr_3.5rem_3rem_3rem_2.75rem]'
          : 'grid-cols-[1.5rem_1fr_4.25rem_3.75rem_2.75rem]'

  return (
    <section className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onOpen(we.exercise_id)} className="text-left">
          <h2 className="font-semibold underline-offset-2 hover:underline">
            {name} <span className="text-zinc-400">›</span>
          </h2>
        </button>
        <span className="flex shrink-0 items-center gap-1">
          <VideoButton links={links} />
        </span>
      </div>
      {eff.setupNote && <p className="text-sm whitespace-pre-line text-zinc-500 dark:text-zinc-400">{eff.setupNote}</p>}
      {tt === 'weight_reps' && (
        <>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Target {targets.target} reps · Minimum {targets.minimum}{eff.isUnilateral ? ' per side' : ''}</p>
          {warmUp && <p className="mt-2 rounded-md bg-sky-50 px-2 py-1 text-sm text-sky-800 dark:bg-sky-950 dark:text-sky-200">Warm Up · 5–6 light reps</p>}
          {advice && <div className={`mt-2 rounded-md px-2 py-1 text-sm ${advice === 'reduce' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-accent-soft text-accent-ink'}`}>
            <p className="font-medium">{advice === 'increase' ? 'Increase weight' : advice === 'reduce' ? 'Reduce weight' : 'Keep weight'}</p>
            {advice === 'reduce' && <p className="text-xs">First work set below minimum twice at the same weight. Check rest, recovery and form before choosing a lighter weight.</p>}
          </div>}
        </>
      )}


      <div className={`mt-3 grid ${cols} items-center gap-x-1 gap-y-1.5 text-xs text-zinc-500 dark:text-zinc-400`}>
        <span className="text-center">Set</span>
        <span>Previous</span>
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
          const prev = s.set_type === 'warmup' ? prevWarmup[warmupNo++] : prevWorking[workingNo++]
          const label = s.set_type === 'warmup' ? 'W' : String(workingNo)
          return (
            <SetRow
              key={s.id}
              set={s}
              label={label}
              previous={describeSet(prev, tt, eff.isUnilateral)}
              trackingType={tt}
              unilateral={eff.isUnilateral}
              restSeconds={we.rest_s ?? eff.restS}
              records={recordsOf(s, best)}
            />
          )
        })}
      </div>

      {tt === 'weight_reps' && (
        <div className="mt-3 text-sm tabular-nums">
          <p className="font-medium">Completed reps: {comparison.total}{eff.isUnilateral ? ' (both sides)' : ''}{comparison.previousTotal !== null && ` · previous ${comparison.previousTotal}`}{comparison.delta !== null && ` · ${comparison.delta > 0 ? '+' : ''}${comparison.delta}`}</p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {comparison.reason === 'no_history' ? 'No previous performance in this workout yet.'
              : comparison.reason === 'unfinished' ? `${comparison.completed}/${comparison.planned} work sets checked. Difference shown after all work sets.`
                : comparison.reason === 'different_sets' ? 'Set count changed; totals shown without a difference.'
                  : comparison.reason === 'different_weight' ? 'Weight changed; totals shown without a difference.'
                    : comparison.reason === 'missing_reps' ? 'Enter reps for every checked set to compare.' : 'Same workout, variant, set count and weights. Keep form and rest consistent.'}
          </p>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <button onClick={() => void addSet(we)} className="flex-1 rounded-lg bg-zinc-100 py-2 text-sm font-medium dark:bg-zinc-800">
          + Add set
        </button>
        {sets.length > 0 && (
          <button
            onClick={() => void removeLastSet(we)}
            className="rounded-lg px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400"
          >
            {sets.length === 1 ? 'Remove (skip exercise)' : 'Remove set'}
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

interface SetRowProps {
  set: WorkoutSet
  label: string
  previous: [string, string]
  trackingType: string
  unilateral: boolean
  restSeconds: number | null
  records: string[]
}

function SetRow({ set, label, previous, trackingType, unilateral, restSeconds, records }: SetRowProps) {
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
    const nowDone = await toggleSetDone(set)
    if (nowDone && restSeconds) await startRest(restSeconds)
  }

  const rowTone = done ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''

  return (
    <>
      <span
        title={records.length ? `Personal record: ${records.join(', ')}` : undefined}
        className={`flex h-10 flex-col items-center justify-center rounded-md text-sm leading-none font-medium text-zinc-700 dark:text-zinc-200 ${rowTone}`}
      >
        {label}
        {records.length > 0 && <span className="mt-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">PR</span>}
      </span>
      <span className="flex min-w-0 flex-col text-[11px] leading-tight text-zinc-500 tabular-nums dark:text-zinc-400">
        <span className="truncate">{previous[0]}</span>
        {previous[1] && <span className="truncate">{previous[1]}</span>}
      </span>
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
          <Field label="Weight kg" inputMode="decimal" value={formatNumber(set.weight)} onCommit={numberCommit('weight', false)} />
          {unilateral ? (
            <>
              <Field label="Reps left" inputMode="numeric" value={formatNumber(set.reps_left)} onCommit={numberCommit('reps_left', true)} />
              <Field label="Reps right" inputMode="numeric" value={formatNumber(set.reps_right)} onCommit={numberCommit('reps_right', true)} />
            </>
          ) : (
            <Field label="Reps" inputMode="numeric" value={formatNumber(set.reps)} onCommit={numberCommit('reps', true)} />
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
