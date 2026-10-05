import { describe, expect, it } from 'vitest'
import { handle, sessionCookie, type ProxyEnv } from './authproxy.ts'

const AUTH = 'https://auth.example/neondb/auth'
const ORIGIN = 'https://rodrigourech.github.io'
const env: ProxyEnv = { AUTH_URL: AUTH, ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173` }
const COOKIE = '__Secure-neon-auth.session_token'
const S3 = 'https://s3.example/body-photos/'
const photoEnv: ProxyEnv = {
  ...env,
  PHOTO_BUCKET: 'body-photos',
  AWS_ACCESS_KEY_ID: 'key',
  AWS_SECRET_ACCESS_KEY: 'secret',
  AWS_ENDPOINT_URL_S3: 'https://s3.example',
  AWS_REGION: 'eu-central-1',
}
const PHOTO = '0b5c6f2e-3d4a-4f1b-9c8d-7e6f5a4b3c2d'

interface Call {
  url: string
  method: string
  headers: Headers
  body: string | null
}

/** Fake Neon Auth: one user, session token "tok.sig", optional renewal on get-session. */
function fakeAuth(opts: { renew?: boolean; jwtHeader?: boolean } = {}) {
  const calls: Call[] = []
  const objects = new Map<string, ArrayBuffer>()
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
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
    if (url.startsWith(S3)) {
      const req = input as Request
      const key = url.slice(S3.length)
      if (!req.headers.get('authorization')?.startsWith('AWS4-HMAC-SHA256')) return new Response(null, { status: 403 })
      if (req.method === 'PUT') {
        objects.set(key, await req.arrayBuffer())
        return new Response(null, { status: 200 })
      }
      if (req.method === 'DELETE') {
        objects.delete(key)
        return new Response(null, { status: 204 })
      }
      const obj = objects.get(key)
      return obj ? new Response(obj) : new Response(null, { status: 404 })
    }
    return new Response(null, { status: 404 })
  }) as typeof fetch
  return { f, calls, objects }
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

  it('stores, returns and deletes encrypted photo bytes under the user id', async () => {
    const { f, objects } = fakeAuth()
    const upload = new Request('https://proxy.example/photo/upload', {
      method: 'POST',
      headers: { origin: ORIGIN, 'x-session-token': 'tok.sig', 'x-photo-id': PHOTO, 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3]),
    })
    expect((await handle(upload, photoEnv, f)).status).toBe(204)
    expect([...objects.keys()]).toEqual([`u1/${PHOTO}`])

    const down = await handle(post('/photo/download', { token: 'tok.sig', id: PHOTO }), photoEnv, f)
    expect(down.status).toBe(200)
    expect([...new Uint8Array(await down.arrayBuffer())]).toEqual([1, 2, 3])

    expect((await handle(post('/photo/delete', { token: 'tok.sig', id: PHOTO }), photoEnv, f)).status).toBe(204)
    expect(objects.size).toBe(0)
  })

  it('refuses photos without a valid session or id', async () => {
    const { f, objects } = fakeAuth()
    const bad = (headers: Record<string, string>) =>
      new Request('https://proxy.example/photo/upload', { method: 'POST', headers: { origin: ORIGIN, ...headers }, body: new Uint8Array([1]) })
    expect((await handle(bad({ 'x-session-token': 'old.sig', 'x-photo-id': PHOTO }), photoEnv, f)).status).toBe(401)
    expect((await handle(bad({ 'x-session-token': 'tok.sig', 'x-photo-id': '../other/x' }), photoEnv, f)).status).toBe(400)
    expect((await handle(post('/photo/download', { token: 'tok.sig', id: PHOTO }), env, f)).status).toBe(500)
    expect(objects.size).toBe(0)
  })
})
