import { db, displayName, type Exercise, type TrackingType, type Workout, type WorkoutSet } from './db'
import type { WeeklyGoal } from './settings'
import { effectiveReps, epley } from './stats'

// Analytics for the Stats tab. Definitions: docs/00_handover.md (section Analytics-Definitionen).
// All calculations are pure functions over AnalyticsData so they can be tested without IndexedDB.
// Weeks run Monday to Sunday in local time.

export interface WorkoutInfo {
  id: string
  startedAt: string
  finishedAt: string
  crowd: number | null
  /** Contains at least one completed working set of a weight/reps exercise */
  strength: boolean
  /** Contains at least one completed set of a distance/duration exercise */
  run: boolean
}

export interface SetInfo {
  workoutId: string
  /** Start of the workout (ISO) */
  date: string
  exerciseId: string
  /** Main exercise (the exercise itself if it is not a variant) */
  mainId: string
  trackingType: TrackingType
  unilateral: boolean
  primary: string[]
  secondary: string[]
  set: WorkoutSet
}

export interface ExerciseOption {
  mainId: string
  name: string
  variants: { id: string; name: string }[]
}

export interface AnalyticsData {
  workouts: WorkoutInfo[]
  sets: SetInfo[]
  /** Weight/reps exercises with data, grouped by main exercise */
  exercises: ExerciseOption[]
  /** Display name per exercise id ("Parent – Variant" for variants) */
  names: Map<string, string>
}

const DAY = 86_400_000

// --- loading -----------------------------------------------------------------

/** Sets of finished, non-deleted workouts with the effective exercise settings. */
export async function loadAnalytics(): Promise<AnalyticsData> {
  const [workouts, wes, sets, exercises] = await Promise.all([
    db.workout.toArray(),
    db.workout_exercise.toArray(),
    db.workout_set.toArray(),
    db.exercise.toArray(),
  ])
  return buildAnalytics(workouts, wes, sets, exercises)
}

