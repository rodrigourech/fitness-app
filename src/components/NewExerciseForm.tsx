import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { db, type TrackingType } from '../lib/db'
import { createExercise, createVariant } from '../lib/exercise'
import RestStepper from './RestStepper'

interface Props {
  userId: string
  initialName?: string
  onCreated: (exerciseId: string) => void
  onCancel?: () => void
}

const TYPES: { value: TrackingType; label: string }[] = [
  { value: 'weight_reps', label: 'Weight & reps' },
  { value: 'duration', label: 'Time' },
  { value: 'distance_duration', label: 'Distance & time' },
]

const input =
  'rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100'

export default function NewExerciseForm({ userId, initialName = '', onCreated, onCancel }: Props) {
  const mains = useLiveQuery(
    async () =>
      (await db.exercise.toArray())
        .filter((e) => e.parent_id === null && e.deleted_at === null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  )
  const [parentId, setParentId] = useState('')
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<TrackingType>('weight_reps')
  const [unilateral, setUnilateral] = useState(false)
  const [rest, setRest] = useState<number | null>(90)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const isVariant = parentId !== ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const n = note.trim() || null
      const parent = isVariant ? mains?.find((m) => m.id === parentId) : undefined
      const id = parent
        ? await createVariant(parent, name, n)
        : await createExercise(userId, { name, trackingType: type, isUnilateral: unilateral, restS: rest, note: n })
      onCreated(id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Kind</span>
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={input}>
          <option value="">New exercise</option>
          {(mains ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              Variant of {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{isVariant ? 'Variant name' : 'Name'}</span>
        <input
          required
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={isVariant ? 'e.g. Wide grip' : 'e.g. Pec Deck (Machine)'}
          className={input}
        />
      </label>

      {!isVariant && (
        <>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold">Tracking</legend>
            <div className="grid grid-cols-3 gap-1">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={type === t.value}
                  onClick={() => setType(t.value)}
                  className={`rounded-md px-2 py-2 text-sm ${
                    type === t.value
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'bg-neutral-100 dark:bg-neutral-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </fieldset>
          {type === 'weight_reps' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={unilateral} onChange={(e) => setUnilateral(e.target.checked)} className="h-5 w-5" />
              One side at a time (reps left and right)
            </label>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Rest between sets</span>
            <RestStepper value={rest} onChange={setRest} />
          </div>
        </>
      )}
      {isVariant && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          The variant inherits tracking, rest, muscles and videos from the main exercise. You can change them later.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Notes</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Floor, seat, grip, …" className={input} />
      </label>

      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg py-3 text-sm text-neutral-600 dark:text-neutral-300">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex-1 rounded-lg bg-neutral-900 py-3 font-semibold text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Create
        </button>
      </div>
    </form>
  )
}
