import { db } from './db'
import { addDays, buildAnalytics, dayKey, weekStart, type AnalyticsData, type SetInfo, type WorkoutInfo } from './core/analytics'

import type { WeeklyGoal } from './settings'
import { effectiveReps, epley } from './stats'

export { buildAnalytics, dayKey, muscleLabel, setsPerMuscle, weekStart, weeklyVolume } from './core/analytics'
export type { AnalyticsData, ExerciseOption, MuscleSets, SetInfo, WeekValue, WorkoutInfo } from './core/analytics'

// Analytics for the Stats tab. Definitions: docs/00_handover.md (section Analytics-Definitionen).
// All calculations are pure functions over AnalyticsData so they can be tested without IndexedDB; the parts the Food
// connector needs live in core/analytics.ts.
// Weeks run Monday to Sunday in local time.

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
  /** Weight: reps of all working sets at the top weight, in set order. 1RM: reps of the best set */
  repsList: number[]
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
  const topSets = new Map<string, SetInfo[]>()
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
      repsList: [reps!],
    }
    const cur = best.get(x.workoutId)
    if (!cur || p.value > cur.value || (p.value === cur.value && p.reps > cur.reps)) best.set(x.workoutId, p)
    topSets.set(x.workoutId, [...(topSets.get(x.workoutId) ?? []), x])
  }
  const points = [...best.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (metric === 'weight') {
    for (const p of points) {
      p.repsList = (topSets.get(p.workoutId) ?? [])
        .filter((x) => x.set.weight === p.weight && x.exerciseId === p.exerciseId)
        .sort((a, b) => a.set.position - b.set.position)
        .map((x) => effectiveReps(x.set) ?? 0)
    }
  }
  return points
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

/** Scale 1–10 since 15 October 2026 (before 1–5; earlier values were kept unchanged). */
export const CROWD_MAX = 10
export const CROWD_LABEL: Record<number, string> = {
  1: 'Empty', 2: 'Empty', 3: 'Quiet', 4: 'Quiet', 5: 'Normal', 6: 'Normal', 7: 'Busy', 8: 'Busy', 9: 'Packed', 10: 'Packed',
}

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

/** Longest stretch a rating covers; a workout left open longer than this counts only up to it. */
export const CROWD_MAX_SPAN_MS = 3 * 60 * 60 * 1000

/**
 * Crowd ratings per weekday and two-hour slot (decision 19 November 2026): a rating holds for the whole workout, so it
 * counts in every slot from start to end (at most CROWD_MAX_SPAN_MS after the start), also for all earlier workouts.
 */
export function crowdGrid(workouts: WorkoutInfo[], from: number): CrowdSummary {
  const sums = Array.from({ length: 7 }, () => CROWD_SLOTS.map(() => ({ sum: 0, count: 0 })))
  let ratings = 0
  for (const w of workouts) {
    if (w.crowd === null || Date.parse(w.finishedAt) < from) continue
    const start = Date.parse(w.startedAt)
    const end = Math.max(start + 1, Math.min(Date.parse(w.finishedAt), start + CROWD_MAX_SPAN_MS))
    ratings++
    // Walk the slots the workout overlaps, slot by slot in local time
    const t = new Date(start)
    while (t.getTime() < end) {
      const hour = t.getHours()
      const slotIndex = CROWD_SLOTS.findIndex((s) => hour >= s.from && hour < s.to)
      const slot = CROWD_SLOTS[slotIndex]!
      const cell = sums[(t.getDay() + 6) % 7]![slotIndex]!
      cell.sum += w.crowd
      cell.count++
      t.setHours(slot.to, 0, 0, 0) // start of the next slot (hour 24 rolls over to the next day)
    }
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
