import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import AppBar from '../components/AppBar'
import PhotoImage from '../components/PhotoImage'
import { CONDITION_LABEL } from '../lib/body'
import type { BodyWeight } from '../lib/db'
import { photoKeyState } from '../lib/photos'
import { daysLeft, purgeItems, restoreConflict, restoreItem, trashItems, TRASH_DAYS, type TrashItem } from '../lib/trash'

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const deletedFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function day(isoDate: string): string {
  return dayFormat.format(new Date(`${isoDate}T12:00:00`))
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Deleted body weight entries, photos and workouts of the last 30 days (decision 8 October 2026). */
export default function TrashPage({ onDone }: { onDone: () => void }) {
  const items = useLiveQuery(() => trashItems(), [])
  const keyState = useLiveQuery(photoKeyState, [])
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <button onClick={onDone} className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium shadow-sm dark:bg-zinc-800">
          Done
        </button>
      </AppBar>

      <h1 className="text-xl font-semibold">Trash</h1>
      <p className="mt-1 mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Deleted entries, photos and workouts stay here for {TRASH_DAYS} days and can be restored. After that they are removed for good.
      </p>

      {items === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : items.length === 0 ? (
        <p className="card p-4 text-sm text-zinc-500 dark:text-zinc-400">The trash is empty.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <TrashRow key={`${item.kind}:${item.id}`} item={item} showPhotos={keyState === 'ready'} />
            ))}
          </ul>

          <div className="mt-6">
            {confirmEmpty ? (
              <div className="card p-3">
                <p className="mb-3 text-sm">
                  Remove all {plural(items.length, 'item')} for good? This cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmEmpty(false)} className="flex-1 rounded-lg py-2 text-sm">
                    Cancel
                  </button>
                  <button
                    onClick={() => void purgeItems(items).then(() => setConfirmEmpty(false))}
                    className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white"
                  >
                    Empty trash
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmEmpty(true)} className="w-full py-2 text-sm text-red-600 dark:text-red-400">
                Empty trash
              </button>
            )}
          </div>
        </>
      )}
    </main>
  )
}

function TrashRow({ item, showPhotos }: { item: TrashItem; showPhotos: boolean }) {
  const [mode, setMode] = useState<'idle' | 'purge' | 'replace'>('idle')
  const [current, setCurrent] = useState<BodyWeight | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    const conflict = await restoreConflict(item)
    if (conflict) {
      setCurrent(conflict)
      setMode('replace')
      return
    }
    await run(() => restoreItem(item))
  }

  const left = daysLeft(item.deletedAt)
  const photos = item.kind === 'body_weight' ? item.photos : item.kind === 'body_photo' ? [item.photo] : []

  return (
    <li className="card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Title item={item} />
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            Deleted {deletedFormat.format(new Date(item.deletedAt))} · {left === 0 ? 'last day' : `${plural(left, 'day')} left`}
          </p>
        </div>
        {mode === 'idle' && (
          <div className="flex shrink-0 gap-1">
            <button
              disabled={busy}
              onClick={() => void restore()}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-fg disabled:opacity-50"
            >
              Restore
            </button>
            <button
              disabled={busy}
              onClick={() => setMode('purge')}
              aria-label="Delete permanently"
              title="Delete permanently"
              className="rounded-lg px-2 py-1.5 text-zinc-400 hover:text-red-600 disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {showPhotos && photos.length > 0 && (
        <div className="mt-2 flex gap-2">
          {photos.map((p) => (
            <div key={p.id} className="relative aspect-[3/4] w-16 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
              <PhotoImage photo={p} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      )}

      {mode === 'purge' && (
        <Confirm
          text="Delete permanently? This cannot be undone."
          action="Delete permanently"
          danger
          busy={busy}
          onCancel={() => setMode('idle')}
          onConfirm={() => void run(() => purgeItems([item]))}
        />
      )}
      {mode === 'replace' && current && (
        <Confirm
          text={`There is already an entry for this day (${current.weight_kg.toFixed(1)} kg). Replace it? The current entry moves to the trash.`}
          action="Replace"
          busy={busy}
          onCancel={() => setMode('idle')}
          onConfirm={() => void run(() => restoreItem(item))}
        />
      )}
    </li>
  )
}

function Title({ item }: { item: TrashItem }) {
  if (item.kind === 'body_weight') {
    const e = item.entry
    const details = [
      `${e.weight_kg.toFixed(1)} kg`,
      e.condition ? CONDITION_LABEL[e.condition] : null,
      item.photos.length ? plural(item.photos.length, 'photo') : null,
      e.note,
    ].filter(Boolean)
    return (
      <>
        <p className="font-semibold">Body weight · {day(e.measured_on)}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{details.join(' · ')}</p>
      </>
    )
  }
  if (item.kind === 'body_photo') {
    const p = item.photo
    return (
      <>
        <p className="font-semibold">Photo · {day(p.measured_on)}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{p.pose ? `Pose ${p.pose}` : 'Progress photo'}</p>
      </>
    )
  }
  if (item.kind === 'template')
    return (
      <>
        <p className="font-semibold">{item.template.name}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Workout template · {plural(item.exercises, 'exercise')} · returns to the archive</p>
      </>
    )
  const w = item.workout
  return (
    <>
      <p className="font-semibold">
        {w.template_name_snapshot ?? 'Workout'} · {dayFormat.format(new Date(w.started_at))}
      </p>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Workout · {plural(item.exercises, 'exercise')} · {plural(item.sets, 'set')}
      </p>
    </>
  )
}

function Confirm(props: { text: string; action: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <p className="mb-2 text-sm">{props.text}</p>
      <div className="flex gap-2">
        <button onClick={props.onCancel} className="flex-1 rounded-lg py-2 text-sm">
          Cancel
        </button>
        <button
          disabled={props.busy}
          onClick={props.onConfirm}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold disabled:opacity-50 ${props.danger ? 'bg-red-600 text-white' : 'bg-accent text-accent-fg'}`}
        >
          {props.action}
        </button>
      </div>
    </div>
  )
}
