import { useState } from 'react'
import { applyUpdate, useUpdateAvailable } from '../lib/update'

// Bar «New version available · Reload» (decision 5 November 2026, variant A): above the navigation outside a workout,
// in the head of a running workout, scrolling with the page so it never covers set fields or the rest timer.

export default function UpdateBar({ placement }: { placement: 'nav' | 'inline' }) {
  const available = useUpdateAvailable()
  const [busy, setBusy] = useState(false)
  if (!available) return null
  const bar = (
    <div
      role="status"
      className={`flex h-10 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white pr-1 pl-3.5 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
        placement === 'nav' ? 'shadow-md' : ''
      }`}
    >
      <span>New version available</span>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void applyUpdate()
        }}
        className="h-8 rounded-lg bg-accent px-3.5 text-sm font-semibold text-accent-fg disabled:opacity-60"
      >
        {busy ? 'Reloading …' : 'Reload'}
      </button>
    </div>
  )
  return placement === 'nav' ? <div className="update-bar fixed z-30">{bar}</div> : <div className="-mt-1 mb-3">{bar}</div>
}
