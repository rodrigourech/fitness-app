import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import AppBar from '../components/AppBar'
import ExerciseSheet from '../components/ExerciseSheet'
import ExercisePicker from '../components/ExercisePicker'
import Field from '../components/Field'
import Popover from '../components/Popover'
import RestTimer from '../components/RestTimer'
import SyncBadge from '../components/SyncBadge'
import { useNow } from '../hooks/useNow'
import { startRest, stopRest } from '../lib/rest'
import { db, displayName, type Exercise, type ExerciseLink, type Workout, type WorkoutExercise, type WorkoutSet } from '../lib/db'
import { linkLabel, linksFor } from '../lib/exercise'
import { bestBefore, recordsOf, shouldIncrease, targetRepsFor, type Best } from '../lib/stats'
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
  previousSets,
  removeLastSet,
  toggleSetDone,
  updateSet,
  updateWorkout,
} from '../lib/workout'

interface Props {
  workout: Workout
  onReauth: () => void
}

interface ExerciseBlock {
  we: WorkoutExercise
  exercise: Exercise | undefined
  name: string
  sets: WorkoutSet[]
  previous: WorkoutSet[]
  links: ExerciseLink[]
  best: Best
  increase: boolean
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
      const prev = await previousSets(we.exercise_id, workoutId)
      return {
        we,
        exercise,
        name: exercise ? displayName(exercise, byId) : 'Unknown exercise',
        sets: allSets
          .filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null)
          .sort((a, b) => a.position - b.position),
        previous: prev,
        links: exercise ? await linksFor(exercise) : [],
        best: await bestBefore(we.exercise_id, workoutId),
        increase: shouldIncrease(prev, await targetRepsFor(templateId, we.exercise_id)),
      }
    }),
  )
}

