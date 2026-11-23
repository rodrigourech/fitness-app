// Analytics without database access (shared by the app and the Food connector, decision 23 November 2026).
// Definitions: docs/00_handover.md (section Analytics-Definitionen). Weeks run Monday to Sunday in local time.
import type { Exercise, TrackingType, Workout, WorkoutSet } from '../db'
import { displayName } from './exercise'

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

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
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
