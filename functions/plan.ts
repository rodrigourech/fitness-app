// Plan changes through the Food connector (Änderungsauftrag Rodrigo, 27 November 2026, version 1.5.0).
// Claude may change templates and the exercise catalogue from the coaching chat, always in two steps: preview_* shows a
// before/after diff in German and returns a signed token; confirm_* stores exactly that change after the user said yes.
//
// Security and data rules
// - The role food_connector may insert and update template, template_exercise, template_set, exercise and
//   exercise_link (migration 0065), nothing else: workouts, sets, body weight and settings stay read only, and nothing
//   is ever deleted. Removing means deleted_at, archiving means archived_at, as in the app.
// - Every write sets updated_at (at least 1 ms newer than before), so the app takes it over on the next sync
//   (the newer updated_at wins).
// - Workouts copy the template at start, so a running workout keeps its plan. Exercise settings (top set, alternative,
//   weight step, location) are read live by the app, exactly as when they are changed in the app.
// - All writes of one confirmation run in one SQL statement (data-modifying CTEs), so they are stored together or not at all.
// - The token carries the request and a fingerprint (updated_at) of the rows it builds on. If the template or an
//   exercise changed in the app since the preview, confirm refuses and asks for a new preview.

import { displayName, effective } from '../src/lib/core/exercise.ts'
import type { Exercise, ExerciseLink, Template, TemplateExercise, TemplateSet } from '../src/lib/core/rows.ts'
import { repetitionTargets, validRepetitionTargets } from '../src/lib/training.ts'
import { findExercise, loadTraining, normalizeRow, type Sql, type TrainingData } from './training.ts'

type Args = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RUNNING_H = 12

export interface PlanData extends TrainingData {
  links: ExerciseLink[]
}

export async function loadPlan(sql: Sql, user: string): Promise<PlanData> {
  const [d, links] = await Promise.all([
    loadTraining(sql, user),
    sql('select to_jsonb(t) as r from public.exercise_link t where t.user_id = $1 and t.deleted_at is null', [user]),
  ])
  return { ...d, links: links.map((x) => normalizeRow<ExerciseLink>(x.r)) }
}

// --- writes ---------------------------------------------------------------------------------------------

type Kind = 'text' | 'int' | 'num' | 'bool' | 'ts' | 'uuid' | 'text[]'
export type PlanTable = 'template' | 'template_exercise' | 'template_set' | 'exercise' | 'exercise_link'

/** Columns the connector may write, per table (id, user_id, created_at and updated_at are set by the statement). */
const COLUMNS: Record<PlanTable, Record<string, Kind>> = {
  template: { name: 'text', note: 'text', archived_at: 'ts', deleted_at: 'ts' },
  template_exercise: { template_id: 'uuid', exercise_id: 'uuid', position: 'int', rest_s: 'int', comment: 'text', deleted_at: 'ts' },
  template_set: { template_exercise_id: 'uuid', position: 'int', set_type: 'text', target_reps_min: 'int', target_reps_max: 'int', target_weight: 'num',
    target_duration_s: 'int', target_distance_km: 'num', deleted_at: 'ts' },
  exercise: { parent_id: 'uuid', name: 'text', equipment: 'text', muscles_primary: 'text[]', muscles_secondary: 'text[]', tracking_type: 'text', is_unilateral: 'bool',
    weight_step: 'num', default_rest_s: 'int', floor: 'text', setup_note: 'text', focus_cue: 'text', instructions: 'text', target_reps: 'int', min_reps: 'int',
    warm_up: 'bool', top_set: 'bool', alternative_id: 'uuid', deleted_at: 'ts' },
  exercise_link: { exercise_id: 'uuid', url: 'text', title: 'text', deleted_at: 'ts' },
}
const PG: Record<Exclude<Kind, 'text[]'>, string> = { text: 'text', int: 'integer', num: 'numeric', bool: 'boolean', ts: 'timestamptz', uuid: 'uuid' }

export interface Write {
  table: PlanTable
  id: string
  insert: boolean
  values: Record<string, unknown>
  /** Inserts only: created_at = confirmation time + order ms, keeps the order of new videos */
  order?: number
}

/** One statement for all writes: data-modifying CTEs run atomically, and the deferred foreign keys are checked at the end. */
export function writeStatement(writes: Write[], user: string, ts: string): { query: string; params: unknown[] } {
  if (!writes.length) throw new Error('Nothing to write.')
  const params: unknown[] = []
  const p = (v: unknown, kind: Kind): string => {
    if (kind === 'text[]') {
      params.push(v === null || v === undefined ? null : JSON.stringify(v))
      const n = params.length
      return `case when $${n}::jsonb is null then null else array(select x from jsonb_array_elements_text($${n}::jsonb) with ordinality t(x, i) order by i) end`
    }
    params.push(v === undefined ? null : v)
    return `$${params.length}::${PG[kind]}`
  }
  const tsP = p(ts, 'ts')
  const userP = p(user, 'text')
  const parts = writes.map((w, i) => {
    const cols = Object.hasOwn(COLUMNS, w.table) ? COLUMNS[w.table] : null
    if (!cols) throw new Error(`Table ${w.table} may not be written.`)
    const keys = Object.keys(w.values)
    for (const k of keys) if (!(k in cols)) throw new Error(`Column ${w.table}.${k} may not be written.`)
    if (!UUID.test(w.id)) throw new Error('Invalid id.')
    if (w.insert) {
      const created = w.order ? `(${tsP} + ${Math.round(w.order)} * interval '1 ms')` : tsP
      return `w${i} as (insert into public.${w.table} (id, user_id${keys.map((k) => `, ${k}`).join('')}, created_at, updated_at) values (${p(w.id, 'uuid')}, ${userP}${keys.map((k) => `, ${p(w.values[k], cols[k]!)}`).join('')}, ${created}, ${created}))`
    }
    const set = keys.map((k) => `${k} = ${p(w.values[k], cols[k]!)}`)
    return `w${i} as (update public.${w.table} set ${[...set, `updated_at = greatest(${tsP}, updated_at + interval '1 ms')`].join(', ')} where id = ${p(w.id, 'uuid')} and user_id = ${userP})`
  })
  return { query: `with ${parts.join(',\n')}\nselect ${writes.length} as writes`, params }
}