export function buildAnalytics(
  workouts: Workout[],
  wes: { id: string; workout_id: string; exercise_id: string; deleted_at: string | null }[],
  sets: WorkoutSet[],
  exercises: Exercise[],
): AnalyticsData {
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const finished = new Map(workouts.filter((w) => w.deleted_at === null && w.finished_at !== null).map((w) => [w.id, w]))
  const weById = new Map(wes.filter((we) => we.deleted_at === null && finished.has(we.workout_id)).map((we) => [we.id, we]))

  const out: SetInfo[] = []
  for (const s of sets) {
    // All remaining sets of a finished workout count: finishing discards unchecked sets, and
    // workouts imported from Strong carry no completed_at
    if (s.deleted_at !== null) continue
    const we = weById.get(s.workout_exercise_id)
    const ex = we && byId.get(we.exercise_id)
    if (!we || !ex) continue
    const parent = ex.parent_id ? byId.get(ex.parent_id) : undefined
    out.push({
      workoutId: we.workout_id,
      date: finished.get(we.workout_id)!.started_at,
      exerciseId: ex.id,
      mainId: parent?.id ?? ex.id,
      trackingType: ex.tracking_type ?? parent?.tracking_type ?? 'weight_reps',
      unilateral: ex.is_unilateral ?? parent?.is_unilateral ?? false,
      primary: ex.muscles_primary ?? parent?.muscles_primary ?? [],
      secondary: ex.muscles_secondary ?? parent?.muscles_secondary ?? [],
      set: s,
    })
  }

  const infos: WorkoutInfo[] = [...finished.values()].map((w) => {
    const mine = out.filter((x) => x.workoutId === w.id)
    return {
      id: w.id,
      startedAt: w.started_at,
      finishedAt: w.finished_at!,
      crowd: w.crowd_level ?? null,
      strength: mine.some((x) => x.trackingType === 'weight_reps' && x.set.set_type === 'working'),
      run: mine.some((x) => x.trackingType === 'distance_duration'),
    }
  })

  const names = new Map(exercises.map((e) => [e.id, displayName(e, byId)]))
  const groups = new Map<string, Set<string>>()
  for (const x of out) {
    if (x.trackingType !== 'weight_reps') continue
    if (!groups.has(x.mainId)) groups.set(x.mainId, new Set())
    if (x.exerciseId !== x.mainId) groups.get(x.mainId)!.add(x.exerciseId)
  }
  const options: ExerciseOption[] = [...groups.entries()]
    .map(([mainId, variants]) => ({
      mainId,
      name: byId.get(mainId)?.name ?? 'Unknown exercise',
      variants: [...variants].map((id) => ({ id, name: byId.get(id)?.name ?? id })).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { workouts: infos, sets: out, exercises: options, names }
}

// --- dates -------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Monday 00:00 local time of the week containing d. */
export function weekStart(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7))
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

// --- weekly goal ---------------------------------------------------------------

export interface GoalDay {
  date: string
  strength: boolean
  run: boolean
  future: boolean
}

export interface GoalWeek {
  start: string
  days: GoalDay[]
  strength: number
  run: number
  met: boolean
  current: boolean
}

export interface GoalSummary {
  /** Oldest first */
  weeks: GoalWeek[]
  /** Consecutive weeks with the goal met, ending with the current week (if met) or the last week */
  streak: number
  thisWeek: GoalWeek
}

export function weeklyGoal(workouts: WorkoutInfo[], weeks: number, now: Date, goal: WeeklyGoal): GoalSummary {
  const byDay = new Map<string, { strength: boolean; run: boolean }>()
  for (const w of workouts) {
    const key = dayKey(new Date(w.startedAt))
    const cur = byDay.get(key) ?? { strength: false, run: false }
    byDay.set(key, { strength: cur.strength || w.strength, run: cur.run || w.run })
  }

  const build = (start: Date, current: boolean): GoalWeek => {
    const days: GoalDay[] = []
    let strength = 0
    let run = 0
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i)
      const key = dayKey(d)
      const v = byDay.get(key) ?? { strength: false, run: false }
      // A day counts once per kind: two strength workouts on the same day are one session
      if (v.strength) strength++
      if (v.run) run++
      days.push({ date: key, ...v, future: d.getTime() > now.getTime() })
    }
    return { start: dayKey(start), days, strength, run, met: strength >= goal.strength && run >= goal.run, current }
  }

  const thisStart = weekStart(now)
  const list: GoalWeek[] = []
  for (let i = weeks - 1; i >= 0; i--) list.push(build(addDays(thisStart, -7 * i), i === 0))

  // Streak over the full history, not only the displayed weeks
  const first = workouts.length ? weekStart(new Date(Math.min(...workouts.map((w) => Date.parse(w.startedAt))))) : thisStart
  let streak = 0
  let cursor = build(thisStart, true).met ? thisStart : addDays(thisStart, -7)
  while (cursor.getTime() >= first.getTime() && build(cursor, false).met) {
    streak++
    cursor = addDays(cursor, -7)
  }

  return { weeks: list, streak, thisWeek: list[list.length - 1]! }
}

// --- strength progression -------------------------------------------------------

/** weight = heaviest working set of a workout; e1rm = best estimated 1RM (Epley) of a workout */
export type Metric = 'weight' | 'e1rm'

export interface ProgressPoint {
  workoutId: string
  date: string
  /** Value of the chosen metric */
  value: number
  /** The set behind the value */
  weight: number
  reps: number
  e1rm: number
  exerciseId: string
}

/**
 * One point per workout for a main exercise (all variants) or a single variant, oldest first.
 * Weight: the heaviest working set (more reps break ties). 1RM: the set with the best Epley estimate.
 */
