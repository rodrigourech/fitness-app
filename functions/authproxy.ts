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

const COOKIE = '__Secure-neon-auth.session_token'
const MAX_FIELD = 2048

export interface ProxyEnv {
  /** Neon Auth base URL, e.g. https://ep-....neonauth....neon.tech/neondb/auth */
  AUTH_URL?: string
  /** Comma-separated list of allowed browser origins. */
  ALLOWED_ORIGINS?: string
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
    'access-control-allow-headers': 'content-type',
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

  const body: unknown = await req.json().catch(() => null)
  const route = new URL(req.url).pathname.replace(/\/+$/, '')

  try {
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

export default {
  fetch(req: Request): Promise<Response> {
    return handle(req, process.env)
  },
}
