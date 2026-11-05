import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
// App updates (decision 5 November 2026, revised the same evening, variant A): the service worker looks for a new
// version on start, every time the app comes back to the foreground and every 30 minutes. A new version waits until
// Rodrigo taps «Reload» in the bar «New version available»; the app never reloads by itself, so a running workout is
// never interrupted. vite-plugin-pwa runs with registerType 'prompt' (no skipWaiting in the service worker).

import { createUpdateController, type CheckResult } from './updateController'

/** Commit and build time of the running version, set at build time (vite.config.ts). */
export const BUILD_TIME: string = __BUILD_TIME__
export const BUILD_COMMIT: string | null = __BUILD_COMMIT__ || null

async function fetchServerRevision(): Promise<string | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}build-info.json`, { cache: 'no-store' })
  if (!res.ok) return null
  const info = (await res.json()) as { revision?: string | null }
  return info.revision ?? null
}

const controller = createUpdateController({
  register: (options) => registerSW({ immediate: true, ...options }),
  onVisible: (callback) =>
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') callback()
    }),
  every: (ms, callback) => void setInterval(callback, ms),
  online: () => navigator.onLine,
  reload: () => window.location.reload(),
  serverRevision: fetchServerRevision,
  revision: BUILD_COMMIT,
})

export function startUpdates(): void {
  if ('serviceWorker' in navigator) controller.start()
}

export type { CheckResult }
export const checkForUpdate = (): Promise<CheckResult> => controller.check()
export const applyUpdate = (): Promise<void> => controller.apply()

/** True once a new version waits for «Reload». */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(controller.subscribe, controller.available)
}
