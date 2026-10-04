import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, getMeta, setMeta } from './db'

const PROXY = 'https://proxy.example'

function jwt(expInS: number): string {
  const payload = btoa(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + expInS }))
  return `h.${payload.replace(/=+$/, '')}.s`
}

async function load() {
  vi.stubEnv('VITE_AUTH_PROXY_URL', PROXY)
  vi.resetModules()
  return import('./session')
}

describe('session via auth proxy', () => {
  beforeEach(async () => {
    await db.meta.clear()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses a cached JWT that is still valid', async () => {
    const { getJwt } = await load()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const cached = jwt(600)
    await setMeta('session_token', 'tok')
    await setMeta('jwt', cached)
    expect(await getJwt()).toBe(cached)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes an expiring JWT and stores the renewed session token', async () => {
    const { getJwt } = await load()
    const fresh = jwt(900)
    const fetchMock = vi.fn(async () => Response.json({ token: 'tok2', jwt: fresh, user: { id: 'u1', email: '' }, expiresAt: null }))
    vi.stubGlobal('fetch', fetchMock)
    await setMeta('session_token', 'tok')
    await setMeta('jwt', jwt(30))
    expect(await getJwt()).toBe(fresh)
    expect(fetchMock).toHaveBeenCalledWith(`${PROXY}/session`, expect.objectContaining({ body: JSON.stringify({ token: 'tok' }) }))
    expect(await getMeta('session_token')).toBe('tok2')
  })

  it('coalesces concurrent refreshes into one request', async () => {
    const { getJwt } = await load()
    const fetchMock = vi.fn(async () => Response.json({ token: 'tok', jwt: jwt(900), user: { id: 'u1', email: '' }, expiresAt: null }))
    vi.stubGlobal('fetch', fetchMock)
    await setMeta('session_token', 'tok')
    await Promise.all([getJwt(), getJwt(), getJwt()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('forgets an expired session', async () => {
    const { getJwt } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Session expired.' }, { status: 401 })))
    await setMeta('session_token', 'tok')
    expect(await getJwt()).toBeNull()
    expect(await getMeta('session_token')).toBeUndefined()
  })

  it('reports proxy failures as errors, not as signed out', async () => {
    const { getJwt, ProxyError } = await load()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 502 })))
    await setMeta('session_token', 'tok')
    await expect(getJwt()).rejects.toBeInstanceOf(ProxyError)
    expect(await getMeta('session_token')).toBe('tok')
  })

  it('returns null without a session', async () => {
    const { getJwt } = await load()
    expect(await getJwt()).toBeNull()
  })
})
