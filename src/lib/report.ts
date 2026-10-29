// Workout report after «Finish workout» and in Stats › Reports (decisions 19 and 29 October 2026).
// Strength: duration (against the last workout of the same template), sets done of planned and records; one row per
// exercise with the top set of the last time this exercise or variant was trained, today's top set and the weight for
// the next workout. Skipped exercises get a row without today's values. Volume is no longer shown (it mostly follows
// which exercises were done) but still decides whether a workout is a run.
import { db, type Workout, type WorkoutExercise, type WorkoutSet } from './db'
import { progressionAdvice, type ProgressionAdvice } from './progression'
import { bestBefore, recordsOf } from './stats'
import { lowerWeight, nextWeight } from './topset'
import { repetitionTargets } from './training'
import { effective, recentTrainingSessions, type TrainingSession } from './workout'

export interface ReportTotals {
  durationS: number | null
  /** Weight × reps of the done work sets; one-sided sets count both sides */
  volume: number
  /** Done work sets */
  sets: number
  /** Work sets of the workout including those dropped at the finish */
  planned: number
  distanceKm: number
  runS: number
}

/** Heaviest done work set; on a tie the one with the most reps (the weaker side on one-sided sets). */
export interface TopSet {
  weight: number
  reps: number | null
  repsLeft: number | null
  repsRight: number | null
}

export interface ReportLine {
  exerciseId: string
  name: string
  /** done: at least one work set with weight; skipped: skipped or no done work set */
  status: 'done' | 'skipped'
  unilateral: boolean
  /** Top set today; null when skipped */
  today: TopSet | null
  /** Top set of the last earlier workout with this exercise or variant (any workout); null the first time */
  last: TopSet | null
  /** Heaviest weight of the done work sets (the top set); 0 when skipped */
  current: number
  /** Weight for the next workout; null on a change without a weight step */
  next: number | null
  advice: Exclude<ProgressionAdvice, null>
  record: boolean
}

export interface WorkoutReport {
  workout: Workout
  name: string
  kind: 'strength' | 'run'
  totals: ReportTotals
  /** Last finished workout of the same template before this one */
  previous: ReportTotals | null
  lines: ReportLine[]
  records: number
}

interface Parts {
  wes: WorkoutExercise[]
  sets: WorkoutSet[]
}

async function partsOf(w: Workout): Promise<Parts> {
  const wes = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).filter((we) => we.deleted_at === null)
  const all = await db.workout_set.where('workout_exercise_id').anyOf(wes.map((we) => we.id)).toArray()
  // Open sets are discarded at the finish with deleted_at = finished_at; they still count as planned
  const sets = all.filter((s) => s.deleted_at === null || (w.finished_at !== null && s.deleted_at === w.finished_at))
  return { wes, sets }
}

/** Totals of a workout; sets include those discarded at the finish (deleted_at = finished_at), which count as planned. */
export function totalsOf(w: Workout, { sets }: Pick<Parts, 'sets'>): ReportTotals {
  const work = sets.filter((s) => s.set_type === 'working')
  // After the finish every remaining set counts as done (imported history has no completed_at)
  const done = work.filter((s) => s.deleted_at === null)
  let volume = 0
  let distanceKm = 0
  let runS = 0
  for (const s of done) {
    if (s.weight !== null) volume += s.weight * (s.reps ?? (s.reps_left ?? 0) + (s.reps_right ?? 0))
    if (s.distance_km !== null) {
      distanceKm += s.distance_km
      runS += s.duration_s ?? 0
    }
  }
  const durationS = w.finished_at ? Math.max(0, Math.round((Date.parse(w.finished_at) - Date.parse(w.started_at)) / 1000)) : null
  return { durationS, volume: Math.round(volume), sets: done.length, planned: work.length, distanceKm: Math.round(distanceKm * 100) / 100, runS }
}

async function previousOf(w: Workout): Promise<Workout | null> {
  if (!w.template_id) return null
  const list = (await db.workout.where('template_id').equals(w.template_id).toArray())
    .filter((x) => x.id !== w.id && x.deleted_at === null && x.finished_at !== null && x.started_at < w.started_at)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  return list[0] ?? null
}

/** Reps that count for comparing: reps, or the weaker side of a one-sided set. */
function repsOf(s: Pick<WorkoutSet, 'reps' | 'reps_left' | 'reps_right'>): number {
  if (s.reps !== null) return s.reps
  const sides = [s.reps_left, s.reps_right].filter((r): r is number => r !== null)
  return sides.length ? Math.min(...sides) : 0
}

/** Top set of the given work sets: heaviest weight, then most reps; null without a weight above 0. */
export function topSetOf(sets: Pick<WorkoutSet, 'set_type' | 'weight' | 'reps' | 'reps_left' | 'reps_right'>[]): TopSet | null {
  let best: (typeof sets)[number] | null = null
  for (const s of sets) {
    if (s.set_type !== 'working' || s.weight === null || s.weight <= 0) continue
    if (!best || s.weight > best.weight! || (s.weight === best.weight && repsOf(s) > repsOf(best))) best = s
  }
  return best ? { weight: best.weight!, reps: best.reps, repsLeft: best.reps_left, repsRight: best.reps_right } : null
}

