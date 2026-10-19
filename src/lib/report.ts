// Workout report after «Finish workout» and in Stats › Reports (decision 19 October 2026).
// Three numbers against the last workout of the same template (duration, volume, sets done of planned);
// strength workouts list one line per exercise with today's weight and the weight for the next workout.
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

export interface ReportLine {
  exerciseId: string
  name: string
  /** Heaviest weight of the done work sets (the top set) */
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

function totalsOf(w: Workout, { sets }: Parts): ReportTotals {
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
    if (!ex || we.skipped_at) continue
    const eff = effective(ex, byId)
    if (eff.trackingType !== 'weight_reps') continue
    const mine = parts.sets.filter((s) => s.workout_exercise_id === we.id && s.deleted_at === null).sort((a, b) => a.position - b.position)
    const work = mine.filter((s) => s.set_type === 'working').map((s) => ({ ...s, completed_at: s.completed_at ?? w.finished_at }))
    const current = Math.max(0, ...work.map((s) => s.weight ?? 0))
    if (!work.length || current <= 0) continue
    // Progression as it stood right after this workout: this performance plus the one before it
    const session: TrainingSession = { workout: w, exercise: we, sets: mine }
    const sessions = [session, ...(await recentTrainingSessions(we.exercise_id, undefined, w.id, 1))]
    const planned = parts.sets.filter((s) => s.workout_exercise_id === we.id && s.set_type === 'working').length
    const defaults = repetitionTargets(ex, byId, [])
    const targets = { target: we.target_reps ?? defaults.target, minimum: we.min_reps ?? defaults.minimum }
    const advice = progressionAdvice(sessions, targets, eff.isUnilateral, planned, eff.topSet) ?? 'hold'
    const step = eff.weightStep
    const next = advice === 'hold' ? current : !step ? null : advice === 'increase' ? nextWeight(current, step) : lowerWeight(current, step)
    const best = await bestBefore(we.exercise_id, w.id, w.started_at)
    const record = work.some((s) => recordsOf(s, best).length > 0)
    if (record) records++
    const main = ex.parent_id ? byId.get(ex.parent_id) ?? ex : ex
    lines.push({ exerciseId: ex.id, name: main.name, current, next, advice, record })
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
