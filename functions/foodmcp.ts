// Food connector: a small MCP server (Streamable HTTP, stateless JSON) deployed as Neon Function «foodmcp»
// (decisions 1 November 2026). Claude logs meals through it from any chat or from the guided mask.
//
// Security
// - The URL carries a long random key: /mcp/<FOOD_MCP_KEY>. Without it every request gets 404.
// - The database role behind FOOD_DATABASE_URL may only read and write food_item, food_entry and (migration 0052)
//   recipe, fridge_item, inventory_item and inventory_move, so it cannot reach workouts, body weight or photos.
// - A meal is stored only in two steps: preview_meal computes the values (staples on the server, never by Claude)
//   and returns a signed preview; confirm_meal stores exactly that preview after the user said yes.
//
// Tools: list_staples, add_staple, preview_meal, confirm_meal, get_day, delete_entry,
//   recipes (decision 19 November 2026): list_recipes, get_recipe, save_recipe, delete_recipe, log_recipe,
//   fridge: list_fridge, eat_from_fridge, discard_fridge_item, stock: preview_stock_add, confirm_stock_add, list_stock,
//   adjust_stock. Logging a recipe or a fridge portion goes through the same preview and confirm_meal.

export interface FoodEnv {
  FOOD_MCP_KEY?: string
  FOOD_DATABASE_URL?: string
  FOOD_USER_ID?: string
}

export type Sql = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>

const TZ = 'Europe/Zurich'
/** Protein minimum when the app setting cannot be read (decision 15 November 2026: 160 g, about 1.9 g/kg) */
const PROTEIN_TARGET_G = 160
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drinks', 'cheat'] as const
type Category = (typeof CATEGORIES)[number]
const CATEGORY_DE: Record<Category, string> = { breakfast: 'Frühstück', lunch: 'Mittagessen', dinner: 'Abendessen', snack: 'Snack', dessert: 'Dessert', drinks: 'Drinks', cheat: 'Cheat Meal' }
const MAX_PORTIONS = 7

export const INSTRUCTIONS = `Food logging for Rodrigo's fitness app. Always answer in German (Swiss spelling, ss instead of ß), formal «Sie».
Fixed procedure, never skip a step:
1. Ask only for what is missing, in this order: category and time, ingredients with amounts (pack, grams, pieces), portions cooked, then for unknown products the pack size or a photo of the nutrition label. Categories: breakfast, lunch, dinner, snack, dessert, drinks (beer, wine, alcohol), cheat.
   Meal prep (more than one portion cooked): ask on which day and for which meal each portion is eaten and pass them as portions [{eaten_at, category}], one per cooked portion; every portion becomes its own entry on its day. Without an answer: first portion now, the others at lunch on the following days.
2. Call list_staples first. Use staples by id whenever the ingredient matches; the server computes their values. Estimate only ingredients that are not staples and mark them source "estimate" (or "label" when read from a photo). A new product from a label photo: add_staple first, then use it.
3. Call preview_meal and show its text to the user unchanged.
4. Store only after the user confirms (ja, ok, passt): call confirm_meal with the preview token. On a change request, call preview_meal again.
Never invent values for staples, never store without a preview and a confirmation. Only kcal and protein are tracked.
Recipes: list_recipes and get_recipe show the saved recipes (contents in German). To cook one, ask how many portions and, per portion, the day and meal or «fridge» (not planned yet), then log_recipe, show the preview unchanged and confirm_meal after «ja». Fridge portions count only when eaten: list_fridge, then eat_from_fridge (preview, confirm_meal). save_recipe stores a new or changed recipe; delete_recipe and discard_fridge_item only after the user confirmed in the chat.
Stock (kitchen): for a purchase (receipt, product photo or text) map the products to staples (new products: add_staple first), ignore non-food, then preview_stock_add, show the preview and confirm_stock_add after «ja». Saving a meal takes the staples off the stock automatically (oldest first) and reports what is left; cooking a recipe takes them once for all portions. adjust_stock corrects an amount or marks an item used up or discarded (after confirmation).`

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

async function signToken(key: string, payload: { createdAt: number }): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)))
  return `${body}.${await hmac(key, body)}`
}

async function verifyToken<T extends { createdAt: number }>(key: string, token: string): Promise<T | null> {
  const [body, sig] = token.split('.')
  if (!body || !sig || (await hmac(key, body)) !== sig) return null
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T
  return Date.now() - payload.createdAt < 24 * 3_600_000 ? payload : null
}

export async function signPreview(key: string, payload: PreviewPayload): Promise<string> {
  return signToken(key, payload)
}

