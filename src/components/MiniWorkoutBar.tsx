import { useLiveQuery } from 'dexie-react-hooks'
import { useNow } from '../hooks/useNow'
import { db, type Workout } from '../lib/db'
import { formatDuration } from '../lib/workout'

/** Minimised running workout at the bottom of the screen; a tap opens it again. */
export default function MiniWorkoutBar({ workout, onExpand }: { workout: Workout; onExpand: () => void }) {
  const now = useNow(1000)
  const restUntil = useLiveQuery(async () => (await db.meta.get('rest_until'))?.value, [])
  const elapsed = Math.max(0, Math.floor((now - Date.parse(workout.started_at)) / 1000))
  const restLeft = restUntil ? Math.ceil((Date.parse(restUntil) - now) / 1000) : null

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      <button
        onClick={onExpand}
        aria-label="Open running workout"
        className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-left text-accent-fg shadow-lg"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{workout.template_name_snapshot ?? 'Workout'}</span>
          <span className="block text-xs tabular-nums opacity-80">{formatDuration(elapsed)}</span>
        </span>
        <span className="flex items-center gap-3">
          {restLeft !== null && (
            <span className="rounded-lg bg-black/15 px-2 py-1 text-sm font-semibold tabular-nums">
              {restLeft > 0 ? `Rest ${formatDuration(restLeft)}` : 'Rest over'}
            </span>
          )}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 15l6-6 6 6" />
          </svg>
        </span>
      </button>
    </div>
  )
}
