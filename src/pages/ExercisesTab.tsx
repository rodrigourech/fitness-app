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
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700"
        />
        <button
          onClick={() => setCreating(true)}
          className="rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          + New
        </button>
      </div>
      <ul className="flex flex-col">
        {filtered.map((o) => (
          <li key={o.id}>
            <button
              onClick={() => setOpen(o.id)}
              className={`w-full border-b border-neutral-200 py-3 text-left dark:border-neutral-800 ${o.isVariant ? 'pl-4 text-sm text-neutral-600 dark:text-neutral-300' : 'font-medium'}`}
            >
              {o.label}
            </button>
          </li>
        ))}
        {options !== undefined && filtered.length === 0 && <li className="py-2 text-sm text-neutral-500">No match.</li>}
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
