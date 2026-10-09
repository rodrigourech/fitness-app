import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import CrowdPicker from '../components/CrowdPicker'
import Sheet from '../components/Sheet'
import { db, type WorkoutSet } from '../lib/db'
import { exportJson, exportSetsCsv } from '../lib/export'
import { deleteWorkout, finishedWorkouts, workoutDetail, type DetailExercise, type WorkoutSummary } from '../lib/history'
import { effectiveReps, epley, volume } from '../lib/stats'
import { offerUndo } from '../lib/undo'
import { formatDuration, formatNumber, paceSeconds, updateWorkout } from '../lib/workout'

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export default function HistoryTab() {
  const list = useLiveQuery(finishedWorkouts, [])
  const [open, setOpen] = useState<WorkoutSummary | null>(null)

  return (
    <>
      {list === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : list.length === 0 ? (
        <p className="text-zinc-500">No finished workouts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((s) => (
            <li key={s.workout.id}>
              <button
                onClick={() => setOpen(s)}
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

      <div className="mt-6 flex gap-2">
        <button onClick={() => void exportSetsCsv()} className="flex-1 rounded-lg bg-zinc-100 py-2.5 text-sm font-medium dark:bg-zinc-800">
          Export sets (CSV)
        </button>
        <button onClick={() => void exportJson()} className="flex-1 rounded-lg bg-zinc-100 py-2.5 text-sm font-medium dark:bg-zinc-800">
          Export all (JSON)
        </button>
      </div>

      {open && <WorkoutDetailSheet summary={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function WorkoutDetailSheet({ summary, onClose }: { summary: WorkoutSummary; onClose: () => void }) {
  const detail = useLiveQuery(() => workoutDetail(summary.workout.id), [summary.workout.id])
  // Live row, so the crowd rating updates while the sheet is open
  const live = useLiveQuery(() => db.workout.get(summary.workout.id), [summary.workout.id])
  const [confirm, setConfirm] = useState(false)
  const w = live ?? summary.workout
  const time = `${timeFormat.format(new Date(w.started_at))}${w.finished_at ? `–${timeFormat.format(new Date(w.finished_at))}` : ''}`

  return (
    <Sheet title={`${w.template_name_snapshot ?? 'Workout'} · ${dateFormat.format(new Date(w.started_at))}`} onClose={onClose}>
      <dl className="mb-4 grid grid-cols-3 gap-2">
        <Tile label="Time" value={time} />
        <Tile label="Duration" value={summary.durationS !== null ? formatDuration(summary.durationS) : '–'} />
        <Tile label="Volume" value={`${Math.round(summary.volume).toLocaleString('en-GB')} kg`} />
      </dl>
      {w.note && (
        <p className="mb-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm whitespace-pre-line text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {w.note}
        </p>
      )}

      {detail === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {detail.map((ex, i) => (
            <li key={i} className="card p-3">
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

function rirLabel(rir: number | null): string {
  return rir === null ? '' : rir >= 4 ? '4+' : String(rir)
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
  const hasRir = ex.sets.some((s) => s.rir !== null)
  const head: string[] =
    kind === 'duration'
      ? ['Time']
      : kind === 'distance_duration'
        ? ['Distance', 'Time', 'Pace']
        : [...(hasWeight ? ['kg'] : []), ...(ex.unilateral ? ['Left', 'Right'] : ['Reps']), ...(hasRir ? ['RIR'] : [])]

  function cells(s: WorkoutSet): string[] {
    if (kind === 'duration') return [formatDuration(s.duration_s) || '–']
    if (kind === 'distance_duration') {
      const pace = paceSeconds(s.duration_s, s.distance_km)
      return [s.distance_km !== null ? `${s.distance_km} km` : '–', formatDuration(s.duration_s) || '–', pace !== null ? `${formatDuration(pace)} /km` : '–']
    }
    return [
      ...(hasWeight ? [s.weight !== null ? formatNumber(s.weight) : '–'] : []),
      ...(ex.unilateral ? [formatNumber(s.reps_left) || '–', formatNumber(s.reps_right) || '–'] : [formatNumber(s.reps) || '–']),
      ...(hasRir ? [rirLabel(s.rir)] : []),
    ]
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
                  <td key={k} className="py-1 pl-3 text-right">
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
