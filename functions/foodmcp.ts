// Food connector: a small MCP server (Streamable HTTP, stateless JSON) deployed as Neon Function «foodmcp»
// (decisions 1 November 2026). Claude logs meals through it from any chat or from the guided mask.
//
// Security
// - The URL carries a long random key: /mcp/<FOOD_MCP_KEY>. Without it every request gets 404.
// - The database role behind FOOD_DATABASE_URL may only read and write food_item and food_entry (migration 0031),
//   so the connector cannot reach workouts, body weight or photos even with a bug here.
// - A meal is stored only in two steps: preview_meal computes the values (staples on the server, never by Claude)
//   and returns a signed preview; confirm_meal stores exactly that preview after the user said yes.
//
// Tools: list_staples, add_staple, preview_meal, confirm_meal, get_day, delete_entry

export interface FoodEnv {
  FOOD_MCP_KEY?: string
  FOOD_DATABASE_URL?: string
  FOOD_USER_ID?: string
}

export type Sql = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

const TZ = 'Europe/Zurich'
const PROTEIN_TARGET_G = 140
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack', 'cheat'] as const
type Category = (typeof CATEGORIES)[number]
const CATEGORY_DE: Record<Category, string> = { breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack', cheat: 'Cheat Meal' }

export const INSTRUCTIONS = `Food logging for Rodrigo's fitness app. Always answer in German (Swiss spelling, ss instead of ß), formal «Sie».
Fixed procedure, never skip a step:
1. Ask only for what is missing, in this order: category and time, ingredients with amounts (pack, grams, pieces), portions cooked and eaten, then for unknown products the pack size or a photo of the nutrition label.
2. Call list_staples first. Use staples by id whenever the ingredient matches; the server computes their values. Estimate only ingredients that are not staples and mark them source "estimate" (or "label" when read from a photo). A new product from a label photo: add_staple first, then use it.
3. Call preview_meal and show its text to the user unchanged.
4. Store only after the user confirms (ja, ok, passt): call confirm_meal with the preview token. On a change request, call preview_meal again.
Never invent values for staples, never store without a preview and a confirmation. Only kcal and protein are tracked.`

// --- helpers ------------------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function num(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Local day YYYY-MM-DD in Zurich. */
export function zurichDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function zurichLabel(d: Date): string {
  const f = new Intl.DateTimeFormat('de-CH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return f.format(d).replace(',', ' ·')
}

/** Start and end (exclusive) of a Zurich day as ISO timestamps. */
export function zurichDayRange(day: string): [string, string] {
  const at = (iso: string) => {
    // Offset of Zurich at that moment (+01:00 or +02:00)
    const probe = new Date(`${iso}T12:00:00Z`)
    const local = new Date(probe.toLocaleString('en-US', { timeZone: TZ }))
    const utc = new Date(probe.toLocaleString('en-US', { timeZone: 'UTC' }))
    const offsetMin = Math.round((local.getTime() - utc.getTime()) / 60000)
    return new Date(Date.parse(`${iso}T00:00:00Z`) - offsetMin * 60000).toISOString()
  }
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  return [at(day), at(next)]
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data))))
}

export async function signPreview(key: string, payload: PreviewPayload): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  return `${body}.${await hmac(key, body)}`
}

export async function verifyPreview(key: string, token: string): Promise<PreviewPayload | null> {
  const [body, sig] = token.split('.')
  if (!body || !sig || (await hmac(key, body)) !== sig) return null
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as PreviewPayload
  return Date.now() - payload.createdAt < 24 * 3_600_000 ? payload : null
}

// --- database ---------------------------------------------------------------------------------------

/** SQL over Neon's HTTP endpoint (same protocol as the serverless driver), no dependency. */
export function neonHttp(url: string, f: typeof fetch = fetch): Sql {
  const host = new URL(url.replace(/^postgres(ql)?:/, 'https:')).hostname
  return async (query, params = []) => {
    const res = await f(`https://${host}/sql`, {
      method: 'POST',
      headers: { 'Neon-Connection-String': url, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, params }),
    })
    const json = (await res.json()) as { rows?: Record<string, unknown>[]; message?: string }
    if (!res.ok) throw new Error(json.message ?? `Database error (HTTP ${res.status})`)
    return json.rows ?? []
  }
}