export default function WorkoutPage({ workout, onReauth }: Props) {
  const blocks = useLiveQuery(() => loadBlocks(workout.id, workout.template_id), [workout.id, workout.template_id])
  const exercises = useLiveQuery(() => db.exercise.toArray(), [])
  const now = useNow(1000)
  const [sheet, setSheet] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
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

  return (
    <main className="mx-auto max-w-xl px-4 pb-32">
      <RestTimer />
      <AppBar>
        <SyncBadge onReauth={onReauth} />
      </AppBar>
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{workout.template_name_snapshot ?? 'Workout'}</h1>
          <p className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{formatDuration(elapsed)}</p>
        </div>
        <button onClick={() => void askFinish()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
          Finish
        </button>
      </header>

      {blocks === undefined ? (
        <p className="text-neutral-500">Loading …</p>
      ) : (
        <div className="flex flex-col gap-4">
          {blocks.map((b) => (
            <ExerciseCard key={b.we.id} block={b} byId={byId} onOpen={setSheet} />
          ))}
        </div>
      )}

      <button
        onClick={() => setPicking(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-neutral-300 py-3 text-sm font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
      >
        + Add exercise
      </button>

      <label className="mt-6 flex flex-col gap-1">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">Workout note</span>
        <textarea
          defaultValue={workout.note ?? ''}
          onBlur={(e) => void updateWorkout(workout, { note: e.target.value.trim() || null })}
          rows={2}
          className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700"
        />
      </label>

      <button
        onClick={() => setConfirm({ kind: 'cancel' })}
        className="mt-6 w-full rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400"
      >
        Discard workout
      </button>

      {confirm && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setConfirm(null)}>
          <div
            className="w-full rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-sm sm:rounded-2xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            {confirm.kind === 'finish' ? (
              <>
                <h2 className="mb-2 text-lg font-semibold">Finish workout?</h2>
                <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
                  {confirm.open === 0
                    ? 'All sets are checked.'
                    : `${confirm.open} unchecked ${confirm.open === 1 ? 'set' : 'sets'} will be discarded.`}
                </p>
                <button onClick={() => void doFinish()} className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white">
                  Finish
                </button>
              </>
            ) : (
              <>
                <h2 className="mb-2 text-lg font-semibold">Discard workout?</h2>
                <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">All sets of this workout will be discarded.</p>
                <button onClick={() => void doCancel()} className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">
                  Discard
                </button>
              </>
            )}
            <button onClick={() => setConfirm(null)} className="mt-2 w-full rounded-lg px-4 py-3 text-sm text-neutral-600 dark:text-neutral-300">
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
  const { we, exercise, name, sets, previous, links, best, increase } = block
  const eff = exercise
    ? effective(exercise, byId)
    : { trackingType: 'weight_reps', isUnilateral: false, floor: null, seat: null, footPosition: null, setupNote: null, focusMuscles: [] as string[], focusCue: null, restS: null }

  const prevWorking = previous.filter((s) => s.set_type === 'working')
  // RIR is recorded only for the last working set, below the set rows
  const lastWorking = sets.filter((s) => s.set_type === 'working').at(-1)
  const prevWarmup = previous.filter((s) => s.set_type === 'warmup')
  let workingNo = 0
  let warmupNo = 0

  const tt = eff.trackingType
  const cols =
    tt === 'duration'
      ? 'grid-cols-[1.5rem_1fr_6rem_2.75rem]'
      : tt === 'distance_duration'
        ? 'grid-cols-[1.5rem_1fr_3.25rem_4rem_4rem_2.5rem]'
        : eff.isUnilateral
          ? 'grid-cols-[1.5rem_1fr_3.5rem_3rem_3rem_2.75rem]'
          : 'grid-cols-[1.5rem_1fr_4.25rem_3.75rem_2.75rem]'

  return (
    <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-2">
        <button onClick={() => onOpen(we.exercise_id)} className="text-left">
          <h2 className="font-semibold underline-offset-2 hover:underline">
            {name} <span className="text-neutral-400">›</span>
          </h2>
        </button>
        <VideoButton links={links} />
      </div>
      {eff.setupNote && <p className="text-sm whitespace-pre-line text-neutral-500 dark:text-neutral-400">{eff.setupNote}</p>}
      {increase && (
        <p className="mt-1 rounded-md bg-emerald-50 px-2 py-1 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          ↑ Last time every set hit the target with RIR ≥ 2 – increase the weight.
        </p>
      )}


      <div className={`mt-3 grid ${cols} items-center gap-x-1 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400`}>
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
              restSeconds={eff.restS ?? we.rest_s}
              records={recordsOf(s, best)}
            />
          )
        })}
      </div>

      {tt === 'weight_reps' && lastWorking && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5">
            <Popover
              hover
              label={<>RIR ⓘ</>}
              ariaLabel="What is RIR?"
              triggerClassName="mr-1 text-xs text-neutral-500 underline decoration-dotted underline-offset-2 dark:text-neutral-400"
            >
              <RirHelp />
            </Popover>
            {RIR_OPTIONS.map((o) => {
              const active = lastWorking.rir === o.value
              return (
                <button
                  key={o.label}
                  aria-pressed={active}
                  onClick={() => void updateSet(lastWorking, { rir: o.value })}
                  className={`h-8 min-w-8 rounded-md px-2 text-sm tabular-nums ${
                    active
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="mt-2 flex gap-2">
        <button onClick={() => void addSet(we)} className="flex-1 rounded-lg bg-neutral-100 py-2 text-sm font-medium dark:bg-neutral-800">
          + Add set
        </button>
        {sets.length > 0 && (
          <button
            onClick={() => void removeLastSet(we)}
            className="rounded-lg px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400"
          >
            Remove set
          </button>
        )}
      </div>
    </section>
  )
}

function RirHelp() {
  return (
    <>
      <span className="mb-1 block font-semibold">RIR – Reps in Reserve</span>
      <span className="mb-2 block text-neutral-600 dark:text-neutral-300">How many more reps you could have done with clean form.</span>
      <span className="grid grid-cols-[2rem_1fr] gap-x-2 gap-y-0.5 tabular-nums">
        <b>0</b>
        <span>failure, no rep left</span>
        <b>1</b>
        <span>one more rep possible</span>
        <b>2</b>
        <span>two more reps possible</span>
        <b>4+</b>
        <span>clearly easy</span>
      </span>
      <span className="mt-2 block text-xs text-neutral-500 dark:text-neutral-400">Target 1–2 · last set only · optional</span>
    </>
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
          <span className="mb-1 text-xs text-neutral-500 dark:text-neutral-400">Choose a video</span>
          {links.map((l) => (
            <a
              key={l.id}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
              className="truncate rounded-md px-2 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              ▶ {linkLabel(l)}
            </a>
          ))}
        </span>
      )}
    </Popover>
  )
}

const RIR_OPTIONS: { label: string; value: number | null }[] = [
  { label: '–', value: null },
  { label: '0', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4+', value: 4 },
]

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
        className={`flex h-10 flex-col items-center justify-center rounded-md text-sm leading-none font-medium text-neutral-700 dark:text-neutral-200 ${rowTone}`}
      >
        {label}
        {records.length > 0 && <span className="mt-0.5 text-[9px] font-bold text-amber-600 dark:text-amber-400">PR</span>}
      </span>
      <span className="flex min-w-0 flex-col text-[11px] leading-tight text-neutral-500 tabular-nums dark:text-neutral-400">
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
          done ? 'bg-emerald-600 text-white' : 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500'
        }`}
      >
        ✓
      </button>
    </>
  )
}
