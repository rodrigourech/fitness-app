// Markdown export for AI chats (decision 22 October 2026).
// One workout: header with context, comparison with the last workout of the same template (as in the report),
// then every exercise with all sets next to the sets of the last earlier workout containing that exercise
// (as the column Previous). History: summary, body weight, current plan and every workout in the period.
// The text is built from one in-memory snapshot, so it can be prepared before the tap (iOS needs the clipboard
// write inside the tap).
import { CONDITION_LABEL } from './body'
import {
  db,
  displayName,
  type BodyWeight,
  type Exercise,
  type Template,
  type TemplateExercise,
  type TemplateSet,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from './db'
import { belowMinimum } from './progression'
import { formatMinutes, percentChange, totalsOf, type ReportTotals } from './report'
import { getTemplateOrder, getTrainingShares, sortByOrder, type TrainingShares } from './settings'
import { volume } from './stats'
import { poundStep, topIndex } from './topset'
import { repetitionTargets } from './training'
import { effective, formatDuration, paceSeconds } from './workout'

export type ExportRange = '7d' | '30d' | 'all'

export const EXPORT_RANGES: { key: ExportRange; label: string; title: string; days: number | null }[] = [
  { key: '7d', label: '7 days', title: 'Last 7 days', days: 7 },
  { key: '30d', label: '30 days', title: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', title: 'All time', days: null },
]

export interface ExportData {
  byId: Map<string, Exercise>
  /** Finished workouts, oldest first */
  workouts: Workout[]
  /** Exercises per workout, by position */
  wes: Map<string, WorkoutExercise[]>
  /** Sets per workout exercise by position, including sets discarded at the finish (deleted_at = finished_at) */
  sets: Map<string, WorkoutSet[]>
  /** One entry per day (latest edit wins), oldest first */
  body: BodyWeight[]
  /** Active templates in the stored order */
  templates: Template[]
  templateExercises: Map<string, TemplateExercise[]>
  templateSets: Map<string, TemplateSet[]>
  shares: TrainingShares
}

function group<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = out.get(k)
    if (list) list.push(r)
    else out.set(k, [r])
  }
  return out
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

/** Reads everything the export needs in one go. */
export async function loadExportData(): Promise<ExportData> {
  const [exercises, workoutRows, weRows, setRows, bodyRows, templateRows, teRows, tsRows, shares, order] = await Promise.all([
    db.exercise.toArray(),
    db.workout.toArray(),
    db.workout_exercise.toArray(),
    db.workout_set.toArray(),
    db.body_weight.toArray(),
    db.template.toArray(),
    db.template_exercise.toArray(),
    db.template_set.toArray(),
    getTrainingShares(),
    getTemplateOrder(),
  ])
  const workouts = workoutRows
    .filter((w) => w.deleted_at === null && w.finished_at !== null)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
  const workoutById = new Map(workouts.map((w) => [w.id, w]))
  const wesList = weRows.filter((we) => we.deleted_at === null && workoutById.has(we.workout_id)).sort(byPosition)
  const weById = new Map(wesList.map((we) => [we.id, we]))
  const setList = setRows
    .filter((s) => {
      const we = weById.get(s.workout_exercise_id)
      if (!we) return false
      return s.deleted_at === null || s.deleted_at === workoutById.get(we.workout_id)!.finished_at
    })
    .sort(byPosition)

  const byDay = new Map<string, BodyWeight>()
  for (const b of bodyRows) {
    if (b.deleted_at !== null) continue
    const cur = byDay.get(b.measured_on)
    if (!cur || b.updated_at > cur.updated_at) byDay.set(b.measured_on, b)
  }

  const templates = sortByOrder(
    templateRows.filter((t) => t.deleted_at === null && !t.archived_at),
    order,
  )
  return {
    byId: new Map(exercises.map((e) => [e.id, e])),
    workouts,
    wes: group(wesList, (we) => we.workout_id),
    sets: group(setList, (s) => s.workout_exercise_id),
    body: [...byDay.values()].sort((a, b) => a.measured_on.localeCompare(b.measured_on)),
    templates,
    templateExercises: group(teRows.filter((te) => te.deleted_at === null).sort(byPosition), (te) => te.template_id),
    templateSets: group(tsRows.filter((s) => s.deleted_at === null).sort(byPosition), (s) => s.template_exercise_id),
    shares,
  }
}

// --- formatting ---------------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const shortFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

const fmtDate = (d: Date | string) => dateFormat.format(typeof d === 'string' ? new Date(d) : d).replace(',', '')
const fmtShort = (d: Date | string) => shortFormat.format(typeof d === 'string' ? new Date(d) : d).replace(',', '')
const fmtTime = (iso: string) => timeFormat.format(new Date(iso))
/** Calendar day (YYYY-MM-DD) as a local date, so a day entry is shown as written */
const dayDate = (day: string) => new Date(`${day}T12:00:00`)

/** Local calendar day of a timestamp as YYYY-MM-DD. */
export function localDay(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

const DAY = 86_400_000
const num = (n: number) => String(Math.round(n * 100) / 100)
const kg = (n: number) => `${num(n)} kg`
const signed = (n: number, unit = '') => `${n > 0 ? '+' : ''}${num(n)}${unit}`
const pct = (now: number, before: number | null | undefined) => {
  const p = percentChange(now, before)
  return p === null ? '–' : `${p > 0 ? '+' : ''}${p} %`
}
/** Table cell: no pipes or line breaks */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' / ')
const row = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`
const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => '---')), ...rows.map(row)]
const heading = (level: number, text: string) => `${'#'.repeat(Math.min(level, 6))} ${text}`
const repRange = (min: number, max: number) => (min === max ? String(max) : `${min}–${max}`)
const oneLine = (s: string) => s.trim().replace(/\s*\n\s*/g, ' / ')

function stepLabel(step: number | null): string | null {
  if (!step) return null
  const lb = poundStep(step)
  return lb ? `${num(step)} kg (${lb} lb)` : kg(step)
}

const LEGEND = [
  'Notes for reading: weights in kg. W = warm-up set (not counted in volume, progression or records).',
  'Volume = weight × reps of the work sets; one-sided sets count both sides.',
  'Previous = the last earlier workout that contained the same exercise or variant (any workout).',
  '«below min» = reps under the minimum of the rep range.',
]

// --- one workout ----------------------------------------------------------------------

interface Session {
  workout: Workout
  we: WorkoutExercise
  sets: WorkoutSet[]
}

const done = (sets: WorkoutSet[] | undefined) => (sets ?? []).filter((s) => s.deleted_at === null)

function workoutSets(data: ExportData, w: Workout): WorkoutSet[] {
  return (data.wes.get(w.id) ?? []).flatMap((we) => data.sets.get(we.id) ?? [])
}

function totals(data: ExportData, w: Workout): ReportTotals {
  return totalsOf(w, { sets: workoutSets(data, w) })
}

function kindOf(t: ReportTotals): 'strength' | 'run' {
  return t.volume === 0 && t.distanceKm > 0 ? 'run' : 'strength'
}

/** Last earlier workout of the same template (as in the report). */
function previousOfTemplate(data: ExportData, w: Workout): Workout | null {
  if (!w.template_id) return null
  return data.workouts.filter((x) => x.id !== w.id && x.template_id === w.template_id && x.started_at < w.started_at).at(-1) ?? null
}

/** Last earlier performance of the exact exercise or variant in any workout (as the column Previous). */
function previousSession(data: ExportData, exerciseId: string, w: Workout): Session | null {
  for (let i = data.workouts.length - 1; i >= 0; i--) {
    const x = data.workouts[i]!
    if (x.id === w.id || x.started_at >= w.started_at) continue
    for (const we of data.wes.get(x.id) ?? []) {
      if (we.exercise_id !== exerciseId || we.skipped_at) continue
      const sets = done(data.sets.get(we.id))
      if (sets.some((s) => s.set_type === 'working')) return { workout: x, we, sets }
    }
  }
  return null
}

function bodyWeightLine(data: ExportData, w: Workout): string | null {
  const day = localDay(w.started_at)
  const entry = data.body.find((b) => b.measured_on === day)
  if (entry) return `Body weight ${kg(entry.weight_kg)}${entry.condition ? ` (${CONDITION_LABEL[entry.condition]})` : ''}`
  const t = Date.parse(day)
  const window = data.body.filter((b) => {
    const d = Date.parse(b.measured_on)
    return d <= t && d > t - 7 * DAY
  })
  if (!window.length) return null
  const avg = window.reduce((s, b) => s + b.weight_kg, 0) / window.length
  return `Body weight ${kg(Math.round(avg * 10) / 10)} (7-day average, no entry that day)`
}

interface Kind {
  trackingType: string
  unilateral: boolean
  minReps: number | null
}

function result(s: WorkoutSet, k: Kind): string {
  if (k.trackingType === 'duration') return formatDuration(s.duration_s) || '–'
  if (k.trackingType === 'distance_duration') {
    const pace = paceSeconds(s.duration_s, s.distance_km)
    return [s.distance_km !== null ? `${num(s.distance_km)} km` : '– km', formatDuration(s.duration_s) || '–', ...(pace !== null ? [`${formatDuration(pace)} /km`] : [])].join(' · ')
  }
  const reps = k.unilateral ? `L ${s.reps_left ?? '–'} / R ${s.reps_right ?? '–'}` : `${s.reps ?? '–'}`
  const base = s.weight === null ? `${reps} reps` : `${kg(s.weight)} × ${reps}`
  const low =
    s.set_type === 'working' &&
    (k.unilateral ? belowMinimum(s.reps_left, k.minReps) || belowMinimum(s.reps_right, k.minReps) : belowMinimum(s.reps, k.minReps))
  return low ? `${base} (below min)` : base
}

function comparison(data: ExportData, w: Workout, level: number): string[] {
  if (!w.template_id) return []
  const name = w.template_name_snapshot ?? 'Workout'
  const prev = previousOfTemplate(data, w)
  if (!prev) return [heading(level, `Compared with last ${name}`), '', `First ${name} in the app, nothing to compare.`, '']
  const now = totals(data, w)
  const before = totals(data, prev)
  const rows =
    kindOf(now) === 'run'
      ? [
          ['Distance', `${num(now.distanceKm)} km`, `${num(before.distanceKm)} km`, pct(now.distanceKm, before.distanceKm)],
          ['Run time', formatDuration(now.runS) || '–', formatDuration(before.runS) || '–', pct(now.runS, before.runS)],
          [
            'Pace',
            ...[now, before].map((t) => {
              const p = paceSeconds(t.runS, t.distanceKm)
              return p === null ? '–' : `${formatDuration(p)} /km`
            }),
            '',
          ],
        ]
      : [
          ['Duration', formatMinutes(now.durationS), formatMinutes(before.durationS), now.durationS !== null ? pct(now.durationS, before.durationS) : '–'],
          ['Volume', kg(now.volume), kg(before.volume), pct(now.volume, before.volume)],
          ['Work sets', `${now.sets} of ${now.planned}`, `${before.sets} of ${before.planned}`, signed(now.sets - before.sets)],
        ]
  return [heading(level, `Compared with last ${name} (${fmtDate(prev.started_at)})`), '', ...table(['Metric', 'This workout', 'Last', 'Change'], rows), '']
}

function exerciseBlock(data: ExportData, w: Workout, we: WorkoutExercise, index: number, level: number): string[] {
  const ex = data.byId.get(we.exercise_id)
  const name = ex ? displayName(ex, data.byId) : 'Unknown exercise'
  if (we.skipped_at) return [heading(level, `${index}. ${name} (skipped)`), '']
  const eff = ex ? effective(ex, data.byId) : null
  const k: Kind = {
    trackingType: eff?.trackingType ?? 'weight_reps',
    unilateral: eff?.isUnilateral ?? false,
    minReps: (eff?.trackingType ?? 'weight_reps') === 'weight_reps' ? we.min_reps ?? eff?.minReps ?? null : null,
  }
  const weightReps = k.trackingType === 'weight_reps'
  const facts = [
    ...(weightReps && we.min_reps != null && we.target_reps != null ? [`Rep range ${repRange(we.min_reps, we.target_reps)}`] : []),
    ...(weightReps && eff?.topSet ? ['Top set + back-off sets'] : []),
    ...(k.unilateral ? ['One-sided (left and right)'] : []),
    ...(we.rest_s ? [`Rest ${we.rest_s} s`] : []),
    ...(weightReps && stepLabel(eff?.weightStep ?? null) ? [`Weight step ${stepLabel(eff!.weightStep)}`] : []),
  ]
  const original = we.original_exercise_id ? data.byId.get(we.original_exercise_id) : undefined
  const out = [heading(level, `${index}. ${name}${original ? ` (alternative for ${displayName(original, data.byId)})` : ''}`), '']
  if (facts.length) out.push(facts.join(' · '), '')

  const mine = done(data.sets.get(we.id))
  const prev = previousSession(data, we.exercise_id, w)
  const warm = mine.filter((s) => s.set_type === 'warmup')
  const work = mine.filter((s) => s.set_type === 'working')
  const prevWarm = prev?.sets.filter((s) => s.set_type === 'warmup') ?? []
  const prevWork = prev?.sets.filter((s) => s.set_type === 'working') ?? []
  const top = weightReps && eff?.topSet ? topIndex(work.map((s) => s.weight)) : -1
  const rows: string[][] = []
  for (let i = 0; i < Math.max(warm.length, prevWarm.length); i++) {
    rows.push(['W', warm[i] ? 'Warm-up' : '', warm[i] ? result(warm[i]!, k) : '–', ...(prev ? [prevWarm[i] ? result(prevWarm[i]!, k) : '–'] : [])])
  }
  for (let i = 0; i < Math.max(work.length, prevWork.length); i++) {
    const type = !work[i] ? '' : top === -1 ? 'Work' : i === top ? 'Top' : 'Back-off'
    rows.push([String(i + 1), type, work[i] ? result(work[i]!, k) : '–', ...(prev ? [prevWork[i] ? result(prevWork[i]!, k) : '–'] : [])])
  }
  if (!rows.length) out.push('No sets recorded.', '')
  else {
    const prevHead = prev ? [`Previous (${prev.workout.template_name_snapshot ?? 'Workout'}, ${fmtShort(prev.workout.started_at)})`] : []
    out.push(...table(['Set', 'Type', 'Result', ...prevHead], rows), '')
  }

  const summary = [`${work.length} work ${work.length === 1 ? 'set' : 'sets'}`]
  if (weightReps && work.some((s) => s.weight !== null)) {
    summary.push(`volume ${kg(volume(work))}${prev ? ` (previous ${kg(volume(prevWork))})` : ''}`)
  }
  if (k.trackingType === 'distance_duration') {
    const km = work.reduce((s, x) => s + (x.distance_km ?? 0), 0)
    if (km > 0) summary.push(`${num(km)} km`)
  }
  out.push(`Total ${summary.join(', ')}`)
  if (!prev) out.push('No earlier workout with this exercise.')
  if (we.comment?.trim()) out.push(`Comment: ${oneLine(we.comment)}`)
  out.push('')
  return out
}

function workoutSection(data: ExportData, w: Workout, level: number): string[] {
  const name = w.template_name_snapshot ?? 'Workout'
  const t = totals(data, w)
  const facts = [
    `Time ${fmtTime(w.started_at)}${w.finished_at ? `–${fmtTime(w.finished_at)}` : ''} (${formatMinutes(t.durationS)})`,
    ...(kindOf(t) === 'strength' ? [`Volume ${kg(t.volume)}, ${t.sets} of ${t.planned} work sets done`] : []),
    ...(t.distanceKm > 0 ? [`Run ${num(t.distanceKm)} km in ${formatDuration(t.runS)}`] : []),
    ...(w.crowd_level ? [`Gym crowd ${w.crowd_level}/10`] : []),
    ...(bodyWeightLine(data, w) ? [bodyWeightLine(data, w)!] : []),
    ...(w.note?.trim() ? [`Note: ${oneLine(w.note)}`] : []),
  ]
  const out = [heading(level, `${name} · ${fmtDate(w.started_at)}`), '', ...facts.map((f) => `- ${f}`), '']
  out.push(...comparison(data, w, level + 1))
  ;(data.wes.get(w.id) ?? []).forEach((we, i) => out.push(...exerciseBlock(data, w, we, i + 1, level + 1)))
  return out
}

const finish = (lines: string[]) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'

/** One finished workout as Markdown, or null if it does not exist (any more). */
export function workoutMarkdown(data: ExportData, workoutId: string): string | null {
  const w = data.workouts.find((x) => x.id === workoutId)
  if (!w) return null
  return finish([...workoutSection(data, w, 1), ...LEGEND.map((l) => `> ${l}`)])
}

// --- history --------------------------------------------------------------------------

/** Monday of the local week of a date, as YYYY-MM-DD. */
function weekStart(d: Date): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return localDay(x)
}

/** Start of the period; null = all time. */
export function rangeStart(range: ExportRange, now: Date): Date | null {
  const days = EXPORT_RANGES.find((r) => r.key === range)?.days ?? null
  return days === null ? null : new Date(now.getTime() - days * DAY)
}

/** Finished workouts in the period, oldest first. */
export function workoutsInRange(data: ExportData, range: ExportRange, now: Date): Workout[] {
  const from = rangeStart(range, now)
  return data.workouts.filter((w) => !from || Date.parse(w.started_at) >= from.getTime())
}

function summary(data: ExportData, list: Workout[], from: Date, now: Date): string[] {
  const out = [heading(2, 'Summary'), '']
  const perName = new Map<string, number>()
  for (const w of list) perName.set(w.template_name_snapshot ?? 'Workout', (perName.get(w.template_name_snapshot ?? 'Workout') ?? 0) + 1)
  const all = list.map((w) => ({ w, t: totals(data, w) }))
  const strength = all.filter((x) => kindOf(x.t) === 'strength')
  const runs = all.filter((x) => x.t.distanceKm > 0)
  out.push(`- Workouts ${list.length} (${[...perName].map(([n, c]) => `${n} ${c}`).join(', ')})`)
  if (strength.length) {
    out.push(
      `- Strength ${strength.length} workouts, ${strength.reduce((s, x) => s + x.t.sets, 0)} work sets, volume ${kg(strength.reduce((s, x) => s + x.t.volume, 0))}`,
    )
  }
  if (runs.length) {
    const km = runs.reduce((s, x) => s + x.t.distanceKm, 0)
    const sec = runs.reduce((s, x) => s + x.t.runS, 0)
    const pace = paceSeconds(sec, km)
    out.push(`- Runs ${runs.length}, ${num(km)} km in ${formatDuration(sec)}${pace !== null ? ` (${formatDuration(pace)} /km)` : ''}`)
  }
  out.push('')

  // Weeks from Monday, including weeks without a workout
  const weeks: string[] = []
  for (let d = new Date(`${weekStart(from)}T12:00:00`); localDay(d) <= weekStart(now); d.setDate(d.getDate() + 7)) weeks.push(localDay(d))
  const weekRows = weeks.map((wk) => {
    const inWeek = all.filter((x) => weekStart(new Date(x.w.started_at)) === wk)
    return [
      `${fmtShort(dayDate(wk))} ${wk.slice(0, 4)}`,
      String(inWeek.length),
      String(inWeek.reduce((s, x) => s + x.t.sets, 0)),
      kg(inWeek.reduce((s, x) => s + x.t.volume, 0)),
    ]
  })
  out.push(heading(3, 'Per week (from Monday)'), '', ...table(['Week', 'Workouts', 'Work sets', 'Volume'], weekRows), '')

  // Top set (heaviest work set, most reps at that weight) per exercise or variant: first and last in the period
  const tops = new Map<string, { name: string; first: string; firstKg: number; last: string; lastKg: number; sessions: number }>()
  for (const w of list) {
    for (const we of data.wes.get(w.id) ?? []) {
      const ex = data.byId.get(we.exercise_id)
      if (!ex || we.skipped_at || effective(ex, data.byId).trackingType !== 'weight_reps') continue
      const work = done(data.sets.get(we.id)).filter((s) => s.set_type === 'working' && s.weight !== null && s.weight > 0)
      if (!work.length) continue
      const maxKg = Math.max(...work.map((s) => s.weight!))
      const best = work.filter((s) => s.weight === maxKg).sort((a, b) => repsOf(b) - repsOf(a))[0]!
      const label = `${kg(maxKg)} × ${best.reps ?? `L ${best.reps_left ?? '–'} / R ${best.reps_right ?? '–'}`} (${fmtShort(w.started_at)})`
      const cur = tops.get(ex.id)
      if (cur) Object.assign(cur, { last: label, lastKg: maxKg, sessions: cur.sessions + 1 })
      else tops.set(ex.id, { name: displayName(ex, data.byId), first: label, firstKg: maxKg, last: label, lastKg: maxKg, sessions: 1 })
    }
  }
  if (tops.size) {
    const rows = [...tops.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => [t.name, String(t.sessions), t.first, t.last, signed(t.lastKg - t.firstKg, ' kg')])
    out.push(heading(3, 'Top set per exercise'), '', ...table(['Exercise', 'Workouts', 'First', 'Last', 'Change'], rows), '')
  }
  return out
}

const repsOf = (s: WorkoutSet) => s.reps ?? Math.min(s.reps_left ?? 0, s.reps_right ?? 0)

function bodySection(data: ExportData, from: Date | null): string[] {
  const day = from ? localDay(from) : ''
  const entries = data.body.filter((b) => b.measured_on >= day)
  const out = [heading(2, 'Body weight'), '']
  if (!entries.length) return [...out, 'No entries in this period.', '']
  const first = entries[0]!
  const last = entries.at(-1)!
  if (entries.length > 1) out.push(`From ${kg(first.weight_kg)} to ${kg(last.weight_kg)} (${signed(Math.round((last.weight_kg - first.weight_kg) * 10) / 10, ' kg')})`, '')
  const rows = entries.map((b) => [fmtDate(dayDate(b.measured_on)), num(b.weight_kg), b.condition ? CONDITION_LABEL[b.condition] : '', b.note?.trim() ?? ''])
  out.push(...table(['Date', 'kg', 'Condition', 'Note'], rows), '')
  return out
}

function planSection(data: ExportData): string[] {
  const out = [
    heading(2, 'Current plan'),
    '',
    `Training settings: warm-up set at ${data.shares.warmUp} % and back-off sets at ${data.shares.backOff} % of the top set.`,
    '',
  ]
  if (!data.templates.length) return [...out, 'No active workouts.', '']
  for (const t of data.templates) {
    out.push(heading(3, t.name), '')
    if (t.note?.trim()) out.push(`Note: ${oneLine(t.note)}`, '')
    const tes = data.templateExercises.get(t.id) ?? []
    if (!tes.length) {
      out.push('No exercises.', '')
      continue
    }
    const rows = tes.map((te, i) => {
      const ex = data.byId.get(te.exercise_id)
      if (!ex) return [String(i + 1), 'Unknown exercise', '', '', '', '', '']
      const eff = effective(ex, data.byId)
      const planned = data.templateSets.get(te.id) ?? []
      const working = planned.filter((s) => s.set_type === 'working').length
      const weightReps = eff.trackingType === 'weight_reps'
      const targets = repetitionTargets(ex, data.byId, planned)
      const rest = te.rest_s ?? eff.restS
      return [
        String(i + 1),
        displayName(ex, data.byId) + (te.comment?.trim() ? ` (${oneLine(te.comment)})` : ''),
        `${weightReps && eff.warmUp ? 'W + ' : ''}${working}`,
        weightReps ? repRange(targets.minimum, targets.target) : '–',
        weightReps ? (eff.topSet ? 'yes' : 'no') : '–',
        rest ? `${rest} s` : '–',
        (weightReps && stepLabel(eff.weightStep)) || '–',
      ]
    })
    out.push(...table(['#', 'Exercise', 'Sets', 'Reps', 'Top set', 'Rest', 'Weight step'], rows), '')
  }
  return out
}

/** All workouts in the period with summary, body weight and current plan as Markdown. */
export function historyMarkdown(data: ExportData, range: ExportRange, now = new Date()): string {
  const title = EXPORT_RANGES.find((r) => r.key === range)!.title
  const list = workoutsInRange(data, range, now)
  const from = rangeStart(range, now) ?? (list[0] ? new Date(list[0].started_at) : now)
  const out = [
    heading(1, `Training history · ${title}`),
    '',
    `Period ${fmtDate(from)} to ${fmtDate(now)} · exported ${fmtDate(now)}, ${fmtTime(now.toISOString())}`,
    '',
    ...LEGEND.map((l) => `> ${l}`),
    '',
  ]
  if (list.length) out.push(...summary(data, list, from, now))
  out.push(...bodySection(data, rangeStart(range, now)))
  out.push(...planSection(data))
  out.push(heading(2, 'Workouts (oldest first)'), '')
  if (!list.length) out.push('No workouts in this period.', '')
  for (const w of list) out.push(...workoutSection(data, w, 3))
  return finish(out)
}
