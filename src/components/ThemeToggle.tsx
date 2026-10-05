import { useEffect, useState } from 'react'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import Popover from './Popover'

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Sun, moon or half circle (system), drawn with the current text colour. */
function Icon({ pref }: { pref: ThemePref }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
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

/** Theme switch for the app bar: System, Light or Dark. */
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref)

  useEffect(() => {
    const sync = () => setPref(getThemePref())
    window.addEventListener('themechange', sync)
    return () => window.removeEventListener('themechange', sync)
  }, [])

  return (
    <Popover
      align="right"
      ariaLabel={`Theme: ${pref}`}
      label={<Icon pref={pref} />}
      triggerClassName="rounded-md p-1.5 text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
    >
      {(close) => (
        <span role="radiogroup" aria-label="Theme" className="flex w-36 flex-col gap-0.5">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={pref === o.value}
              onClick={() => {
                setThemePref(o.value)
                setPref(o.value)
                close()
              }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                pref === o.value ? 'bg-neutral-100 font-semibold dark:bg-neutral-800' : ''
              }`}
            >
              <Icon pref={o.value} />
              {o.label}
            </button>
          ))}
        </span>
      )}
    </Popover>
  )
}