export async function verifyPreview(key: string, token: string): Promise<PreviewPayload | null> {
  const p = await verifyToken<PreviewPayload & { kind?: string }>(key, token)
  return p && p.kind !== 'stock' ? p : null
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

/** Protein minimum from the app's nutrition targets (user_setting nutrition_targets), else the default. */
async function proteinTarget(sql: Sql, user: string): Promise<number> {
  try {
    const rows = await sql("select value from public.user_setting where user_id = $1 and key = 'nutrition_targets' and deleted_at is null", [user])
    const raw = rows[0]?.value
    const v = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { proteinG?: unknown } | undefined
    const n = Number(v?.proteinG)
    return Number.isFinite(n) && n >= 40 && n <= 300 ? Math.round(n) : PROTEIN_TARGET_G
  } catch {
    return PROTEIN_TARGET_G
  }
}

// --- meal computation ----------------------------------------------------------------------------------

export interface ItemInput {
  staple_id?: string
  name?: string
  quantity: number
  unit: 'g' | 'ml' | 'piece' | 'serving' | 'pack'
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
  /** Meal prep: one entry per portion at these times (decision 1 November 2026) */
  schedule: { eatenAt: string; category: Category }[] | null
  kcal: number
  protein: number
  /** Recipes and fridge (migration 0052): portions put into the fridge, the fridge row eaten from, what the stock loses */
  recipeId?: string | null
  fridge?: { portions: number; eatBy: string; items: PreviewItem[] } | null
  fridgeItemId?: string | null
  stock?: 'meal' | 'recipe' | 'none'
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
      const grams = input.unit === 'g' || input.unit === 'ml' ? q : input.unit === 'pack' ? (s.package_g ? q * s.package_g : NaN) : NaN
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
  return { name: input.name, food_item_id: null, amount: `${q} ${input.unit === 'g' || input.unit === 'ml' ? input.unit : input.unit === 'piece' ? 'Stück' : input.unit}`, kcal: Math.max(0, Math.round(input.kcal)), protein_g: Math.max(0, round1(input.protein_g)), source: input.source ?? 'estimate' }
}

export interface PortionInput {
  eaten_at?: string
  category?: string
}

export function buildPreview(args: { category: Category; title?: string; eaten_at?: string; items: ItemInput[]; portions_cooked?: number; portions_eaten?: number; portions?: PortionInput[] }, list: Staple[], now: Date): PreviewPayload {
  if (!CATEGORIES.includes(args.category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}.`)
  if (!Array.isArray(args.items) || args.items.length === 0) throw new Error('At least one ingredient is required.')
  const items = args.items.map((i) => itemValues(i, list))
  const totalKcal = items.reduce((s, i) => s + i.kcal, 0)
  const totalProtein = round1(items.reduce((s, i) => s + i.protein_g, 0))
  const at = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString() : now.toISOString())
  let schedule: PreviewPayload['schedule'] = null
  if (Array.isArray(args.portions) && args.portions.length > 1) {
    if (args.portions.length > MAX_PORTIONS) throw new Error(`At most ${MAX_PORTIONS} portions.`)
    schedule = args.portions.map((p, i) => {
      const category = (p.category ?? (i === 0 ? args.category : 'lunch')) as Category
      if (!CATEGORIES.includes(category)) throw new Error(`Portion ${i + 1}: category must be one of ${CATEGORIES.join(', ')}.`)
      return { eatenAt: at(p.eaten_at ?? (i === 0 ? args.eaten_at : undefined)), category }
    })
  }
  const cooked = schedule ? schedule.length : args.portions_cooked && args.portions_cooked > 1 ? args.portions_cooked : null
  const eaten = schedule ? 1 : cooked ? Math.min(cooked, args.portions_eaten && args.portions_eaten > 0 ? args.portions_eaten : 1) : null
  const f = cooked ? eaten! / cooked : 1
  const eatenAt = schedule ? schedule[0]!.eatenAt : at(args.eaten_at)
  const title = (args.title?.trim() || items.map((i) => i.name.split(',')[0]).join(', ')).slice(0, 120)
  const detail = [cooked && !schedule ? `${eaten} von ${cooked} Portionen` : null, items.map((i) => `${i.name.split(',')[0]} ${i.amount}`).join(' · ')].filter(Boolean).join(' · ')
  return { createdAt: now.getTime(), eatenAt, category: schedule ? schedule[0]!.category : args.category, title, detail, items, totalKcal, totalProtein, cooked, eaten, schedule,
    kcal: Math.round(totalKcal * f), protein: round1(totalProtein * f) }
}

/** Entries a confirmed preview creates: one, or one per portion for meal prep. */
export function previewEntries(p: PreviewPayload): { eatenAt: string; category: Category; detail: string | null; cooked: number | null; eaten: number | null }[] {
  if (!p.schedule) return [{ eatenAt: p.eatenAt, category: p.category, detail: p.detail, cooked: p.cooked, eaten: p.eaten }]
  const n = p.cooked ?? p.schedule.length
  return p.schedule.map((s, i) => ({ eatenAt: s.eatenAt, category: s.category, detail: n > 1 ? `${i + 1}. von ${n} Portionen · ${p.detail}` : p.detail, cooked: n > 1 ? n : null, eaten: n > 1 ? 1 : null }))
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s
const SOURCE_DE = { staple: 'Liste', label: 'Etikett', estimate: 'Schätzung' }

/** Fixed preview format (decision 1 November 2026). todayBefore are the totals of the day of the first portion. */
export function previewText(p: PreviewPayload, todayBefore: { kcal: number; protein: number } | null): string {
  const firstDay = zurichDay(new Date(p.eatenAt))
  const sameDay = p.schedule ? p.schedule.filter((s) => zurichDay(new Date(s.eatenAt)) === firstDay).length : 1
  const lines = [
    `Mahlzeit    ${CATEGORY_DE[p.category]} · ${zurichLabel(new Date(p.eatenAt))}`,
    `${pad('Zutat', 28)}${pad('Menge', 10)}${lpad('kcal', 6)}${lpad('Protein', 9)}  Quelle`,
    ...p.items.map((i) => `${pad(i.name, 28)}${pad(i.amount, 10)}${lpad(num(i.kcal), 6)}${lpad(`${round1(i.protein_g)} g`, 9)}  ${SOURCE_DE[i.source]}`),
    ...(p.cooked && !p.schedule ? [`Gekocht ${p.cooked} Portionen · gegessen ${p.eaten}`, `Total              ${num(p.totalKcal)} kcal · ${Math.round(p.totalProtein)} g Protein`] : []),
    ...(p.schedule ? [`Gekocht ${p.cooked ?? p.schedule.length} Portionen`, `Total              ${num(p.totalKcal)} kcal · ${Math.round(p.totalProtein)} g Protein`,
      ...p.schedule.map((s, i) => `Portion ${i + 1}          ${CATEGORY_DE[s.category]} · ${zurichLabel(new Date(s.eatenAt))}`)] : []),
    ...(p.fridge ? [`Kühlschrank       ${p.fridge.portions} ${p.fridge.portions === 1 ? 'Portion' : 'Portionen'} · essen bis ${p.fridge.eatBy} · zählt erst beim Essen`] : []),
    ...(p.fridgeItemId ? ['Aus dem Kühlschrank (Vorrat wurde beim Kochen abgezogen)'] : []),
    `${p.schedule ? 'Pro Portion       ' : 'Ihre Portion      '} ${num(p.kcal)} kcal · ${Math.round(p.protein)} g Protein`,
    ...(todayBefore ? [`Heute danach       ${num(todayBefore.kcal + p.kcal * sameDay)} kcal · ${Math.round(todayBefore.protein + p.protein * sameDay)} g Protein`] : []),
    'Eintragen? (ja / ändern)',
  ]
  return '```\n' + lines.join('\n') + '\n```'
}


// --- recipes, fridge and stock (decision 19 November 2026, migration 0052) ---------------------------------

interface RecipeItemRow {
  id: string
  name: string
  food_item_id: string | null
  qty: number | null
  unit: 'g' | 'ml' | 'piece' | 'serving' | null
  hint: { n: number; label: string } | null
  to_taste: boolean
  kcal: number
  protein_g: number
  source: 'staple' | 'label' | 'estimate'
}

interface RecipeRow {
  id: string
  name: string
  category: 'meal' | 'dessert' | 'snack'
  protein_type: string | null
  portions: number
  prep_min: number | null
  meal_prep: boolean
  keeps_days: number
  notes: string | null
  items: RecipeItemRow[]
  steps: { text: string; timer_s: number | null; items: string[] }[]
}

const RECIPE_CATEGORY_DE = { meal: 'Hauptgericht', dessert: 'Dessert', snack: 'Snack' }
const PROTEIN_DE: Record<string, string> = { beef: 'Rind', chicken: 'Poulet', pork: 'Schwein', fish: 'Fisch', veggie: 'Vegetarisch', mixed: 'Gemischt' }
const RECIPE_COLUMNS = 'id, name, category, protein_type, portions, prep_min, meal_prep, keeps_days, notes, items, steps'

function json<T>(v: unknown): T {
  return (typeof v === 'string' ? JSON.parse(v) : v) as T
}

function recipeRow(r: Record<string, unknown>): RecipeRow {
  return { id: String(r.id), name: String(r.name), category: r.category as RecipeRow['category'], protein_type: (r.protein_type as string) ?? null, portions: Number(r.portions),
    prep_min: r.prep_min === null || r.prep_min === undefined ? null : Number(r.prep_min), meal_prep: Boolean(r.meal_prep), keeps_days: Number(r.keeps_days ?? 3),
    notes: (r.notes as string) ?? null, items: json<RecipeItemRow[]>(r.items) ?? [], steps: json<RecipeRow['steps']>(r.steps) ?? [] }
}

async function recipeById(sql: Sql, user: string, id: string): Promise<RecipeRow | null> {
  if (!UUID.test(id)) throw new Error('Invalid recipe id.')
  const rows = await sql(`select ${RECIPE_COLUMNS} from public.recipe where id = $1 and user_id = $2 and deleted_at is null`, [id, user])
  return rows[0] ? recipeRow(rows[0]) : null
}

function perPortion(r: RecipeRow): { kcal: number; protein: number } {
  const p = r.portions > 0 ? r.portions : 1
  return { kcal: Math.round(r.items.reduce((s, i) => s + Number(i.kcal), 0) / p), protein: round1(r.items.reduce((s, i) => s + Number(i.protein_g), 0) / p) }
}

/** Scaled amount like the app: grams and millilitres to 5, pieces and servings to 0.5. */
export function scaledAmount(i: Pick<RecipeItemRow, 'qty' | 'unit' | 'to_taste'>, f: number): string {
  if (i.to_taste || i.qty === null || i.unit === null) return 'nach Geschmack'
  const raw = i.qty * f
  if (i.unit === 'g' || i.unit === 'ml') return `${raw < 10 ? Math.max(1, Math.round(raw)) : Math.round(raw / 5) * 5} ${i.unit}`
  const v = Math.max(0.5, Math.round(raw * 2) / 2)
  return i.unit === 'piece' ? `${v} Stück` : `${v} ${v === 1 ? 'Portion' : 'Portionen'}`
}

function recipeLine(r: RecipeRow): string {
  const p = perPortion(r)
  return `${r.id} · ${r.name} · ${RECIPE_CATEGORY_DE[r.category]}${r.protein_type ? ` · ${PROTEIN_DE[r.protein_type] ?? r.protein_type}` : ''} · ${r.portions} ${r.portions === 1 ? 'Portion' : 'Portionen'}${r.meal_prep ? ' (Meal prep)' : ''} · pro Portion ${num(p.kcal)} kcal · ${Math.round(p.protein)} g Protein`
}

export function recipeText(r: RecipeRow): string {
  const lines = [recipeLine(r), '', 'Zutaten']
  for (const i of r.items) lines.push(`- ${i.name}: ${i.hint && !i.to_taste ? `${i.hint.n} ${i.hint.label} · ` : ''}${scaledAmount(i, 1)}`)
  if (r.steps.length) {
    lines.push('', 'Schritte')
    r.steps.forEach((st, n) => lines.push(`${n + 1}. ${st.text.replace(/\{([a-z0-9]+)\}/gi, (_, id: string) => { const it = r.items.find((x) => x.id === id); return it ? scaledAmount(it, 1) : '' })}${st.timer_s ? ` (Timer ${Math.round(st.timer_s / 60)} min)` : ''}`))
  }
  if (r.notes) lines.push('', `Notiz: ${r.notes}`)
  return lines.join('\n')
}

function dayPlus(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Preview of a cooked recipe: entries for planned portions, the rest into the fridge; stock taken once on confirm. */
export function recipePreview(r: RecipeRow, args: { portions_cooked?: number; schedule?: { eaten_at?: string; category?: string }[] }, now: Date): PreviewPayload {
  const schedule = Array.isArray(args.schedule) ? args.schedule : []
  const cooked = Math.round(Number(args.portions_cooked ?? schedule.length ?? 1)) || 1
  if (cooked > MAX_PORTIONS) throw new Error(`At most ${MAX_PORTIONS} portions.`)
  if (schedule.length !== cooked) {
    if (cooked === 1 && schedule.length === 0) schedule.push({})
    else throw new Error(`schedule needs one element per cooked portion (${cooked}): {eaten_at, category} or category "fridge".`)
  }
  const f = cooked / (r.portions > 0 ? r.portions : 1)
  const items: PreviewItem[] = r.items.filter((i) => !i.to_taste || Number(i.kcal) > 0).map((i) => ({
    name: i.name, food_item_id: i.food_item_id, amount: scaledAmount(i, f), kcal: Math.round(Number(i.kcal) * f), protein_g: round1(Number(i.protein_g) * f), source: i.source,
  }))
  const totalKcal = items.reduce((s, i) => s + i.kcal, 0)
  const totalProtein = round1(items.reduce((s, i) => s + i.protein_g, 0))
  const at = (iso: string | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString() : now.toISOString())
  const eaten = schedule.filter((x) => x.category !== 'fridge').map((x, n) => {
    const category = (x.category ?? (n === 0 ? 'lunch' : 'lunch')) as Category
    if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')} or fridge.`)
    return { eatenAt: at(x.eaten_at), category }
  })
  const fridgeCount = cooked - eaten.length
  const perItems: PreviewItem[] = r.items.filter((i) => !i.to_taste || Number(i.kcal) > 0).map((i) => ({
    name: i.name, food_item_id: i.food_item_id, amount: scaledAmount(i, 1 / (r.portions > 0 ? r.portions : 1)),
    kcal: Math.round(Number(i.kcal) / r.portions), protein_g: round1(Number(i.protein_g) / r.portions), source: i.source,
  }))
  return {
    createdAt: now.getTime(), eatenAt: eaten[0]?.eatenAt ?? now.toISOString(), category: eaten[0]?.category ?? 'dinner', title: r.name,
    detail: items.slice(0, 4).map((i) => `${i.name.split(',')[0]} ${i.amount}`).join(' · '), items, totalKcal, totalProtein,
    cooked, eaten: 1, schedule: eaten, kcal: Math.round(totalKcal / cooked), protein: round1(totalProtein / cooked),
    recipeId: r.id, fridge: fridgeCount > 0 ? { portions: fridgeCount, eatBy: dayPlus(zurichDay(now), r.keeps_days), items: perItems } : null, fridgeItemId: null, stock: 'recipe',
  }
}

