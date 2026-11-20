import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  home: <path d="m3 10 9-7 9 7v11H3V10Zm6 11v-8h6v8" />,
  workout: <><path d="m6 5-2 2 13 13 2-2M3 9l6-6M15 21l6-6M8 12l4-4M12 16l4-4" /></>,
  stats: <path d="M4 3v18h17M8 16l4-5 4 2 5-7" />,
  body: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  up: <path d="M12 20V4m-6 6 6-6 6 6" />,
  calendar: <><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16" /></>,
  scale: <><rect x="3" y="4" width="18" height="17" rx="4" /><path d="M8 10a5 5 0 0 1 8 0M12 8v3" /></>,
  photos: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8" cy="9" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />,
  history: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v6l4 2" />,
  guide: <path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1m0-15c3-2 6-2 10-1v15c-4-1-7-1-10 1V5Z" />,
  food: <path d="M7 3v8a2 2 0 0 0 2 2v8M7 3v5M11 3v5M17 3c-2 2-2 6 0 8v10" />,
  // Section switches of Training and Food (decision 20 November 2026)
  plans: <path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12" />,
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  book: <><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M5 17a3 3 0 0 1 3-3h10" /></>,
  fridge: <><rect x="6" y="3" width="12" height="18" rx="2" /><path d="M6 10h12M9 6v2M9 13v3" /></>,
}

export type AppIconName = keyof typeof paths

export default function AppIcon({ name, className = '' }: { name: AppIconName; className?: string }) {
  return <svg className={`app-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
