import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import Sheet from '../components/Sheet'
import { exportJson, exportSetsCsv } from '../lib/export'
import { deleteWorkout, finishedWorkouts, workoutDetail, type WorkoutSummary } from '../lib/history'
import { describeSet, formatDuration } from '../lib/workout'

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

export default function HistoryTab() {
  const list = useLiveQuery(finishedWorkouts, [])
  const [open, setOpen] = useState<WorkoutSummary | null>(null)

  return (
    <>
      {list === undefined ? (
        <p className="text-neutral-500">Loading …</p>
      ) : list.length === 0 ? (
        <p className="text-neutral-500">No finished workouts yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((s) => (
            <li key={s.workout.id}>
              <button
                onClick={() => setOpen(s)}
                className="w-full rounded-xl border border-neutral-200 p-3 text-left dark:border-neutral-800"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{s.workout.template_name_snapshot ?? 'Workout'}</span>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">{dateFormat.format(new Date(s.workout.started_at))}</span>
                </span>
                <span className="mt-1 flex gap-4 text-sm text-neutral-600 tabular-nums dark:text-neutral-300">
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
        <button onClick={() => void exportSetsCsv()} className="flex-1 rounded-lg bg-neutral-100 py-2.5 text-sm font-medium dark:bg-neutral-800">
          Export sets (CSV)
        </button>
        <button onClick={() => void exportJson()} className="flex-1 rounded-lg bg-neutral-100 py-2.5 text-sm font-medium dark:bg-neutral-800">
          Export all (JSON)
        </button>
      </div>

      {open && <WorkoutDetailSheet summary={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function WorkoutDetailSheet({ summary, onClose }: { summary: WorkoutSummary; onClose: () => void }) {
  const detail = useLiveQuery(() => workoutDetail(summary.workout.id), [summary.workout.id])
  const [confirm, setConfirm] = useState(false)
  const w = summary.workout

  return (
    <Sheet title={`${w.template_name_snapshot ?? 'Workout'} · ${dateFormat.format(new Date(w.started_at))}`} onClose={onClose}>
      <p className="mb-3 text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
        {timeFormat.format(new Date(w.started_at))} · {summary.durationS !== null ? formatDuration(summary.durationS) : '–'} ·{' '}
        {Math.round(summary.volume).toLocaleString('en-GB')} kg
      </p>
      {w.note && <p className="mb-3 text-sm whitespace-pre-line">{w.note}</p>}
      <ul className="flex flex-col gap-3">
        {(detail ?? []).map((ex, i) => (
          <li key={i}>
            <h3 className="font-semibold">{ex.name}</h3>
            <ol className="text-sm text-neutral-700 tabular-nums dark:text-neutral-300">
              {ex.sets.map((s, k) => {
                const [a, b] = describeSet(s, ex.trackingType, ex.unilateral)
                return (
                  <li key={s.id}>
                    {s.set_type === 'warmup' ? 'W' : k + 1}. {a} {b}
                    {s.rir !== null && <span className="text-neutral-500"> · RIR {s.rir === 4 ? '4+' : s.rir}</span>}
                  </li>
                )
              })}
            </ol>
          </li>
        ))}
      </ul>
      {confirm ? (
        <div className="mt-6 flex gap-2">
          <button onClick={() => setConfirm(false)} className="flex-1 rounded-lg py-2 text-sm">
            Cancel
          </button>
          <button onClick={() => void deleteWorkout(w).then(onClose)} className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white">
            Delete workout
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} className="mt-6 w-full py-2 text-sm text-red-600 dark:text-red-400">
          Delete workout
        </button>
      )}
    </Sheet>
  )
}
