import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState, type FormEvent } from 'react'
import { catalogDefaults, describeEntry, loadCatalog, searchCatalog, type CatalogDefaults, type CatalogEntry } from '../lib/catalog'
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
  'rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100'

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
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [picked, setPicked] = useState<CatalogDefaults | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const isVariant = parentId !== ''

  useEffect(() => {
    let alive = true
    void loadCatalog().then((c) => alive && setCatalog(c))
    return () => {
      alive = false
    }
  }, [])

  const suggestions = !isVariant && showSuggestions && !picked ? searchCatalog(catalog, name, 6) : []

  function pick(e: CatalogEntry) {
    const d = catalogDefaults(e)
    setPicked(d)
    setName(d.name)
    setType(d.trackingType)
    setShowSuggestions(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      const n = note.trim() || null
      const parent = isVariant ? mains?.find((m) => m.id === parentId) : undefined
      const id = parent
        ? await createVariant(parent, name, n)
        : await createExercise(userId, {
            name,
            trackingType: type,
            isUnilateral: unilateral,
            restS: rest,
            note: n,
            ...(picked && {
              equipment: picked.equipment,
              musclesPrimary: picked.musclesPrimary,
              musclesSecondary: picked.musclesSecondary,
              focusMuscles: picked.focusMuscles,
              sourceId: picked.sourceId,
            }),
          })
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
          onChange={(e) => {
            setName(e.target.value)
            setShowSuggestions(true)
          }}
          placeholder={isVariant ? 'e.g. Wide grip' : 'Type to search the catalog, e.g. pec deck'}
          className={input}
        />
      </label>

      {suggestions.length > 0 && (
        <ul aria-label="Catalog suggestions" className="-mt-2 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => pick(s)}
                className="w-full border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
              >
                <span className="block text-sm">{s.name}</span>
                <span className="block text-xs text-zinc-500 dark:text-zinc-400">{describeEntry(s)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && !isVariant && (
        <p className="-mt-1 flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
          <span>
            From catalog · muscles and focus are prefilled ({picked.musclesPrimary.join(', ') || 'none'})
          </span>
          <button type="button" onClick={() => setPicked(null)} className="font-semibold">
            Remove
          </button>
        </p>
      )}

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
                      ? 'bg-accent text-accent-fg'
                      : 'bg-zinc-100 dark:bg-zinc-800'
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
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          The variant inherits tracking, rest, muscles and videos from the main exercise. You can change them later.
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-semibold">Notes</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Floor, seat, grip, …" className={input} />
      </label>

      <div className="flex gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg py-3 text-sm text-zinc-600 dark:text-zinc-300">
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex-1 rounded-lg bg-accent py-3 font-semibold text-accent-fg disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </form>
  )
}