interface Staple {
  id: string
  name: string
  store: string | null
  basis: '100g' | 'piece' | 'serving'
  kcal: number
  protein_g: number
  piece_g: number | null
  package_g: number | null
}

function staple(r: Record<string, unknown>): Staple {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return { id: String(r.id), name: String(r.name), store: (r.store as string) ?? null, basis: r.basis as Staple['basis'], kcal: Number(r.kcal),
    protein_g: Number(r.protein_g), piece_g: n(r.piece_g), package_g: n(r.package_g) }
}

async function staples(sql: Sql, user: string): Promise<Staple[]> {
  return (await sql('select id, name, store, basis, kcal, protein_g, piece_g, package_g from public.food_item where user_id = $1 and deleted_at is null order by name', [user])).map(staple)
}

async function dayTotals(sql: Sql, user: string, day: string): Promise<{ kcal: number; protein: number; entries: Record<string, unknown>[] }> {
  const [from, to] = zurichDayRange(day)
  const entries = await sql(
    'select id, eaten_at, category, title, kcal, protein_g, source from public.food_entry where user_id = $1 and deleted_at is null and eaten_at >= $2 and eaten_at < $3 order by eaten_at',
    [user, from, to],
  )
  return { kcal: entries.reduce((s, e) => s + Number(e.kcal), 0), protein: entries.reduce((s, e) => s + Number(e.protein_g), 0), entries }
}

// --- meal computation ----------------------------------------------------------------------------------

export interface ItemInput {
  staple_id?: string
  name?: string
  quantity: number
  unit: 'g' | 'piece' | 'serving' | 'pack'
  kcal?: number
  protein_g?: number
  source?: 'estimate' | 'label'
}

export interface PreviewItem {
  name: string
  food_item_id: string | null
  amount: string
  kcal: number
  protein_g: number
  source: 'staple' | 'label' | 'estimate'
}

export interface PreviewPayload {
  createdAt: number
  eatenAt: string
  category: Category
  title: string
  detail: string | null
  items: PreviewItem[]
  totalKcal: number
  totalProtein: number
  cooked: number | null
  eaten: number | null
  kcal: number
  protein: number
}

/** Values of one ingredient; staples from the stored values, others from the given estimate. Throws a message for Claude. */
export function itemValues(input: ItemInput, list: Staple[]): PreviewItem {
  const q = Number(input.quantity)
  if (!(q > 0)) throw new Error(`Quantity missing for ${input.name ?? input.staple_id}.`)
  if (input.staple_id) {
    const s = list.find((x) => x.id === input.staple_id)
    if (!s) throw new Error(`Unknown staple ${input.staple_id}; call list_staples.`)
    let factor: number
    let amount: string
    if (s.basis === '100g') {
      const grams = input.unit === 'g' ? q : input.unit === 'pack' ? (s.package_g ? q * s.package_g : NaN) : NaN
      if (Number.isNaN(grams)) throw new Error(input.unit === 'pack' ? `Pack size of «${s.name}» unknown; ask the user and call add_staple with package_g.` : `«${s.name}» is per 100 g; give grams or packs.`)
      factor = grams / 100
      amount = `${round1(grams)} g`
    } else {
      const count = input.unit === 'g' ? (s.piece_g ? q / s.piece_g : NaN) : input.unit === 'pack' ? NaN : q
      if (Number.isNaN(count)) throw new Error(`«${s.name}» is counted per ${s.basis}; give the number of ${s.basis === 'piece' ? 'pieces' : 'servings'}.`)
      factor = count
      amount = `${round1(count)} ${s.basis === 'piece' ? 'Stück' : count === 1 ? 'Portion' : 'Portionen'}`
    }
    return { name: s.name, food_item_id: s.id, amount, kcal: Math.round(s.kcal * factor), protein_g: round1(s.protein_g * factor), source: 'staple' }
  }
  if (!input.name || input.kcal === undefined || input.protein_g === undefined) throw new Error('An ingredient that is not a staple needs name, kcal and protein_g (estimate for the whole amount).')
  return { name: input.name, food_item_id: null, amount: `${q} ${input.unit === 'g' ? 'g' : input.unit}`, kcal: Math.max(0, Math.round(input.kcal)), protein_g: Math.max(0, round1(input.protein_g)), source: input.source ?? 'estimate' }
}

