// Progression table in Stats (decision 1 November 2026): every weight/reps exercise of the active workouts, once per
// main exercise, with the top set of the first and the latest workout (all variants count) and a status. Change and
// status use the estimated 1RM (Epley) of the top set, so more reps at the same weight count too.
// Since 5 November 2026 start, trend and change cover the last 4 weeks: the start is the last workout before the
// window (else the first one), so the change shows the current pace instead of the beginner phase.
import { db, type Exercise, type TemplateExercise } from './db'
import { loadAnalytics, type SetInfo } from './analytics'
import { topSetOf, type TopSet } from './report'
import { getTemplateOrder, sortByOrder } from './settings'
import { effectiveReps, epley } from './stats'

export type ProgressStatus = 'new' | 'strong' | 'good' | 'flat' | 'stalled' | 'lower'

export interface ProgressPointE1 {
  date: string
  top: TopSet
  e1rm: number
}

export interface PlanProgressRow {
  mainId: string
  title: string
  subtitle: string
  unilateral: boolean
  first: TopSet | null
  latest: TopSet | null
  /** Change of the estimated 1RM over the last 4 weeks in percent; null with fewer than 2 workouts there */
  changePct: number | null
  status: ProgressStatus
  /** Stalled: date of the last new best */
  since: string | null
  series: number[]
}

const DAY = 86_400_000
/** Window of start, trend and change (decision 5 November 2026) */
export const PROGRESS_WINDOW_DAYS = 28
/** Thresholds within the window: below ±2.5 % flat, from +10 % strong */
const FLAT = 0.025
const STRONG = 0.1
/** Workouts without a new best before an exercise counts as stalled, and the minimum time since that best */
const STALL_SESSIONS = 4
const STALL_DAYS = 14

/** «Chest Press (Machine)» → title «Chest Press», detail «Machine». */
export function splitName(name: string): { title: string; detail: string | null } {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(name)
  return m ? { title: m[1]!, detail: m[2]! } : { title: name, detail: null }
}

/** Points of the window: the last workout before it as the start (if any), then every workout inside it. */
export function windowPoints<T extends { date: string }>(points: T[], now: Date, days = PROGRESS_WINDOW_DAYS): T[] {
  const start = now.getTime() - days * DAY
  let base = -1
  points.forEach((p, i) => {
    if (Date.parse(p.date) < start) base = i
  })
  return base === -1 ? points : points.slice(base)
}

/**
 * Status from the series of top sets, oldest first (thresholds: docs/entscheidungen.md, 1 and 5 November 2026).
 * Plateau (stalled) looks at the whole series; change, flat, good, strong and lower at the last 4 weeks.
 */
export function progressStatus(points: ProgressPointE1[], now: Date): { status: ProgressStatus; since: string | null; changePct: number | null } {
  if (points.length < 2) return { status: 'new', since: null, changePct: null }
  const win = windowPoints(points, now)
  const change = win.length >= 2 ? (win[win.length - 1]!.e1rm - win[0]!.e1rm) / win[0]!.e1rm : null
  const changePct = change === null ? null : Math.round(change * 100)
  if (points.length < 3) return { status: 'new', since: null, changePct }
  let best = -Infinity
  let bestIndex = 0
  points.forEach((p, i) => {
    if (p.e1rm > best + 0.01) {
      best = p.e1rm
      bestIndex = i
    }
  })
  const after = points.length - 1 - bestIndex
  const since = points[bestIndex]!.date
  if (after >= STALL_SESSIONS && now.getTime() - Date.parse(since) >= STALL_DAYS * DAY) return { status: 'stalled', since, changePct }
  if (change === null || Math.abs(change) < FLAT) return { status: 'flat', since: null, changePct }
  return { status: change >= STRONG ? 'strong' : change > 0 ? 'good' : 'lower', since: null, changePct }
}

/** Top set per workout of one main exercise, oldest first. */
export function topSetSeries(sets: SetInfo[], mainId: string): ProgressPointE1[] {
  const byWorkout = new Map<string, SetInfo[]>()
  for (const s of sets) {
    if (s.mainId !== mainId || s.trackingType !== 'weight_reps' || s.set.set_type !== 'working') continue
    const list = byWorkout.get(s.workoutId) ?? []
    list.push(s)
    byWorkout.set(s.workoutId, list)
  }
  const out: ProgressPointE1[] = []
  for (const list of byWorkout.values()) {
    const top = topSetOf(list.map((x) => x.set))
    const e1rm = top ? epley(top.weight, effectiveReps({ reps: top.reps, reps_left: top.repsLeft, reps_right: top.repsRight })) : null
    if (top && e1rm !== null) out.push({ date: list[0]!.date, top, e1rm })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Rows for the given plan entries (template exercises in display order). */
export function buildPlanProgress(entries: Pick<TemplateExercise, 'exercise_id'>[], exercises: Exercise[], sets: SetInfo[], now: Date): PlanProgressRow[] {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const rows: PlanProgressRow[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const ex = byId.get(entry.exercise_id)
    if (!ex || ex.deleted_at !== null) continue
    const main = ex.parent_id ? byId.get(ex.parent_id) ?? ex : ex
    if ((ex.tracking_type ?? main.tracking_type) !== 'weight_reps' || seen.has(main.id)) continue
    seen.add(main.id)
    const points = topSetSeries(sets, main.id)
    // Only exercises with at least one finished work set (decision 5 November 2026)
    if (points.length === 0) continue
    const { title, detail } = splitName(main.name)
    const altId = ex.alternative_id ?? main.alternative_id ?? null
    const alt = altId ? byId.get(altId) : undefined
    const altName = alt ? (splitName(alt.name).title === title ? splitName(alt.name).detail ?? alt.name : splitName(alt.name).title) : null
    const subtitle = [ex.parent_id ? ex.name : detail, altName ? `alt. ${altName}` : null].filter(Boolean).join(' · ')
    const { status, since, changePct } = progressStatus(points, now)
    const win = windowPoints(points, now)
    rows.push({
      mainId: main.id,
      title,
      subtitle,
      unilateral: ex.is_unilateral ?? main.is_unilateral ?? false,
      first: win.length > 1 ? win[0]!.top : null,
      latest: points.length ? points[points.length - 1]!.top : null,
      changePct,
      status,
      since,
      series: win.map((p) => p.e1rm),
    })
  }
  return rows
}

/** Active workouts in the user's order, their exercises by position. */
export async function loadPlanProgress(now: Date): Promise<PlanProgressRow[]> {
  const [templates, slots, exercises, order, data] = await Promise.all([
    db.template.toArray(),
    db.template_exercise.toArray(),
    db.exercise.toArray(),
    getTemplateOrder(),
    loadAnalytics(),
  ])
  const active = sortByOrder(templates.filter((t) => t.deleted_at === null && !t.archived_at), order)
  const entries = active.flatMap((t) => slots.filter((s) => s.template_id === t.id && s.deleted_at === null).sort((a, b) => a.position - b.position))
  return buildPlanProgress(entries, exercises, data.sets, now)
}
