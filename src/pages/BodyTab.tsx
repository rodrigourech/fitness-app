import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState, type FormEvent } from 'react'
import PhotoImage from '../components/PhotoImage'
import Sheet from '../components/Sheet'
import { bodyWeightSeries, CONDITION_LABEL, deleteBodyWeight, saveBodyWeight, todayLocal } from '../lib/body'
import { db, type BodyCondition, type BodyPhoto, type PhotoPose } from '../lib/db'
import {
  addPhoto,
  changePhotoPassphrase,
  createPhotoKey,
  deletePhoto,
  photoKeyState,
  photosOf,
  resetPhotoPassphrase,
  storedPhotoCount,
  unlockPhotoKey,
} from '../lib/photos'
import { offerUndo } from '../lib/undo'
import { parseNumber } from '../lib/workout'

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const CONDITIONS = Object.keys(CONDITION_LABEL) as BodyCondition[]
const POSES: { value: PhotoPose; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
]
const SHORT_CONDITION: Record<BodyCondition, string> = {
  morning_fasted: 'morning',
  after_workout: 'after workout',
  after_meal: 'after meal',
  other: 'other',
}

const input = 'rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700'

export default function BodyTab({ userId }: { userId: string }) {
  const series = useLiveQuery(bodyWeightSeries, [])
  const photoCounts = useLiveQuery(async () => {
    const counts = new Map<string, number>()
    for (const p of await db.body_photo.toArray())
      if (p.deleted_at === null) counts.set(p.measured_on, (counts.get(p.measured_on) ?? 0) + 1)
    return counts
  }, [])
  const [date, setDate] = useState(todayLocal())
  const [kg, setKg] = useState('')
  const [condition, setCondition] = useState<BodyCondition>('morning_fasted')
  const [note, setNote] = useState('')
  const [error, setError] = useState(false)

  const existing = series?.find((p) => p.entry.measured_on === date)?.entry

  // Selecting a day with an entry loads it into the form for editing
  function pickDate(d: string) {
    setDate(d)
    const e = series?.find((p) => p.entry.measured_on === d)?.entry
    setKg(e ? String(e.weight_kg) : '')
    setCondition(e?.condition ?? 'morning_fasted')
    setNote(e?.note ?? '')
    setError(false)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = parseNumber(kg)
    if (n === undefined || n === null || n < 20 || n > 300) {
      setError(true)
      return
    }
    await saveBodyWeight(userId, date, n, condition, note.trim() || null)
    setError(false)
  }

  const latest = series?.[0]

  return (
    <>
      {latest && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="card p-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Latest</div>
            <div className="text-2xl font-semibold tabular-nums">{latest.entry.weight_kg.toFixed(1)} kg</div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">7-day average</div>
            <div className="text-2xl font-semibold tabular-nums">{latest.avg7.toFixed(1)} kg</div>
          </div>
        </div>
      )}

      <div className="card mb-4 flex flex-col gap-3 p-4">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="date"
              aria-label="Date"
              value={date}
              max={todayLocal()}
              onChange={(e) => pickDate(e.target.value)}
              className={`${input} min-w-0 flex-1`}
            />
            <input
              aria-label="Body weight kg"
              inputMode="decimal"
              placeholder="kg"
              value={kg}
              onChange={(e) => {
                setKg(e.target.value)
                setError(false)
              }}
              className={`${input} w-24 ${error ? 'border-red-500 dark:border-red-500' : ''}`}
            />
          </div>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">When measured</span>
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as BodyCondition)}
              className={`${input} py-1.5 text-sm dark:bg-zinc-900`}
            >
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <input aria-label="Note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className={input} />
          <button type="submit" className="rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg">
            {existing ? 'Update entry' : 'Save'}
          </button>
          <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Tip: weigh in the morning before eating, so values stay comparable.
          </p>
        </form>
        {/* Outside the form: the passphrase dialog has its own form */}
        <DayPhotos userId={userId} date={date} />
      </div>

      {series && series.length > 0 ? (
        <div className="card overflow-hidden">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-normal">Date</th>
                <th className="py-2 text-right font-normal">kg</th>
                <th className="py-2 text-right font-normal">7-day avg</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {series.map((p) => {
                const photos = photoCounts?.get(p.entry.measured_on) ?? 0
                return (
                  <tr
                    key={p.entry.id}
                    onClick={() => pickDate(p.entry.measured_on)}
                    className={`cursor-pointer border-t border-zinc-100 dark:border-zinc-800 ${p.entry.measured_on === date ? 'bg-accent-soft' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <span className="block">{dateFormat.format(new Date(`${p.entry.measured_on}T12:00:00`))}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {[
                          p.entry.condition ? SHORT_CONDITION[p.entry.condition] : null,
                          photos ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : null,
                          p.entry.note,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className="py-2 text-right">{p.entry.weight_kg.toFixed(1)}</td>
                    <td className="py-2 text-right text-zinc-500 dark:text-zinc-400">{p.avg7.toFixed(1)}</td>
                    <td className="py-2 pr-1 text-right">
                      <button
                        aria-label="Delete entry"
                        onClick={(e) => {
                          e.stopPropagation()
                          const label = dateFormat.format(new Date(`${p.entry.measured_on}T12:00:00`))
                          void deleteBodyWeight(p.entry).then(() => offerUndo(`${label} moved to trash`, p.entry.id))
                        }}
                        className="px-2 text-zinc-400 hover:text-red-600"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-zinc-500">No measurements yet.</p>
      )}
    </>
  )
}

// --- photos ---------------------------------------------------------------------------------

function DayPhotos({ userId, date }: { userId: string; date: string }) {
  const photos = useLiveQuery(() => photosOf(date), [date])
  const keyState = useLiveQuery(photoKeyState, [])
  const [pose, setPose] = useState<PhotoPose>('front')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'auto' | 'change' | null>(null)
  const [open, setOpen] = useState<BodyPhoto | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await addPhoto(userId, date, file, pose)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Photos</span>
        <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          End-to-end encrypted
        </span>
      </div>

      {keyState === undefined ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Checking photo access …</p>
      ) : keyState !== 'ready' ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setSheet('auto')}
            className="w-full rounded-lg bg-zinc-100 py-2.5 text-sm font-medium dark:bg-zinc-800"
          >
            {keyState === 'none' ? 'Set up photo passphrase' : 'Unlock photos'}
          </button>
          {keyState === 'locked' && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              To change your passphrase and keep your photos, use a device where they are still unlocked,
              or unlock them here first. If you forgot it, open “Unlock photos” for reset options.
            </p>
          )}
        </div>
      ) : (
        <>
          {photos && photos.length > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-2">
              {photos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setOpen(p)}
                  className="relative aspect-[3/4] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
                >
                  <PhotoImage photo={p} className="h-full w-full object-cover" />
                  {p.pose && (
                    <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-medium text-white">
                      {p.pose}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <div role="radiogroup" aria-label="Pose" className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
              {POSES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={pose === p.value}
                  onClick={() => setPose(p.value)}
                  className={`rounded-md py-1.5 text-xs font-semibold ${pose === p.value ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-fg disabled:opacity-50"
            >
              {busy ? 'Saving …' : '+ Photo'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </div>
          <button type="button" onClick={() => setSheet('change')} className="mt-3 w-full rounded-lg bg-zinc-100 px-3 py-3 text-sm font-semibold dark:bg-zinc-800">
            Change passphrase
          </button>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Photos are unlocked on this device. You can change the passphrase without entering the old one.</p>
        </>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {sheet === 'auto' && keyState && keyState !== 'ready' && <PassphraseSheet mode={keyState} userId={userId} onClose={() => setSheet(null)} />}
      {sheet === 'change' && <PassphraseSheet mode="change" userId={userId} onClose={() => setSheet(null)} />}
      {open && <PhotoViewer photo={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function PhotoViewer({ photo, onClose }: { photo: BodyPhoto; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <Sheet
      title={`${dateFormat.format(new Date(`${photo.measured_on}T12:00:00`))}${photo.pose ? ` · ${photo.pose}` : ''}`}
      onClose={onClose}
    >
      <div className="overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
        <PhotoImage photo={photo} className="w-full" />
      </div>
      {confirm ? (
        <div className="mt-4 flex gap-2">
          <button onClick={() => setConfirm(false)} className="flex-1 rounded-lg py-2 text-sm">
            Cancel
          </button>
          <button
            onClick={() =>
              void deletePhoto(photo).then(() => {
                offerUndo('Photo moved to trash', photo.id)
                onClose()
              })
            }
            className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white"
          >
            Delete photo
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirm(true)} className="mt-4 w-full py-2 text-sm text-red-600 dark:text-red-400">
          Delete photo
        </button>
      )}
    </Sheet>
  )
}

type PassphraseMode = 'none' | 'locked' | 'change' | 'reset'

const PASSPHRASE_TITLE: Record<PassphraseMode, string> = {
  none: 'Set up photo passphrase',
  locked: 'Unlock photos',
  change: 'Change photo passphrase',
  reset: 'Reset photo passphrase',
}

function PassphraseSheet({ mode: initial, userId, onClose }: { mode: PassphraseMode; userId: string; onClose: () => void }) {
  const [mode, setMode] = useState<PassphraseMode>(initial)
  const [pass, setPass] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const count = useLiveQuery(storedPhotoCount, [])
  const isNew = mode !== 'locked'

  function switchMode(next: PassphraseMode) {
    setMode(next)
    setPass('')
    setRepeat('')
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (isNew) {
      if (pass.length < 10) return setError('Use at least 10 characters.')
      if (pass !== repeat) return setError('The passphrases do not match.')
    }
    setBusy(true)
    try {
      if (mode === 'none') {
        await createPhotoKey(userId, pass)
      } else if (mode === 'change') {
        await changePhotoPassphrase(userId, pass, (done, total) => setProgress({ done, total }))
      } else if (mode === 'reset') {
        await resetPhotoPassphrase(userId, pass)
      } else if (!(await unlockPhotoKey(pass))) {
        setError('Wrong passphrase.')
        return
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const photos = count === undefined ? 'all' : `${count} ${count === 1 ? 'photo' : 'photos'}`
  const text: Record<PassphraseMode, string> = {
    none: 'Photos are encrypted on this device before upload. Only this passphrase can open them, not even the server can. If you forget it, your photos cannot be recovered. Keep it in a password manager.',
    locked: 'Enter your photo passphrase once on this device.',
    change: count === 0
      ? 'There are no photos yet, so only the passphrase changes. Other devices will ask for the new one.'
      : `All ${photos} (including the trash) are re-encrypted with the new passphrase on this device; the old passphrase is not needed. Other devices will ask for the new one. Keep this screen open until it is done.`,
    reset: `Without the old passphrase your ${photos} (including the trash) cannot be opened any more. Resetting deletes them for good; the originals in your phone's photo library are not affected. If photos still open on another device, use "Change passphrase" there instead to keep them.`,
  }

  return (
    <Sheet title={PASSPHRASE_TITLE[mode]} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{text[mode]}</p>
        <input
          type="password"
          autoComplete={isNew ? 'new-password' : 'current-password'}
          placeholder={isNew && mode !== 'none' ? 'New passphrase' : 'Photo passphrase'}
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          className={input}
        />
        {isNew && (
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Repeat passphrase"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className={input}
          />
        )}
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={busy || !pass}
          className={`rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50 ${
            mode === 'reset' ? 'bg-red-600 text-white' : 'bg-accent text-accent-fg'
          }`}
        >
          {progress
            ? `Re-encrypting ${progress.done} of ${progress.total} …`
            : busy
              ? 'Working …'
              : mode === 'none'
                ? 'Create passphrase'
                : mode === 'change'
                  ? 'Change passphrase'
                  : mode === 'reset'
                    ? count
                      ? `Delete ${photos} and reset`
                      : 'Reset passphrase'
                    : 'Unlock'}
        </button>
        {mode === 'locked' && (
          <button type="button" onClick={() => switchMode('reset')} className="py-1 text-sm text-zinc-500 dark:text-zinc-400">
            Forgot passphrase?
          </button>
        )}
        {mode === 'reset' && initial === 'locked' && (
          <button type="button" onClick={() => switchMode('locked')} className="py-1 text-sm text-zinc-500 dark:text-zinc-400">
            Back to unlock
          </button>
        )}
      </form>
    </Sheet>
  )
}
