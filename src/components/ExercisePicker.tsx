import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { exerciseOptions } from '../lib/exercise'
import NewExerciseForm from './NewExerciseForm'
import Sheet from './Sheet'

interface Props {
  userId: string
  title?: string
  onPick: (exerciseId: string) => void
  onClose: () => void
}

/** Search existing exercises or create a new one, then hand back its id. */
export default function ExercisePicker({ userId, title = 'Add exercise', onPick, onClose }: Props) {
  const options = useLiveQuery(exerciseOptions, [])
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const q = query.trim().toLowerCase()
  const filtered = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q))

  return (
    <Sheet title={creating ? 'New exercise' : title} onClose={onClose}>
      {creating ? (
        <NewExerciseForm userId={userId} initialName={query} onCreated={onPick} onCancel={() => setCreating(false)} />
      ) : (
        <>
          <input
            autoFocus
            aria-label="Search exercises"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-3 w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700"
          />
          <button
            onClick={() => setCreating(true)}
            className="mb-3 w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg"
          >
            + New exercise{q ? ` “${query.trim()}”` : ''}
          </button>
          <ul className="flex flex-col">
            {filtered.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => onPick(o.id)}
                  className={`w-full border-b border-zinc-100 py-2.5 text-left text-base dark:border-zinc-800 ${o.isVariant ? 'pl-4 text-zinc-600 dark:text-zinc-300' : ''}`}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {filtered.length === 0 && <li className="py-2 text-sm text-zinc-500">No match.</li>}
          </ul>
        </>
      )}
    </Sheet>
  )
}
