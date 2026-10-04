import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { db, displayName, type Exercise } from '../lib/db'
import { addLink, createVariant, linkLabel, linksFor, normalizeUrl, removeLink, updateExercise } from '../lib/exercise'
import { effective } from '../lib/workout'
import { regionName } from '../lib/muscles'
import BodyMap from './BodyMap'
import RestStepper from './RestStepper'
import { formatDuration } from '../lib/workout'

interface Props {
  exerciseId: string
  onClose: () => void
}

/** Bottom sheet with focus muscles, cue and reference videos of an exercise. */
export default function ExerciseSheet({ exerciseId, onClose }: Props) {
  // The sheet can navigate between a main exercise and its variants
  const [currentId, setCurrentId] = useState(exerciseId)
  const [variantName, setVariantName] = useState('')
  const data = useLiveQuery(async () => {
    const ex = await db.exercise.get(currentId)
    if (!ex) return null
    const parent = ex.parent_id ? await db.exercise.get(ex.parent_id) : undefined
    const byId = new Map<string, Exercise>([[ex.id, ex], ...(parent ? ([[parent.id, parent]] as const) : [])])
    const mainId = parent?.id ?? ex.id
    const variants = (await db.exercise.where('parent_id').equals(mainId).toArray())
      .filter((v) => v.deleted_at === null)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ex, parent, byId, variants, links: await linksFor(ex) }
  }, [currentId])

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [urlError, setUrlError] = useState(false)

  if (data === undefined) return null
  if (data === null) return null
  const { ex, parent, byId, variants, links } = data
  const main = parent ?? ex
  const eff = effective(ex, byId)
  const focusInherited = ex.parent_id !== null && ex.focus_muscles == null
  const cueInherited = ex.parent_id !== null && ex.focus_cue == null

  function toggleRegion(region: string) {
    const current = eff.focusMuscles
    const next = current.includes(region) ? current.filter((r) => r !== region) : [...current, region]
    void updateExercise(ex, { focus_muscles: next })
  }

  async function submitVariant(e: FormEvent) {
    e.preventDefault()
    if (!variantName.trim()) return
    const id = await createVariant(main, variantName, null)
    setVariantName('')
    setCurrentId(id)
  }

  async function submitLink(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizeUrl(url)
    if (!normalized) {
      setUrlError(true)
      return
    }
    await addLink(ex, normalized, title.trim() || null)
    setUrl('')
    setTitle('')
    setUrlError(false)
  }


  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={displayName(ex, byId)}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-md sm:rounded-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{displayName(ex, byId)}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400">
            Close
          </button>
        </div>

        <section className="mb-5 flex flex-col gap-3">
          {parent && (
            <TextField
              label="Exercise (shared by all variants)"
              value={parent.name}
              required
              onSave={(v) => updateExercise(parent, { name: v ?? parent.name })}
            />
          )}
          <TextField
            label={parent ? 'Variant' : 'Exercise'}
            value={ex.name}
            required
            onSave={(v) => updateExercise(ex, { name: v ?? ex.name })}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Rest between sets</span>
            <RestStepper
              value={ex.default_rest_s}
              onChange={(s) => void updateExercise(ex, { default_rest_s: s })}
              fallbackLabel={parent?.default_rest_s ? `${formatDuration(parent.default_rest_s)} (inh.)` : 'Off'}
            />
          </div>
          <TextField
            label="Notes"
            value={ex.setup_note ?? ''}
            placeholder={parent?.setup_note ? `Inherited: ${parent.setup_note}` : 'Floor, seat, grip, …'}
            multiline
            onSave={(v) => updateExercise(ex, { setup_note: v })}
          />
        </section>

        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold">Variants of {main.name}</h3>
          <ul className="mb-2 flex flex-wrap gap-1.5">
            {parent && (
              <li>
                <button onClick={() => setCurrentId(main.id)} className="rounded-full border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700">
                  ‹ Main exercise
                </button>
              </li>
            )}
            {variants.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setCurrentId(v.id)}
                  aria-current={v.id === ex.id}
                  className={`rounded-full px-3 py-1 text-sm ${
                    v.id === ex.id
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                      : 'bg-neutral-100 dark:bg-neutral-800'
                  }`}
                >
                  {v.name}
                </button>
              </li>
            ))}
            {variants.length === 0 && <li className="text-sm text-neutral-500 dark:text-neutral-400">No variants yet.</li>}
          </ul>
          <form onSubmit={(e) => void submitVariant(e)} className="flex gap-2">
            <input
              aria-label="New variant name"
              placeholder="New variant, e.g. Rope"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700"
            />
            <button
              type="submit"
              disabled={!variantName.trim()}
              className="rounded-lg bg-neutral-900 px-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              + Add variant
            </button>
          </form>
        </section>

        <section className="mb-5">
          <h3 className="mb-1 text-sm font-semibold">Muscles to feel</h3>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            Tap a muscle to add or remove it.{focusInherited ? ' Currently inherited from the main exercise.' : ''}
          </p>
          <BodyMap regions={eff.focusMuscles} onToggle={toggleRegion} />
          {eff.focusMuscles.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {eff.focusMuscles.map((r) => (
                <li key={r} className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
                  {regionName(r)}
                </li>
              ))}
            </ul>
          )}
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-sm font-semibold">Cue</span>
            <textarea
              key={`${ex.id}-${ex.updated_at}`}
              defaultValue={eff.focusCue ?? ''}
              placeholder={cueInherited ? 'Inherited from the main exercise' : 'e.g. drive with the elbows, feel the lats'}
              rows={2}
              onBlur={(e) => {
                const value = e.target.value.trim() || null
                if (value !== eff.focusCue) void updateExercise(ex, { focus_cue: value })
              }}
              className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700"
            />
          </label>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold">Reference videos</h3>
          {links.length === 0 ? (
            <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">No videos yet.</p>
          ) : (
            <ul className="mb-3 flex flex-col gap-1.5">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate rounded-lg bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800"
                  >
                    ▶ {linkLabel(l)}
                    {l.inherited && <span className="ml-1 text-xs text-neutral-500"> (main exercise)</span>}
                  </a>
                  {!l.inherited && (
                    <button onClick={() => void removeLink(l)} className="px-2 py-2 text-sm text-red-600 dark:text-red-400">
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={(e) => void submitLink(e)} className="flex flex-col gap-2">
            <input
              aria-label="Video URL"
              inputMode="url"
              autoCapitalize="none"
              placeholder="https://…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setUrlError(false)
              }}
              className={`rounded-lg border bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700 ${
                urlError ? 'border-red-500' : 'border-neutral-300'
              }`}
            />
            <input
              aria-label="Title (optional)"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700"
            />
            {urlError && <p className="text-sm text-red-600 dark:text-red-400">Please enter a valid web address.</p>}
            <button type="submit" className="rounded-lg bg-neutral-900 py-2 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
              Add video
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}

interface TextFieldProps {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
  /** Called on blur with the trimmed value (null when empty). */
  onSave: (value: string | null) => Promise<void> | void
}

/** Text input that saves on blur; multi-line keeps line breaks. */
function TextField({ label, value, placeholder, multiline, required, onSave }: TextFieldProps) {
  const className =
    'rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-100'
  function save(raw: string) {
    const v = multiline ? raw.replace(/\s+$/, '').replace(/^\s*\n/, '') : raw.trim()
    if (required && !v) return
    if ((v || '') !== value) void onSave(v || null)
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      {multiline ? (
        <textarea
          key={value}
          defaultValue={value}
          placeholder={placeholder}
          rows={Math.max(3, value.split('\n').length + 1)}
          onBlur={(e) => save(e.target.value)}
          className={className}
        />
      ) : (
        <input key={value} defaultValue={value} placeholder={placeholder} onBlur={(e) => save(e.target.value)} className={className} />
      )}
    </label>
  )
}
