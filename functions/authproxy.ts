// Auth proxy for Neon Auth, deployed as Neon Function "authproxy" (see neon.ts, docs/entscheidungen.md).
//
// Why: Neon Auth keeps the session in a cookie on its own domain. Safari blocks that third-party
// cookie, and iOS home-screen apps always do. The proxy talks to Neon Auth server-to-server and
// returns the session token to the app, which stores it itself and exchanges it here for a
// short-lived JWT for the Data API. The proxy holds no secrets and stores nothing.
//
// Routes (POST, JSON):
//   /sign-in   { email, password } -> { token, jwt, user, expiresAt }
//   /session   { token }           -> { token, jwt, user, expiresAt }   (token may be renewed)
//   /sign-out  { token }           -> 204
//   /photo/upload    body = encrypted bytes, headers x-session-token, x-photo-id -> 204
//   /photo/download  { token, id } -> encrypted bytes
//   /photo/delete    { token, id } -> 204
// Photos are encrypted in the app before upload; the proxy only stores and returns opaque bytes
// in the private bucket (key <user id>/<photo id>) and never sees the passphrase or the image.

import { AwsClient } from 'aws4fetch'

const COOKIE = '__Secure-neon-auth.session_token'
const MAX_FIELD = 2048
const MAX_PHOTO_BYTES = 4 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ProxyEnv {
  /** Neon Auth base URL, e.g. https://ep-....neonauth....neon.tech/neondb/auth */
  AUTH_URL?: string
  /** Comma-separated list of allowed browser origins. */
  ALLOWED_ORIGINS?: string
  /** Private bucket for encrypted progress photos (declared in neon.ts) */
  PHOTO_BUCKET?: string
  /** Injected by Neon when a bucket is declared */
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  AWS_ENDPOINT_URL_S3?: string
  AWS_REGION?: string
}

export interface SessionResult {
  token: string
  jwt: string
  user: { id: string; email: string }
  expiresAt: string | null
}

type Fetch = typeof fetch

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-session-token, x-photo-id',
    'access-control-max-age': '86400',
    vary: 'Origin',
  }
}

function reply(body: unknown, status: number, origin: string | null): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store', ...(origin ? corsHeaders(origin) : {}) }
  if (body === null) return new Response(null, { status, headers })
  headers['content-type'] = 'application/json'
  return new Response(JSON.stringify(body), { status, headers })
}

/** Value of the Neon Auth session cookie in a response, or null (also when the cookie is cleared). */
export function sessionCookie(res: Response): string | null {
  for (const cookie of res.headers.getSetCookie()) {
    if (!cookie.startsWith(`${COOKIE}=`)) continue
    const value = cookie.slice(COOKIE.length + 1).split(';')[0] ?? ''
    if (!value || /;\s*max-age=0/i.test(cookie)) return null
    return value
  }
  return null
}

function field(body: unknown, name: string): string | null {
  const value = (body as Record<string, unknown> | null)?.[name]
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD ? value : null
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: unknown }
    if (typeof data.message === 'string') return data.message
  } catch {
    // no JSON body
  }
  return `HTTP ${res.status}`
}

async function session(
  auth: string,
  origin: string,
  token: string,
  f: Fetch,
): Promise<SessionResult | { status: number; error: string }> {
  const headers = { cookie: `${COOKIE}=${token}`, origin }
  const res = await f(`${auth}/get-session`, { headers })
  if (!res.ok) return { status: res.status === 401 ? 401 : 502, error: await readError(res) }
  const data = (await res.json().catch(() => null)) as {
    user?: { id?: string; email?: string }
    session?: { expiresAt?: string }
  } | null
  const id = data?.user?.id
  if (!id) return { status: 401, error: 'Session expired.' }

  let jwt = res.headers.get('set-auth-jwt')
  if (!jwt) {
    const t = await f(`${auth}/token`, { headers })
    if (t.ok) jwt = ((await t.json().catch(() => null)) as { token?: string } | null)?.token ?? null
  }
  if (!jwt) return { status: 502, error: 'Neon Auth returned no JWT.' }

  return {
    token: sessionCookie(res) ?? token,
    jwt,
    user: { id, email: data.user?.email ?? '' },
    expiresAt: data.session?.expiresAt ?? null,
  }
}

