// Read-only training tools of the Food connector (request Rodrigo, 23 November 2026, version 1.4.0).
// Claude reads workouts, templates, exercises, body weight and targets for analyses in the coaching chat. Nothing here
// writes: the role food_connector has only SELECT on these tables (migration 0062), the rows of the app owner that are
// not deleted. All numbers come from the same pure functions as the app (src/lib/core and the pure modules next to it),
// so progression, top set, sets per muscle, 7-day average and forecast match what the app shows.
// Dates are shown in Zurich time; weights in kg as in the app.

import { buildAnalytics, dayKey, muscleLabel, setsPerMuscle, weekStart, weeklyVolume } from '../src/lib/core/analytics.ts'
import { trendWeighIns, weightSeries } from '../src/lib/core/body.ts'
import { displayName, effective, warmUpPlan } from '../src/lib/core/exercise.ts'
import { durationReached, nextWeightAfter, progressionAdvice, trainingSessionsOf, workSets, type ProgressionAdvice, type TrainingSession } from '../src/lib/core/progression.ts'
import { bestRepsSet, topSetOf, type TopSet } from '../src/lib/core/report.ts'
import type { BodyWeight, Exercise, Template, TemplateExercise, TemplateSet, Workout, WorkoutExercise, WorkoutSet } from '../src/lib/core/rows.ts'
import { parseGoalWeight, parseNutrition, parseTrainingShares, parseWeeklyGoal } from '../src/lib/core/settings.ts'
import { effectiveReps, epley } from '../src/lib/core/stats.ts'
import { weightForecast } from '../src/lib/forecast.ts'
import { decidingReps } from '../src/lib/goal.ts'
import { shareOf, topIndex } from '../src/lib/topset.ts'
import { repetitionTargets } from '../src/lib/training.ts'

export type Sql = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
type Args = Record<string, unknown>

const TZ = 'Europe/Zurich'
const DAY = 86_400_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export const TRAINING_INSTRUCTIONS = `Training data (read only): list_workouts, get_workout, exercise_history, list_templates, list_exercises, weekly_volume, body_weight and get_targets read the app's data for analyses (progression, volume per muscle, stagnation, weight trend). They never write; workouts and body weight are changed only in the app, templates and exercises through the plan tools below. Values (progression status, recommended weight, sets per muscle, 7-day average, trend and forecast) are computed on the server exactly as in the app; do not recompute them, explain them. For questions about a single exercise use exercise_history; for the plan use list_templates.`

// --- loading ---------------------------------------------------------------------------------------

export interface TrainingData {
  exercises: Exercise[]
  templates: Template[]
  tes: TemplateExercise[]
  tsets: TemplateSet[]
  workouts: Workout[]
  wes: WorkoutExercise[]
  sets: WorkoutSet[]
  weights: BodyWeight[]
  settings: Map<string, unknown>
}

const TABLES = ['exercise', 'template', 'template_exercise', 'template_set', 'workout', 'workout_exercise', 'workout_set', 'body_weight'] as const
export type TrainingTable = (typeof TABLES)[number] | 'user_setting'

function json(v: unknown): unknown {
  return typeof v === 'string' ? JSON.parse(v) : v
}

/** Timestamps from to_jsonb («2026-11-23T10:05:00.123+00:00») as ISO in UTC, so they compare as strings like in the app. */
export function normalizeRow<T>(raw: unknown): T {
  const r = { ...(json(raw) as Record<string, unknown>) }
  for (const k of Object.keys(r)) {
    const v = r[k]
    if (k.endsWith('_at') && typeof v === 'string' && v) r[k] = new Date(v).toISOString()
  }
  return r as T
}

/** Reads the app owner's rows (not deleted) of the training tables; the policies of migration 0062 allow nothing else. */
export async function loadTraining(sql: Sql, user: string): Promise<TrainingData> {
  const read = async <T>(table: TrainingTable): Promise<T[]> => {
    const rows = await sql(`select to_jsonb(t) as r from public.${table} t where t.user_id = $1 and t.deleted_at is null`, [user])
    return rows.map((x) => normalizeRow<T>(x.r))
  }
  const [exercises, templates, tes, tsets, workouts, wes, sets, weights, settingRows] = await Promise.all([
    read<Exercise>('exercise'), read<Template>('template'), read<TemplateExercise>('template_exercise'), read<TemplateSet>('template_set'),
    read<Workout>('workout'), read<WorkoutExercise>('workout_exercise'), read<WorkoutSet>('workout_set'), read<BodyWeight>('body_weight'),
    read<{ key: string; value: unknown }>('user_setting'),
  ])
  const settings = new Map(settingRows.map((s) => [s.key, json(s.value)]))
  return { exercises, templates, tes, tsets, workouts, wes, sets, weights, settings }
}

// --- dates and formatting ---------------------------------------------------------------------------