export function progressSeries(
  sets: SetInfo[],
  mainId: string,
  variantId: string | null,
  from: number,
  metric: Metric,
): ProgressPoint[] {
  const best = new Map<string, ProgressPoint>()
  for (const x of sets) {
    if (x.mainId !== mainId || x.trackingType !== 'weight_reps' || x.set.set_type !== 'working') continue
    if (variantId !== null && x.exerciseId !== variantId) continue
    if (Date.parse(x.date) < from) continue
    const reps = effectiveReps(x.set)
    const e = epley(x.set.weight, reps)
    if (e === null) continue
    const p: ProgressPoint = {
      workoutId: x.workoutId,
      date: x.date,
      value: metric === 'weight' ? x.set.weight! : e,
      weight: x.set.weight!,
      reps: reps!,
      e1rm: e,
      exerciseId: x.exerciseId,
    }
    const cur = best.get(x.workoutId)
    if (!cur || p.value > cur.value || (p.value === cur.value && p.reps > cur.reps)) best.set(x.workoutId, p)
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export interface ProgressRow {
  mainId: string
  name: string
  points: ProgressPoint[]
  latest: number
  /** latest minus first value in the period */
  change: number
  lastDate: string
}

/** Progression of every exercise with data in the period, most recently trained first. */
export function progressOverview(data: AnalyticsData, from: number, metric: Metric): ProgressRow[] {
  return data.exercises
    .map((e) => {
      const points = progressSeries(data.sets, e.mainId, null, from, metric)
      const first = points[0]
      const last = points.at(-1)
      return first && last
        ? { mainId: e.mainId, name: e.name, points, latest: last.value, change: last.value - first.value, lastDate: last.date }
        : null
    })
    .filter((r): r is ProgressRow => r !== null)
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name))
}

// --- volume --------------------------------------------------------------------

export interface WeekValue {
  start: string
  value: number
}

/** Volume per week (working sets, weight * reps; one-sided sets count both sides), oldest first. */
export function weeklyVolume(sets: SetInfo[], from: number, now: Date): WeekValue[] {
  const weeks = new Map<string, number>()
  const last = weekStart(now)
  for (let d = weekStart(new Date(from)); d.getTime() <= last.getTime(); d = addDays(d, 7)) weeks.set(dayKey(d), 0)
  for (const x of sets) {
    const s = x.set
    if (x.trackingType !== 'weight_reps' || s.set_type !== 'working' || s.weight === null) continue
    const key = dayKey(weekStart(new Date(x.date)))
    if (!weeks.has(key)) continue
    const reps = s.reps ?? (s.reps_left ?? 0) + (s.reps_right ?? 0)
    weeks.set(key, weeks.get(key)! + s.weight * reps)
  }
  return [...weeks.entries()].map(([start, value]) => ({ start, value }))
}

// --- sets per muscle group -------------------------------------------------------

export interface MuscleSets {
  muscle: string
  sets: number
}

/** Working sets per muscle group in one week: 1 for primary, 0.5 for secondary involvement. */
export function setsPerMuscle(sets: SetInfo[], weekStartKey: string): MuscleSets[] {
  const out = new Map<string, number>()
  for (const x of sets) {
    if (x.set.set_type !== 'working' || x.trackingType === 'distance_duration') continue
    if (dayKey(weekStart(new Date(x.date))) !== weekStartKey) continue
    for (const m of x.primary) if (m !== 'cardio') out.set(m, (out.get(m) ?? 0) + 1)
    for (const m of x.secondary) if (m !== 'cardio' && !x.primary.includes(m)) out.set(m, (out.get(m) ?? 0) + 0.5)
  }
  return [...out.entries()].map(([muscle, n]) => ({ muscle, sets: n })).sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle))
}