/** Collects writes; several changes to the same row become one write. */
class Writes {
  private map = new Map<string, Write>()
  add(table: PlanTable, id: string, values: Record<string, unknown>, insert = false, order?: number): void {
    const key = `${table}:${id}`
    const w = this.map.get(key)
    if (w) Object.assign(w.values, values)
    else this.map.set(key, { table, id, insert, values: { ...values }, ...(order ? { order } : {}) })
  }
  /** Update only the fields that differ from the current row. */
  patch(table: PlanTable, row: Record<string, unknown> & { id: string }, values: Record<string, unknown>): void {
    const diff = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== undefined && !same(row[k], v)))
    if (Object.keys(diff).length) this.add(table, row.id, diff)
  }
  list(): Write[] {
    return [...this.map.values()].filter((w) => w.insert || Object.keys(w.values).length)
  }
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

const TABLE_KEY = { template: 'templates', template_exercise: 'tes', template_set: 'tsets', exercise: 'exercises', exercise_link: 'links' } as const

/** The data as it will be after the writes (deleted rows drop out, as in loadTraining). */
export function applyWrites(d: PlanData, writes: Write[], ts: string): PlanData {
  const out: PlanData = { ...d, exercises: [...d.exercises], templates: [...d.templates], tes: [...d.tes], tsets: [...d.tsets], links: [...d.links] }
  for (const w of writes) {
    const list = out[TABLE_KEY[w.table]] as unknown as Record<string, unknown>[]
    const i = list.findIndex((r) => r.id === w.id)
    const row: Record<string, unknown> | null = w.insert ? { ...blank(w.table), id: w.id, user_id: '', created_at: ts, ...w.values, updated_at: ts } : i >= 0 ? { ...list[i], ...w.values, updated_at: ts } : null
    if (!row) continue
    if (i >= 0) list.splice(i, 1)
    if (row.deleted_at == null) list.push(row)
  }
  return out
}

function blank(table: PlanTable): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(Object.keys(COLUMNS[table]).map((k) => [k, null]))
  if (table === 'exercise') Object.assign(out, { seat: null, foot_position: null, source_id: null, focus_muscles: null })
  return out
}

