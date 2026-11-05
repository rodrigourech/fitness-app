// Update logic without browser APIs (decision 5 November 2026, variant A); wired up in update.ts.

const INTERVAL_MS = 30 * 60 * 1000

/** pending: the server has a newer build that the service worker has not fetched yet */
export type CheckResult = 'available' | 'pending' | 'current' | 'offline' | 'unsupported'

/** What the controller needs from the browser; injected so the logic is testable without a service worker. */
export interface UpdateDeps {
  register: (options: {
    onNeedRefresh: () => void
    onRegisteredSW: (url: string, registration: ServiceWorkerRegistration | undefined) => void
  }) => (reloadPage?: boolean) => Promise<void>
  onVisible: (callback: () => void) => void
  every: (ms: number, callback: () => void) => void
  online: () => boolean
  reload: () => void
  /** Commit of the version on the server (build-info.json), null when unknown */
  serverRevision: () => Promise<string | null>
  /** Commit of the running version, null in local builds */
  revision: string | null
}

export function createUpdateController(deps: UpdateDeps) {
  let available = false
  let registration: ServiceWorkerRegistration | undefined
  let activate: ((reloadPage?: boolean) => Promise<void>) | undefined
  const listeners = new Set<() => void>()
  const setAvailable = () => {
    if (available) return
    available = true
    listeners.forEach((l) => l())
  }
  const waitingOrInstalling = () => Boolean(registration?.waiting || registration?.installing)

  return {
    start(): void {
      activate = deps.register({
        onNeedRefresh: setAvailable,
        onRegisteredSW(_url, r) {
          registration = r
          if (!r) return
          const check = () => {
            if (deps.online()) void r.update().catch(() => undefined)
          }
          deps.every(INTERVAL_MS, check)
          deps.onVisible(check)
        },
      })
    },

    /** Manual check from More; a found version shows the same bar. */
    async check(): Promise<CheckResult> {
      if (!registration) return 'unsupported'
      if (!deps.online()) return 'offline'
      await registration.update().catch(() => undefined)
      if (available || waitingOrInstalling()) {
        // An installing worker reports through onNeedRefresh once it is ready
        if (registration.waiting) setAvailable()
        return 'available'
      }
      const server = await deps.serverRevision().catch(() => null)
      if (server && deps.revision && server !== deps.revision) return 'pending'
      return 'current'
    },

    /** Tap on «Reload»: activate the waiting version and reload; without one a plain reload. */
    async apply(): Promise<void> {
      if (activate && registration?.waiting) await activate(true)
      else deps.reload()
    },

    available: () => available,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type UpdateController = ReturnType<typeof createUpdateController>
