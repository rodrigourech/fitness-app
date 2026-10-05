import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'
import { adjustRest, stopRest } from '../lib/rest'
import { formatDuration } from '../lib/workout'
import { useNow } from '../hooks/useNow'

export default function RestTimer() {
  const until = useLiveQuery(async () => (await db.meta.get('rest_until'))?.value, [])
  const now = useNow(250)
  if (!until) return null
  const left = Math.ceil((Date.parse(until) - now) / 1000)
  const over = left <= 0

  return (
    <div
      className={`sticky top-0 z-10 -mx-4 mb-3 flex items-center justify-between gap-2 px-4 py-2 pt-[max(env(safe-area-inset-top),0.5rem)] ${
        over ? 'bg-emerald-600 text-white' : 'bg-accent text-accent-fg'
      }`}
    >
      <span className="text-sm">{over ? 'Rest over' : 'Rest'}</span>
      <span className="text-2xl font-semibold tabular-nums">{over ? formatDuration(-left) : formatDuration(left)}</span>
      <div className="flex gap-1">
        <button onClick={() => void adjustRest(-15)} className="rounded px-2 py-1 text-sm opacity-80">
          −15
        </button>
        <button onClick={() => void adjustRest(15)} className="rounded px-2 py-1 text-sm opacity-80">
          +15
        </button>
        <button onClick={() => void stopRest()} className="rounded px-2 py-1 text-sm font-medium">
          {over ? 'OK' : 'Stop'}
        </button>
      </div>
    </div>
  )
}
