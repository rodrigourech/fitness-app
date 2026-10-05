// Light/dark theme. The preference is per device (localStorage); "system" follows the OS setting.
// index.html applies the stored theme before the first paint, so there is no flash.

export type ThemePref = 'system' | 'light' | 'dark'

const KEY = 'theme'
const COLORS = { light: '#ffffff', dark: '#0a0a0a' } as const

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Sets data-theme on <html> (Tailwind dark variant and chart tokens) and the browser theme colour. */
export function applyTheme(pref: ThemePref = getThemePref()): void {
  const theme = pref === 'dark' || (pref === 'system' && systemDark()) ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme])
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, pref)
  } catch {
    // Storage blocked (e.g. private mode): the choice applies until the app is closed
  }
  applyTheme(pref)
  window.dispatchEvent(new Event('themechange'))
}

/** Applies the theme now and follows OS changes while the preference is "system". */
export function initTheme(): void {
  applyTheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system')
  })
}