/** Stock units of an item amount: «250 g», «2 Stück», «2 ×»; servings are not counted. */
export function stockNeed(amount: string): { qty: number; unit: 'g' | 'ml' | 'piece' } | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(g|ml|Stück|pieces?|×)?(?=\s|$)/i.exec(amount)
  if (!m || !m[2]) return null
  const qty = Number(m[1]!.replace(',', '.'))
  const u = m[2].toLowerCase()
  return qty > 0 ? { qty, unit: u === 'g' ? 'g' : u === 'ml' ? 'ml' : 'piece' } : null
}

/** Takes the staples of the items off the stock, oldest first, never below zero; returns «… übrig» lines. */
async function takeStock(sql: Sql, user: string, items: PreviewItem[], reason: 'meal' | 'recipe', now: Date): Promise<string[]> {
  const ts = now.toISOString()
  const notes: string[] = []
  for (const it of items) {
    if (!it.food_item_id) continue
    const need = stockNeed(it.amount)
    await sql('update public.inventory_item set last_used_at = $3, updated_at = $3 where user_id = $1 and food_item_id = $2 and deleted_at is null and not tracked', [user, it.food_item_id, ts])
    if (!need) continue
    const rows = await sql(
      'select id, name, qty_left from public.inventory_item where user_id = $1 and food_item_id = $2 and unit = $3 and tracked and deleted_at is null and qty_left > 0 order by best_before nulls last, created_at',
      [user, it.food_item_id, need.unit])
    if (!rows.length) continue
    let rest = need.qty
    let left = 0
    for (const r of rows) {
      const have = Number(r.qty_left)
      const take = Math.min(rest, have)
      if (take > 0) {
        await sql('update public.inventory_item set qty_left = $2, last_used_at = $3, updated_at = $3 where id = $1', [r.id, round1(have - take), ts])
        await sql('insert into public.inventory_move (id, user_id, item_id, delta, reason, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6)', [crypto.randomUUID(), user, r.id, -take, reason, ts])
      }
      rest -= take
      left += have - take
    }
    notes.push(`${String(rows[0]!.name)}: ${round1(left)} ${need.unit === 'piece' ? 'Stück' : need.unit} übrig`)
  }
  return notes
}

