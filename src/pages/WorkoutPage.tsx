import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import Field from '../components/Field'
import RestTimer from '../components/RestTimer'
import SyncBadge from '../components/SyncBadge'
import { useNow } from '../hooks/useNow'
import { startRest, stopRest } from '../lib/rest'
import { db, displayName, type Exercise, type Workout, type WorkoutExercise, type WorkoutSet } from '../lib/db'
import {
  addSet,
  cancelWorkout,
  describeSet,
  effective,
  finishWorkout,
  formatDuration,
  formatNumber,
  openSetCount,
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
}

const FLOOR = { oben: 'Oben', unten: 'Unten' } as const

async function loadBlocks(workoutId: string): Promise<ExerciseBlock[]> {
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
      return {
        we,
        exercise,
        name: exercise ? displayName(exercise, byId) : 'Unbekannte Übung',
        sets: allSets
          .filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null)
          .sort((a, b) => a.position - b.position),
        previous: await previousSets(we.exercise_id, workoutId),
      }
    }),
  )
}

export default function WorkoutPage({ workout, onReauth }: Props) {
  const blocks = useLiveQuery(() => loadBlocks(workout.id), [workout.id])
  const exercises = useLiveQuery(() => db.exercise.toArray(), [])
  const now = useNow(1000)
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
      <header className="mb-4 flex items-center justify-between gap-2 pt-[max(env(safe-area-inset-top),1rem)]">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{workout.template_name_snapshot ?? 'Training'}</h1>
          <p className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">{formatDuration(elapsed)}</p>
        </div>
        <div className="flex items-center gap-1">
          <SyncBadge onReauth={onReauth} />
          <button
            onClick={() => void askFinish()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Abschliessen
          </button>
        </div>
      </header>

      {blocks === undefined ? (
        <p className="text-neutral-500">Laden …</p>
      ) : (
        <div className="flex flex-col gap-4">
          {blocks.map((b) => (
            <ExerciseCard key={b.we.id} block={b} byId={byId} />
          ))}
        </div>
      )}

      <label className="mt-6 flex flex-col gap-1">
        <span className="text-sm text-neutral-500 dark:text-neutral-400">Notiz zum Training</span>
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
        Training abbrechen
      </button>

      {confirm && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setConfirm(null)}>
          <div
            className="w-full rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-sm sm:rounded-2xl dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            {confirm.kind === 'finish' ? (
              <>
                <h2 className="mb-2 text-lg font-semibold">Training abschliessen?</h2>
                <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
                  {confirm.open === 0
                    ? 'Alle Sätze sind abgehakt.'
                    : `${confirm.open} nicht abgehakte ${confirm.open === 1 ? 'Satz wird' : 'Sätze werden'} verworfen.`}
                </p>
                <button onClick={() => void doFinish()} className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white">
                  Abschliessen
                </button>
              </>
            ) : (
              <>
                <h2 className="mb-2 text-lg font-semibold">Training abbrechen?</h2>
                <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">Alle erfassten Sätze dieses Trainings werden verworfen.</p>
                <button onClick={() => void doCancel()} className="w-full rounded-lg bg-red-600 px-4 py-3 font-semibold text-white">
                  Training verwerfen
                </button>
              </>
            )}
            <button onClick={() => setConfirm(null)} className="mt-2 w-full rounded-lg px-4 py-3 text-sm text-neutral-600 dark:text-neutral-300">
              Zurück
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