/** Fingerprint of the rows a change builds on: if one of them changes in the app, the preview is outdated. */
function fingerprint(rows: ({ id: string; updated_at: string } | undefined)[]): string {
  const key = rows.filter((r): r is { id: string; updated_at: string } => !!r).map((r) => `${r.id}@${r.updated_at}`).sort().join(',')
  if (!key) return 'none'
  // cyrb53: short, stable hash so the token stays small (no security role; the token itself is signed)
  let h1 = 0xdeadbeef ^ key.length
  let h2 = 0x41c6ce57 ^ key.length
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

// --- texts ----------------------------------------------------------------------------------------------

const EQUIPMENT_DE: Record<string, string> = { plate_loaded: 'Plate', pin_loaded: 'Pin', dumbbell: 'Dumbbell', bodyweight: 'Bodyweight', cable: 'Cable', machine: 'Machine', barbell: 'Barbell' }
const TRACKING_DE: Record<string, string> = { weight_reps: 'Gewicht und Wdh', duration: 'Zeit', distance_duration: 'Distanz und Zeit' }
const KNOWN_MUSCLES = ['abs', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower_back', 'upper_back', 'neck',
  'quads', 'shoulders', 'traps', 'triceps', 'cardio']
const KNOWN_EQUIPMENT = Object.keys(EQUIPMENT_DE)

const FIELD_DE: Record<string, string> = {
  name: 'Name', parent_id: 'Hauptübung', tracking_type: 'Erfassung', is_unilateral: 'Einseitig', muscles_primary: 'Muskeln primär', muscles_secondary: 'Muskeln sekundär',
  equipment: 'Equipment', weight_step: 'Gewichtsschritt', default_rest_s: 'Standardpause', target_reps: 'Max Wdh', min_reps: 'Min Wdh', floor: 'Ort',
  warm_up: 'Aufwärmen', top_set: 'Top Set', alternative_id: 'Alternative', setup_note: 'Einstellung', focus_cue: 'Hinweis', instructions: 'Ausführung',
}

function kg(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

function value(field: string, v: unknown, byId: Map<string, Exercise>): string {
  if (v === null || v === undefined || (Array.isArray(v) && !v.length)) {
    if (field === 'warm_up' || field === 'top_set' || field === 'alternative_id' || field === 'target_reps' || field === 'min_reps' || field === 'default_rest_s' || field === 'weight_step') return 'Standard'
    return 'leer'
  }
  switch (field) {
    case 'tracking_type': return TRACKING_DE[String(v)] ?? String(v)
    case 'equipment': return EQUIPMENT_DE[String(v)] ?? String(v)
    case 'is_unilateral': return v ? 'ja' : 'nein'
    case 'warm_up':
    case 'top_set': return v ? 'ein' : 'aus'
    case 'weight_step': return `${kg(Number(v))} kg`
    case 'default_rest_s': return `${v} s`
    case 'alternative_id':
    case 'parent_id': { const e = byId.get(String(v)); return e ? displayName(e, byId) : String(v) }
    case 'muscles_primary':
    case 'muscles_secondary': return (v as string[]).join(', ')
    case 'setup_note':
    case 'focus_cue':
    case 'instructions':
    case 'name': return `«${String(v).replace(/\n/g, ' / ')}»`
    default: return String(v)
  }
}

function byIdOf(d: PlanData): Map<string, Exercise> {
  return new Map(d.exercises.map((e) => [e.id, e]))
}

function nameOf(d: PlanData, id: string): string {
  const byId = byIdOf(d)
  const e = byId.get(id)
  return e ? displayName(e, byId) : 'Unbekannte Übung'
}

function slotSets(d: PlanData, teId: string): TemplateSet[] {
  return d.tsets.filter((s) => s.template_exercise_id === teId).sort((a, b) => a.position - b.position)
}

function slots(d: PlanData, templateId: string): TemplateExercise[] {
  return d.tes.filter((te) => te.template_id === templateId).sort((a, b) => a.position - b.position)
}

/** Template part of a slot: sets with range or time, rest and comment (same wording as list_templates). */
function slotView(d: PlanData, te: TemplateExercise): { name: string; scheme: string; rest: string; comment: string; extras: string } {
  const byId = byIdOf(d)
  const ex = byId.get(te.exercise_id)
  if (!ex) return { name: 'Unbekannte Übung', scheme: '', rest: '', comment: '', extras: '' }
  const eff = effective(ex, byId)
  const planned = slotSets(d, te.id)
  const work = planned.filter((s) => s.set_type === 'working')
  const r = repetitionTargets(ex, byId, planned)
  const dur = work.map((s) => s.target_duration_s).filter((x): x is number => x !== null)
  const scheme = eff.trackingType === 'duration' ? `${work.length} × ${dur.length ? `${Math.max(...dur)} s` : 'Zeit'}` : eff.trackingType === 'distance_duration' ? `${work.length} × Lauf` : `${work.length} × ${r.minimum}–${r.target}`
  const rest = te.rest_s ?? eff.restS
  const alt = ex.alternative_id ?? (ex.parent_id ? byId.get(ex.parent_id)?.alternative_id : null)
  const extras = [eff.warmUp && eff.trackingType === 'weight_reps' && !eff.bodyweight ? 'Warm-up' : null, eff.topSet ? 'Top Set' : null,
    alt ? `Alternative ${nameOf(d, alt)}` : null, eff.floor ?? null].filter(Boolean).join(' · ')
  return { name: displayName(ex, byId), scheme, rest: rest ? `Pause ${rest} s${te.rest_s === null ? ' (Standard)' : ''}` : 'Pause Standard', comment: te.comment ? `«${te.comment}»` : '', extras }
}

function slotLine(d: PlanData, te: TemplateExercise): string {
  const v = slotView(d, te)
  return `${te.position}. ${v.name} · ${[v.scheme, v.rest, v.comment, v.extras].filter(Boolean).join(' · ')}`
}

/** Changed fields of exercises, with a note when a change applies to all templates or all variants. */
function exerciseChanges(before: PlanData, after: PlanData, writes: Write[]): string[] {
  const out: string[] = []
  const bById = byIdOf(before)
  const aById = byIdOf(after)
  for (const w of writes.filter((x) => x.table === 'exercise')) {
    const a = aById.get(w.id)
    const b = bById.get(w.id)
    if (!a) continue
    const name = displayName(a, aById)
    if (w.insert) {
      const fields = Object.entries(w.values).filter(([k, v]) => k in FIELD_DE && k !== 'name' && v !== null && !(Array.isArray(v) && !v.length))
      out.push(`- Neu: ${name}${fields.length ? ` · ${fields.map(([k, v]) => `${FIELD_DE[k]} ${value(k, v, aById)}`).join(' · ')}` : ''}`)
      continue
    }
    const variants = after.exercises.filter((e) => e.parent_id === a.id).length
    const used = new Set(after.tes.filter((te) => te.exercise_id === a.id || aById.get(te.exercise_id)?.parent_id === a.id).map((te) => te.template_id))
    const scope = [variants ? 'gilt auch für die Varianten' : null, used.size > 1 ? `gilt in ${used.size} Vorlagen` : null].filter(Boolean).join(', ')
    for (const [k, v] of Object.entries(w.values)) {
      if (!(k in FIELD_DE)) continue
      out.push(`- ${name}: ${FIELD_DE[k]} ${value(k, (b as unknown as Record<string, unknown>)?.[k], bById)} → ${value(k, v, aById)}${scope ? ` (${scope})` : ''}`)
    }
  }
  return out
}

function linkChanges(before: PlanData, after: PlanData, writes: Write[]): string[] {
  const byId = byIdOf(after)
  return writes.filter((w) => w.table === 'exercise_link').map((w) => {
    const l = after.links.find((x) => x.id === w.id) ?? before.links.find((x) => x.id === w.id)!
    const ex = nameOf(after, l.exercise_id)
    if (w.insert) return `- ${ex}: Video neu ${l.title ? `«${l.title}» ` : ''}${l.url}`
    if (w.values.deleted_at) return `- ${ex}: Video entfernt ${l.title ? `«${l.title}» ` : ''}${l.url}`
    return `- ${ex}: Videotitel ${value('name', before.links.find((x) => x.id === w.id)?.title ?? null, byId)} → ${value('name', w.values.title, byId)} (${l.url})`
  })
}

function hhmm(iso: string): string {
  return new Intl.DateTimeFormat('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

function running(d: PlanData, now: Date) {
  return d.workouts.filter((w) => w.finished_at === null && now.getTime() - Date.parse(w.started_at) < RUNNING_H * 3_600_000)
}

// --- input helpers --------------------------------------------------------------------------------------

function str(v: unknown): string | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const s = String(v).trim()
  return s ? s : null
}

function int(v: unknown, name: string, min: number, max: number): number | null | undefined {
  if (v === undefined) return undefined
  if (v === null) return null
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`)
  return n
}

function bool(v: unknown, name: string): boolean | null | undefined {
  if (v === undefined || v === null) return v as undefined | null
  if (typeof v !== 'boolean') throw new Error(`${name} must be true, false or null.`)
  return v
}

// --- exercise fields (shared by preview_template and preview_exercise) ---------------------------------

export interface ExerciseInput {
  name?: string
  tracking?: string
  unilateral?: boolean
  muscles_primary?: string[]
  muscles_secondary?: string[]
  equipment?: string | null
  weight_step?: number | null
  rest_s?: number | null
  reps_min?: number | null
  reps_max?: number | null
  location?: string | null
  warm_up?: boolean | null
  top_set?: boolean | null
  alternative?: string | null
  note?: string | null
  cue?: string | null
  instructions?: string | null
}

function muscles(v: unknown, name: string, d: PlanData): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) throw new Error(`${name} must be a list of muscle keys.`)
  const known = new Set([...KNOWN_MUSCLES, ...d.exercises.flatMap((e) => [...(e.muscles_primary ?? []), ...(e.muscles_secondary ?? [])])])
  const list = [...new Set(v.map((m) => String(m).trim().toLowerCase()).filter(Boolean))]
  const bad = list.filter((m) => !known.has(m))
  if (bad.length) throw new Error(`Unknown muscle ${bad.join(', ')}; use ${[...known].sort().join(', ')}.`)
  return list
}

/**
 * Writes the exercise fields as the app does: equipment, location, tracking, one-sided and muscles belong to the main
 * exercise (shared by all variants); everything else to the exercise itself (a variant overrides its main exercise).
 */
function exerciseFields(d: PlanData, ex: Exercise, a: ExerciseInput, w: Writes): void {
  const byId = byIdOf(d)
  const main = ex.parent_id ? byId.get(ex.parent_id) ?? ex : ex
  const mainVals: Record<string, unknown> = {}
  const own: Record<string, unknown> = {}
  if (a.name !== undefined) {
    const n = str(a.name)
    if (!n) throw new Error('name may not be empty.')
    own.name = n
  }
  if (a.tracking !== undefined) {
    if (!(a.tracking in TRACKING_DE)) throw new Error('tracking must be weight_reps, duration or distance_duration.')
    mainVals.tracking_type = a.tracking
  }
  const uni = bool(a.unilateral, 'unilateral')
  if (uni !== undefined) mainVals.is_unilateral = uni ?? false
  const mp = muscles(a.muscles_primary, 'muscles_primary', d)
  if (mp !== undefined) {
    if (!mp.length) throw new Error('muscles_primary needs at least one muscle.')
    mainVals.muscles_primary = mp
  }
  const ms = muscles(a.muscles_secondary, 'muscles_secondary', d)
  if (ms !== undefined) mainVals.muscles_secondary = ms
  if (a.equipment !== undefined) {
    const e = str(a.equipment)
    const known = new Set([...KNOWN_EQUIPMENT, ...d.exercises.map((x) => x.equipment).filter((x): x is string => !!x)])
    if (e !== null && !known.has(e!)) throw new Error(`equipment must be one of ${[...known].join(', ')} or null.`)
    mainVals.equipment = e
  }
  if (a.location !== undefined) {
    const l = str(a.location)
    if (l !== null && l !== 'oben' && l !== 'unten') throw new Error('location must be oben, unten or null.')
    mainVals.floor = l
  }
  if (a.weight_step !== undefined) {
    const s = a.weight_step === null ? null : Number(a.weight_step)
    if (s !== null && !(s > 0 && s <= 50)) throw new Error('weight_step must be more than 0 and at most 50 kg, or null.')
    own.weight_step = s
  }
  const rest = int(a.rest_s, 'rest_s', 0, 900)
  if (rest !== undefined) own.default_rest_s = rest
  const max = int(a.reps_max, 'reps_max', 1, 100)
  const min = int(a.reps_min, 'reps_min', 1, 100)
  if (max !== undefined) own.target_reps = max
  if (min !== undefined) own.min_reps = min
  const wu = bool(a.warm_up, 'warm_up')
  if (wu !== undefined) own.warm_up = wu
  const ts = bool(a.top_set, 'top_set')
  if (ts !== undefined) own.top_set = ts
  if (a.alternative !== undefined) {
    if (a.alternative === null || str(a.alternative) === null) own.alternative_id = null
    else {
      const alt = findExercise(d, String(a.alternative))
      if (alt.id === ex.id) throw new Error('An exercise cannot be its own alternative.')
      own.alternative_id = alt.id
    }
  }
  if (a.note !== undefined) own.setup_note = str(a.note)
  if (a.cue !== undefined) own.focus_cue = str(a.cue)
  if (a.instructions !== undefined) own.instructions = str(a.instructions)
  if (main.id === ex.id) Object.assign(own, mainVals)
  else w.patch('exercise', main as unknown as Record<string, unknown> & { id: string }, mainVals)
  w.patch('exercise', ex as unknown as Record<string, unknown> & { id: string }, own)
}

const EXERCISE_KEYS: (keyof ExerciseInput)[] = ['name', 'tracking', 'unilateral', 'muscles_primary', 'muscles_secondary', 'equipment', 'weight_step', 'rest_s', 'reps_min',
  'reps_max', 'location', 'warm_up', 'top_set', 'alternative', 'note', 'cue', 'instructions']

function checkReps(after: PlanData, ids: Iterable<string>): void {
  const byId = byIdOf(after)
  for (const id of ids) {
    const ex = byId.get(id)
    if (!ex) continue
    const eff = effective(ex, byId)
    if (!validRepetitionTargets(eff.targetReps, eff.minReps)) throw new Error(`${displayName(ex, byId)}: Min reps must be between 1 and Max reps; Max reps at most 100.`)
  }
}

// --- plans ------------------------------------------------------------------------------------------------

export interface Plan {
  writes: Write[]
  text: string
  /** Fingerprint of the rows the plan builds on */
  fp: string
  /** Args with the ids assigned in the preview (new template or exercise), signed into the token */
  args: Args
}

export interface SlotInput {
  exercise: string
  sets?: number
  reps_min?: number | null
  reps_max?: number | null
  duration_s?: number | null
  rest_s?: number | null
  comment?: string | null
  warm_up?: boolean | null
  top_set?: boolean | null
  alternative?: string | null
  location?: string | null
  weight_step?: number | null
}

/** preview_template: a new template or a change; exercises (when given) is the complete new list in order. */
export function templatePlan(d: PlanData, input: Args, now: Date): Plan {
  const args: Args = { ...input }
  const ts = now.toISOString()
  const w = new Writes()
  let t: Template | undefined
  if (typeof args.template_id === 'string' && args.template_id) {
    if (!UUID.test(args.template_id)) throw new Error('Invalid template_id.')
    t = d.templates.find((x) => x.id === args.template_id)
    if (!t) throw new Error('Template not found; call list_templates.')
  } else if (typeof args.template === 'string' && args.template.trim()) {
    const q = args.template.trim().toLowerCase()
    const hits = d.templates.filter((x) => x.name.toLowerCase() === q)
    if (hits.length !== 1) throw new Error(hits.length ? `Several templates are called «${args.template}»; pass template_id.` : `No template «${args.template}»; call list_templates.`)
    t = hits[0]
    args.template_id = t!.id
    delete args.template
  } else if (typeof args.new_id === 'string' && UUID.test(args.new_id)) {
    t = d.templates.find((x) => x.id === args.new_id)
  } else {
    args.new_id = crypto.randomUUID()
  }
  const id = t?.id ?? String(args.new_id)
  const isNew = !t
  const name = str(args.name)
  if (isNew && !name) throw new Error('name is required for a new template.')
  if (name && d.templates.some((x) => x.id !== id && !x.archived_at && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`An active template is already called «${name}».`)
  const note = str(args.note)
  if (isNew) w.add('template', id, { name, note: note ?? null }, true)
  else w.patch('template', t as unknown as Record<string, unknown> & { id: string }, { name: name ?? undefined, note })

  const old = t ? slots(d, t.id) : []
  const touched = new Set<string>()
  if (args.exercises !== undefined) {
    if (!Array.isArray(args.exercises)) throw new Error('exercises must be the complete list of exercises in order.')
    if (args.exercises.length > 20) throw new Error('At most 20 exercises per template.')
    const byId = byIdOf(d)
    const resolved = (args.exercises as SlotInput[]).map((s) => {
      if (!s || typeof s !== 'object') throw new Error('Each exercise needs at least «exercise» (id or name).')
      const ex = findExercise(d, String(s.exercise ?? ''))
      return { s, ex }
    })
    const ids = resolved.map((r) => r.ex.id)
    const dup = ids.find((x, i) => ids.indexOf(x) !== i)
    if (dup) throw new Error(`${nameOf(d, dup)} is listed twice.`)
    // Same exercise keeps its slot; another variant of the same main exercise takes over a free slot of that family
    const used = new Set<string>()
    const match = resolved.map(({ ex }) => {
      const hit = old.find((te) => !used.has(te.id) && te.exercise_id === ex.id)
      if (hit) used.add(hit.id)
      return hit
    })
    resolved.forEach(({ ex }, i) => {
      if (match[i]) return
      const family = ex.parent_id ?? ex.id
      const hit = old.find((te) => !used.has(te.id) && !ids.includes(te.exercise_id) && ((byId.get(te.exercise_id)?.parent_id ?? te.exercise_id) === family))
      if (hit) { used.add(hit.id); match[i] = hit }
    })
    resolved.forEach(({ s, ex }, i) => {
      const position = i + 1
      const eff = effective(ex, byId)
      const te = match[i]
      const teId = te?.id ?? crypto.randomUUID()
      const rest = int(s.rest_s, 'rest_s', 0, 900)
      const comment = str(s.comment)
      if (te) w.patch('template_exercise', te as unknown as Record<string, unknown> & { id: string }, { position, exercise_id: ex.id, rest_s: rest, comment })
      else w.add('template_exercise', teId, { template_id: id, exercise_id: ex.id, position, rest_s: rest ?? null, comment: comment ?? null }, true)
      // Planned work sets: count, range or time; new sets copy the last one (as in the app)
      const current = te ? slotSets(d, te.id).filter((x) => x.set_type === 'working') : []
      const count = int(s.sets, 'sets', 1, 10) ?? (current.length || (eff.trackingType === 'weight_reps' ? 3 : 1))
      const repsMin = int(s.reps_min, 'reps_min', 1, 100)
      const repsMax = int(s.reps_max, 'reps_max', 1, 100)
      const duration = int(s.duration_s, 'duration_s', 1, 3600)
      if ((repsMin !== undefined || repsMax !== undefined) && eff.trackingType !== 'weight_reps') throw new Error(`${displayName(ex, byId)} is tracked by time; use duration_s.`)
      if (duration !== undefined && eff.trackingType === 'weight_reps') throw new Error(`${displayName(ex, byId)} is tracked by reps; use reps_min and reps_max.`)
      const last = current.at(-1)
      for (let k = 0; k < count; k++) {
        const row = current[k]
        const src = row ?? last
        const targets = {
          target_reps_min: repsMin !== undefined ? repsMin : src?.target_reps_min ?? null,
          target_reps_max: repsMax !== undefined ? repsMax : src?.target_reps_max ?? null,
          target_duration_s: duration !== undefined ? duration : src?.target_duration_s ?? null,
        }
        if (row) w.patch('template_set', row as unknown as Record<string, unknown> & { id: string }, { ...targets, position: k + 1 })
        else w.add('template_set', crypto.randomUUID(), { template_exercise_id: teId, position: k + 1, set_type: 'working', ...targets,
          target_weight: src?.target_weight ?? null, target_distance_km: src?.target_distance_km ?? null }, true)
        if (targets.target_reps_max !== null && targets.target_reps_min !== null && targets.target_reps_max < targets.target_reps_min) throw new Error(`${displayName(ex, byId)}: reps_max must be at least reps_min.`)
      }
      for (const row of current.slice(count)) w.add('template_set', row.id, { deleted_at: ts })
      const fields: ExerciseInput = {}
      for (const k of ['warm_up', 'top_set', 'alternative', 'location', 'weight_step'] as const) if (s[k] !== undefined) (fields as Record<string, unknown>)[k] = s[k]
      if (Object.keys(fields).length) exerciseFields(d, ex, fields, w)
      touched.add(ex.id)
      if (ex.parent_id) touched.add(ex.parent_id)
    })
    for (const te of old) {
      if (used.has(te.id)) continue
      for (const s of slotSets(d, te.id)) w.add('template_set', s.id, { deleted_at: ts })
      w.add('template_exercise', te.id, { deleted_at: ts })
    }
  }

  const writes = w.list()
  const after = applyWrites(d, writes, ts)
  checkReps(after, touched)
  for (const te of after.tes.filter((x) => x.template_id === id)) {
    const ex = byIdOf(after).get(te.exercise_id)
    if (!ex) continue
    const eff = effective(ex, byIdOf(after))
    const planned = slotSets(after, te.id).filter((s) => s.set_type === 'working')
    for (const s of planned) if (!validRepetitionTargets(s.target_reps_max ?? eff.targetReps, s.target_reps_min ?? eff.minReps)) throw new Error(`${displayName(ex, byIdOf(after))}: Min reps must be between 1 and Max reps.`)
  }
  const fp = fingerprint([t, ...old, ...old.flatMap((te) => slotSets(d, te.id)), ...[...touched].map((x) => d.exercises.find((e) => e.id === x))])

  const title = name ?? t?.name ?? ''
  const lines: string[] = [`Vorschau Vorlage «${title}»${isNew ? ' (neu)' : ''}${t?.archived_at ? ' (archiviert)' : ''}`]
  if (!writes.length) return { writes, fp, args, text: `${lines[0]}\nKeine Änderung, alles ist bereits so gespeichert.` }
  const afterSlots = slots(after, id)
  lines.push('', 'Nachher', ...(afterSlots.length ? afterSlots.map((te) => slotLine(after, te)) : ['keine Übungen']))
  const changes: string[] = []
  if (!isNew) {
    if (name && name !== t!.name) changes.push(`- Name: «${t!.name}» → «${name}»`)
    if (note !== undefined && (note ?? null) !== (t!.note ?? null)) changes.push(`- Notiz: ${t!.note ? `«${t!.note}»` : 'leer'} → ${note ? `«${note}»` : 'leer'}`)
    for (const te of afterSlots) {
      const before = old.find((x) => x.id === te.id)
      if (!before) { changes.push(`- Neu: ${slotLine(after, te)}`); continue }
      const b = slotView(d, before)
      const a = slotView(after, te)
      const diff = [b.name !== a.name ? `Übung ${b.name} → ${a.name}` : null, before.position !== te.position ? `Position ${before.position} → ${te.position}` : null,
        b.scheme !== a.scheme ? `Sätze ${b.scheme} → ${a.scheme}` : null, b.rest !== a.rest ? `${b.rest} → ${a.rest}` : null,
        b.comment !== a.comment ? `Kommentar ${b.comment || 'leer'} → ${a.comment || 'leer'}` : null].filter(Boolean)
      if (diff.length) changes.push(`- Geändert: ${te.position}. ${a.name} · ${diff.join(' · ')}`)
    }
    for (const te of old.filter((x) => !after.tes.some((y) => y.id === x.id))) changes.push(`- Entfernt: ${slotView(d, te).name} (${slotView(d, te).scheme})`)
  }
  if (changes.length) lines.push('', 'Änderungen', ...changes)
  const exChanges = exerciseChanges(d, after, writes)
  if (exChanges.length) lines.push('', 'Übungseinstellungen (gelten überall, wo die Übung vorkommt)', ...exChanges)
  const run = running(d, now)
  if (run.length) lines.push('', `Hinweis: Ein Training läuft seit ${hhmm(run[0]!.started_at)} Uhr. Es behält seinen Plan; die Vorlage gilt ab dem nächsten Start.${exChanges.length ? ' Übungseinstellungen wirken sofort.' : ''}`)
  if (isNew) lines.push('', 'Die neue Vorlage erscheint nach dem Sync am Ende der Liste; die Reihenfolge lässt sich in der App ändern.')
  lines.push('', 'Speichern erst nach «ja» mit confirm_template.')
  return { writes, fp, args, text: lines.join('\n') }
}

/** preview_archive_template: archive (gone from the list, kept under Archive) or restore. */
export function archivePlan(d: PlanData, input: Args, now: Date): Plan {
  const args: Args = { ...input }
  let t: Template | undefined
  if (typeof args.template_id === 'string' && args.template_id) {
    if (!UUID.test(args.template_id)) throw new Error('Invalid template_id.')
    t = d.templates.find((x) => x.id === args.template_id)
  } else if (typeof args.template === 'string' && args.template.trim()) {
    const hits = d.templates.filter((x) => x.name.toLowerCase() === String(args.template).trim().toLowerCase())
    if (hits.length > 1) throw new Error(`Several templates are called «${args.template}»; pass template_id.`)
    t = hits[0]
  }
  if (!t) throw new Error('Template not found; call list_templates.')
  args.template_id = t.id
  delete args.template
  const restore = args.restore === true
  const w = new Writes()
  if (restore && t.archived_at) {
    if (d.templates.some((x) => x.id !== t!.id && !x.archived_at && x.name.toLowerCase() === t!.name.toLowerCase())) throw new Error(`An active template is already called «${t.name}»; rename one first.`)
    w.add('template', t.id, { archived_at: null })
  }
  if (!restore && !t.archived_at) w.add('template', t.id, { archived_at: now.toISOString() })
  const writes = w.list()
  const head = `Vorschau Vorlage «${t.name}» ${restore ? 'wiederherstellen' : 'archivieren'}`
  if (!writes.length) return { writes, fp: fingerprint([t]), args, text: `${head}\nKeine Änderung, die Vorlage ist bereits ${restore ? 'aktiv' : 'archiviert'}.` }
  const count = slots(d, t.id).length
  const done = d.workouts.filter((x) => x.template_id === t!.id).length
  const lines = [head, `${count} ${count === 1 ? 'Übung' : 'Übungen'}; ${done} bisherige ${done === 1 ? 'Training bleibt' : 'Trainings bleiben'} unverändert in History und Statistik.`,
    restore ? 'Die Vorlage erscheint nach dem Sync wieder in der Liste.' : 'Die Vorlage verschwindet aus der Liste und bleibt unter Archive; wiederherstellen ist jederzeit möglich (preview_archive_template mit restore).']
  if (!restore && running(d, now).some((x) => x.template_id === t!.id)) lines.push('Hinweis: Ein Training mit dieser Vorlage läuft; es läuft unverändert weiter.')
  lines.push('', 'Speichern erst nach «ja» mit confirm_archive_template.')
  return { writes, fp: fingerprint([t]), args, text: lines.join('\n') }
}

/** preview_exercise: a new exercise (with parent: a variant) or a change, including videos. */
export function exercisePlan(d: PlanData, input: Args, now: Date): Plan {
  const args: Args = { ...input }
  const ts = now.toISOString()
  const w = new Writes()
  let ex: Exercise | undefined
  if (typeof args.exercise_id === 'string' && args.exercise_id) {
    if (!UUID.test(args.exercise_id)) throw new Error('Invalid exercise_id.')
    ex = d.exercises.find((e) => e.id === args.exercise_id)
    if (!ex) throw new Error('Exercise not found; call list_exercises.')
  } else if (typeof args.exercise === 'string' && args.exercise.trim()) {
    ex = findExercise(d, args.exercise)
    args.exercise_id = ex.id
    delete args.exercise
  } else if (typeof args.new_id === 'string' && UUID.test(args.new_id)) {
    ex = d.exercises.find((e) => e.id === args.new_id)
  } else {
    args.new_id = crypto.randomUUID()
  }
  const isNew = !ex
  const byId = byIdOf(d)
  const a = Object.fromEntries(EXERCISE_KEYS.filter((k) => args[k] !== undefined).map((k) => [k, args[k]])) as ExerciseInput
  let current: Exercise
  if (isNew) {
    const name = str(a.name)
    if (!name) throw new Error('name is required for a new exercise.')
    let parent: Exercise | null = null
    if (args.parent !== undefined && args.parent !== null) {
      parent = findExercise(d, String(args.parent))
      if (parent.parent_id) throw new Error('parent must be a main exercise, not a variant.')
    }
    const full = parent ? `${parent.name} – ${name}` : name
    if (d.exercises.some((e) => displayName(e, byId).toLowerCase() === full.toLowerCase())) throw new Error(`An exercise «${full}» already exists; call list_exercises.`)
    const id = String(args.new_id)
    const row: Record<string, unknown> = { parent_id: parent?.id ?? null, name }
    if (!parent) {
      const mp = muscles(a.muscles_primary, 'muscles_primary', d)
      if (!mp?.length) throw new Error('muscles_primary is required for a new main exercise.')
      row.tracking_type = a.tracking ?? 'weight_reps'
      if (!(String(row.tracking_type) in TRACKING_DE)) throw new Error('tracking must be weight_reps, duration or distance_duration.')
      row.is_unilateral = bool(a.unilateral, 'unilateral') ?? false
      row.muscles_primary = mp
      row.muscles_secondary = muscles(a.muscles_secondary, 'muscles_secondary', d) ?? []
    } else if (a.tracking !== undefined || a.unilateral !== undefined || a.muscles_primary !== undefined || a.muscles_secondary !== undefined) {
      throw new Error('A variant inherits tracking, one-sided and muscles from its main exercise; change them there.')
    }
    w.add('exercise', id, row, true)
    current = { ...(blank('exercise') as unknown as Exercise), ...(row as unknown as Exercise), id, user_id: '', created_at: ts, updated_at: ts, deleted_at: null }
    const rest = { ...a }
    delete rest.name
    delete rest.tracking
    delete rest.unilateral
    delete rest.muscles_primary
    delete rest.muscles_secondary
    const tmp: PlanData = { ...d, exercises: [...d.exercises, current] }
    exerciseFields(tmp, current, rest, w)
  } else {
    current = ex!
    if (args.parent !== undefined) throw new Error('parent can only be set for a new exercise.')
    exerciseFields(d, current, a, w)
  }

  // Videos: add (or retitle when the URL exists), remove by URL or id
  const links = d.links.filter((l) => l.exercise_id === current.id)
  let order = 0
  if (args.videos_add !== undefined) {
    if (!Array.isArray(args.videos_add)) throw new Error('videos_add must be a list of {url, title}.')
    for (const v of args.videos_add as { url?: string; title?: string | null }[]) {
      const url = String(v?.url ?? '').trim()
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error(`Invalid video URL «${url}».`)
      const title = str(v.title) ?? null
      const have = links.find((l) => l.url === url)
      if (have) { if (v.title !== undefined) w.patch('exercise_link', have as unknown as Record<string, unknown> & { id: string }, { title }) }
      else w.add('exercise_link', crypto.randomUUID(), { exercise_id: current.id, url, title }, true, ++order)
    }
  }
  if (args.videos_remove !== undefined) {
    if (!Array.isArray(args.videos_remove)) throw new Error('videos_remove must be a list of URLs or ids.')
    for (const r of args.videos_remove as string[]) {
      const hit = links.find((l) => l.id === r || l.url === String(r).trim())
      if (!hit) throw new Error(`No video «${r}» at this exercise.`)
      w.add('exercise_link', hit.id, { deleted_at: ts })
    }
  }

  const writes = w.list()
  const after = applyWrites(d, writes, ts)
  checkReps(after, [current.id, ...after.exercises.filter((e) => e.parent_id === current.id).map((e) => e.id)])
  const parentRow = current.parent_id ? d.exercises.find((e) => e.id === current.parent_id) : undefined
  const fp = fingerprint([isNew ? undefined : current, parentRow, ...links])
  const aById = byIdOf(after)
  const title = aById.get(current.id) ? displayName(aById.get(current.id)!, aById) : current.name
  const head = `Vorschau Übung «${title}»${isNew ? ' (neu)' : ''}`
  if (!writes.length) return { writes, fp, args, text: `${head}\nKeine Änderung, alles ist bereits so gespeichert.` }
  const lines = [head, ...exerciseChanges(d, after, writes), ...linkChanges(d, after, writes)]
  const tes = after.tes.filter((te) => te.exercise_id === current.id || aById.get(te.exercise_id)?.parent_id === current.id)
  const names = [...new Set(tes.map((te) => after.templates.find((t) => t.id === te.template_id)).filter((t): t is Template => !!t && !t.archived_at).map((t) => t.name))]
  if (names.length) lines.push(`Betrifft die Vorlagen ${names.map((n) => `«${n}»`).join(', ')}.`)
  else if (isNew) lines.push('Noch in keiner Vorlage; mit preview_template einplanen.')
  const run = running(d, now).filter((x) => d.wes.some((we) => we.workout_id === x.id && (we.exercise_id === current.id || byId.get(we.exercise_id)?.parent_id === current.id)))
  if (run.length) lines.push(`Hinweis: Die Übung ist im laufenden Training (seit ${hhmm(run[0]!.started_at)} Uhr); Einstellungen wie Top Set, Alternative und Gewichtsschritt wirken dort sofort.`)
  lines.push('', 'Speichern erst nach «ja» mit confirm_exercise.')
  return { writes, fp, args, text: lines.join('\n') }
}

// --- tools ---------------------------------------------------------------------------------------------

const exerciseProps = {
  name: { type: 'string', description: 'Exercise name (for a variant only the variant part, e.g. «Wide Grip»)' },
  tracking: { type: 'string', enum: ['weight_reps', 'duration', 'distance_duration'], description: 'Main exercise only' },
  unilateral: { type: 'boolean', description: 'One-sided (left and right counted separately); main exercise only' },
  muscles_primary: { type: 'array', items: { type: 'string' }, description: 'Muscle keys as in list_exercises, e.g. chest, lats, upper_back, shoulders, biceps, triceps, quads, hamstrings, glutes, calves, abs' },
  muscles_secondary: { type: 'array', items: { type: 'string' } },
  equipment: { type: ['string', 'null'], description: 'plate_loaded, pin_loaded, dumbbell, bodyweight, cable, machine, barbell; shared by all variants' },
  weight_step: { type: ['number', 'null'], description: 'kg per step (dumbbells: one dumbbell); null = not set' },
  rest_s: { type: ['number', 'null'], description: 'Default rest in seconds' },
  reps_min: { type: ['number', 'null'], description: 'Exercise default Min reps (templates may override)' },
  reps_max: { type: ['number', 'null'], description: 'Exercise default Max reps' },
  location: { type: ['string', 'null'], enum: ['oben', 'unten', null], description: 'Floor in the gym; shared by all variants' },
  warm_up: { type: ['boolean', 'null'], description: 'Warm-up set; null = default (variant: inherit)' },
  top_set: { type: ['boolean', 'null'], description: 'Top set with back-off sets; null = off (variant: inherit)' },
  alternative: { type: ['string', 'null'], description: 'Exercise id or name to switch to when taken; null = none' },
  note: { type: ['string', 'null'], description: 'Setup note, German' },
  cue: { type: ['string', 'null'], description: 'Execution cue, German' },
  instructions: { type: ['string', 'null'], description: 'Execution steps, German, one per line «1) …»' },
} as const

const tokenOnly = { type: 'object', properties: { preview_token: { type: 'string' } }, required: ['preview_token'] } as const

export const PLAN_TOOLS = [
  {
    name: 'preview_template',
    description: 'Preview of a new or changed workout template (plan change from the coaching chat). Pass template_id or template (exact name) to change one, or name only for a new one. exercises, when given, is the complete new list in order: an exercise already in the template keeps its sets and history; one left out is removed. Show the text unchanged, confirm_template after the user said «ja».',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string' },
        template: { type: 'string', description: 'Exact name of the template to change' },
        name: { type: 'string', description: 'New name, or the name of a new template' },
        note: { type: ['string', 'null'] },
        exercises: {
          type: 'array',
          description: 'Complete list in order. Omitted fields keep their value; null resets to the default.',
          items: {
            type: 'object',
            properties: {
              exercise: { type: 'string', description: 'Exercise id or name (a variant switches the slot and keeps its sets)' },
              sets: { type: 'number', description: 'Number of work sets (1 to 10)' },
              reps_min: { type: ['number', 'null'] },
              reps_max: { type: ['number', 'null'] },
              duration_s: { type: ['number', 'null'], description: 'Goal time per set for timed exercises' },
              rest_s: { type: ['number', 'null'], description: 'Rest in this template; null = exercise default' },
              comment: { type: ['string', 'null'] },
              warm_up: exerciseProps.warm_up,
              top_set: exerciseProps.top_set,
              alternative: exerciseProps.alternative,
              location: exerciseProps.location,
              weight_step: exerciseProps.weight_step,
            },
            required: ['exercise'],
          },
        },
      },
    },
  },
  { name: 'confirm_template', description: 'Stores a previewed template change after the user confirmed it.', inputSchema: tokenOnly },
  {
    name: 'preview_archive_template',
    description: 'Preview of archiving a template (gone from the list, kept under Archive, workouts stay) or restoring it (restore true). Show the text unchanged, confirm_archive_template after «ja».',
    inputSchema: { type: 'object', properties: { template_id: { type: 'string' }, template: { type: 'string', description: 'Exact name' }, restore: { type: 'boolean' } } },
  },
  { name: 'confirm_archive_template', description: 'Archives or restores a template after the user confirmed the preview.', inputSchema: tokenOnly },
  {
    name: 'preview_exercise',
    description: 'Preview of a new exercise (with parent: a variant of that main exercise) or a change to one: name, tracking, muscles, equipment, weight step, rest, rep range, location, warm-up, top set, alternative, notes, videos. Show the text unchanged, confirm_exercise after «ja».',
    inputSchema: {
      type: 'object',
      properties: {
        exercise_id: { type: 'string', description: 'Exercise to change' },
        exercise: { type: 'string', description: 'Exercise to change by name' },
        parent: { type: 'string', description: 'New variant: id or name of the main exercise' },
        ...exerciseProps,
        videos_add: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, title: { type: ['string', 'null'] } }, required: ['url'] }, description: 'An existing URL gets the new title' },
        videos_remove: { type: 'array', items: { type: 'string' }, description: 'URL or id of videos to remove' },
      },
    },
  },
  { name: 'confirm_exercise', description: 'Stores a previewed exercise change after the user confirmed it.', inputSchema: tokenOnly },
] as const

export const PLAN_TOOL_NAMES: ReadonlySet<string> = new Set(PLAN_TOOLS.map((t) => t.name))

export const PLAN_INSTRUCTIONS = `Plan changes (templates and exercises): only when the user asks for a change in the chat. preview_template, preview_archive_template and preview_exercise show a before/after preview; show it unchanged and store only after an explicit «ja» with confirm_template, confirm_archive_template or confirm_exercise. Never confirm without that answer. Workouts, sets, body weight and settings cannot be changed. For a template change pass exercises as the complete list in order (from list_templates); omitted fields keep their value. Warm-up, top set, alternative, location and weight step belong to the exercise and apply in every template that uses it; the preview says so. Nothing is deleted: removed exercises and videos go to the trash, templates are archived.`

export interface PlanToken {
  createdAt: number
  kind: 'plan'
  tool: 'template' | 'archive' | 'exercise'
  args: Args
  fp: string
}

const BUILD = { template: templatePlan, archive: archivePlan, exercise: exercisePlan } as const
const TOOL_OF: Record<string, PlanToken['tool']> = { preview_template: 'template', confirm_template: 'template', preview_archive_template: 'archive',
  confirm_archive_template: 'archive', preview_exercise: 'exercise', confirm_exercise: 'exercise' }

export interface PlanCtx {
  sql: Sql
  user: string
  now: Date
  sign: (p: PlanToken) => Promise<string>
  verify: (token: string) => Promise<PlanToken | null>
}

export async function callPlanTool(name: string, args: Args, ctx: PlanCtx): Promise<{ text: string }> {
  const tool = TOOL_OF[name]
  if (!tool) throw new Error(`Unknown tool ${name}`)
  const d = await loadPlan(ctx.sql, ctx.user)
  if (name.startsWith('preview_')) {
    const plan = BUILD[tool](d, args, ctx.now)
    if (!plan.writes.length) return { text: plan.text }
    const token = await ctx.sign({ createdAt: ctx.now.getTime(), kind: 'plan', tool, args: plan.args, fp: plan.fp })
    return { text: `${plan.text}\n\npreview_token: ${token}` }
  }
  const p = await ctx.verify(String(args.preview_token ?? ''))
  if (!p || p.kind !== 'plan' || p.tool !== tool) throw new Error(`Invalid or expired preview; call preview_${tool === 'archive' ? 'archive_template' : tool} again.`)
  const plan = BUILD[tool](d, p.args, ctx.now)
  if (!plan.writes.length) return { text: 'Bereits gespeichert.' }
  if (plan.fp !== p.fp) throw new Error(`Changed in the app since the preview; call preview_${tool === 'archive' ? 'archive_template' : tool} again and show the new preview.`)
  const st = writeStatement(plan.writes, ctx.user, ctx.now.toISOString())
  await ctx.sql(st.query, st.params)
  const label = tool === 'template' ? 'Vorlage' : tool === 'archive' ? (p.args.restore === true ? 'Vorlage wiederhergestellt' : 'Vorlage archiviert') : 'Übung'
  return { text: `Gespeichert (${label}, ${plan.writes.length} ${plan.writes.length === 1 ? 'Zeile' : 'Zeilen'}). Die App übernimmt es beim nächsten Sync (App öffnen oder herunterziehen).` }
}
