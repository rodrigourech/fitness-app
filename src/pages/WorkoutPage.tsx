import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import AppBar from '../components/AppBar'
import CrowdPicker from '../components/CrowdPicker'
import ExerciseSheet from '../components/ExerciseSheet'
import ExercisePicker from '../components/ExercisePicker'
import Field from '../components/Field'
import Popover from '../components/Popover'
import RestTimer from '../components/RestTimer'
import UpdateBar from '../components/UpdateBar'
import SyncBadge from '../components/SyncBadge'
import InfoPage from './InfoPage'
import { useNow } from '../hooks/useNow'
import { useSwipeDown } from '../hooks/useSwipeDown'
import { useSwipeX } from '../hooks/useSwipeX'
import { offerUndo } from '../lib/undo'
import UndoToast from '../components/UndoToast'
import { cardOpen, doneSummary, exerciseDone, focusId, isExtra, todoSummary } from '../lib/focus'
import { startRest, stopRest } from '../lib/rest'
import { db, displayName, type Exercise, type ExerciseLink, type Workout, type WorkoutExercise, type WorkoutSet } from '../lib/db'
import { linkLabel, linksFor } from '../lib/exercise'
import { bestBefore, recordsOf, type Best } from '../lib/stats'
import { belowMinimum, progressionAdvice, type ProgressionAdvice } from '../lib/progression'
import { repetitionTargets, type RepetitionTargets } from '../lib/training'
import ProgressionSheet from '../components/ProgressionSheet'
import { goalState, repsOf, decidingIndexes } from '../lib/goal'
import { displayWeight, increaseMarks, recommendations, warmUpWeight, type Recommendation } from '../lib/topset'
import { DEFAULT_TRAINING_SHARES, getTrainingShares, type TrainingShares } from '../lib/settings'
import {
  addExerciseToWorkout,
  addSet,
  applyPace,
  cancelWorkout,
  describeSet,
  effective,
  finishWorkout,
  openSets,
  type OpenSet,
  formatDuration,
  formatNumber,
  paceSeconds,
  parseDuration,
  parseNumber,
  recentTrainingSessions,
  alternativeOf,
  removeSet,
  switchExercise,
  skipExercise,
  unskipExercise,
  toggleSetDone,
  updateSet,
  updateWorkout,
  warmUpPlan,
} from '../lib/workout'

interface Props {
  workout: Workout
  onReauth: () => void
  /** Shrinks the workout to a bar so the rest of the app can be used */
  onMinimize: () => void
  /** Called with the workout id after «Finish workout» (opens the report) */
  onFinished?: (workoutId: string) => void
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
  /** Exercise the switch leads to: the alternative, or back to the planned exercise (decision 22 October 2026) */
  switchTo: string | null
  /** Planned exercise while its alternative is trained */
  originalName: string | null
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
      const original = we.original_exercise_id ? byId.get(we.original_exercise_id) : undefined
      const switchTarget = original ?? (exercise ? alternativeOf(exercise, byId) : null)
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
        switchTo: switchTarget ? displayName(switchTarget, byId) : null,
        originalName: original ? displayName(original, byId) : null,
      }
    }),
  )
}