const SHELF: [RegExp, number][] = [
  [/hack|mince|fisch|fish|lachs|salmon|thun/i, 2],
  [/poulet|chicken|huhn|schwein|pork|geschnetzel|speck|bacon|rind|beef|steak/i, 4],
  [/skyr|quark|joghurt|yogurt|milch|milk|rahm|cream|crème|käse|cheese/i, 3],
  [/gemüse|broccoli|brokkoli|tomate|tomato|zwiebel|onion|paprika|salat|bohnen|beans|zucchini|karotte|spinat|kartoffel|potato|avocado/i, 5],
]

export interface StockPayload {
  createdAt: number
  kind: 'stock'
  rows: { name: string; food_item_id: string | null; location: 'fridge' | 'freezer' | 'shelf'; unit: 'g' | 'ml' | 'piece' | null; qty: number | null; tracked: boolean; best_before: string | null }[]
}

const LOCATION_DE = { fridge: 'Kühlschrank', freezer: 'Tiefkühler', shelf: 'Vorrat' }

export function stockPreview(args: { items?: { staple_id?: string; name?: string; quantity?: number; unit?: string; location?: string; best_before?: string; tracked?: boolean }[] }, list: Staple[], now: Date): StockPayload {
  if (!Array.isArray(args.items) || args.items.length === 0) throw new Error('At least one product is required.')
  const today = zurichDay(now)
  const rows = args.items.map((i) => {
    const s = i.staple_id ? list.find((x) => x.id === i.staple_id) : undefined
    if (i.staple_id && !s) throw new Error(`Unknown staple ${i.staple_id}; call list_staples.`)
    const name = (s?.name ?? i.name ?? '').trim()
    if (!name) throw new Error('A product needs staple_id or name.')
    const location = (['fridge', 'freezer', 'shelf'].includes(String(i.location)) ? i.location : 'fridge') as StockPayload['rows'][number]['location']
    const tracked = i.tracked !== false
    let qty: number | null = null
    let unit: StockPayload['rows'][number]['unit'] = null
    if (tracked) {
      const q = Number(i.quantity)
      if (!(q > 0)) throw new Error(`Quantity missing for ${name}; for oil, spices or sauces pass tracked false.`)
      if (i.unit === 'pack') {
        if (!s?.package_g) throw new Error(`Pack size of «${name}» unknown; ask the user and call add_staple with package_g.`)
        qty = q * s.package_g
        unit = 'g'
      } else {
        unit = i.unit === 'ml' ? 'ml' : i.unit === 'piece' ? 'piece' : 'g'
        qty = q
      }
    }
    const shelf = SHELF.find(([re]) => re.test(name))?.[1]
    const best = typeof i.best_before === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.best_before) ? i.best_before : shelf && location === 'fridge' ? dayPlus(today, shelf) : null
    return { name, food_item_id: s?.id ?? null, location, unit, qty, tracked, best_before: best }
  })
  return { createdAt: now.getTime(), kind: 'stock', rows }
}