function ExerciseCard({ block, byId }: { block: ExerciseBlock; byId: Map<string, Exercise> }) {
  const { we, exercise, name, sets, previous } = block
  const [rirHelp, setRirHelp] = useState(false)
  const eff = exercise
    ? effective(exercise, byId)
    : { trackingType: 'weight_reps', isUnilateral: false, floor: null, seat: null, footPosition: null, setupNote: null }
  const settings = [
    eff.floor ? FLOOR[eff.floor] : null,
    eff.seat ? `Sitz ${eff.seat}` : null,
    eff.footPosition ? `Füsse ${eff.footPosition}` : null,
    eff.setupNote,
  ].filter(Boolean)

  const prevWorking = previous.filter((s) => s.set_type === 'working')
  // RIR is recorded only for the last working set of an exercise
  const lastWorkingId = sets.filter((s) => s.set_type === 'working').at(-1)?.id
  const prevWarmup = previous.filter((s) => s.set_type === 'warmup')
  let workingNo = 0
  let warmupNo = 0

  const tt = eff.trackingType
  const cols =
    tt === 'duration'
      ? 'grid-cols-[1.5rem_1fr_6rem_2.75rem]'
      : tt === 'distance_duration'
        ? 'grid-cols-[1.5rem_1fr_4.5rem_5rem_2.75rem]'
        : eff.isUnilateral
          ? 'grid-cols-[1.5rem_1fr_3.25rem_2.75rem_2.75rem_2.75rem_2.5rem]'
          : 'grid-cols-[1.5rem_1fr_3.75rem_3.25rem_3rem_2.75rem]'

  return (
    <section className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="font-semibold">{name}</h2>
      {settings.length > 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">{settings.join(' · ')}</p>}
      {we.comment && <p className="text-sm text-neutral-500 italic dark:text-neutral-400">{we.comment}</p>}

      {rirHelp && (
        <p className="mt-3 rounded-md bg-neutral-100 p-2 text-sm text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
          RIR = Reps in Reserve: Wiederholungen, die mit sauberer Technik noch möglich gewesen wären (0 = Muskelversagen,
          2 = zwei weitere wären gegangen). Nur beim letzten Satz, freiwillig. Ziel: 1–2.
        </p>
      )}

      <div className={`mt-3 grid ${cols} items-center gap-x-1 gap-y-1.5 text-xs text-neutral-500 dark:text-neutral-400`}>
        <span className="text-center">Satz</span>
        <span>Vorher</span>
        {tt === 'duration' && <span className="text-center">Zeit</span>}
        {tt === 'distance_duration' && (
          <>
            <span className="text-center">km</span>
            <span className="text-center">Zeit</span>
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
              <span className="text-center">Wdh.</span>
            )}
            <button
              onClick={() => setRirHelp((v) => !v)}
              aria-expanded={rirHelp}
              className="text-center underline decoration-dotted underline-offset-2"
            >
              RIR ⓘ
            </button>
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
              restSeconds={we.rest_s}
              showRir={s.id === lastWorkingId}
            />
          )
        })}
      </div>

      <div className="mt-2 flex gap-2">
        <button onClick={() => void addSet(we)} className="flex-1 rounded-lg bg-neutral-100 py-2 text-sm font-medium dark:bg-neutral-800">
          + Satz
        </button>
        {sets.length > 0 && (
          <button
            onClick={() => void removeLastSet(we)}
            className="rounded-lg px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400"
          >
            Satz entfernen
          </button>
        )}
      </div>
    </section>
  )
}

interface SetRowProps {
  set: WorkoutSet
  label: string
  previous: [string, string]
  trackingType: string
  unilateral: boolean
  restSeconds: number | null
  showRir: boolean
}

function SetRow({ set, label, previous, trackingType, unilateral, restSeconds, showRir }: SetRowProps) {
  const done = set.completed_at !== null

  function numberCommit(field: 'weight' | 'reps' | 'reps_left' | 'reps_right' | 'distance_km', integer: boolean) {
    return (input: string) => {
      const n = parseNumber(input)
      if (n === undefined || (integer && n !== null && !Number.isInteger(n))) return false
      void updateSet(set, { [field]: n })
      return true
    }
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
      <span className={`flex h-10 items-center justify-center rounded-md text-sm font-medium text-neutral-700 dark:text-neutral-200 ${rowTone}`}>
        {label}
      </span>
      <span className="flex min-w-0 flex-col text-[11px] leading-tight text-neutral-500 tabular-nums dark:text-neutral-400">
        <span className="truncate">{previous[0]}</span>
        {previous[1] && <span className="truncate">{previous[1]}</span>}
      </span>
      {trackingType === 'duration' && (
        <Field label="Zeit" inputMode="text" placeholder="mm:ss" value={formatDuration(set.duration_s)} onCommit={durationCommit} />
      )}
      {trackingType === 'distance_duration' && (
        <>
          <Field label="Distanz km" inputMode="decimal" value={formatNumber(set.distance_km)} onCommit={numberCommit('distance_km', false)} />
          <Field label="Zeit" inputMode="text" placeholder="mm:ss" value={formatDuration(set.duration_s)} onCommit={durationCommit} />
        </>
      )}
      {trackingType === 'weight_reps' && (
        <>
          <Field label="Gewicht kg" inputMode="decimal" value={formatNumber(set.weight)} onCommit={numberCommit('weight', false)} />
          {unilateral ? (
            <>
              <Field label="Wiederholungen links" inputMode="numeric" value={formatNumber(set.reps_left)} onCommit={numberCommit('reps_left', true)} />
              <Field label="Wiederholungen rechts" inputMode="numeric" value={formatNumber(set.reps_right)} onCommit={numberCommit('reps_right', true)} />
            </>
          ) : (
            <Field label="Wiederholungen" inputMode="numeric" value={formatNumber(set.reps)} onCommit={numberCommit('reps', true)} />
          )}
          {showRir ? (
            <select
              aria-label="RIR"
              value={set.rir === null ? '' : String(set.rir)}
              onChange={(e) => void updateSet(set, { rir: e.target.value === '' ? null : Number(e.target.value) })}
              className="h-10 w-full min-w-0 appearance-none rounded-md bg-neutral-100 text-center text-base tabular-nums dark:bg-neutral-800"
            >
              <option value="">–</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4+</option>
            </select>
          ) : (
            <span />
          )}
        </>
      )}
      <button
        aria-label={done ? 'Satz offen' : 'Satz erledigt'}
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
