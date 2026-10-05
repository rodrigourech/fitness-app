import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import ExerciseSheet from '../components/ExerciseSheet'
import NewExerciseForm from '../components/NewExerciseForm'
import Sheet from '../components/Sheet'
import { exerciseOptions } from '../lib/exercise'

export default function ExercisesTab({ userId }: { userId: string }) {
  const options = useLiveQuery(exerciseOptions, [])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const q = query.trim().toLowerCase()
  const filtered = (options ?? []).filter((o) => !q || o.label.toLowerCase().includes(q))

  return (
    <>
      <div className="mb-3 flex gap-2">
        <input
          aria-label="Search exercises"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700"
        />
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg"
        >
          + New
        </button>
      </div>
      <ul className="flex flex-col">
        {filtered.map((o) => (
          <li key={o.id}>
            <button
              onClick={() => setOpen(o.id)}
              className={`w-full border-b border-zinc-200 py-3 text-left dark:border-zinc-800 ${o.isVariant ? 'pl-4 text-sm text-zinc-600 dark:text-zinc-300' : 'font-medium'}`}
            >
              {o.label}
            </button>
          </li>
        ))}
        {options !== undefined && filtered.length === 0 && <li className="py-2 text-sm text-zinc-500">No match.</li>}
      </ul>

      {creating && (
        <Sheet title="New exercise" onClose={() => setCreating(false)}>
          <NewExerciseForm
            userId={userId}
            initialName={query.trim()}
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              setCreating(false)
              setOpen(id)
            }}
          />
        </Sheet>
      )}
      {open && <ExerciseSheet exerciseId={open} onClose={() => setOpen(null)} />}
    </>
  )
}
