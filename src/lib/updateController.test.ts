import { describe, expect, it, vi } from 'vitest'
import { createUpdateController, type UpdateDeps } from './updateController'

// Fake service worker registration: update() may find a new version that ends up waiting
function setup(opts: { online?: boolean; server?: string | null; revision?: string | null } = {}) {
  const reg = { waiting: null as object | null, installing: null as object | null, update: vi.fn(async () => undefined) }
  let hooks: Parameters<UpdateDeps['register']>[0] | undefined
  const visible: (() => void)[] = []
  const timers: (() => void)[] = []
  const activate = vi.fn(async () => undefined)
  const reload = vi.fn()
  const c = createUpdateController({
    register: (o) => ((hooks = o), activate),
    onVisible: (cb) => visible.push(cb),
    every: (_ms, cb) => timers.push(cb),
    online: () => opts.online ?? true,
    reload,
    serverRevision: async () => opts.server ?? null,
    revision: opts.revision ?? null,
  })
  c.start()
  hooks!.onRegisteredSW('sw.js', reg as unknown as ServiceWorkerRegistration)
  return { c, reg, hooks: hooks!, visible, timers, activate, reload }
}

describe('update controller (decision 5 November 2026, variant A)', () => {
  it('checks on return to the app and on the timer, never while offline', () => {
    const { reg, visible, timers } = setup()
    visible[0]!()
    timers[0]!()
    expect(reg.update).toHaveBeenCalledTimes(2)
    const off = setup({ online: false })
    off.visible[0]!()
    expect(off.reg.update).not.toHaveBeenCalled()
  })

  it('a new version only shows the bar and never reloads by itself', () => {
    const { c, hooks, activate, reload } = setup()
    const listener = vi.fn()
    c.subscribe(listener)
    expect(c.available()).toBe(false)
    hooks.onNeedRefresh()
    expect(c.available()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(activate).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('Reload activates the waiting version, without one it reloads the page', async () => {
    const a = setup()
    a.reg.waiting = {}
    await a.c.apply()
    expect(a.activate).toHaveBeenCalledWith(true)
    const b = setup()
    await b.c.apply()
    expect(b.activate).not.toHaveBeenCalled()
    expect(b.reload).toHaveBeenCalled()
  })

  it('manual check: available with a waiting version, pending when only the server is newer, else current', async () => {
    const a = setup()
    a.reg.update.mockImplementation(async () => void (a.reg.waiting = {}))
    expect(await a.c.check()).toBe('available')
    expect(a.c.available()).toBe(true)
    expect(await setup({ server: 'new', revision: 'old' }).c.check()).toBe('pending')
    expect(await setup({ server: 'same', revision: 'same' }).c.check()).toBe('current')
    expect(await setup({ online: false }).c.check()).toBe('offline')
  })
})
