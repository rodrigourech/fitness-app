import { describe, expect, it } from 'vitest'
import { handle, sessionCookie, type ProxyEnv } from './authproxy.ts'

const AUTH = 'https://auth.example/neondb/auth'
const ORIGIN = 'https://rodrigourech.github.io'
const env: ProxyEnv = { AUTH_URL: AUTH, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` }
const COOKIE = '__Secure-neon-auth.session_token'

interface Call {
  url: string
  method: string
  headers: Headers
  body: string | null
}

/** Fake Neon Auth: one user, session token "tok.sig", optional renewal on get-session. */
function fakeAuth(opts: { renew?: boolean; jwtHeader?: boolean } = {}) {
  const calls: Call[] = []
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    calls.push({ url, method: init?.method ?? 'GET', headers, body: (init?.body as string) ?? null })
    const cookie = headers.get('cookie') ?? ''
    const valid = cookie === `${COOKIE}=tok.sig` || cookie === `${COOKIE}=new.sig`
    if (url === `${AUTH}/sign-in/email`) {
      const { password } = JSON.parse(String(init?.body))
      if (password !== 'right') return Response.json({ message: 'Invalid email or password' }, { status: 401 })
      return Response.json(
        { token: 'raw', user: { id: 'u1' } },
        { headers: { 'set-cookie': `${COOKIE}=tok.sig; Path=/; HttpOnly; Secure; SameSite=None` } },
      )
    }
    if (url === `${AUTH}/get-session`) {
      if (!valid) return Response.json(null)
      const h = new Headers()
      if (opts.jwtHeader !== false) h.set('set-auth-jwt', 'jwt-1')
      if (opts.renew) h.append('set-cookie', `${COOKIE}=new.sig; Path=/; HttpOnly; Secure`)
      return Response.json({ user: { id: 'u1', email: 'a@b.c' }, session: { expiresAt: '2026-10-11T00:00:00Z' } }, { headers: h })
    }
    if (url === `${AUTH}/token`) return valid ? Response.json({ token: 'jwt-2' }) : new Response(null, { status: 401 })
    if (url === `${AUTH}/sign-out`) return Response.json({ success: true })
    return new Response(null, { status: 404 })
  }) as typeof fetch
  return { f, calls }
}

function post(path: string, body: unknown, origin: string | null = ORIGIN): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (origin) headers.origin = origin
  return new Request(`https://proxy.example${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('auth proxy', () => {
  it('signs in and returns session token and JWT', async () => {
    const { f, calls } = fakeAuth()
    const res = await handle(post('/sign-in', { email: 'a@b.c', password: 'right' }), env, f)
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(await res.json()).toEqual({
      token: 'tok.sig',
      jwt: 'jwt-1',
      user: { id: 'u1', email: 'a@b.c' },
      expiresAt: '2026-10-11T00:00:00Z',
    })
    // Neon Auth checks the origin against its trusted domains
    expect(calls.every((c) => c.headers.get('origin') === ORIGIN)).toBe(true)
  })

  it('passes wrong password through as 401', async () => {
    const { f } = fakeAuth()
    const res = await handle(post('/sign-in', { email: 'a@b.c', password: 'wrong' }), env, f)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Invalid email or password' })
  })

  it('refreshes the JWT and returns a renewed session token', async () => {
    const { f } = fakeAuth({ renew: true })
    const res = await handle(post('/session', { token: 'tok.sig' }), env, f)
    expect(await res.json()).toMatchObject({ token: 'new.sig', jwt: 'jwt-1' })
  })

  it('falls back to /token when get-session sends no JWT header', async () => {
    const { f } = fakeAuth({ jwtHeader: false })
    const res = await handle(post('/session', { token: 'tok.sig' }), env, f)
    expect(await res.json()).toMatchObject({ token: 'tok.sig', jwt: 'jwt-2' })
  })

  it('answers 401 for an unknown or expired session', async () => {
    const { f } = fakeAuth()
    const res = await handle(post('/session', { token: 'old.sig' }), env, f)
    expect(res.status).toBe(401)
  })

  it('rejects foreign or missing origins and does not call Neon Auth', async () => {
    const { f, calls } = fakeAuth()
    expect((await handle(post('/sign-in', { email: 'a', password: 'right' }, 'https://evil.example'), env, f)).status).toBe(403)
    expect((await handle(post('/sign-in', { email: 'a', password: 'right' }, null), env, f)).status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('answers CORS preflight', async () => {
    const { f } = fakeAuth()
    const req = new Request('https://proxy.example/session', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } })
    const res = await handle(req, env, f)
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
  })

  it('signs out with the session cookie', async () => {
    const { f, calls } = fakeAuth()
    const res = await handle(post('/sign-out', { token: 'tok.sig' }), env, f)
    expect(res.status).toBe(204)
    expect(calls[0]?.headers.get('cookie')).toBe(`${COOKIE}=tok.sig`)
  })

  it('ignores a cleared session cookie', () => {
    const res = new Response(null, { headers: { 'set-cookie': `${COOKIE}=; Max-Age=0; Path=/` } })
    expect(sessionCookie(res)).toBeNull()
  })
})
