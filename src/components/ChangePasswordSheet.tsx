import { useState, type FormEvent } from 'react'
import { proxyChangePassword } from '../lib/session'
import Sheet from './Sheet'

const input = 'rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700'

/** Changes the account password; all other devices are signed out (decision 9 October 2026). */
export default function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 10) return setError('Use at least 10 characters.')
    if (next !== repeat) return setError('The new passwords do not match.')
    if (next === current) return setError('The new password is the same as the current one.')
    if (!navigator.onLine) return setError('Changing the password needs a connection.')
    setBusy(true)
    try {
      await proxyChangePassword(current, next)
      setDone(true)
    } catch (err) {
      const status = (err as { status?: number }).status
      setError(status === 400 || status === 401 ? 'The current password is wrong.' : err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Change password" onClose={onClose}>
      {done ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">Password changed. All other devices are signed out and need the new password.</p>
          <button onClick={onClose} className="rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg">
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            After the change, all other devices are signed out. The photo passphrase is separate and stays the same.
          </p>
          <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
          <input type="password" autoComplete="new-password" placeholder="New password" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
          <input type="password" autoComplete="new-password" placeholder="Repeat new password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={input} />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={busy || !current || !next}
            className="rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-fg disabled:opacity-50"
          >
            {busy ? 'Working …' : 'Change password'}
          </button>
        </form>
      )}
    </Sheet>
  )
}
