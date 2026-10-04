import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { db, displayName, type Exercise } from '../lib/db'
import { addLink, linkLabel, linksFor, normalizeUrl, removeLink, updateExercise } from '../lib/exercise'
import { effective } from '../lib/workout'
import { regionName } from '../lib/muscles'
import BodyMap from './BodyMap'

interface Props {
  exerciseId: string
  onClose: () => void
}

const FLOOR = { oben: 'Upstairs', unten: 'Downstairs' } as const

/** Bottom sheet with focus muscles, cue and reference videos of an exercise. */
export default function ExerciseSheet({ exerciseId, onClose }: Props) {
  const data = useLiveQuery(async () => {
    const ex = await db.exercise.get(exerciseId)
    if (!ex) return null
    const parent = ex.parent_id ? await db.exercise.get(ex.parent_id) : undefined
    const byId = new Map<string, Exercise>([[ex.id, ex], ...(parent ? ([[parent.id, parent]] as const) : [])])
    return { ex, byId, links: await linksFor(ex) }
  }, [exerciseId])

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [urlError, setUrlError] = useState(false)

  if (data === undefined) return null
  if (data === null) return null
  const { ex, byId, links } = data
  const eff = effective(ex, byId)
  const focusInherited = ex.parent_id !== null && ex.focus_muscles == null
  const cueInherited = ex.parent_id !== null && ex.focus_cue == null

  function toggleRegion(region: string) {
    const current = eff.focusMuscles
    const next = current.includes(region) ? current.filter((r) => r !== region) : [...current, region]
    void updateExercise(ex, { focus_muscles: next })
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

  const settings = [
    eff.floor ? FLOOR[eff.floor] : null,
    eff.seat ? `Seat ${eff.seat}` : null,
    eff.footPosition ? `Feet ${eff.footPosition}` : null,
    eff.setupNote,
  ].filter(Boolean)

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={displayName(ex, byId)}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-md sm:rounded-2xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{displayName(ex, byId)}</h2>
            {settings.length > 0 && <p className="text-sm text-neutral-500 dark:text-neutral-400">{settings.join(' · ')}</p>}
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-neutral-500 dark:text-neutral-400">
            Close
          </button>
        </div>

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
