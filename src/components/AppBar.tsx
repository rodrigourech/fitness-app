import type { ReactNode } from 'react'

// The beta build (branch major-update) uses its own local database name, see .github/workflows/deploy.yml
const BETA = import.meta.env.VITE_DB_NAME === 'fitness-app-beta'

/** Top bar with the app title and page actions. */
export default function AppBar({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
      <span className="flex items-center gap-2 text-lg font-bold tracking-tight whitespace-nowrap">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
        Fitness App
        {BETA && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent-ink">Beta</span>}
      </span>
      <div className="flex flex-wrap items-center justify-end gap-0.5 whitespace-nowrap">{children}</div>
    </div>
  )
}