export function stockPreviewText(p: StockPayload): string {
  const lines = [`${pad('Produkt', 30)}${pad('Menge', 12)}${pad('Ort', 13)}Haltbar bis`,
    ...p.rows.map((r) => `${pad(r.name, 30)}${pad(r.tracked ? `${r.qty} ${r.unit === 'piece' ? 'Stück' : r.unit}` : 'vorhanden', 12)}${pad(LOCATION_DE[r.location], 13)}${r.best_before ?? '–'}`),
    'Einbuchen? (ja / ändern)']
  return '```\n' + lines.join('\n') + '\n```'
}

// --- tools -----------------------------------------------------------------------------------------------

const itemSchema = {
  type: 'object',
  properties: {
    staple_id: { type: 'string', description: 'Id from list_staples; omit for ingredients that are not staples' },
    name: { type: 'string', description: 'Name, required when there is no staple_id' },
    quantity: { type: 'number' },
    unit: { type: 'string', enum: ['g', 'ml', 'piece', 'serving', 'pack'] },
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
        portions_cooked: { type: 'number', description: 'Only without portions: cooked portions, eaten now = portions_eaten' },
        portions_eaten: { type: 'number' },
        portions: {
          type: 'array',
          description: 'Meal prep: one element per cooked portion with the time and category it is eaten; each becomes its own entry',
          items: { type: 'object', properties: { eaten_at: { type: 'string', description: 'ISO time with offset' }, category: { type: 'string', enum: [...CATEGORIES] } }, required: ['eaten_at'] },
        },
      },
      required: ['category', 'items'],
    },
  },
  { name: 'confirm_meal', description: 'Stores a previewed meal after the user confirmed it.', inputSchema: { type: 'object', properties: { preview_token: { type: 'string' } }, required: ['preview_token'] } },
  { name: 'get_day', description: 'Entries and totals of a day (default today, Zurich time).', inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } } } },
  { name: 'delete_entry', description: 'Moves an entry to the trash.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'list_recipes', description: 'Saved recipes with values per portion. Filter by category (meal, dessert, snack) and protein_type.',
    inputSchema: { type: 'object', properties: { category: { type: 'string', enum: ['meal', 'dessert', 'snack'] }, protein_type: { type: 'string', enum: ['beef', 'chicken', 'pork', 'fish', 'veggie', 'mixed'] } } },
  },
  { name: 'get_recipe', description: 'A recipe with ingredients, amounts and steps (German).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'save_recipe',
    description: 'Creates a recipe or, with id, replaces it. Ingredients like preview_meal (staples by id, others with estimate for the whole amount) for the given portions; to_taste for salt, spices. Steps may reference ingredient amounts as {i1}, {i2} (ingredients are numbered i1, i2, … in the given order). Contents in German.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string', enum: ['meal', 'dessert', 'snack'] },
        protein_type: { type: 'string', enum: ['beef', 'chicken', 'pork', 'fish', 'veggie', 'mixed'], description: 'Required for meal' },
        portions: { type: 'number' }, prep_min: { type: 'number' }, meal_prep: { type: 'boolean' }, keeps_days: { type: 'number', description: 'Days in the fridge, default 3' }, notes: { type: 'string' },
        items: { type: 'array', items: { ...itemSchema, properties: { ...itemSchema.properties, hint_n: { type: 'number', description: 'Grey count before the weight, e.g. 1 for «1 Becher»' }, hint_label: { type: 'string' }, to_taste: { type: 'boolean' } }, required: [] } },
        steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, timer_s: { type: 'number' } }, required: ['text'] } },
      },
      required: ['name', 'category', 'portions', 'items'],
    },
  },
  { name: 'delete_recipe', description: 'Moves a recipe to the trash (only after the user confirmed). Logged meals stay.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'log_recipe',
    description: 'Preview of a cooked recipe: one schedule element per cooked portion with eaten_at and category, or category "fridge" for portions not planned yet (they count only when eaten). Store with confirm_meal after the user confirmed. Stock is taken once for all portions.',
    inputSchema: {
      type: 'object',
      properties: {
        recipe_id: { type: 'string' }, portions_cooked: { type: 'number' },
        schedule: { type: 'array', items: { type: 'object', properties: { eaten_at: { type: 'string', description: 'ISO time with offset' }, category: { type: 'string', enum: [...CATEGORIES, 'fridge'] } }, required: ['category'] } },
      },
      required: ['recipe_id', 'portions_cooked', 'schedule'],
    },
  },
  { name: 'list_fridge', description: 'Cooked portions in the fridge with eat-by date.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'eat_from_fridge', description: 'Preview of eating one fridge portion; store with confirm_meal after the user confirmed. No stock is taken.',
    inputSchema: { type: 'object', properties: { fridge_item_id: { type: 'string' }, category: { type: 'string', enum: [...CATEGORIES] }, eaten_at: { type: 'string' } }, required: ['fridge_item_id', 'category'] },
  },
  { name: 'discard_fridge_item', description: 'Discards fridge portions without an entry (only after the user confirmed).', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'preview_stock_add',
    description: 'Preview of bought products to book into the stock (receipt, photo or text). Map products to staples by id where possible; oil, spices and sauces with tracked false (present only). Nothing is stored; confirm_stock_add after the user confirmed.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              staple_id: { type: 'string' }, name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string', enum: ['g', 'ml', 'piece', 'pack'] },
              location: { type: 'string', enum: ['fridge', 'freezer', 'shelf'] }, best_before: { type: 'string', description: 'YYYY-MM-DD if printed' }, tracked: { type: 'boolean' },
            },
          },
        },
      },
      required: ['items'],
    },
  },
  { name: 'confirm_stock_add', description: 'Books a previewed purchase into the stock after the user confirmed.', inputSchema: { type: 'object', properties: { preview_token: { type: 'string' } }, required: ['preview_token'] } },
  {
    name: 'list_stock', description: 'Stock with amount left, place and best-before date.',
    inputSchema: { type: 'object', properties: { location: { type: 'string', enum: ['fridge', 'freezer', 'shelf'] }, expiring: { type: 'boolean', description: 'Only items due within 2 days or expired' } } },
  },
  {
    name: 'adjust_stock', description: 'Corrects the amount left (correction) or removes an item (used_up, discard; only after the user confirmed).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, action: { type: 'string', enum: ['correction', 'used_up', 'discard'] }, qty_left: { type: 'number' } }, required: ['id', 'action'] },
  },
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
      const ts = now.toISOString()
      let added = 0
      let firstEntry: string | null = null
      for (const e of previewEntries(p)) {
        // A preview confirmed twice is stored once
        const dup = await sql('select id from public.food_entry where user_id = $1 and deleted_at is null and eaten_at = $2 and title = $3 and kcal = $4', [user, e.eatenAt, p.title, p.kcal])
        if (dup.length) continue
        const entryId = crypto.randomUUID()
        firstEntry ??= entryId
        await sql(
          'insert into public.food_entry (id, user_id, eaten_at, category, title, detail, items, kcal, protein_g, portions_cooked, portions_eaten, source, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$13)',
          [entryId, user, e.eatenAt, e.category, p.title, e.detail, JSON.stringify(p.items), p.kcal, p.protein, e.cooked, e.eaten, 'claude', ts],
        )
        added++
      }
      // Fridge portions of a cooked recipe (once per preview)
      let fridgeAdded = 0
      if (p.fridge && p.recipeId) {
        const cookedAt = new Date(p.createdAt).toISOString()
        const dupFridge = await sql('select id from public.fridge_item where user_id = $1 and recipe_id = $2 and cooked_at = $3', [user, p.recipeId, cookedAt])
        if (!dupFridge.length) {
          await sql('insert into public.fridge_item (id, user_id, recipe_id, title, portions, kcal, protein_g, items, cooked_at, eat_by, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$11)',
            [crypto.randomUUID(), user, p.recipeId, p.title, p.fridge.portions, p.kcal, p.protein, JSON.stringify(p.fridge.items), cookedAt, p.fridge.eatBy, ts])
          fridgeAdded = p.fridge.portions
        }
      }
      if (added === 0 && fridgeAdded === 0) return { text: 'Bereits eingetragen.' }
      // One portion less in the fridge; stock was taken when cooking
      if (p.fridgeItemId && added > 0) {
        await sql('update public.fridge_item set portions = greatest(portions - 1, 0), deleted_at = case when portions <= 1 then $3::timestamptz else deleted_at end, updated_at = $3 where id = $1 and user_id = $2', [p.fridgeItemId, user, ts])
      }
      const stockNotes = (p.stock ?? 'meal') === 'none' ? [] : await takeStock(sql, user, p.items, p.stock === 'recipe' ? 'recipe' : 'meal', now)
      const tail = [fridgeAdded ? `In den Kühlschrank: ${fridgeAdded} ${fridgeAdded === 1 ? 'Portion' : 'Portionen'}, essen bis ${p.fridge!.eatBy}.` : null, stockNotes.length ? `Vorrat: ${stockNotes.join(', ')}.` : null].filter(Boolean).join('\n')
      if (added === 0) return { text: tail }
      const t = await dayTotals(sql, user, zurichDay(new Date(p.eatenAt)))
      void firstEntry
      const head = p.schedule && p.schedule.length > 1
        ? `Eingetragen: ${p.schedule.length} Portionen à ${num(p.kcal)} kcal · ${Math.round(p.protein)} g Protein (${p.schedule.map((s) => `${CATEGORY_DE[s.category]} ${zurichLabel(new Date(s.eatenAt)).split(' · ')[0]}`).join(', ')}).`
        : `Eingetragen als ${CATEGORY_DE[p.category]}: ${num(p.kcal)} kcal · ${Math.round(p.protein)} g Protein.`
      return { text: `${head}\nHeute total ${num(t.kcal)} kcal · ${Math.round(t.protein)} g Protein (Ziel ≥ ${await proteinTarget(sql, user)} g).${tail ? `\n${tail}` : ''}` }
    }
    case 'get_day': {
      const day = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date) ? args.date : zurichDay(now)
      const t = await dayTotals(sql, user, day)
      const lines = t.entries.map((e) => `${zurichLabel(new Date(String(e.eaten_at))).split(' · ')[1] ?? ''} ${CATEGORY_DE[e.category as Category]}: ${e.title} · ${num(Number(e.kcal))} kcal · ${Math.round(Number(e.protein_g))} g (${e.id})`)
      return { text: `${day}: ${t.entries.length} Einträge, ${num(t.kcal)} kcal, ${Math.round(t.protein)} g Protein (Ziel ≥ ${await proteinTarget(sql, user)} g)\n${lines.join('\n')}`, data: t }
    }
    case 'delete_entry': {
      const id = String(args.id ?? '')
      if (!UUID.test(id)) throw new Error('Invalid id.')
      const rows = await sql('update public.food_entry set deleted_at = $3, updated_at = $3 where id = $1 and user_id = $2 and deleted_at is null returning title', [id, user, now.toISOString()])
      return { text: rows.length ? `In den Papierkorb verschoben: ${rows[0]!.title}` : 'Eintrag nicht gefunden.' }
    }
    case 'list_recipes': {
      const rows = (await sql(`select ${RECIPE_COLUMNS} from public.recipe where user_id = $1 and deleted_at is null order by name`, [user])).map(recipeRow)
        .filter((r) => (!args.category || r.category === args.category) && (!args.protein_type || r.protein_type === args.protein_type))
      return { text: rows.map(recipeLine).join('\n') || 'Keine Rezepte.', data: rows.map((r) => ({ id: r.id, name: r.name })) }
    }
    case 'get_recipe': {
      const r = await recipeById(sql, user, String(args.id ?? ''))
      return { text: r ? recipeText(r) : 'Rezept nicht gefunden.' }
    }
    case 'save_recipe': {
      const nameArg = String(args.name ?? '').trim()
      const category = args.category as RecipeRow['category']
      const portions = Number(args.portions)
      if (!nameArg || !['meal', 'dessert', 'snack'].includes(category) || !(portions > 0)) throw new Error('name, category and portions are required.')
      const list = await staples(sql, user)
      const raw = Array.isArray(args.items) ? (args.items as (ItemInput & { hint_n?: number; hint_label?: string; to_taste?: boolean })[]) : []
      if (raw.length === 0) throw new Error('At least one ingredient is required.')
      const items: RecipeItemRow[] = raw.map((i, n) => {
        const hint = i.hint_n && i.hint_label ? { n: Number(i.hint_n), label: String(i.hint_label) } : null
        if (i.to_taste && !(Number(i.quantity) > 0)) return { id: `i${n + 1}`, name: String(i.name ?? ''), food_item_id: null, qty: null, unit: null, hint: null, to_taste: true, kcal: 0, protein_g: 0, source: 'estimate' }
        const v = itemValues(i, list)
        const s = i.staple_id ? list.find((x) => x.id === i.staple_id) : undefined
        const grams = /^([\d.]+) (g|ml)$/.exec(v.amount)
        const qty = grams ? Number(grams[1]) : Number(i.quantity)
        const unit: RecipeItemRow['unit'] = grams ? (grams[2] as 'g' | 'ml') : s?.basis === 'serving' || i.unit === 'serving' ? 'serving' : 'piece'
        return { id: `i${n + 1}`, name: i.name?.trim() || v.name, food_item_id: v.food_item_id, qty, unit, hint, to_taste: Boolean(i.to_taste), kcal: v.kcal, protein_g: v.protein_g, source: v.source }
      })
      const steps = (Array.isArray(args.steps) ? (args.steps as { text?: string; timer_s?: number }[]) : []).filter((x) => x.text).map((x) => ({
        text: String(x.text), timer_s: Number(x.timer_s) > 0 ? Math.round(Number(x.timer_s)) : null, items: [...String(x.text).matchAll(/\{(i\d+)\}/g)].map((m) => m[1]!) }))
      const protein = category === 'meal' ? (['beef', 'chicken', 'pork', 'fish', 'veggie', 'mixed'].includes(String(args.protein_type)) ? String(args.protein_type) : 'mixed') : null
      const ts = now.toISOString()
      const values = [nameArg, category, protein, portions, Number(args.prep_min) > 0 ? Math.round(Number(args.prep_min)) : null, Boolean(args.meal_prep ?? portions > 1),
        Number(args.keeps_days) > 0 ? Math.min(30, Math.round(Number(args.keeps_days))) : 3, typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : null,
        JSON.stringify(items), JSON.stringify(steps), ts]
      let id = typeof args.id === 'string' && UUID.test(args.id) ? args.id : null
      if (id) {
        const rows = await sql('update public.recipe set name = $3, category = $4, protein_type = $5, portions = $6, prep_min = $7, meal_prep = $8, keeps_days = $9, notes = $10, items = $11::jsonb, steps = $12::jsonb, updated_at = $13 where id = $1 and user_id = $2 and deleted_at is null returning id', [id, user, ...values])
        if (!rows.length) throw new Error('Recipe not found.')
      } else {
        id = crypto.randomUUID()
        await sql('insert into public.recipe (id, user_id, name, category, protein_type, portions, prep_min, meal_prep, keeps_days, notes, items, steps, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$13)', [id, user, ...values])
      }
      const saved = await recipeById(sql, user, id)
      return { text: `Gespeichert:\n${saved ? recipeText(saved) : nameArg}`, data: { id } }
    }
    case 'delete_recipe': {
      const id = String(args.id ?? '')
      if (!UUID.test(id)) throw new Error('Invalid id.')
      const rows = await sql('update public.recipe set deleted_at = $3, updated_at = $3 where id = $1 and user_id = $2 and deleted_at is null returning name', [id, user, now.toISOString()])
      return { text: rows.length ? `In den Papierkorb verschoben: ${rows[0]!.name}` : 'Rezept nicht gefunden.' }
    }
    case 'log_recipe': {
      const r = await recipeById(sql, user, String(args.recipe_id ?? ''))
      if (!r) throw new Error('Recipe not found; call list_recipes.')
      const p = recipePreview(r, args as Parameters<typeof recipePreview>[1], now)
      const before = await dayTotals(sql, user, zurichDay(new Date(p.eatenAt)))
      const token = await signPreview(key, p)
      return { text: `${previewText(p, before)}\n\npreview_token: ${token}`, data: { preview_token: token } }
    }
    case 'list_fridge': {
      const rows = await sql('select id, title, portions, kcal, protein_g, cooked_at, eat_by from public.fridge_item where user_id = $1 and deleted_at is null and portions > 0 order by eat_by', [user])
      const today = zurichDay(now)
      return { text: rows.map((f) => { const by = String(f.eat_by).slice(0, 10); return `${f.id} · ${f.title} · ${Number(f.portions)} ${Number(f.portions) === 1 ? 'Portion' : 'Portionen'} · pro Portion ${num(Number(f.kcal))} kcal · ${Math.round(Number(f.protein_g))} g Protein · gekocht ${zurichDay(new Date(String(f.cooked_at)))} · essen bis ${by}${by < today ? ' (abgelaufen)' : by === today ? ' (heute essen)' : ''}` }).join('\n') || 'Kühlschrank leer.' }
    }
    case 'eat_from_fridge': {
      const id = String(args.fridge_item_id ?? '')
      if (!UUID.test(id)) throw new Error('Invalid id.')
      const rows = await sql('select id, title, portions, kcal, protein_g, items from public.fridge_item where id = $1 and user_id = $2 and deleted_at is null and portions > 0', [id, user])
      const f = rows[0]
      if (!f) throw new Error('Fridge portion not found; call list_fridge.')
      const category = args.category as Category
      if (!CATEGORIES.includes(category)) throw new Error(`category must be one of ${CATEGORIES.join(', ')}.`)
      const eatenAt = typeof args.eaten_at === 'string' && !Number.isNaN(Date.parse(args.eaten_at)) ? new Date(args.eaten_at).toISOString() : now.toISOString()
      const items = json<PreviewItem[]>(f.items) ?? []
      const p: PreviewPayload = { createdAt: now.getTime(), eatenAt, category, title: String(f.title), detail: 'Aus dem Kühlschrank', items, totalKcal: Number(f.kcal), totalProtein: Number(f.protein_g),
        cooked: null, eaten: null, schedule: null, kcal: Math.round(Number(f.kcal)), protein: round1(Number(f.protein_g)), fridgeItemId: id, stock: 'none' }
      const before = await dayTotals(sql, user, zurichDay(new Date(eatenAt)))
      const token = await signPreview(key, p)
      return { text: `${previewText(p, before)}\n\npreview_token: ${token}`, data: { preview_token: token } }
    }
    case 'discard_fridge_item': {
      const id = String(args.id ?? '')
      if (!UUID.test(id)) throw new Error('Invalid id.')
      const rows = await sql('update public.fridge_item set deleted_at = $3, updated_at = $3 where id = $1 and user_id = $2 and deleted_at is null returning title', [id, user, now.toISOString()])
      return { text: rows.length ? `Entsorgt: ${rows[0]!.title}` : 'Nicht gefunden.' }
    }
    case 'preview_stock_add': {
      const p = stockPreview(args as Parameters<typeof stockPreview>[0], await staples(sql, user), now)
      const token = await signToken(key, p)
      return { text: `${stockPreviewText(p)}\n\npreview_token: ${token}`, data: { preview_token: token } }
    }
    case 'confirm_stock_add': {
      const p = await verifyToken<StockPayload>(key, String(args.preview_token ?? ''))
      if (!p || p.kind !== 'stock') throw new Error('Invalid or expired preview; call preview_stock_add again.')
      const ts = new Date(p.createdAt).toISOString()
      const dup = await sql('select id from public.inventory_item where user_id = $1 and created_at = $2 limit 1', [user, ts])
      if (dup.length) return { text: 'Bereits eingebucht.' }
      for (const r of p.rows) {
        const id = crypto.randomUUID()
        await sql('insert into public.inventory_item (id, user_id, food_item_id, name, location, unit, qty_initial, qty_left, tracked, best_before, last_used_at, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$10,$11)',
          [id, user, r.food_item_id, r.name, r.location, r.unit, r.qty, r.tracked, r.best_before, ts, now.toISOString()])
        if (r.tracked && r.qty) await sql('insert into public.inventory_move (id, user_id, item_id, delta, reason, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6)', [crypto.randomUUID(), user, id, r.qty, 'purchase', now.toISOString()])
      }
      return { text: `Eingebucht: ${p.rows.map((r) => r.name).join(', ')}.` }
    }
    case 'list_stock': {
      const today = zurichDay(now)
      const soon = dayPlus(today, 2)
      const rows = (await sql('select id, name, location, unit, qty_initial, qty_left, tracked, best_before, last_used_at from public.inventory_item where user_id = $1 and deleted_at is null order by location, name', [user]))
        .filter((r) => !(r.tracked && Number(r.qty_left ?? 0) <= 0 && zurichDay(new Date(String(r.last_used_at))) < today))
        .filter((r) => !args.location || r.location === args.location)
        .filter((r) => !args.expiring || (r.best_before && String(r.best_before).slice(0, 10) <= soon))
      return { text: rows.map((r) => { const by = r.best_before ? String(r.best_before).slice(0, 10) : null; const u = r.unit === 'piece' ? 'Stück' : String(r.unit ?? ''); return `${r.id} · ${r.name} · ${LOCATION_DE[r.location as 'fridge']} · ${r.tracked ? `${round1(Number(r.qty_left))} von ${round1(Number(r.qty_initial))} ${u}` : 'vorhanden'}${by ? ` · bis ${by}${by < today ? ' (abgelaufen)' : by === today ? ' (heute)' : ''}` : ''}` }).join('\n') || 'Kein Vorrat erfasst.' }
    }
    case 'adjust_stock': {
      const id = String(args.id ?? '')
      if (!UUID.test(id)) throw new Error('Invalid id.')
      const rows = await sql('select id, name, qty_left, tracked from public.inventory_item where id = $1 and user_id = $2 and deleted_at is null', [id, user])
      const r = rows[0]
      if (!r) throw new Error('Stock item not found; call list_stock.')
      const ts = now.toISOString()
      const have = Number(r.qty_left ?? 0)
      if (args.action === 'correction') {
        const left = Math.max(0, Number(args.qty_left))
        if (!Number.isFinite(left)) throw new Error('qty_left is required for a correction.')
        await sql('update public.inventory_item set qty_left = $2, last_used_at = $3, updated_at = $3 where id = $1', [id, round1(left), ts])
        if (left !== have) await sql('insert into public.inventory_move (id, user_id, item_id, delta, reason, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6)', [crypto.randomUUID(), user, id, round1(left - have), 'correction', ts])
        return { text: `${r.name}: ${round1(left)} übrig.` }
      }
      if (args.action !== 'used_up' && args.action !== 'discard') throw new Error('action must be correction, used_up or discard.')
      await sql('update public.inventory_item set qty_left = case when tracked then 0 else null end, deleted_at = $2, last_used_at = $2, updated_at = $2 where id = $1', [id, ts])
      if (r.tracked && have > 0) await sql('insert into public.inventory_move (id, user_id, item_id, delta, reason, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$6)', [crypto.randomUUID(), user, id, -have, args.action, ts])
      return { text: `${r.name}: ${args.action === 'used_up' ? 'aufgebraucht' : 'entsorgt'}.` }
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
        serverInfo: { name: 'fitness-food', version: '1.2.0' },
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
        // Text only: clients show structuredContent instead of the text, and the fixed preview format lives in the text
        return rpc(msg.id, { content: [{ type: 'text', text: out.text }] })
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
  if (!key || key.length < 32 || !env.FOOD_DATABASE_URL || !env.FOOD_USER_ID || !path.endsWith(`/mcp/${key}`)) return new Response('Not found', { status: 404 })
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