/** Wall-clock time in Zurich as «YYYY-MM-DDTHH:mm:ss» without offset: parsed as local time it gives Zurich days and weeks. */
export function zurichWall(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

export function zurichDate(iso: string): string {
  return zurichWall(iso).slice(0, 10)
}

const WEEKDAY_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** «Mo 23.11.2026 10:05» */
function when(iso: string): string {
  const w = zurichWall(iso)
  const day = new Date(`${w.slice(0, 10)}T12:00:00Z`).getUTCDay()
  return `${WEEKDAY_DE[day]} ${w.slice(8, 10)}.${w.slice(5, 7)}.${w.slice(0, 4)} ${w.slice(11, 16)}`
}

/** «23.11.2026» */
function dateDe(day: string): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`
}

function kg(n: number): string {
  return String(Math.round(n * 10) / 10)
}

function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Weight step as labelled: dumbbells in pairs are entered as the total, so the step per dumbbell counts twice. */
function stepText(eff: { weightStep: number | null; equipment: string | null; isUnilateral: boolean }): string | null {
  if (!eff.weightStep) return null
  return eff.equipment === 'dumbbell' && !eff.isUnilateral ? `Stufe ${kg(eff.weightStep / 2)} kg pro Hantel (Summe ${kg(eff.weightStep)} kg)` : `Stufe ${kg(eff.weightStep)} kg`
}

function dayPlus(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10)
}

function dayArg(v: unknown, name: string): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !ISO_DAY.test(v)) throw new Error(`${name} must be YYYY-MM-DD.`)
  return v
}

/** Range [from, to] of Zurich days; default the last `days` days up to today. */
function range(args: Args, now: Date, days: number): { from: string; to: string } {
  const to = dayArg(args.to, 'to') ?? zurichDate(now.toISOString())
  const from = dayArg(args.from, 'from') ?? dayPlus(to, -(days - 1))
  if (from > to) throw new Error('from must not be after to.')
  return { from, to }
}

// --- sets and exercises -------------------------------------------------------------------------------

function byIdOf(d: TrainingData): Map<string, Exercise> {
  return new Map(d.exercises.map((e) => [e.id, e]))
}

function nameOf(id: string, byId: Map<string, Exercise>): string {
  const ex = byId.get(id)
  return ex ? displayName(ex, byId) : 'Unbekannte Übung'
}

function setsOf(d: TrainingData, weId: string): WorkoutSet[] {
  return d.sets.filter((s) => s.workout_exercise_id === weId).sort((a, b) => a.position - b.position)
}

/** «32×10», one-sided «12×10/9», timed «45 s», run «5.0 km · 28:30», bodyweight «×8». */
export function setText(s: WorkoutSet, eff: { trackingType: string; isUnilateral: boolean; bodyweight: boolean }): string {
  if (eff.trackingType === 'duration') return `${s.duration_s ?? '?'} s`
  if (eff.trackingType === 'distance_duration') return `${s.distance_km ?? '?'} km · ${s.duration_s !== null ? `${Math.floor(s.duration_s / 60)}:${String(s.duration_s % 60).padStart(2, '0')}` : '?'}`
  const reps = eff.isUnilateral ? `${s.reps_left ?? '?'}/${s.reps_right ?? '?'}` : `${s.reps ?? '?'}`
  const load = eff.bodyweight || s.weight === null ? '' : kg(s.weight)
  return `${load}×${reps}${s.rir !== null ? ` RIR ${s.rir}` : ''}`
}

/** Set labels as in the app: W for warm-up; with top set the first heaviest work set is Top, the others Back-off. */
export function setLabels(sets: WorkoutSet[], topSet: boolean): string[] {
  const work = sets.filter((s) => s.set_type === 'working')
  const top = topSet ? topIndex(work.map((s) => s.weight)) : -1
  let i = -1
  return sets.map((s) => {
    if (s.set_type === 'warmup') return 'W'
    i += 1
    if (top === -1) return `${i + 1}`
    return i === top ? 'Top' : 'Back-off'
  })
}

function topText(t: TopSet | null, unilateral: boolean, bodyweight: boolean): string {
  if (!t) return '–'
  const reps = unilateral ? `${t.repsLeft ?? '?'}/${t.repsRight ?? '?'}` : `${t.reps ?? '?'}`
  return bodyweight ? `×${reps}` : `${kg(t.weight)}×${reps}`
}

/** Totals of a finished workout as in the report: work sets, weight × reps (one-sided sets count both sides). */
function totals(d: TrainingData, w: Workout): { volume: number; work: number; warmUp: number; exercises: number } {
  const wes = d.wes.filter((we) => we.workout_id === w.id)
  let volume = 0
  let work = 0
  let warmUp = 0
  let exercises = 0
  for (const we of wes) {
    const sets = setsOf(d, we.id)
    if (sets.some((s) => s.set_type === 'working')) exercises += 1
    for (const s of sets) {
      if (s.set_type === 'warmup') { warmUp += 1; continue }
      work += 1
      if (s.weight !== null) volume += s.weight * (s.reps ?? (s.reps_left ?? 0) + (s.reps_right ?? 0))
    }
  }
  return { volume: Math.round(volume), work, warmUp, exercises }
}

// --- progression ------------------------------------------------------------------------------------------

export interface ProgressionStatus {
  advice: ProgressionAdvice
  /** Top-set weight of the last time */
  current: number
  /** Recommended top-set weight next time; null without a weight step (heavier), or for bodyweight */
  next: number | null
  backOff: number | null
  warmUp: number | null
  target: number
  minimum: number
  plannedCount: number
  repsToGo: number | null
  stage: boolean
  lastDate: string
  template: string | null
}

/**
 * Status for the next workout as in the app (Home «Ready to increase», report «Next workout»): the last two
 * performances of this exact exercise or variant in any workout; targets from the last workout's snapshot, else the
 * template; planned work sets from the slot of the last workout's template, else the active plan.
 */
export function progressionStatus(d: TrainingData, exerciseId: string): ProgressionStatus | null {
  const byId = byIdOf(d)
  const ex = byId.get(exerciseId)
  if (!ex) return null
  const eff = effective(ex, byId)
  if (eff.trackingType === 'distance_duration') return null
  const sessions = trainingSessionsOf(exerciseId, d, 2)
  const latest = sessions[0]
  if (!latest) return null
  const live = new Set(d.templates.filter((t) => !t.archived_at).map((t) => t.id))
  const slot = (latest.workout.template_id ? d.tes.find((te) => te.template_id === latest.workout.template_id && te.exercise_id === exerciseId) : undefined)
    ?? d.tes.find((te) => live.has(te.template_id) && te.exercise_id === exerciseId)
  const planned = slot ? d.tsets.filter((s) => s.template_exercise_id === slot.id && s.set_type === 'working') : []
  const plannedCount = planned.length || workSets(latest.sets).length
  const defaults = repetitionTargets(ex, byId, planned)
  const target = latest.exercise.target_reps ?? defaults.target
  const minimum = latest.exercise.min_reps ?? defaults.minimum
  const work = workSets(latest.sets)
  const current = Math.max(0, ...work.map((s) => s.weight ?? 0))
  const stage = eff.bodyweight || eff.trackingType === 'duration'
  let advice: ProgressionAdvice
  if (eff.trackingType === 'duration') {
    const goal = planned.reduce<number | null>((m, s) => (s.target_duration_s === null ? m : Math.max(m ?? 0, s.target_duration_s)), null)
    advice = durationReached(latest.sets, goal, plannedCount) ? 'increase' : 'hold'
  } else {
    advice = progressionAdvice(sessions, { target, minimum }, eff.isUnilateral, plannedCount, eff.topSet) ?? 'hold'
  }
  const next = stage || current <= 0 ? null : nextWeightAfter(advice, current, eff.weightStep)
  const shares = parseTrainingShares(d.settings.get('training_shares'))
  const base = next ?? (advice === 'hold' ? current : null)
  const backOff = !stage && eff.topSet && base ? shareOf(base, shares.backOff / 100, eff.weightStep).kg : null
  const warmUp = !stage && eff.warmUp && base ? shareOf(base, warmUpPlan(eff.equipment, shares).share, eff.weightStep).kg : null
  const today = eff.trackingType === 'weight_reps' ? decidingReps(work, eff.topSet, eff.isUnilateral) : null
  const template = latest.workout.template_name_snapshot ?? d.templates.find((t) => t.id === latest.workout.template_id)?.name ?? null
  return { advice, current, next, backOff, warmUp, target, minimum, plannedCount, repsToGo: advice === 'hold' && today !== null ? Math.max(0, target - today) : null,
    stage, lastDate: latest.workout.started_at, template }
}

const ADVICE_DE: Record<string, string> = { increase: 'Gewicht erhöhen', hold: 'Gewicht halten', reduce: 'Gewicht senken' }

function statusText(p: ProgressionStatus, eff: { topSet: boolean; weightStep: number | null; trackingType: string }): string {
  if (p.stage) {
    return p.advice === 'increase' ? 'Status: Ziel erreicht, nächste Stufe der Bewegung («Next stage»)' : `Status: Stufe halten, Ziel ${eff.trackingType === 'duration' ? 'Zeit' : `${p.target} Wdh`} in allen ${p.plannedCount} Sätzen`
  }
  const lines = [`Status: ${ADVICE_DE[p.advice ?? 'hold']} (Bereich ${p.minimum}–${p.target} Wdh, ${p.plannedCount} Arbeitssätze, ${eff.topSet ? 'Top Set entscheidet' : 'alle Arbeitssätze entscheiden'})`]
  const rec = p.next !== null ? `${kg(p.next)} kg` : p.advice === 'increase' ? 'schwerer (keine Gewichtsstufe hinterlegt)' : p.advice === 'reduce' ? 'leichter (keine Gewichtsstufe hinterlegt)' : `${kg(p.current)} kg`
  lines.push(`Empfehlung nächstes Training: ${eff.topSet ? 'Top Set ' : ''}${rec}${p.backOff !== null ? `, Back-off ${kg(p.backOff)} kg` : ''}${p.warmUp !== null ? `, Warm-up ${kg(p.warmUp)} kg` : ''}`)
  if (p.repsToGo !== null && p.repsToGo > 0) lines.push(`Bis zur Erhöhung: noch ${p.repsToGo} Wdh im ${eff.topSet ? 'Top Set' : 'schwächsten Arbeitssatz'}`)
  return lines.join('\n')
}

// --- tools -------------------------------------------------------------------------------------------------

const rangeProps = {
  from: { type: 'string', description: 'First day YYYY-MM-DD (Zurich time)' },
  to: { type: 'string', description: 'Last day YYYY-MM-DD (Zurich time), default today' },
}

export const TRAINING_TOOLS = [
  {
    name: 'list_workouts', description: 'Read only. Workouts in a period (default the last 28 days): date, template, duration, volume, number of sets, gym crowd, id for get_workout.',
    inputSchema: { type: 'object', properties: rangeProps },
  },
  {
    name: 'get_workout', description: 'Read only. One workout in full: exercises in order, sets with kg, reps, duration and set type (W, Top, Back-off), skipped exercises, alternatives, notes. Default the latest workout.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Workout id from list_workouts' }, date: { type: 'string', description: 'YYYY-MM-DD: the latest workout of that day' } } },
  },
  {
    name: 'exercise_history', description: 'Read only. History of an exercise over all workouts, with its variants and alternatives: every performance, best top set, best e1RM (Epley), progression status and recommended weight as in the app.',
    inputSchema: { type: 'object', properties: { exercise: { type: 'string', description: 'Exercise id or (part of the) name, e.g. «Lat Pulldown»' }, from: { type: 'string', description: 'Only performances from YYYY-MM-DD on' }, family: { type: 'boolean', description: 'Include variants and alternatives (default true)' } }, required: ['exercise'] },
  },
  {
    name: 'list_templates', description: 'Read only. Workout templates (plans): active with exercises, work sets, rep range, warm-up, top set, rest and alternative; archived by name (details with include_archived).',
    inputSchema: { type: 'object', properties: { include_archived: { type: 'boolean', description: 'Details of archived templates too' } } },
  },
  {
    name: 'list_exercises', description: 'Read only. Exercise catalogue: muscles, equipment, weight step, location, rep range, top set, warm-up, alternative, notes; variants under their main exercise.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Filter by name' }, in_plan: { type: 'boolean', description: 'Only exercises of active templates' } } },
  },
  {
    name: 'weekly_volume', description: 'Read only. Work sets per muscle group and week (1 per primary, 0.5 per secondary muscle, as defined in the app) and volume in kg, weeks Monday to Sunday in Zurich time.',
    inputSchema: { type: 'object', properties: { weeks: { type: 'number', description: 'Number of weeks up to this week (default 8, max 52)' } } },
  },
  {
    name: 'body_weight', description: 'Read only. Weigh-ins in a period (default the last 90 days) with 7-day average, trend per week and forecast to the goal weight as in the app (last 28 days, morning fasted or without condition, 80 % band).',
    inputSchema: { type: 'object', properties: rangeProps },
  },
  { name: 'get_targets', description: 'Read only. Targets of the app: goal weight, daily need, deficit, kcal target, protein minimum, creatine, warm-up and back-off shares, workouts per week.', inputSchema: { type: 'object', properties: {} } },
] as const

export const TRAINING_TOOL_NAMES: ReadonlySet<string> = new Set(TRAINING_TOOLS.map((t) => t.name))

export function findExercise(d: TrainingData, query: string): Exercise {
  const byId = byIdOf(d)
  if (UUID.test(query)) {
    const ex = byId.get(query)
    if (!ex) throw new Error('Exercise not found; call list_exercises.')
    return ex
  }
  const q = query.trim().toLowerCase()
  if (!q) throw new Error('exercise is required.')
  const named = d.exercises.map((e) => ({ e, name: displayName(e, byId).toLowerCase() }))
  const exact = named.filter((x) => x.name === q || x.e.name.toLowerCase() === q)
  const hits = exact.length ? exact : named.filter((x) => x.name.includes(q))
  // Prefer the main exercise when the query matches it and its variants
  const mains = hits.filter((x) => x.e.parent_id === null)
  const pick = mains.length === 1 ? mains : hits
  if (pick.length === 1) return pick[0]!.e
  if (!pick.length) throw new Error(`No exercise matches «${query}»; call list_exercises.`)
  throw new Error(`Several exercises match «${query}»: ${pick.map((x) => `${displayName(x.e, byId)} (${x.e.id})`).join('; ')}. Pass the id.`)
}

/** Main exercise, its variants and the alternatives (in both directions) with their variants. */
export function familyOf(d: TrainingData, ex: Exercise): { id: string; role: string }[] {
  const byId = byIdOf(d)
  const mainId = ex.parent_id ?? ex.id
  const members = (id: string) => [id, ...d.exercises.filter((e) => e.parent_id === id).map((e) => e.id)]
  const out = new Map<string, string>()
  for (const id of members(mainId)) out.set(id, id === mainId ? 'Hauptübung' : 'Variante')
  const own = [...out.keys()]
  const alternatives = new Set<string>()
  for (const id of own) {
    const e = byId.get(id)
    const alt = e?.alternative_id ?? (e?.parent_id ? byId.get(e.parent_id)?.alternative_id : null)
    if (alt) alternatives.add(byId.get(alt)?.parent_id ?? alt)
  }
  for (const e of d.exercises) if (e.alternative_id && own.includes(e.alternative_id)) alternatives.add(e.parent_id ?? e.id)
  for (const alt of alternatives) for (const id of members(alt)) if (!out.has(id)) out.set(id, 'Alternative')
  return [...out.entries()].map(([id, role]) => ({ id, role }))
}

export async function callTrainingTool(name: string, args: Args, ctx: { sql: Sql; user: string; now: Date }): Promise<{ text: string }> {
  const d = await loadTraining(ctx.sql, ctx.user)
  return { text: trainingTool(name, args, d, ctx.now) }
}

export function trainingTool(name: string, args: Args, d: TrainingData, now: Date): string {
  const byId = byIdOf(d)
  switch (name) {
    case 'list_workouts': {
      const { from, to } = range(args, now, 28)
      const list = d.workouts
        .filter((w) => { const day = zurichDate(w.started_at); return day >= from && day <= to })
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
      if (!list.length) return `Keine Trainings vom ${dateDe(from)} bis ${dateDe(to)}.`
      const lines = list.map((w) => {
        const t = totals(d, w)
        const name = w.template_name_snapshot ?? 'Workout'
        if (w.finished_at === null) return `${when(w.started_at)} · ${name} · läuft noch · id ${w.id}`
        const dur = minutes(Math.max(0, (Date.parse(w.finished_at) - Date.parse(w.started_at)) / 1000))
        return `${when(w.started_at)} · ${name} · ${dur} · ${thousands(t.volume)} kg Volumen · ${t.work} Arbeitssätze${t.warmUp ? ` (+${t.warmUp} W)` : ''} · ${plural(t.exercises, 'Übung', 'Übungen')}${w.crowd_level ? ` · Gym ${w.crowd_level}/10` : ''} · id ${w.id}`
      })
      return `Trainings ${dateDe(from)} bis ${dateDe(to)} (${list.length}, neueste zuerst; Volumen = kg × Wdh der Arbeitssätze, einseitig beide Seiten)\n${lines.join('\n')}`
    }
    case 'get_workout': {
      let w: Workout | undefined
      if (typeof args.id === 'string' && args.id) {
        if (!UUID.test(args.id)) throw new Error('Invalid id.')
        w = d.workouts.find((x) => x.id === args.id)
      } else {
        const day = dayArg(args.date, 'date')
        w = [...d.workouts].sort((a, b) => b.started_at.localeCompare(a.started_at)).find((x) => !day || zurichDate(x.started_at) === day)
      }
      if (!w) throw new Error('Workout not found; call list_workouts.')
      const t = totals(d, w)
      const head = [`${w.template_name_snapshot ?? 'Workout'} · ${when(w.started_at)}${w.finished_at ? ` bis ${zurichWall(w.finished_at).slice(11, 16)} (${minutes((Date.parse(w.finished_at) - Date.parse(w.started_at)) / 1000)})` : ' · läuft noch'}`,
        `${thousands(t.volume)} kg Volumen · ${t.work} Arbeitssätze${t.warmUp ? ` (+${t.warmUp} W)` : ''}${w.crowd_level ? ` · Gym ${w.crowd_level}/10` : ''}${w.note ? `\nNotiz: ${w.note}` : ''}`]
      const body = d.wes.filter((we) => we.workout_id === w.id).sort((a, b) => a.position - b.position).map((we, i) => {
        const ex = byId.get(we.exercise_id)
        const eff = ex ? effective(ex, byId) : { trackingType: 'weight_reps', isUnilateral: false, bodyweight: false, topSet: false }
        const sets = setsOf(d, we.id)
        const labels = setLabels(sets, eff.topSet)
        const extra = [we.original_exercise_id ? `statt ${nameOf(we.original_exercise_id, byId)}` : null, we.comment, we.rest_s ? `Pause ${we.rest_s} s` : null,
          we.target_reps ? `Bereich ${we.min_reps ?? '?'}–${we.target_reps}` : null].filter(Boolean)
        const title = `${i + 1}. ${nameOf(we.exercise_id, byId)}${extra.length ? ` (${extra.join(', ')})` : ''}`
        if (we.skipped_at) return `${title}: übersprungen`
        if (!sets.length) return `${title}: keine Sätze`
        return `${title}\n   ${sets.map((s, k) => `${labels[k]} ${setText(s, eff)}`).join(' · ')}`
      })
      return `${head.join('\n')}\n${body.join('\n')}\nid ${w.id}`
    }
    case 'exercise_history': {
      const ex = findExercise(d, String(args.exercise ?? ''))
      const from = dayArg(args.from, 'from')
      const family = args.family === false ? [{ id: ex.id, role: ex.parent_id ? 'Variante' : 'Hauptübung' }] : familyOf(d, ex)
      const blocks: string[] = []
      for (const member of family) {
        const mex = byId.get(member.id)!
        const eff = effective(mex, byId)
        const sessions: TrainingSession[] = trainingSessionsOf(member.id, d, 10_000)
          .filter((s) => !from || zurichDate(s.workout.started_at) >= from)
          .reverse()
        if (!sessions.length) continue
        const lines = sessions.map((s) => {
          const labels = setLabels(s.sets, eff.topSet)
          const work = workSets(s.sets)
          const vol = work.reduce((sum, x) => sum + (x.weight ?? 0) * (x.reps ?? (x.reps_left ?? 0) + (x.reps_right ?? 0)), 0)
          const pick = eff.bodyweight ? bestRepsSet(work) : topSetOf(work)
          return `${zurichDate(s.workout.started_at)} · ${s.workout.template_name_snapshot ?? 'Workout'} · ${s.sets.map((x, k) => `${labels[k]} ${setText(x, eff)}`).join(', ')}${eff.trackingType === 'weight_reps' && !eff.bodyweight ? `${eff.topSet ? '' : ` · bester Satz ${topText(pick, eff.isUnilateral, false)}`} · ${thousands(vol)} kg` : ''}`
        })
        const all = sessions.flatMap((s) => workSets(s.sets))
        const best = eff.bodyweight ? bestRepsSet(all) : topSetOf(all)
        let e1rm: { v: number; s: WorkoutSet; date: string } | null = null
        for (const s of sessions) for (const x of workSets(s.sets)) {
          const v = epley(x.weight, effectiveReps(x))
          if (v !== null && (!e1rm || v > e1rm.v)) e1rm = { v, s: x, date: zurichDate(s.workout.started_at) }
        }
        const status = progressionStatus(d, member.id)
        const head = `${displayName(mex, byId)} (${member.role}, id ${member.id})${stepText(eff) ? ` · ${stepText(eff)}` : ''}${eff.isUnilateral ? ' · einseitig' : ''}`
        const summary = [`${plural(sessions.length, 'Training', 'Trainings')} seit ${dateDe(zurichDate(sessions[0]!.workout.started_at))}`,
          eff.trackingType === 'weight_reps' ? `bestes ${eff.bodyweight ? 'Wiederholungsmaximum' : 'Top Set'} ${topText(best, eff.isUnilateral, eff.bodyweight)}` : null,
          e1rm && !eff.bodyweight ? `bestes e1RM ${kg(e1rm.v)} kg (${setText(e1rm.s, eff)} am ${dateDe(e1rm.date)})` : null].filter(Boolean).join(' · ')
        blocks.push([head, summary, ...lines, status ? statusText(status, eff) : null].filter(Boolean).join('\n'))
      }
      return blocks.length ? blocks.join('\n\n') : `Keine Trainings mit ${displayName(ex, byId)}${from ? ` seit ${dateDe(from)}` : ''}.`
    }
    case 'list_templates': {
      const templates = d.templates.filter((t) => !t.purged_at).sort((a, b) => a.name.localeCompare(b.name))
      const detail = (t: Template) => {
        const slots = d.tes.filter((te) => te.template_id === t.id).sort((a, b) => a.position - b.position).map((te) => {
          const ex = byId.get(te.exercise_id)
          if (!ex) return `${te.position}. Unbekannte Übung`
          const eff = effective(ex, byId)
          const planned = d.tsets.filter((s) => s.template_exercise_id === te.id).sort((a, b) => a.position - b.position)
          const work = planned.filter((s) => s.set_type === 'working')
          const r = repetitionTargets(ex, byId, planned)
          const rest = te.rest_s ?? eff.restS
          const weights = work.map((s) => s.target_weight).filter((x): x is number => x !== null)
          const alt = ex.alternative_id ?? (ex.parent_id ? byId.get(ex.parent_id)?.alternative_id : null)
          const dur = work.map((s) => s.target_duration_s).filter((x): x is number => x !== null)
          const scheme = eff.trackingType === 'duration' ? `${work.length} × ${dur.length ? `${Math.max(...dur)} s` : 'Zeit'}` : eff.trackingType === 'distance_duration' ? `${work.length} × Lauf` : `${work.length} × ${r.minimum}–${r.target}`
          const parts = [scheme, eff.warmUp && eff.trackingType === 'weight_reps' && !eff.bodyweight ? 'Warm-up' : null, eff.topSet ? 'Top Set' : null, rest ? `Pause ${rest} s` : null,
            weights.length ? `Zielgewicht ${weights.map(kg).join('/')} kg` : null, alt ? `Alternative ${nameOf(alt, byId)}` : null, te.comment ? `«${te.comment}»` : null, eff.floor ? (eff.floor === 'oben' ? 'oben' : 'unten') : null]
          return `${te.position}. ${displayName(ex, byId)}: ${parts.filter(Boolean).join(' · ')}`
        })
        return `${t.name}${t.archived_at ? ` (archiviert ${dateDe(zurichDate(t.archived_at))})` : ''}${t.note ? ` · ${t.note}` : ''} (id ${t.id})\n${slots.join('\n') || 'keine Übungen'}`
      }
      const active = templates.filter((t) => !t.archived_at)
      const archived = templates.filter((t) => t.archived_at)
      const out = [`Aktive Vorlagen (${active.length})`, ...active.map(detail)]
      if (archived.length) out.push(args.include_archived === true ? `Archiviert (${archived.length})\n${archived.map(detail).join('\n\n')}` : `Archiviert (${archived.length}, Details mit include_archived): ${archived.map((t) => t.name).join('; ')}`)
      return out.join('\n\n')
    }
    case 'list_exercises': {
      const q = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
      const live = new Set(d.templates.filter((t) => !t.archived_at).map((t) => t.id))
      const inPlan = new Set(d.tes.filter((te) => live.has(te.template_id)).map((te) => te.exercise_id))
      const mains = d.exercises.filter((e) => e.parent_id === null).sort((a, b) => a.name.localeCompare(b.name))
      const line = (e: Exercise, indent: string) => {
        const eff = effective(e, byId)
        const r = repetitionTargets(e, byId)
        const muscles = [(e.muscles_primary ?? []).join(', '), (e.muscles_secondary ?? []).length ? `sekundär ${(e.muscles_secondary ?? []).join(', ')}` : ''].filter(Boolean).join('; ')
        const alt = e.alternative_id ? nameOf(e.alternative_id, byId) : null
        const parts = [eff.equipment, muscles || null, eff.trackingType === 'weight_reps' && !eff.bodyweight ? `${r.minimum}–${r.target} Wdh` : eff.trackingType === 'duration' ? 'Zeit' : eff.trackingType === 'distance_duration' ? 'Lauf' : `${r.minimum}–${r.target} Wdh ohne kg`,
          stepText(eff), eff.topSet ? 'Top Set' : null, eff.warmUp && !eff.bodyweight && eff.trackingType === 'weight_reps' ? 'Warm-up' : null,
          eff.isUnilateral ? 'einseitig' : null, eff.floor ? `Standort ${eff.floor}` : null, alt ? `Alternative ${alt}` : null, inPlan.has(e.id) ? 'im Plan' : null]
        const notes = [eff.setupNote ? `Einstellung: ${eff.setupNote}` : null, eff.focusCue ? `Hinweis: ${eff.focusCue}` : null].filter(Boolean)
        return `${indent}${e.parent_id ? displayName(e, byId) : e.name}: ${parts.filter(Boolean).join(' · ')} (id ${e.id})${notes.length ? `\n${indent}   ${notes.join(' | ')}` : ''}`
      }
      const out: string[] = []
      for (const m of mains) {
        const variants = d.exercises.filter((e) => e.parent_id === m.id).sort((a, b) => a.name.localeCompare(b.name))
        const group = [m, ...variants]
        if (args.in_plan === true && !group.some((e) => inPlan.has(e.id))) continue
        if (q && !group.some((e) => displayName(e, byId).toLowerCase().includes(q))) continue
        out.push([line(m, ''), ...variants.map((v) => line(v, '   '))].join('\n'))
      }
      return out.length ? `Übungen (${out.length} Hauptübungen; Bereich Min–Max Wdh, Varianten erben von der Hauptübung)\n${out.join('\n')}` : 'Keine Übung gefunden.'
    }
    case 'weekly_volume': {
      const weeks = Math.min(52, Math.max(1, Math.round(Number(args.weeks ?? 8)) || 8))
      // Zurich wall-clock times: the app's week functions use local time, so weeks run Monday to Sunday in Zurich
      const local = d.workouts.map((w) => ({ ...w, started_at: zurichWall(w.started_at) }))
      const data = buildAnalytics(local, d.wes, d.sets, d.exercises)
      const nowLocal = new Date(zurichWall(now.toISOString()))
      const first = weekStart(nowLocal)
      first.setDate(first.getDate() - 7 * (weeks - 1))
      const volume = weeklyVolume(data.sets, first.getTime(), nowLocal)
      const out = volume.slice().reverse().map((wk) => {
        const muscles = setsPerMuscle(data.sets, wk.start)
        const sets = data.sets.filter((x) => x.set.set_type === 'working' && x.trackingType !== 'distance_duration' && dayKey(weekStart(new Date(x.date))) === wk.start).length
        const count = data.workouts.filter((w) => w.strength && dayKey(weekStart(new Date(w.startedAt))) === wk.start).length
        const end = dayPlus(wk.start, 6)
        return `Woche ${dateDe(wk.start)} bis ${dateDe(end)}${wk.start === dayKey(weekStart(nowLocal)) ? ' (laufend)' : ''}: ${plural(count, 'Krafttraining', 'Krafttrainings')} · ${sets} Arbeitssätze · ${thousands(wk.value)} kg\n   ${muscles.map((m) => `${muscleLabel(m.muscle)} ${m.sets}`).join(', ') || 'keine Sätze'}`
      })
      return `Sätze pro Muskelgruppe und Woche (Arbeitssätze, primär 1, sekundär 0.5; Volumen kg × Wdh), neueste zuerst\n${out.join('\n')}`
    }
    case 'body_weight': {
      const { from, to } = range(args, now, 90)
      const series = weightSeries(d.weights)
      const goal = parseGoalWeight(d.settings.get('goal_weight'))
      const today = zurichDate(now.toISOString())
      const inRange = series.filter((p) => p.entry.measured_on >= from && p.entry.measured_on <= to)
      const cond: Record<string, string> = { morning_fasted: 'morgens nüchtern', after_workout: 'nach Training', after_meal: 'nach Essen', other: 'anderes' }
      const lines = inRange.map((p) => `${dateDe(p.entry.measured_on)} · ${kg(p.entry.weight_kg)} kg · Schnitt 7 Tage ${kg(p.avg7)} kg${p.entry.condition ? ` · ${cond[p.entry.condition] ?? p.entry.condition}` : ''}${p.entry.note ? ` · ${p.entry.note}` : ''}`)
      const f = weightForecast(trendWeighIns(series), today, goal)
      const latest = series[0]
      const summary = [latest ? `Letzter Eintrag ${dateDe(latest.entry.measured_on)} ${kg(latest.entry.weight_kg)} kg, Schnitt 7 Tage ${kg(latest.avg7)} kg` : 'Keine Gewichtseinträge',
        goal !== null ? `Zielgewicht ${kg(goal)} kg` : 'kein Zielgewicht gesetzt']
      if (f) {
        summary.push(`Trend (letzte 28 Tage, ${f.n} Messungen morgens nüchtern oder ohne Angabe): ${f.perWeek > 0 ? '+' : ''}${(Math.round(f.perWeek * 100) / 100).toFixed(2)} kg pro Woche, heute ${kg(f.at(0))} kg ± ${kg(f.band(0))} kg (80 %)`)
        if (goal !== null) summary.push(f.goalInDays !== null ? `Prognose Zielgewicht um ${dateDe(dayPlus(today, f.goalInDays))} (in ${f.goalInDays} Tagen; Band dort ± ${kg(f.band(f.goalInDays))} kg)` : 'Prognose: Ziel wird mit dem aktuellen Trend innerhalb eines Jahres nicht erreicht')
      } else {
        summary.push('Trend: zu wenig Messungen (mindestens 4 in den letzten 28 Tagen über mindestens 7 Tage)')
      }
      return `${summary.join('\n')}\n\nEinträge ${dateDe(from)} bis ${dateDe(to)} (${inRange.length}, neueste zuerst)\n${lines.join('\n') || 'keine'}`
    }
    case 'get_targets': {
      const n = parseNutrition(d.settings.get('nutrition_targets'))
      const shares = parseTrainingShares(d.settings.get('training_shares'))
      const weekly = parseWeeklyGoal(d.settings.get('weekly_goal'))
      const goal = parseGoalWeight(d.settings.get('goal_weight'))
      return [
        `Zielgewicht: ${goal !== null ? `${kg(goal)} kg` : 'nicht gesetzt'}`,
        `Bedarf ${thousands(n.needKcal)} kcal, Defizitziel ${thousands(n.deficitKcal)} kcal, Tagesziel ${thousands(n.needKcal - n.deficitKcal)} kcal`,
        `Protein mindestens ${n.proteinG} g`,
        `Kreatin: ${n.creatine ? `${kg(n.creatine.doseG)} g täglich seit ${dateDe(n.creatine.since)}` : 'nicht eingetragen'}`,
        `Automatische Einträge: Shake ${n.shake ? 'an' : 'aus'}, Espressi Mo–Fr ${n.espresso ? 'an' : 'aus'}`,
        `Training: Warm-up ${shares.warmUp} %, Back-off ${shares.backOff} % des Top Sets; Wochenziel ${weekly.strength} Krafttrainings${weekly.run ? `, ${weekly.run} Läufe` : ''}`,
      ].join('\n')
    }
    default:
      throw new Error(`Unknown tool ${name}`)
  }
}