/** Change of the top set against the last time: «+2 reps», «+5 kg», «+5 kg · −1 rep», «=». */
export function topSetChange(today: TopSet, last: TopSet): { text: string; tone: 'up' | 'down' | 'same' } {
  const kg = Math.round((today.weight - last.weight) * 10) / 10
  const reps = repsOf({ reps: today.reps, reps_left: today.repsLeft, reps_right: today.repsRight })
    - repsOf({ reps: last.reps, reps_left: last.repsLeft, reps_right: last.repsRight })
  const sign = (n: number) => (n > 0 ? '+' : '−') + Math.abs(n)
  const parts = [
    ...(kg !== 0 ? [`${sign(kg)} kg`] : []),
    ...(reps !== 0 ? [`${sign(reps)} ${Math.abs(reps) === 1 ? 'rep' : 'reps'}`] : []),
  ]
  const tone = kg > 0 ? 'up' : kg < 0 ? 'down' : reps > 0 ? 'up' : reps < 0 ? 'down' : 'same'
  return { text: parts.length ? parts.join(' · ') : '=', tone }
}

/** Report of a finished workout, or null if it does not exist (any more). */
export async function workoutReport(workoutId: string): Promise<WorkoutReport | null> {
  const w = await db.workout.get(workoutId)
  if (!w || w.deleted_at !== null || w.finished_at === null) return null
  const exercises = await db.exercise.toArray()
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const parts = await partsOf(w)
  const totals = totalsOf(w, parts)
  const prev = await previousOf(w)
  const previous = prev ? totalsOf(prev, await partsOf(prev)) : null

  const lines: ReportLine[] = []
  let records = 0
  for (const we of [...parts.wes].sort((a, b) => a.position - b.position)) {
    const ex = byId.get(we.exercise_id)
    if (!ex) continue
    const eff = effective(ex, byId)
    if (eff.trackingType !== 'weight_reps') continue
    const main = ex.parent_id ? byId.get(ex.parent_id) ?? ex : ex
    const before = await recentTrainingSessions(we.exercise_id, undefined, w.id, 1)
    const last = before[0] ? topSetOf(before[0].sets) : null
    const mine = parts.sets.filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null).sort((a, b) => a.position - b.position)
    const work = mine.filter((s) => s.set_type === 'working').map((s) => ({ ...s, completed_at: s.completed_at ?? w.finished_at }))
    const current = Math.max(0, ...work.map((s) => s.weight ?? 0))
    if (we.skipped_at || !work.length || current <= 0) {
      lines.push({ exerciseId: ex.id, name: main.name, status: 'skipped', unilateral: eff.isUnilateral, today: null, last, current: 0, next: null, advice: 'hold', record: false })
      continue
    }
    // Progression as it stood right after this workout: this performance plus the one before it
    const session: TrainingSession = { workout: w, exercise: we, sets: mine }
    const sessions = [session, ...before]
    const planned = parts.sets.filter((s) => s.workout_exercise_id === we.id && s.set_type === 'working').length
    const defaults = repetitionTargets(ex, byId, [])
    const targets = { target: we.target_reps ?? defaults.target, minimum: we.min_reps ?? defaults.minimum }
    const advice = progressionAdvice(sessions, targets, eff.isUnilateral, planned, eff.topSet) ?? 'hold'
    const step = eff.weightStep
    const next = advice === 'hold' ? current : !step ? null : advice === 'increase' ? nextWeight(current, step) : lowerWeight(current, step)
    const best = await bestBefore(we.exercise_id, w.id, w.started_at)
    const record = work.some((s) => recordsOf(s, best).length > 0)
    if (record) records++
    lines.push({ exerciseId: ex.id, name: main.name, status: 'done', unilateral: eff.isUnilateral, today: topSetOf(work), last, current, next, advice, record })
  }
  const kind = totals.volume === 0 && totals.distanceKm > 0 ? 'run' : 'strength'
  return { workout: w, name: w.template_name_snapshot ?? 'Workout', kind, totals, previous, lines, records }
}

/** Reports of all finished workouts, newest first. */
export async function workoutReports(): Promise<WorkoutReport[]> {
  const workouts = (await db.workout.toArray())
    .filter((w) => w.deleted_at === null && w.finished_at !== null)
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
  const out: WorkoutReport[] = []
  for (const w of workouts) {
    const r = await workoutReport(w.id)
    if (r) out.push(r)
  }
  return out
}

/** Change against the previous workout in percent, rounded; null without a comparable value. */
export function percentChange(now: number, before: number | null | undefined): number | null {
  return before ? Math.round(((now - before) / before) * 100) : null
}

/** Minutes as «58 min» or «1 h 05». */
export function formatMinutes(seconds: number | null): string {
  if (seconds === null) return '–'
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** Volume with a thin space as thousands separator: 5 640. */
export function formatVolume(kg: number): string {
  return String(Math.round(kg)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')
}