export function buildPreview(args: { category: Category; title?: string; eaten_at?: string; items: ItemInput[]; portions_cooked?: number; portions_eaten?: number }, list: Staple[], now: Date): PreviewPayload {
  if (!CATEGORIES.includes(args.category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}.`)
  if (!Array.isArray(args.items) || args.items.length === 0) throw new Error('At least one ingredient is required.')
  const items = args.items.map((i) => itemValues(i, list))
  const totalKcal = items.reduce((s, i) => s + i.kcal, 0)
  const totalProtein = round1(items.reduce((s, i) => s + i.protein_g, 0))
  const cooked = args.portions_cooked && args.portions_cooked > 1 ? args.portions_cooked : null
  const eaten = cooked ? Math.min(cooked, args.portions_eaten && args.portions_eaten > 0 ? args.portions_eaten : 1) : null
  const f = cooked ? eaten! / cooked : 1
  const eatenAt = args.eaten_at && !Number.isNaN(Date.parse(args.eaten_at)) ? new Date(args.eaten_at).toISOString() : now.toISOString()
  const title = (args.title?.trim() || items.map((i) => i.name.split(',')[0]).join(', ')).slice(0, 120)
  const detail = [cooked ? `${eaten} von ${cooked} Portionen` : null, items.map((i) => `${i.name.split(',')[0]} ${i.amount}`).join(' · ')].filter(Boolean).join(' · ')
  return { createdAt: now.getTime(), eatenAt, category: args.category, title, detail, items, totalKcal, totalProtein, cooked, eaten,
    kcal: Math.round(totalKcal * f), protein: round1(totalProtein * f) }
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s
const SOURCE_DE = { staple: 'Liste', label: 'Etikett', estimate: 'Schätzung' }

/** Fixed preview format (decision 1 November 2026). */
export function previewText(p: PreviewPayload, todayBefore: { kcal: number; protein: number } | null): string {
  const lines = [
    `Mahlzeit    ${CATEGORY_DE[p.category]} · ${zurichLabel(new Date(p.eatenAt))}`,
    `${pad('Zutat', 28)}${pad('Menge', 10)}${lpad('kcal', 6)}${lpad('Protein', 9)}  Quelle`,
    ...p.items.map((i) => `${pad(i.name, 28)}${pad(i.amount, 10)}${lpad(num(i.kcal), 6)}${lpad(`${round1(i.protein_g)} g`, 9)}  ${SOURCE_DE[i.source]}`),
    ...(p.cooked ? [`Gekocht ${p.cooked} Portionen · gegessen ${p.eaten}`, `Total              ${num(p.totalKcal)} kcal · ${Math.round(p.totalProtein)} g Protein`] : []),
    `Ihre Portion       ${num(p.kcal)} kcal · ${Math.round(p.protein)} g Protein`,
    ...(todayBefore ? [`Heute danach       ${num(todayBefore.kcal + p.kcal)} kcal · ${Math.round(todayBefore.protein + p.protein)} g Protein`] : []),
    'Eintragen? (ja / ändern)',
  ]
  return '```\n' + lines.join('\n') + '\n```'
}

// --- tools -----------------------------------------------------------------------------------------------

const itemSchema = {
  type: 'object',
  properties: {
    staple_id: { type: 'string', description: 'Id from list_staples; omit for ingredients that are not staples' },
    name: { type: 'string', description: 'Name, required when there is no staple_id' },
    quantity: { type: 'number' },
    unit: { type: 'string', enum: ['g', 'piece', 'serving', 'pack'] },
    kcal: { type: 'number', description: 'Only without staple_id: kcal of the whole amount' },
    protein_g: { type: 'number', description: 'Only without staple_id: protein of the whole amount' },
    source: { type: 'string', enum: ['estimate', 'label'] },
  },
  required: ['quantity', 'unit'],
}

export const TOOLS = [
  { name: 'list_staples', description: 'Staples with fixed values (per 100 g, per piece or per serving, pack size). Call before every preview.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'add_staple',
    description: 'Adds a staple or updates one with the same name and store, e.g. from a photo of the nutrition label.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' }, store: { type: 'string' }, basis: { type: 'string', enum: ['100g', 'piece', 'serving'] },
        kcal: { type: 'number' }, protein_g: { type: 'number' }, piece_g: { type: 'number' }, package_g: { type: 'number' },
      },
      required: ['name', 'basis', 'kcal', 'protein_g'],
    },
  },
  {
    name: 'preview_meal',
    description: 'Computes a meal and returns the fixed preview text and a preview token. Nothing is stored. Show the text unchanged and ask for confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...CATEGORIES] },
        eaten_at: { type: 'string', description: 'ISO time with offset; default now' },
        title: { type: 'string' },
        items: { type: 'array', items: itemSchema },
        portions_cooked: { type: 'number' },
        portions_eaten: { type: 'number' },
      },
      required: ['category', 'items'],
    },
  },
  { name: 'confirm_meal', description: 'Stores a previewed meal after the user confirmed it.', inputSchema: { type: 'object', properties: { preview_token: { type: 'string' } }, required: ['preview_token'] } },
  { name: 'get_day', description: 'Entries and totals of a day (default today, Zurich time).', inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } } } },
  { name: 'delete_entry', description: 'Moves an entry to the trash.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
]

type Args = Record<string, unknown>

export async function callTool(name: string, args: Args, ctx: { sql: Sql; user: string; key: string; now: Date }): Promise<{ text: string; data?: unknown }> {
  const { sql, user, key, now } = ctx
  switch (name) {
    case 'list_staples': {
      const list = await staples(sql, user)
      return { text: list.map((s) => `${s.id} · ${s.name}${s.store ? ` (${s.store})` : ''} · ${s.kcal} kcal / ${s.protein_g} g Protein pro ${s.basis === '100g' ? '100 g' : s.basis}${s.piece_g ? ` (${s.piece_g} g)` : ''}${s.package_g ? ` · Packung ${s.package_g} g` : ''}`).join('\n') || 'Keine Standardlebensmittel.', data: list }
    }
    case 'add_staple': {
      const nameArg = String(args.name ?? '').trim()
      const basis = args.basis as Staple['basis']
      const kcal = Number(args.kcal)
      const protein = Number(args.protein_g)
      if (!nameArg || !['100g', 'piece', 'serving'].includes(basis) || !(kcal >= 0) || !(protein >= 0)) throw new Error('name, basis, kcal and protein_g are required.')
      const store = typeof args.store === 'string' && args.store.trim() ? args.store.trim() : null
      const opt = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null)
      const ts = now.toISOString()
      const existing = (await staples(sql, user)).find((s) => s.name.toLowerCase() === nameArg.toLowerCase() && (s.store ?? '') === (store ?? ''))
      if (existing) {
        await sql('update public.food_item set basis = $2, kcal = $3, protein_g = $4, piece_g = coalesce($5, piece_g), package_g = coalesce($6, package_g), note = $7, updated_at = $8 where id = $1',
          [existing.id, basis, kcal, protein, opt(args.piece_g), opt(args.package_g), 'Etikett', ts])
        return { text: `Aktualisiert: ${nameArg} (${existing.id})`, data: { id: existing.id } }
      }
      const id = crypto.randomUUID()
      await sql('insert into public.food_item (id, user_id, name, store, basis, kcal, protein_g, piece_g, package_g, note, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)',
        [id, user, nameArg, store, basis, kcal, protein, opt(args.piece_g), opt(args.package_g), 'Etikett', ts])
      return { text: `Gespeichert: ${nameArg} (${id})`, data: { id } }
    }
    case 'preview_meal': {
      const p = buildPreview(args as Parameters<typeof buildPreview>[0], await staples(sql, user), now)
      const day = zurichDay(new Date(p.eatenAt))
      const before = await dayTotals(sql, user, day)
      const token = await signPreview(key, p)
      return { text: `${previewText(p, before)}\n\npreview_token: ${token}`, data: { preview_token: token, kcal: p.kcal, protein_g: p.protein } }
    }
    case 'confirm_meal': {
      const p = await verifyPreview(key, String(args.preview_token ?? ''))
      if (!p) throw new Error('Invalid or expired preview; call preview_meal again.')
      const id = crypto.randomUUID()
      const ts = now.toISOString()
      // A preview confirmed twice is stored once
      const dup = await sql('select id from public.food_entry where user_id = $1 and deleted_at is null and eaten_at = $2 and title = $3 and kcal = $4', [user, p.eatenAt, p.title, p.kcal])
      if (dup.length) return { text: 'Bereits eingetragen.', data: { id: dup[0]!.id } }
      await sql(
        'insert into public.food_entry (id, user_id, eaten_at, category, title, detail, items, kcal, protein_g, portions_cooked, portions_eaten, source, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$13)',
        [id, user, p.eatenAt, p.category, p.title, p.detail, JSON.stringify(p.items), p.kcal, p.protein, p.cooked, p.eaten, 'claude', ts],
      )
      const t = await dayTotals(sql, user, zurichDay(new Date(p.eatenAt)))
      return { text: `Eingetragen als ${CATEGORY_DE[p.category]}: ${num(p.kcal)} kcal · ${Math.round(p.protein)} g Protein.\nHeute total ${num(t.kcal)} kcal · ${Math.round(t.protein)} g Protein (Ziel ≥ ${PROTEIN_TARGET_G} g).`, data: { id } }
    }
    case 'get_day': {
      const day = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : zurichDay(now)
      const t = await dayTotals(sql, user, day)
      const lines = t.entries.map((e) => `${zurichLabel(new Date(String(e.eaten_at))).split(' · ')[1] ?? ''} ${CATEGORY_DE[e.category as Category]}: ${e.title} · ${num(Number(e.kcal))} kcal · ${Math.round(Number(e.protein_g))} g (${e.id})`)
      return { text: `${day}: ${t.entries.length} Einträge, ${num(t.kcal)} kcal, ${Math.round(t.protein)} g Protein (Ziel ≥ ${PROTEIN_TARGET_G} g)\n${lines.join('\n')}`, data: t }
    }
    case 'delete_entry': {
      const id = String(args.id ?? '')
      if (!UUID.test(id)) throw new Error('Invalid id.')
      const rows = await sql('update public.food_entry set deleted_at = $3, updated_at = $3 where id = $1 and user_id = $2 and deleted_at is null returning title', [id, user, now.toISOString()])
      return { text: rows.length ? `In den Papierkorb verschoben: ${rows[0]!.title}` : 'Eintrag nicht gefunden.' }
    }
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}

// --- MCP over HTTP ---------------------------------------------------------------------------------------

interface RpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

function rpc(id: RpcRequest['id'], result: unknown): unknown {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(id: RpcRequest['id'], code: number, message: string): unknown {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function answer(msg: RpcRequest, env: FoodEnv, sql: Sql, now: Date): Promise<unknown | null> {
  if (msg.id === undefined) return null // notification
  switch (msg.method) {
    case 'initialize':
      return rpc(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'fitness-food', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      })
    case 'ping':
      return rpc(msg.id, {})
    case 'tools/list':
      return rpc(msg.id, { tools: TOOLS })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      try {
        const out = await callTool(name, (msg.params?.arguments as Args) ?? {}, { sql, user: env.FOOD_USER_ID!, key: env.FOOD_MCP_KEY!, now })
        return rpc(msg.id, { content: [{ type: 'text', text: out.text }], ...(out.data !== undefined ? { structuredContent: { result: out.data } } : {}) })
      } catch (e) {
        return rpc(msg.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

export async function handle(req: Request, env: FoodEnv, sqlFactory: (url: string) => Sql = (url) => neonHttp(url), now = new Date()): Promise<Response> {
  const path = new URL(req.url).pathname.replace(/\/+$/, '')
  const key = env.FOOD_MCP_KEY
  if (!key || key.length < 32 || !env.FOOD_DATABASE_URL || !env.FOOD_USER_ID || path !== `/mcp/${key}`) return new Response('Not found', { status: 404 })
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }
  const sql = sqlFactory(env.FOOD_DATABASE_URL)
  const list = Array.isArray(body) ? (body as RpcRequest[]) : [body as RpcRequest]
  const out = (await Promise.all(list.map((m) => answer(m, env, sql, now)))).filter((x) => x !== null)
  if (out.length === 0) return new Response(null, { status: 202 })
  return Response.json(Array.isArray(body) ? out : out[0], { headers: { 'cache-control': 'no-store' } })
}

export default {
  fetch(req: Request): Promise<Response> {
    return handle(req, process.env as FoodEnv)
  },
}
