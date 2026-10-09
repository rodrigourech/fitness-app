import { db, getMeta, setMeta } from './db'

// Session handling via the auth proxy (functions/authproxy.ts).
// Safari and iOS home-screen apps block the Neon Auth cookie, so the app keeps the session token
// itself (IndexedDB) and exchanges it at the proxy for a short-lived JWT for the Data API.

const PROXY = (import.meta.env.VITE_AUTH_PROXY_URL ?? '').replace(/\/+$/, '')
const REFRESH_MARGIN_S = 60

export interface ProxySession {
  token: string
  jwt: string
  user: { id: string; email: string }
  expiresAt: string | null
}

export class ProxyError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

async function call(path: string, body: object): Promise<Response> {
  if (!PROXY) throw new ProxyError('Auth proxy URL is not configured (VITE_AUTH_PROXY_URL).')
  try {
    return await fetch(`${PROXY}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ProxyError('Auth service not reachable.')
  }
}

async function errorOf(res: Response): Promise<ProxyError> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null
  return new ProxyError(data?.error ?? `HTTP ${res.status}`, res.status)
}

/** Seconds since epoch at which a JWT expires (0 if unreadable). */
export function jwtExpiry(jwt: string): number {
  try {
    const part = jwt.split('.')[1] ?? ''
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = (JSON.parse(json) as { exp?: unknown }).exp
    return typeof exp === 'number' ? exp : 0
  } catch {
    return 0
  }
}

export async function storeSession(session: ProxySession): Promise<void> {
  await setMeta('session_token', session.token)
  await setMeta('jwt', session.jwt)
}

export async function clearSession(): Promise<void> {
  await db.meta.bulkDelete(['session_token', 'jwt'])
}

/** Signs in at the proxy. The caller stores the session. Throws ProxyError (status 401 = wrong credentials). */
export async function proxySignIn(email: string, password: string): Promise<ProxySession> {
  const res = await call('/sign-in', { email, password })
  if (!res.ok) throw await errorOf(res)
  return (await res.json()) as ProxySession
}

let pending: Promise<string | null> | null = null

/**
 * A valid JWT for the Data API, refreshed at the proxy when needed.
 * Returns null when there is no session or it has expired (user must sign in again).
 * Throws ProxyError when the proxy is unreachable or fails.
 */
export function getJwt(force = false): Promise<string | null> {
  pending ??= (async () => {
    const token = await getMeta('session_token')
    if (!token) return null
    const cached = await getMeta('jwt')
    if (!force && cached && jwtExpiry(cached) - REFRESH_MARGIN_S > Date.now() / 1000) return cached

    const res = await call('/session', { token })
    if (res.status === 401) {
      await clearSession()
      return null
    }
    if (!res.ok) {
      const err = await errorOf(res)
      // Not 401/403 on purpose: a proxy problem must not look like a signed-out user
      throw new ProxyError(`Auth service: ${err.message}`)
    }
    const session = (await res.json()) as ProxySession
    await storeSession(session)
    return session.jwt
  })().finally(() => {
    pending = null
  })
  return pending
}

/**
 * Changes the password; all other devices are signed out. The new session replaces the current one.
 * Throws ProxyError (status 400/401 for a wrong current password).
 */
export async function proxyChangePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = await getMeta('session_token')
  if (!token) throw new ProxyError('Not signed in.', 401)
  const res = await call('/change-password', { token, currentPassword, newPassword })
  if (!res.ok) throw await errorOf(res)
  await storeSession((await res.json()) as ProxySession)
}

/** Ends the session at Neon Auth (best effort) and forgets it locally. */
export async function proxySignOut(): Promise<void> {
  const token = await getMeta('session_token')
  await clearSession()
  if (token && navigator.onLine) await call('/sign-out', { token }).catch(() => undefined)
}
