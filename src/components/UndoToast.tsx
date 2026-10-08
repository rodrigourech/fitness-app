import { useSyncExternalStore } from 'react'
import { dismissUndo, getUndo, subscribeUndo, undo } from '../lib/undo'

/** "Moved to trash · Undo" at the bottom; sits above the minimised workout bar when that is shown. */
export default function UndoToast({ raised = false }: { raised?: boolean }) {
  const offer = useSyncExternalStore(subscribeUndo, getUndo)
  if (!offer) return null
  return (
    <div
      className={`fixed inset-x-0 z-40 px-3 ${raised ? 'bottom-24' : 'bottom-0 pb-[max(env(safe-area-inset-bottom),0.75rem)]'}`}
      role="status"
    >
      <div
        key={offer.key}
        className="mx-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      >
        <span className="min-w-0 truncate">{offer.message}</span>
        <span className="flex shrink-0 items-center gap-1">
          <button onClick={() => void undo()} className="rounded-md px-2 py-1 font-semibold text-accent-soft dark:text-accent">
            Undo
          </button>
          <button onClick={dismissUndo} aria-label="Dismiss" className="rounded-md px-1.5 py-1 opacity-60">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </span>
      </div>
    </div>
  )
}
