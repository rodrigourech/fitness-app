import { registerSW } from 'virtual:pwa-register'

// App updates without clearing Safari data (decision 5 November 2026). An iPhone home-screen app resumes from the
// background without a page load, so the service worker never looked for a new version. Now it looks on start, every
// time the app comes back to the foreground and every 30 minutes. With registerType autoUpdate the new version takes
// over and the page reloads by itself; every entry is already saved locally, so nothing is lost.

const INTERVAL_MS = 30 * 60 * 1000
let registration: ServiceWorkerRegistration | undefined

export function startUpdates(): void {
  if (!('serviceWorker' in navigator)) return
  registerSW({
    immediate: true,
    onRegisteredSW(_url, r) {
      registration = r
      if (!r) return
      const check = () => {
        if (navigator.onLine) void r.update().catch(() => undefined)
      }
      setInterval(check, INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
    },
  })
}

/** Manual check from More: «updating» reloads by itself once the new version is ready. */
export async function checkForUpdate(): Promise<'updating' | 'current' | 'offline' | 'unsupported'> {
  if (!registration) return 'unsupported'
  if (!navigator.onLine) return 'offline'
  await registration.update()
  return registration.installing || registration.waiting ? 'updating' : 'current'
}

/** Build time of the running version, shown in More. */
export const BUILD_TIME: string = __BUILD_TIME__
