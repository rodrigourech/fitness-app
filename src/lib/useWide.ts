import { useEffect, useState } from 'react'

/** Laptop layout from 1024 px (Tailwind lg, decision 3 November 2026). */
export const WIDE_QUERY = '(min-width: 1024px)'

function matches(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches
}

/** True while the window is at least 1024 px wide; follows resizing. */
export function useWide(): boolean {
  const [wide, setWide] = useState(matches)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return wide
}
