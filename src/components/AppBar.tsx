import type { ReactNode } from 'react'

/** Top bar with the app title and page actions. */
export default function AppBar({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 border-b border-neutral-200 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 dark:border-neutral-800">
      <span className="text-base font-bold tracking-tight">Fitness App</span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  )
}