export default function WorkoutPage({ workout, onReauth, onMinimize, onFinished }: Props) {
  const blocks = useLiveQuery(() => loadBlocks(workout.id, workout.template_id), [workout.id, workout.template_id])
  const shares = useLiveQuery(getTrainingShares, []) ?? DEFAULT_TRAINING_SHARES
  const exercises = useLiveQuery(() => db.exercise.toArray(), [])
  const now = useNow(1000)
  const [sheet, setSheet] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [info, setInfo] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'finish'; open: OpenSet[] } | { kind: 'cancel' }>(null)
  const byId = new Map((exercises ?? []).map((e) => [e.id, e]))
  // Focus view (decision 5 November 2026, variant B): the next open exercise is expanded, the rest are one line each;
  // a tap opens or closes any card, and a card closes by itself once its last work set is checked
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const cards = (blocks ?? []).map((b) => ({ id: b.we.id, skipped: !!b.we.skipped_at, done: exerciseDone(b.sets) }))
  const focus = focusId(cards)
  const doneIds = cards.filter((c) => c.done).map((c) => c.id).join(',')
  const seenDone = useRef<Set<string> | null>(null)
  useEffect(() => {
    const done = new Set(doneIds ? doneIds.split(',') : [])
    const before = seenDone.current
    seenDone.current = done
    if (!before) return
    const fresh = [...done].filter((id) => !before.has(id))
    if (fresh.length)
      setOverrides((o) => {
        const next = { ...o }
        for (const id of fresh) delete next[id]
        return next
      })
  }, [doneIds])
  const setOpen = (id: string, open: boolean | undefined) =>
    setOverrides((o) => {
      const next = { ...o }
      if (open === undefined) delete next[id]
      else next[id] = open
      return next
    })
  const doneCount = cards.filter((c) => c.done).length
  const countable = cards.filter((c) => !c.skipped).length

  async function askFinish() {
    setConfirm({ kind: 'finish', open: await openSets(workout.id) })
  }

  async function doFinish(markDone: string[] = []) {
    await stopRest()
    await finishWorkout(workout, markDone)
    onFinished?.(workout.id)
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
      <UndoToast />
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
      <UpdateBar placement="inline" />
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
          <p className="text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
            {formatDuration(elapsed)}
            {countable > 0 && ` · ${doneCount} of ${countable} done`}
          </p>
          </div>
        </div>
      </header>

      {blocks === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : (
        <div className="flex flex-col gap-4">
          {blocks.map((b, i) => (
            <ExerciseCard
              key={b.we.id}
              block={b}
              index={i + 1}
              byId={byId}
              shares={shares}
              onOpen={setSheet}
              open={cardOpen(b.we.id, focus, overrides[b.we.id])}
              done={cards[i]!.done}
              onToggle={(open) => setOpen(b.we.id, open)}
            />
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
                {confirm.open.length === 0 ? (
                  <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-300">All sets are checked.</p>
                ) : (
                  // Open sets by exercise and number, so a set done but not ticked can still be saved (decision 5 November 2026)
                  <>
                    <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {confirm.open.length} unchecked {confirm.open.length === 1 ? 'set' : 'sets'}:
                    </p>
                    <ul className="mb-4 max-h-48 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
                      {confirm.open.map((s) => (
                        <li key={s.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                          <span className="min-w-0 truncate">{s.exercise} <span className="text-zinc-500 dark:text-zinc-400">· Set {s.number}</span></span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {s.filled ? `${s.weight !== null ? `${displayWeight(s.weight)} × ` : ''}${s.reps ?? ''}` : <span className="font-normal text-zinc-400">empty</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {confirm.open.some((s) => s.filled) && (
                  <button
                    onClick={() => void doFinish(confirm.open.filter((s) => s.filled).map((s) => s.id))}
                    className="mb-2 w-full rounded-lg bg-accent px-4 py-3 font-semibold text-accent-fg"
                  >
                    Mark as done and finish
                  </button>
                )}
                <button
                  onClick={() => void doFinish()}
                  className={confirm.open.some((s) => s.filled)
                    ? 'w-full rounded-lg border border-zinc-300 px-4 py-3 font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-200'
                    : 'w-full rounded-lg bg-accent px-4 py-3 font-semibold text-accent-fg'}
                >
                  {confirm.open.length === 0 ? 'Finish' : 'Finish without them'}
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

interface CardProps {
  block: ExerciseBlock
  index: number
  byId: Map<string, Exercise>
  shares: TrainingShares
  onOpen: (exerciseId: string) => void
  open: boolean
  done: boolean
  /** true or false opens or closes the card; undefined returns it to the focus rule */
  onToggle: (open: boolean | undefined) => void
}

function ExerciseCard({ block, index, byId, shares, onOpen, open, done, onToggle }: CardProps) {
  const { we, exercise, name, variant, topSet, weightStep, sets, previous, links, best, advice, targets, switchTo, originalName } = block
  const eff = exercise
    ? effective(exercise, byId)
    : { trackingType: 'weight_reps', isUnilateral: false, equipment: null as string | null, floor: null, seat: null, footPosition: null, setupNote: null, focusMuscles: [] as string[], focusCue: null, restS: null }

  const [progressOpen, setProgressOpen] = useState(false)

  const anyDone = sets.some((s) => s.completed_at !== null)
  // Extra exercise (decision 5 November 2026): lightly tinted beige with the tag «Extra», may be skipped
  const extra = isExtra(we.comment)
  const extraTone = 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/15'
  const extraTag = extra ? (
    <span className="ml-1.5 rounded-md bg-amber-100 px-1.5 py-0.5 align-[2px] text-[10px] font-bold tracking-wide text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
      EXTRA
    </span>
  ) : null
  const skipped = !!we.skipped_at
  // Swipe left skips (only while no set is done), swipe right restores a skipped exercise (decision 5 November 2026)
  const swipe = useSwipeX(
    (direction) => {
      onToggle(undefined)
      if (direction === 'left') void skipExercise(we).catch(() => undefined)
      else void unskipExercise(we)
    },
    { left: !skipped && !anyDone, right: skipped },
  )
  const wrap = (content: ReactNode) => (
    <SwipeFrame dx={swipe.dx} handlers={swipe.handlers}>
      {content}
    </SwipeFrame>
  )

  if (skipped)
    return wrap(
      <section className="card flex items-center justify-between gap-3 bg-zinc-50 p-3 dark:bg-zinc-900/60">
        <span className="min-w-0">
          <span className="block truncate font-semibold text-zinc-400 line-through decoration-zinc-400 dark:text-zinc-500">{name}</span>
          <span className="block text-xs text-zinc-500 dark:text-zinc-400">Skipped · swipe right to restore</span>
        </span>
        <button
          onClick={() => void unskipExercise(we)}
          className="shrink-0 rounded-full border border-zinc-300 px-3 py-1.5 text-sm font-semibold text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
        >
          Restore
        </button>
      </section>,
    )

  if (!open)
    return wrap(
      <button
        onClick={() => onToggle(true)}
        aria-expanded={false}
        className={`card flex w-full items-center gap-3 p-3 text-left ${
          done ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/50' : extra ? extraTone : ''
        }`}
      >
        {done ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-bold text-white" aria-label="Done">✓</span>
        ) : (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-zinc-300 text-[11px] font-semibold text-zinc-400 dark:border-zinc-600">{index}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${done ? 'text-emerald-800 dark:text-emerald-200' : ''}`}>
            {name}
            {variant && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {variant}</span>}
            {!done && extraTag}
          </span>
          <span className={`block truncate text-sm tabular-nums ${done ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {done
              ? doneSummary(sets)
              : [todoSummary(sets), eff.trackingType === 'weight_reps' ? `${targets.minimum}–${targets.target} reps` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className="shrink-0 text-zinc-400" aria-hidden="true">⌄</span>
      </button>,
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
  // Progress button (decision 5 November 2026, card variant A): green ↑ when the weight goes up today or next time,
  // indigo ↓ when the top set fell below Min reps twice; the sheet explains the rest
  const goal = tt === 'weight_reps' ? goalState(working, topSet, eff.isUnilateral, targets, weightStep) : null
  const progress: ProgressState = advice === 'increase' || goal?.reached ? 'up' : advice === 'reduce' ? 'down' : 'none'
  const decidingNow = new Set(tt === 'weight_reps' ? decidingIndexes(working, topSet) : [])
  const marks = tt === 'weight_reps' && advice === 'increase' ? increaseMarks(current, before, working.map((s) => s.completed_at !== null), topSet) : []
  const recs = tt === 'weight_reps' ? recommendations(current, topSet, shares.backOff / 100, weightStep, marks.some(Boolean)) : []
  const warmPlan = warmUpPlan(eff.equipment, shares)
  const warmKg = tt === 'weight_reps' ? warmUpWeight(current, warmPlan.share, weightStep) : null
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

  return wrap(
    <section className={`card p-3 ${extra ? extraTone : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1">
        <button onClick={() => onOpen(we.exercise_id)} className="min-w-0 text-left">
          <h2 className="font-semibold underline-offset-2 hover:underline">
            {name} <span className="text-zinc-400">›</span>
            {extraTag}
          </h2>
          {(variant || tt === 'weight_reps') && (
            <p className="text-sm text-zinc-700 tabular-nums dark:text-zinc-300">
              {[variant, tt === 'weight_reps' ? `${targets.minimum}–${targets.target} reps` : null].filter(Boolean).join(' · ')}
            </p>
          )}
          {originalName && <p className="text-xs text-zinc-500 dark:text-zinc-400">Alternative for {originalName}</p>}
        </button>
        <button
          onClick={() => onToggle(false)}
          aria-label="Collapse"
          aria-expanded={true}
          title="Collapse"
          className="-mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          {/* Switch to the alternative and back while no set is done (decision 22 October 2026) */}
          {switchTo && !sets.some((s) => s.completed_at !== null) && (
            <button
              onClick={() => void switchExercise(we)}
              aria-label={`Switch to ${switchTo}`}
              title={`Switch to ${switchTo}`}
              // Round icon like progress and «i» (decision 5 November 2026: the labelled pill squeezed the name);
              // filled while the alternative is trained, a tap switches back
              className={`${roundButton} w-8 ${
                originalName
                  ? 'border-accent bg-accent-soft text-accent-ink'
                  : 'border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400'
              }`}
            >
              <span aria-hidden="true">⇄</span>
            </button>
          )}
          {tt === 'weight_reps' && <ProgressButton state={progress} onClick={() => setProgressOpen(true)} />}
          <InfoButton setup={eff.setupNote} cue={eff.focusCue} links={links} onEdit={() => onOpen(we.exercise_id)} />
        </span>
      </div>
      {/* Settings in one line (decision 5 November 2026, card variant A); the full text is behind «i» */}
      {eff.setupNote && <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">{eff.setupNote.split('\n').join(' · ')}</p>}


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
            {/* Max reps for the next weight in the column head (decision 9 November 2026, design E2) */}
            {eff.isUnilateral ? (
              <>
                <span className="text-center">L{tt === 'weight_reps' && <MaxReps n={targets.target} />}</span>
                <span className="text-center">R{tt === 'weight_reps' && <MaxReps n={targets.target} />}</span>
              </>
            ) : (
              <span className="text-center whitespace-nowrap">Reps{tt === 'weight_reps' && <MaxReps n={targets.target} />}</span>
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
              warmUp={warmPlan}
              good={!warm && decidingNow.has(workingNo - 1) && s.completed_at !== null && (repsOf(s, eff.isUnilateral) ?? 0) >= targets.target}
              records={recordsOf(s, best)}
            />
          )
        })}
      </div>

      {/* Sets are planned with Claude, so adding one is a small link; a set is removed by swiping it right
          (decision 5 November 2026, variant A) */}
      <button onClick={() => void addSet(we)} className="mt-1.5 rounded-md px-1 py-1 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100">
        + Set
      </button>
      {progressOpen && (
        <ProgressionSheet
          exerciseId={we.exercise_id}
          today={advice === 'increase' || !goal ? null : { weight: goal.weight, reps: goal.todayReps }}
          advice={advice === 'increase' || advice === 'reduce' ? advice : null}
          onClose={() => setProgressOpen(false)}
        />
      )}
    </section>,
  )
}

/** Card that follows a horizontal swipe; behind it «Skip» (left) or «Restore» (right) appears. */
function SwipeFrame({ dx, handlers, children }: { dx: number; handlers: ReturnType<typeof useSwipeX>['handlers']; children: ReactNode }) {
  return (
    <div className="relative touch-pan-y" {...handlers}>
      {dx !== 0 && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center rounded-2xl px-5 text-sm font-semibold text-white ${
            dx < 0 ? 'justify-end bg-zinc-500 dark:bg-zinc-600' : 'justify-start bg-emerald-500 dark:bg-emerald-600'
          }`}
        >
          {dx < 0 ? 'Skip' : 'Restore'}
        </div>
      )}
      <div className="relative" style={dx ? { transform: `translateX(${dx}px)` } : { transition: 'transform 150ms ease-out' }}>
        {children}
      </div>
    </div>
  )
}

function MaxReps({ n }: { n: number }) {
  return (
    <span className="ml-1 font-bold text-emerald-700 dark:text-emerald-400" title={`Max reps ${n}: reached, the weight goes up`}>
      ↑{n}
    </span>
  )
}

type ProgressState = 'up' | 'down' | 'none'

const roundButton = 'flex h-8 min-w-8 shrink-0 items-center justify-center gap-0.5 rounded-full border px-2 text-sm font-semibold'

/** Progress button (card variant A): opens the progression sheet; green ↑ or indigo ↓ when the weight should change. */
function ProgressButton({ state, onClick }: { state: ProgressState; onClick: () => void }) {
  const tone =
    state === 'up' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : state === 'down' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
      : 'border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400'
  const label = state === 'up' ? 'Progression, increase weight' : state === 'down' ? 'Progression, check weight' : 'Progression'
  return (
    <button onClick={onClick} aria-label={label} title={label} className={`${roundButton} ${tone}`}>
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 15l5-5 3 3 6-7" />
      </svg>
      {state === 'up' && <span aria-hidden="true">↑</span>}
      {state === 'down' && <span aria-hidden="true">↓</span>}
    </button>
  )
}

/** «i»: settings, execution cue and videos of the exercise (card variant A); editing in the exercise sheet. */
function InfoButton({ setup, cue, links, onEdit }: { setup: string | null; cue: string | null; links: ExerciseLink[]; onEdit: () => void }) {
  const cls = `${roundButton} w-8 border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400`
  const head = 'text-[11px] font-bold tracking-wide text-zinc-500 dark:text-zinc-400'
  return (
    <Popover label="i" ariaLabel="Exercise info" triggerClassName={cls} align="right">
      {(close) => (
        <span className="flex flex-col gap-1 text-sm">
          {setup && (
            <>
              <span className={head}>SETUP</span>
              <span className="whitespace-pre-line">{setup}</span>
            </>
          )}
          {cue && (
            <>
              <span className={`${head} ${setup ? 'mt-1.5' : ''}`}>EXECUTION</span>
              <span>{cue}</span>
            </>
          )}
          {links.length > 0 && (
            <span className={`flex flex-col ${setup || cue ? 'mt-1.5' : ''}`}>
              {links.map((l) => (
                <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" onClick={close} className="-mx-2 truncate rounded-md px-2 py-2 font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  ▶ {linkLabel(l)}
                </a>
              ))}
            </span>
          )}
          {!setup && !cue && links.length === 0 && <span className="text-zinc-500 dark:text-zinc-400">No setup, cue or video yet.</span>}
          <button
            onClick={() => {
              close()
              onEdit()
            }}
            className="-mx-2 mt-1 rounded-md px-2 py-2 text-left text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Edit exercise ›
          </button>
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

/** Rec. kg: TOP orange (or green ↑ next weight while the top set should be raised), back-off dashed orange, warm-up dashed blue. */
function RecCell({ rec, raise, onUse }: { rec: RecCellValue; raise: boolean; onUse: (kg: number) => void }) {
  if (rec === undefined) return null
  if (rec === null) return <span />
  const solid = 'flex h-10 items-center justify-center rounded-md border border-orange-500 bg-orange-50 text-sm font-extrabold tracking-wide text-orange-700 tabular-nums dark:bg-orange-500/10 dark:text-orange-300'
  if (rec.kind === 'top') {
    if (!raise) return <span className={solid.replace('text-sm', 'text-xs')}>TOP</span>
    // Raising is good news: green like the progress button (decision 3 November 2026)
    const up = 'flex h-10 items-center justify-center rounded-md border border-emerald-600 bg-emerald-50 text-sm font-extrabold tracking-wide text-emerald-700 tabular-nums dark:bg-emerald-500/10 dark:text-emerald-300'
    const next = rec.next
    return next === null
      ? <span className={up} aria-label="Raise the weight">↑</span>
      : <button onClick={() => onUse(next)} aria-label={`Use ${next} kg`} className={up}>↑ {next}</button>
  }
  const kg = rec.kg
  const tone = rec.kind === 'warm' ? 'border-sky-400 text-sky-700 dark:text-sky-300' : 'border-orange-400 text-orange-700 dark:text-orange-300'
  return (
    <button onClick={() => onUse(kg)} aria-label={`Use recommended ${kg} kg`} className={`flex h-10 items-center justify-center rounded-md border border-dashed text-sm font-semibold tabular-nums ${tone}`}>
      {rec.estimate ? `≈ ${kg}` : kg}
    </button>
  )
}

interface SetRowProps {
  set: WorkoutSet
  label: string
  /** Rec. kg cell; undefined for exercises without weight */
  rec: RecCellValue
  /** Weight field marked green with ↑ while the weight should be raised */
  mark: boolean
  previous: [string, string]
  trackingType: string
  unilateral: boolean
  restSeconds: number | null
  /** Minimum reps; entered reps below it are marked orange */
  minimum: number | null
  records: string[]
  /** Deciding set that reached Max reps: reps field light green */
  good?: boolean
  /** Warm-up reps: hint and the value saved when an empty warm-up set is checked */
  warmUp: { reps: number; hint: string }
}

function SetRow({ set, label, rec, mark, previous, trackingType, unilateral, restSeconds, minimum, records, good, warmUp }: SetRowProps) {
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
    // Empty warm-up reps take the lower value of the hint 6–7
    if (set.completed_at === null && set.set_type === 'warmup' && trackingType === 'weight_reps') {
      const patch: Partial<WorkoutSet> = unilateral
        ? { ...(set.reps_left === null ? { reps_left: warmUp.reps } : {}), ...(set.reps_right === null ? { reps_right: warmUp.reps } : {}) }
        : set.reps === null ? { reps: warmUp.reps } : {}
      if (Object.keys(patch).length) await updateSet(set, patch)
    }
    const nowDone = await toggleSetDone(set)
    if (nowDone && restSeconds) await startRest(restSeconds)
  }

  // Swipe right removes the set, with «Undo» (decision 5 November 2026)
  const swipe = useSwipeX(
    () => {
      void removeSet(set).then((restore) => offerUndo('Set removed', set.id, restore))
    },
    { left: false, right: true },
  )

  const warm = set.set_type === 'warmup'
  const top = rec?.kind === 'top'
  const rowTone = done ? 'bg-emerald-50 dark:bg-emerald-950/40' : warm ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : top ? 'bg-orange-50 dark:bg-orange-500/10' : ''

  return (
    <div className="relative col-span-full grid touch-pan-y grid-cols-subgrid select-none" {...swipe.handlers}>
      {swipe.dx > 0 && (
        <div aria-hidden="true" className="absolute inset-0 flex items-center rounded-md bg-red-500 px-3 text-sm font-semibold text-white">
          Remove
        </div>
      )}
      <div
        className={`relative col-span-full grid grid-cols-subgrid items-center ${swipe.dx ? 'bg-[var(--card)]' : ''}`}
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : { transition: 'transform 150ms ease-out' }}
      >
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
            {mark && <span aria-hidden="true" className="pointer-events-none absolute top-0 right-1 text-[11px] font-extrabold text-emerald-600">↑</span>}
          </span>
          {unilateral ? (
            <>
              <Field label="Reps left" inputMode="numeric" placeholder={warm ? warmUp.hint : undefined} value={formatNumber(set.reps_left)} onCommit={numberCommit('reps_left', true)} warn={belowMinimum(set.reps_left, minimum)} good={good} />
              <Field label="Reps right" inputMode="numeric" placeholder={warm ? warmUp.hint : undefined} value={formatNumber(set.reps_right)} onCommit={numberCommit('reps_right', true)} warn={belowMinimum(set.reps_right, minimum)} good={good} />
            </>
          ) : (
            <Field label="Reps" inputMode="numeric" placeholder={warm ? warmUp.hint : undefined} value={formatNumber(set.reps)} onCommit={numberCommit('reps', true)} warn={belowMinimum(set.reps, minimum)} good={good} />
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
      </div>
    </div>
  )
}

