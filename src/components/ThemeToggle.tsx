import { useEffect, useState } from 'react'
import { getAccent, getThemePref, setAccent, setThemePref, type Accent, type ThemePref } from '../lib/theme'
import Popover from './Popover'

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const ACCENTS: { value: Accent; label: string; color: string }[] = [
  { value: 'blue', label: 'Blue', color: '#2563eb' },
  { value: 'green', label: 'Green', color: '#059669' },
  { value: 'violet', label: 'Violet', color: '#7c3aed' },
]

/** Sun, moon or half circle (system), drawn with the current text colour. */
function Icon({ pref }: { pref: ThemePref }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (pref === 'light')
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  if (pref === 'dark')
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    )
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  )
}

/** Appearance switch for the app bar: System, Light or Dark, plus the accent colour. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref)
  const [accent, setAccentState] = useState<Accent>(getAccent)

  useEffect(() => {
    const sync = () => {
      setPref(getThemePref())
      setAccentState(getAccent())
    }
    window.addEventListener('themechange', sync)
    return () => window.removeEventListener('themechange', sync)
  }, [])

  return (
    <Popover
      align="right"
      ariaLabel={`Appearance: ${pref}, ${accent}`}
      label={<Icon pref={pref} />}
      triggerClassName="rounded-md p-1.5 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      <span className="flex w-40 flex-col gap-0.5">
        <span className="px-2 pb-1 text-xs text-zinc-500 dark:text-zinc-400">Appearance</span>
        <span role="radiogroup" aria-label="Theme" className="flex flex-col gap-0.5">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={pref === o.value}
              onClick={() => {
                setThemePref(o.value)
                setPref(o.value)
              }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                pref === o.value ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : ''
              }`}
            >
              <Icon pref={o.value} />
              {o.label}
            </button>
          ))}
        </span>
        <span className="mt-2 px-2 pb-1 text-xs text-zinc-500 dark:text-zinc-400">Accent</span>
        <span role="radiogroup" aria-label="Accent colour" className="flex gap-2 px-2">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              role="radio"
              aria-checked={accent === a.value}
              aria-label={a.label}
              title={a.label}
              onClick={() => {
                setAccent(a.value)
                setAccentState(a.value)
              }}
              className={`h-7 w-7 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 ${
                accent === a.value ? 'ring-2 ring-zinc-900 dark:ring-zinc-100' : ''
              }`}
              style={{ background: a.color }}
            />
          ))}
        </span>
      </span>
    </Popover>
  )
}