/** "front_delts" -> "Front delts" */
export function muscleLabel(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// --- side comparison -------------------------------------------------------------

export interface SideComparison {
  exerciseId: string
  left: number
  right: number
  sets: number
  /** (right - left) / max(left, right), e.g. -0.1 = right side 10 % weaker */
  diff: number
}

/** Reps per side of one-sided working sets with both sides recorded. */
export function sideComparison(sets: SetInfo[], from: number): SideComparison[] {
  const out = new Map<string, { left: number; right: number; sets: number }>()
  for (const x of sets) {
    const s = x.set
    if (!x.unilateral || s.set_type !== 'working' || s.reps_left === null || s.reps_right === null) continue
    if (Date.parse(x.date) < from) continue
    const cur = out.get(x.exerciseId) ?? { left: 0, right: 0, sets: 0 }
    out.set(x.exerciseId, { left: cur.left + s.reps_left, right: cur.right + s.reps_right, sets: cur.sets + 1 })
  }
  return [...out.entries()].map(([exerciseId, v]) => ({
    exerciseId,
    ...v,
    diff: Math.max(v.left, v.right) > 0 ? (v.right - v.left) / Math.max(v.left, v.right) : 0,
  }))
}

// --- gym crowd -------------------------------------------------------------------

/** Time slots for the crowd heatmap (local time of finishing the workout). */
export const CROWD_SLOTS = [
  { label: '<8', from: 0, to: 8 },
  { label: '8–10', from: 8, to: 10 },
  { label: '10–12', from: 10, to: 12 },
  { label: '12–14', from: 12, to: 14 },
  { label: '14–16', from: 14, to: 16 },
  { label: '16–18', from: 16, to: 18 },
  { label: '18–20', from: 18, to: 20 },
  { label: '20+', from: 20, to: 24 },
] as const

export const CROWD_LABEL: Record<number, string> = { 1: 'Empty', 2: 'Quiet', 3: 'Normal', 4: 'Busy', 5: 'Packed' }

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

export interface CrowdCell {
  weekday: number
  slot: number
  avg: number | null
  count: number
}

export interface CrowdSummary {
  /** cells[weekday][slot], weekday 0 = Monday */
  cells: CrowdCell[][]
  ratings: number
  /** Least crowded cell with at least two ratings, else with one */
  best: CrowdCell | null
}

export function crowdGrid(workouts: WorkoutInfo[], from: number): CrowdSummary {
  const sums = Array.from({ length: 7 }, () => CROWD_SLOTS.map(() => ({ sum: 0, count: 0 })))
  let ratings = 0
  for (const w of workouts) {
    if (w.crowd === null || Date.parse(w.finishedAt) < from) continue
    const d = new Date(w.finishedAt)
    const weekday = (d.getDay() + 6) % 7
    const hour = d.getHours()
    const slot = CROWD_SLOTS.findIndex((s) => hour >= s.from && hour < s.to)
    const cell = sums[weekday]![slot]!
    cell.sum += w.crowd
    cell.count++
    ratings++
  }
  const cells = sums.map((row, weekday) =>
    row.map((c, slot) => ({ weekday, slot, count: c.count, avg: c.count ? c.sum / c.count : null })),
  )
  const rated = cells.flat().filter((c) => c.avg !== null)
  const pick = (min: number) =>
    rated.filter((c) => c.count >= min).sort((a, b) => a.avg! - b.avg! || b.count - a.count)[0] ?? null
  return { cells, ratings, best: pick(2) ?? pick(1) }
}

// --- ranges ----------------------------------------------------------------------

export type Range = '1m' | '3m' | '1y' | 'all'

export const RANGE_LABEL: Record<Range, string> = { '1m': '4 weeks', '3m': '3 months', '1y': '1 year', all: 'All' }

/** Start timestamp of a range; 'all' starts at the first workout. */
export function rangeStart(range: Range, now: Date, workouts: WorkoutInfo[]): number {
  if (range === 'all') {
    const first = Math.min(...workouts.map((w) => Date.parse(w.startedAt)))
    return Number.isFinite(first) ? weekStart(new Date(first)).getTime() : weekStart(now).getTime()
  }
  const days = range === '1m' ? 28 : range === '3m' ? 91 : 365
  return weekStart(new Date(now.getTime() - (days - 1) * DAY)).getTime()
}