export async function handle(req: Request, env: ProxyEnv, f: Fetch = fetch): Promise<Response> {
  const auth = env.AUTH_URL?.replace(/\/+$/, '')
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
  const origin = req.headers.get('origin')
  if (!origin || !allowed.includes(origin)) return reply({ error: 'Origin not allowed.' }, 403, null)
  if (req.method === 'OPTIONS') return reply(null, 204, origin)
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, origin)
  if (!auth) return reply({ error: 'Proxy not configured.' }, 500, origin)

  const route = new URL(req.url).pathname.replace(/\/+$/, '')

  // Upload carries raw bytes, all other routes JSON
  if (route.endsWith('/photo/upload')) {
    try {
      return await photoUpload(req, env, auth, origin, f)
    } catch (err) {
      return reply({ error: `Upload failed: ${err instanceof Error ? err.message : String(err)}` }, 502, origin)
    }
  }

  const body: unknown = await req.json().catch(() => null)

  try {
    if (route.endsWith('/photo/download') || route.endsWith('/photo/delete')) {
      const token = field(body, 'token')
      const id = field(body, 'id')
      if (!token || !id || !UUID.test(id)) return reply({ error: 'Token and photo id required.' }, 400, origin)
      const store = photoStore(env, f)
      if (!store) return reply({ error: 'Photo storage not configured.' }, 500, origin)
      const s = await session(auth, origin, token, f)
      if (!('jwt' in s)) return reply({ error: s.error }, s.status, origin)
      const key = `${s.user.id}/${id.toLowerCase()}`
      if (route.endsWith('/photo/delete')) {
        await store('DELETE', key)
        return reply(null, 204, origin)
      }
      const res = await store('GET', key)
      if (res.status === 404) return reply({ error: 'Photo not found.' }, 404, origin)
      if (!res.ok) return reply({ error: `Storage error (HTTP ${res.status})` }, 502, origin)
      return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: { ...corsHeaders(origin), 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
      })
    }

    if (route.endsWith('/sign-in')) {
      const email = field(body, 'email')
      const password = field(body, 'password')
      if (!email || !password) return reply({ error: 'Email and password required.' }, 400, origin)
      const res = await f(`${auth}/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        // 4xx (wrong password, rate limit) is passed through, everything else is a gateway error
        const status = res.status >= 400 && res.status < 500 ? res.status : 502
        return reply({ error: await readError(res) }, status, origin)
      }
      const token = sessionCookie(res)
      if (!token) return reply({ error: 'Neon Auth returned no session.' }, 502, origin)
      const result = await session(auth, origin, token, f)
      return 'jwt' in result ? reply(result, 200, origin) : reply({ error: result.error }, result.status, origin)
    }

    if (route.endsWith('/session')) {
      const token = field(body, 'token')
      if (!token) return reply({ error: 'Token required.' }, 400, origin)
      const result = await session(auth, origin, token, f)
      return 'jwt' in result ? reply(result, 200, origin) : reply({ error: result.error }, result.status, origin)
    }

    if (route.endsWith('/sign-out')) {
      const token = field(body, 'token')
      if (token) {
        await f(`${auth}/sign-out`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: `${COOKIE}=${token}`, origin },
          body: '{}',
        })
      }
      return reply(null, 204, origin)
    }
  } catch (err) {
    return reply({ error: `Neon Auth not reachable: ${err instanceof Error ? err.message : String(err)}` }, 502, origin)
  }

  return reply({ error: 'Not found.' }, 404, origin)
}

type Store = (method: 'PUT' | 'GET' | 'DELETE', key: string, body?: ArrayBuffer) => Promise<Response>

/** Signed S3 requests against the private photo bucket (path style, as Neon requires). */
function photoStore(env: ProxyEnv, f: Fetch): Store | null {
  const { AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION, PHOTO_BUCKET } = env
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !AWS_ENDPOINT_URL_S3 || !PHOTO_BUCKET) return null
  const aws = new AwsClient({
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
    service: 's3',
    region: AWS_REGION || 'us-east-1',
  })
  const base = `${AWS_ENDPOINT_URL_S3.replace(/\/+$/, '')}/${PHOTO_BUCKET}`
  return async (method, key, body) => {
    const init: RequestInit = { method }
    if (body) {
      init.body = body
      init.headers = { 'content-type': 'application/octet-stream' }
    }
    return f(await aws.sign(`${base}/${key}`, init))
  }
}

async function photoUpload(req: Request, env: ProxyEnv, auth: string, origin: string, f: Fetch): Promise<Response> {
  const token = req.headers.get('x-session-token')
  const id = req.headers.get('x-photo-id')
  if (!token || token.length > MAX_FIELD || !id || !UUID.test(id)) {
    return reply({ error: 'Token and photo id required.' }, 400, origin)
  }
  const store = photoStore(env, f)
  if (!store) return reply({ error: 'Photo storage not configured.' }, 500, origin)
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_PHOTO_BYTES) return reply({ error: 'Photo too large.' }, 413, origin)
  const s = await session(auth, origin, token, f)
  if (!('jwt' in s)) return reply({ error: s.error }, s.status, origin)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) return reply({ error: 'Invalid photo size.' }, 413, origin)
  const res = await store('PUT', `${s.user.id}/${id.toLowerCase()}`, bytes)
  if (!res.ok) return reply({ error: `Storage error (HTTP ${res.status})` }, 502, origin)
  return reply(null, 204, origin)
}

export default {
  fetch(req: Request): Promise<Response> {
    return handle(req, process.env)
  },
}
