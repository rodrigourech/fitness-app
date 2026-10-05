import type { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Bottom sheet on phones, centred dialog on larger screens. */
export default function Sheet({ title, onClose, children }: Props) {
  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-md sm:rounded-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
