import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import CopyShare from '../components/CopyShare'
import CrowdPicker from '../components/CrowdPicker'
import Sheet from '../components/Sheet'
import { db, type Workout, type WorkoutSet } from '../lib/db'
import { exportJson, exportSetsCsv } from '../lib/export'
import { EXPORT_RANGES, historyMarkdown, loadExportData, workoutMarkdown, workoutsInRange, type ExportRange } from '../lib/markdown'
import Field from '../components/Field'
import {
  addHistorySet,
  deleteWorkout,
  finishedWorkouts,
  removeHistorySet,
  updateHistorySet,
  workoutDetail,
  type DetailExercise,
  type WorkoutSummary,
} from '../lib/history'
import { effectiveReps, epley, volume } from '../lib/stats'
import { belowMinimum } from '../lib/progression'
import { topIndex } from '../lib/topset'
import { offerUndo } from '../lib/undo'
import { formatDuration, formatNumber, paceSeconds, parseDuration, parseNumber, updateWorkout } from '../lib/workout'

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export default function HistoryTab() {
  const list = useLiveQuery(finishedWorkouts, [])
  // Looked up in the live list, so duration and volume follow edits while the sheet is open
  const [openId, setOpenId] = useState<string | null>(null)
  const open = list?.find((s) => s.workout.id === openId) ?? null

  return (
    <>
      {list !== undefined && list.length > 0 && <HistoryExport />}
      {list === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : list.length === 0 ? (
        <p className="text-zinc-500">No finished workouts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <li key={s.workout.id}>
              <button
                onClick={() => setOpenId(s.workout.id)}
                className="w-full card p-3 text-left"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.workout.template_name_snapshot ?? 'Workout'}</span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">{dateFormat.format(new Date(s.workout.started_at))}</span>
                </span>
                <span className="mt-1 flex gap-4 text-sm text-zinc-600 tabular-nums dark:text-zinc-300">
                  <span>{s.durationS !== null ? formatDuration(s.durationS) : '–'}</span>
                  <span>{Math.round(s.volume).toLocaleString('en-GB')} kg</span>
                  <span>
                    {s.exercises} {s.exercises === 1 ? 'exercise' : 'exercises'} · {s.sets} {s.sets === 1 ? 'set' : 'sets'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex gap-2 lg:max-w-md">
        <button onClick={() => void exportSetsCsv()} className="flex-1 rounded-lg bg-zinc-100 py-2.5 text-sm font-medium dark:bg-zinc-800">
          Export sets (CSV)
        </button>
        <button onClick={() => void exportJson()} className="flex-1 rounded-lg bg-zinc-100 py-2.5 text-sm font-medium dark:bg-zinc-800">
          Export all (JSON)
        </button>
      </div>

      {open && <WorkoutDetailSheet summary={open} onClose={() => setOpenId(null)} />}
    </>
  )
}

function readRange(): ExportRange {
  try {
    const v = localStorage.getItem('history-export-range')
    if (EXPORT_RANGES.some((r) => r.key === v)) return v as ExportRange
  } catch {
    /* per-device convenience */
  }
  return '30d'
}

/** «Export for AI»: the whole history of a period as Markdown (decision 22 October 2026). */
function HistoryExport() {
  const [range, setRange] = useState<ExportRange>(readRange)
  // Built ahead of the tap and kept current while data changes
  const prepared = useLiveQuery(async () => {
    const data = await loadExportData()
    const now = new Date()
    return { text: historyMarkdown(data, range, now), count: workoutsInRange(data, range, now).length }
  }, [range])
  function pick(r: ExportRange) {
    setRange(r)
    try {
      localStorage.setItem('history-export-range', r)
    } catch {
      /* per-device convenience */
    }
  }
  const title = EXPORT_RANGES.find((r) => r.key === range)!.title
  return (
    <section className="mb-4 card p-3 lg:max-w-xl">
      <h3 className="font-semibold">Export for AI</h3>
      <p className="mt-0.5 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Markdown with every workout and its previous sets, body weight and the current plan.
      </p>
      <div className="home-range-switch" role="group" aria-label="Export period">
        {EXPORT_RANGES.map((r) => (
          <button key={r.key} aria-pressed={range === r.key} onClick={() => pick(r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
        {prepared
          ? `${prepared.count} ${prepared.count === 1 ? 'workout' : 'workouts'} · ${Math.max(1, Math.round(prepared.text.length / 1000))} k characters`
          : 'Preparing …'}
      </p>
      <CopyShare text={prepared?.text} title={`Training history · ${title}`} />
    </section>
  )
}

function WorkoutDetailSheet({ summary, onClose }: { summary: WorkoutSummary; onClose: () => void }) {
  const detail = useLiveQuery(() => workoutDetail(summary.workout.id), [summary.workout.id])
  // Live row, so the crowd rating updates while the sheet is open
  const live = useLiveQuery(() => db.workout.get(summary.workout.id), [summary.workout.id])
  const markdown = useLiveQuery(async () => workoutMarkdown(await loadExportData(), summary.workout.id), [summary.workout.id])
  const [confirm, setConfirm] = useState(false)
  // Editing afterwards: values, added and removed sets are saved right away
  const [editing, setEditing] = useState(false)
  const w = live ?? summary.workout
  const time = `${timeFormat.format(new Date(w.started_at))}${w.finished_at ? `–${timeFormat.format(new Date(w.finished_at))}` : ''}`

  return (
    <Sheet title={`${w.template_name_snapshot ?? 'Workout'} · ${dateFormat.format(new Date(w.started_at))}`} onClose={onClose}>
      <div className={`mb-3 flex items-center gap-3 ${editing ? 'justify-between' : 'justify-end'}`}>
        {editing && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Editing · changes are saved right away</p>}
        <button
          onClick={() => {
            setEditing(!editing)
            setConfirm(false)
          }}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold ${
            editing ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
          }`}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      {editing ? (
        detail === undefined ? (
          <p className="text-zinc-500">Loading …</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {detail.map((ex) => (
              <li key={ex.workoutExercise.id} className="card p-3">
                <ExerciseEditor ex={ex} workout={w} />
              </li>
            ))}
          </ol>
        )
      ) : (
        <>
          <dl className="mb-4 grid grid-cols-3 gap-2">
            <Tile label="Time" value={time} />
            <Tile label="Duration" value={summary.durationS !== null ? formatDuration(summary.durationS) : '–'} />
            <Tile label="Volume" value={`${Math.round(summary.volume).toLocaleString('en-GB')} kg`} />
          </dl>
          <div className="mb-4">
            <CopyShare text={markdown} title={`${w.template_name_snapshot ?? 'Workout'} · ${dateFormat.format(new Date(w.started_at))}`} />
          </div>
          {w.note && (
            <p className="mb-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm whitespace-pre-line text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {w.note}
            </p>
          )}

          {detail === undefined ? (
            <p className="text-zinc-500">Loading …</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {detail.map((ex) => (
                <li key={ex.workoutExercise.id} className="card p-3">
                  <ExerciseResult ex={ex} />
                </li>
              ))}
            </ol>
          )}

          <div className="mt-6">
            <CrowdPicker value={w.crowd_level ?? null} onChange={(v) => void updateWorkout(w, { crowd_level: v })} />
          </div>
          {confirm ? (
            <div className="mt-6 card p-3">
              <p className="mb-3 text-sm">
                Delete this workout with all its sets? It moves to the trash and can be restored there for 30 days.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirm(false)} className="flex-1 rounded-lg py-2 text-sm">
                  Cancel
                </button>
                <button
                  onClick={() =>
                    void deleteWorkout(w).then(() => {
                      offerUndo('Workout moved to trash', w.id)
                      onClose()
                    })
                  }
                  className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white"
                >
                  Delete workout
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)} className="mt-6 w-full py-2 text-sm text-red-600 dark:text-red-400">
              Delete workout
            </button>
          )}
        </>
      )}
    </Sheet>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-100 px-2.5 py-2 dark:bg-zinc-800">
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** One exercise of a finished workout as a compact table with a summary line. */
function ExerciseResult({ ex }: { ex: DetailExercise }) {
  if (ex.skipped)
    return (
      <p className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold text-zinc-500 line-through decoration-zinc-400 dark:text-zinc-400">{ex.name}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">Skipped</span>
      </p>
    )
  const working = ex.sets.filter((s) => s.set_type === 'working')
  const kind = ex.trackingType

  // Columns depend on the tracking type; empty columns (e.g. weight of bodyweight sets) are hidden
  const hasWeight = ex.sets.some((s) => s.weight !== null)
  const head: string[] =
    kind === 'duration'
      ? ['Time']
      : kind === 'distance_duration'
        ? ['Distance', 'Time', 'Pace']
        : [...(hasWeight ? ['kg'] : []), ...(ex.unilateral ? ['Left', 'Right'] : ['Reps'])]

  function cells(s: WorkoutSet): string[] {
    if (kind === 'duration') return [formatDuration(s.duration_s) || '–']
    if (kind === 'distance_duration') {
      const pace = paceSeconds(s.duration_s, s.distance_km)
      return [s.distance_km !== null ? `${s.distance_km} km` : '–', formatDuration(s.duration_s) || '–', pace !== null ? `${formatDuration(pace)} /km` : '–']
    }
    return [
      ...(hasWeight ? [s.weight !== null ? formatNumber(s.weight) : '–'] : []),
      ...(ex.unilateral ? [formatNumber(s.reps_left) || '–', formatNumber(s.reps_right) || '–'] : [formatNumber(s.reps) || '–']),
    ]
  }

  // Reps below the minimum are marked orange (reps columns follow the optional kg column)
  function low(s: WorkoutSet, column: number): boolean {
    if (kind !== 'weight_reps') return false
    const k = column - (hasWeight ? 1 : 0)
    const reps = ex.unilateral ? (k === 0 ? s.reps_left : k === 1 ? s.reps_right : null) : k === 0 ? s.reps : null
    return belowMinimum(reps, ex.minReps)
  }

  // Summary: working sets, volume and best set (highest estimated 1RM)
  const vol = volume(ex.sets)
  let best: WorkoutSet | null = null
  for (const s of working) {
    const e = epley(s.weight, effectiveReps(s))
    if (e !== null && (best === null || e > (epley(best.weight, effectiveReps(best)) ?? 0))) best = s
  }
  const summary = [
    `${working.length} ${working.length === 1 ? 'set' : 'sets'}`,
    ...(kind === 'weight_reps' && vol > 0 ? [`${Math.round(vol).toLocaleString('en-GB')} kg`] : []),
  ].join(' · ')

  let n = 0
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">{ex.name}</h3>
        <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{summary}</span>
      </div>
      {ex.alternativeFor && <p className="-mt-1.5 mb-2 text-xs text-zinc-500 dark:text-zinc-400">Alternative for {ex.alternativeFor}</p>}
      <table className="text-sm tabular-nums">
        <thead>
          <tr className="text-xs text-zinc-500 dark:text-zinc-400">
            <th className="w-10 py-0.5 text-left font-normal">Set</th>
            {head.map((h) => (
              <th key={h} className="min-w-16 py-0.5 pl-3 text-right font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ex.sets.map((s) => {
            const warm = s.set_type === 'warmup'
            if (!warm) n++
            return (
              <tr key={s.id} className={`border-t border-zinc-100 dark:border-zinc-800 ${warm ? 'text-zinc-500 dark:text-zinc-400' : ''}`}>
                <td className="py-1">{warm ? 'W' : n}</td>
                {cells(s).map((c, k) => (
                  <td key={k} className={`py-1 pl-3 text-right ${!warm && low(s, k) ? 'font-semibold text-orange-600 dark:text-orange-400' : ''}`}>
                    {c}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {best && best.weight !== null && (
        <p className="mt-1.5 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
          Best set {best.weight} kg × {effectiveReps(best)} · est. 1RM {Math.round(epley(best.weight, effectiveReps(best))!)} kg
        </p>
      )}
    </>
  )
}

// Columns of the edit rows: set label, type, value fields, remove button
const EDIT_GRID: Record<string, string> = {
  weight_reps: 'grid-cols-[2.25rem_minmax(0,1fr)_4rem_4rem_2rem]',
  unilateral: 'grid-cols-[2.25rem_minmax(0,1fr)_3.5rem_2.75rem_2.75rem_2rem]',
  duration: 'grid-cols-[2.25rem_minmax(0,1fr)_5rem_2rem]',
  distance_duration: 'grid-cols-[2.25rem_minmax(0,1fr)_4rem_4.5rem_2rem]',
}

/** One exercise of a finished workout in edit mode: values per set, add and remove sets. */
function ExerciseEditor({ ex, workout }: { ex: DetailExercise; workout: Workout }) {
  const kind = ex.trackingType
  const layout = kind === 'weight_reps' ? (ex.unilateral ? 'unilateral' : 'weight_reps') : kind in EDIT_GRID ? kind : 'weight_reps'
  const grid = `grid ${EDIT_GRID[layout]} items-center gap-2`
  const head =
    layout === 'duration' ? ['Time'] : layout === 'distance_duration' ? ['km', 'Time'] : layout === 'unilateral' ? ['kg', 'L', 'R'] : ['kg', 'Reps']
  // Same labels as the export: the heaviest work set is the top set when the setting is on
  const working = ex.sets.filter((s) => s.set_type === 'working')
  const top = ex.topSet ? topIndex(working.map((s) => s.weight)) : -1
  const add = () => void addHistorySet(ex.workoutExercise, workout)

  if (ex.skipped && ex.sets.length === 0)
    return (
      <>
        <p className="flex items-baseline justify-between gap-2">
          <span className="font-semibold text-zinc-500 dark:text-zinc-400">{ex.name}</span>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Skipped</span>
        </p>
        <AddSetButton onClick={add} />
      </>
    )

  return (
    <>
      <h3 className="mb-2 font-semibold">{ex.name}</h3>
      <div className={`${grid} mb-1 text-xs text-zinc-500 dark:text-zinc-400`}>
        <span className="pl-1">Set</span>
        <span />
        {head.map((h) => (
          <span key={h} className="text-center">
            {h}
          </span>
        ))}
        <span />
      </div>
      <div className="flex flex-col gap-1.5">
        {ex.sets.map((s) => {
          const warm = s.set_type === 'warmup'
          const i = working.indexOf(s)
          const label = warm ? 'W' : String(i + 1)
          const type = warm ? 'Warm-up' : top === -1 ? '' : i === top ? 'Top set' : 'Back-off'
          return (
            <div key={s.id} className={grid}>
              <span
                className={`flex h-10 items-center justify-center rounded-md text-sm font-semibold ${
                  warm ? 'bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                }`}
              >
                {label}
              </span>
              <span className="truncate text-sm text-zinc-600 dark:text-zinc-300">{type}</span>
              <SetFields set={s} layout={layout} minReps={warm ? null : ex.minReps} />
              <button
                aria-label={`Remove set ${label}`}
                onClick={() => void removeHistorySet(s)}
                className="flex h-10 items-center justify-center rounded-md text-lg text-zinc-400 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
      <AddSetButton onClick={add} />
    </>
  )
}

function AddSetButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mt-2 w-full rounded-lg bg-zinc-100 py-2 text-sm font-medium dark:bg-zinc-800">
      + Add set
    </button>
  )
}

/** Value fields of one set; valid input is saved while typing, as in the running workout. */
function SetFields({ set, layout, minReps }: { set: WorkoutSet; layout: string; minReps: number | null }) {
  function numberCommit(field: 'weight' | 'reps' | 'reps_left' | 'reps_right' | 'distance_km', integer: boolean) {
    return (input: string) => {
      const n = parseNumber(input)
      if (n === undefined || (integer && n !== null && !Number.isInteger(n))) return false
      void updateHistorySet(set, { [field]: n })
      return true
    }
  }
  function durationCommit(input: string) {
    const n = parseDuration(input)
    if (n === undefined) return false
    void updateHistorySet(set, { duration_s: n })
    return true
  }
  const time = <Field label="Time" inputMode="text" placeholder="mm:ss" value={formatDuration(set.duration_s)} onCommit={durationCommit} />

  if (layout === 'duration') return time
  if (layout === 'distance_duration')
    return (
      <>
        <Field label="Distance km" inputMode="decimal" value={formatNumber(set.distance_km)} onCommit={numberCommit('distance_km', false)} />
        {time}
      </>
    )
  return (
    <>
      <Field label="Weight kg" inputMode="decimal" value={formatNumber(set.weight)} onCommit={numberCommit('weight', false)} />
      {layout === 'unilateral' ? (
        <>
          <Field label="Reps left" inputMode="numeric" value={formatNumber(set.reps_left)} onCommit={numberCommit('reps_left', true)} warn={belowMinimum(set.reps_left, minReps)} />
          <Field label="Reps right" inputMode="numeric" value={formatNumber(set.reps_right)} onCommit={numberCommit('reps_right', true)} warn={belowMinimum(set.reps_right, minReps)} />
        </>
      ) : (
        <Field label="Reps" inputMode="numeric" value={formatNumber(set.reps)} onCommit={numberCommit('reps', true)} warn={belowMinimum(set.reps, minReps)} />
      )}
    </>
  )
}
