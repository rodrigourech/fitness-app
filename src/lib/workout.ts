import { db, type Exercise, type Workout, type WorkoutExercise, type WorkoutSet } from './db'
import { saveRows } from './sync'

// Workout logging. A workout copies its template at start; later template edits do not affect it.

const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

function base(userId: string, ts: string) {
  return { user_id: userId, created_at: ts, updated_at: ts, deleted_at: null }
}

/** The unfinished workout on this device, if any. */
export async function getActiveWorkout(): Promise<Workout | undefined> {
  const open = await db.workout.filter((w) => w.finished_at === null && w.deleted_at === null).toArray()
  return open.sort((a, b) => b.started_at.localeCompare(a.started_at))[0]
}

/**
 * Sets of the most recent finished workout containing the exercise.
 * In a finished workout every remaining set counts as done (open sets are discarded at finish;
 * imported history has no completed_at).
 */
export async function previousSets(exerciseId: string, excludeWorkoutId?: string): Promise<WorkoutSet[]> {
  const candidates = await db.workout_exercise
    .where('exercise_id')
    .equals(exerciseId)
    .filter((we) => we.deleted_at === null && we.workout_id !== excludeWorkoutId)
    .toArray()
  if (candidates.length === 0) return []
  const workouts = await db.workout.bulkGet(candidates.map((c) => c.workout_id))
  let best: { we: WorkoutExercise; started: string } | undefined
  candidates.forEach((we, i) => {
    const w = workouts[i]
    if (!w || w.deleted_at !== null || w.finished_at === null) return
    if (!best || w.started_at > best.started) best = { we, started: w.started_at }
  })
  if (!best) return []
  const bestId = best.we.id
  const sets = await db.workout_set
    .where('workout_exercise_id')
    .equals(bestId)
    .filter((s) => s.deleted_at === null)
    .toArray()
  return sets.sort((a, b) => a.position - b.position)
}

type Measure = Pick<WorkoutSet, 'weight' | 'reps' | 'reps_left' | 'reps_right' | 'duration_s' | 'distance_km'>

function measureOf(s: WorkoutSet): Measure {
  return {
    weight: s.weight,
    reps: s.reps,
    reps_left: s.reps_left,
    reps_right: s.reps_right,
    duration_s: s.duration_s,
    distance_km: s.distance_km,
  }
}

/** Starts a workout from a template. Inputs are prefilled with the last performance, else the template targets. */
export async function startWorkout(templateId: string, userId: string): Promise<Workout> {
  const template = await db.template.get(templateId)
  if (!template) throw new Error('Vorlage nicht gefunden')
  const ts = now()
  const workout: Workout = {
    id: uuid(),
    template_id: template.id,
    template_name_snapshot: template.name,
    started_at: ts,
    finished_at: null,
    note: null,
    ...base(userId, ts),
  }

  const tes = (await db.template_exercise.where('template_id').equals(templateId).toArray())
    .filter((te) => te.deleted_at === null)
    .sort((a, b) => a.position - b.position)

  const wes: WorkoutExercise[] = []
  const sets: WorkoutSet[] = []
  for (const te of tes) {
    const we: WorkoutExercise = {
      id: uuid(),
      workout_id: workout.id,
      exercise_id: te.exercise_id,
      position: te.position,
      rest_s: te.rest_s,
      comment: te.comment,
      ...base(userId, ts),
    }
    wes.push(we)
    const planned = (await db.template_set.where('template_exercise_id').equals(te.id).toArray())
      .filter((s) => s.deleted_at === null)
      .sort((a, b) => a.position - b.position)
    const prev = await previousSets(te.exercise_id)
    const prevWorking = prev.filter((s) => s.set_type === 'working')

    let workingIndex = 0
    for (const p of planned) {
      const source = p.set_type === 'working' ? (prevWorking[workingIndex] ?? prevWorking.at(-1)) : undefined
      if (p.set_type === 'working') workingIndex++
      const m: Measure = source
        ? measureOf(source)
        : {
            weight: p.target_weight,
            reps: p.target_reps_min,
            reps_left: p.target_reps_min,
            reps_right: p.target_reps_min,
            duration_s: p.target_duration_s,
            distance_km: p.target_distance_km,
          }
      sets.push({
        id: uuid(),
        workout_exercise_id: we.id,
        position: p.position,
        set_type: p.set_type,
        ...m,
        rir: null,
        completed_at: null,
        ...base(userId, ts),
      })
    }
  }

  await saveRows('workout', [workout])
  await saveRows('workout_exercise', wes)
  await saveRows('workout_set', sets)
  return workout
}

export async function updateSet(set: WorkoutSet, patch: Partial<WorkoutSet>): Promise<void> {
  const current = (await db.workout_set.get(set.id)) ?? set
  await saveRows('workout_set', [{ ...current, ...patch }])
}

/** Toggles a set. Returns true if the set is now completed. */
export async function toggleSetDone(set: WorkoutSet): Promise<boolean> {
  const current = (await db.workout_set.get(set.id)) ?? set
  const done = current.completed_at === null
  await saveRows('workout_set', [{ ...current, completed_at: done ? now() : null }])
  return done
}

export async function addSet(we: WorkoutExercise): Promise<void> {
  const sets = (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray()).filter(
    (s) => s.deleted_at === null,
  )
  const last = sets.sort((a, b) => a.position - b.position).at(-1)
  const ts = now()
  await saveRows('workout_set', [
    {
      id: uuid(),
      workout_exercise_id: we.id,
      position: (last?.position ?? 0) + 1,
      set_type: 'working',
      weight: last?.weight ?? null,
      reps: last?.reps ?? null,
      reps_left: last?.reps_left ?? null,
      reps_right: last?.reps_right ?? null,
      duration_s: last?.duration_s ?? null,
      distance_km: last?.distance_km ?? null,
      rir: null,
      completed_at: null,
      ...base(we.user_id, ts),
    } satisfies WorkoutSet,
  ])
}

/** Removes the last set of an exercise, preferring sets that are not completed. */
export async function removeLastSet(we: WorkoutExercise): Promise<void> {
  const sets = (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray())
    .filter((s) => s.deleted_at === null)
    .sort((a, b) => a.position - b.position)
  const target = [...sets].reverse().find((s) => s.completed_at === null) ?? sets.at(-1)
  if (target) await saveRows('workout_set', [{ ...target, deleted_at: now() }])
}

export async function updateWorkout(w: Workout, patch: Partial<Workout>): Promise<void> {
  const current = (await db.workout.get(w.id)) ?? w
  await saveRows('workout', [{ ...current, ...patch }])
}

async function workoutParts(workoutId: string) {
  const wes = (await db.workout_exercise.where('workout_id').equals(workoutId).toArray()).filter(
    (we) => we.deleted_at === null,
  )
  const sets = (await db.workout_set.where('workout_exercise_id').anyOf(wes.map((we) => we.id)).toArray()).filter(
    (s) => s.deleted_at === null,
  )
  return { wes, sets }
}

/** Number of sets that would be discarded when finishing. */
export async function openSetCount(workoutId: string): Promise<number> {
  const { sets } = await workoutParts(workoutId)
  return sets.filter((s) => s.completed_at === null).length
}

/** Finishes a workout: open sets and exercises without completed sets are discarded. */
export async function finishWorkout(w: Workout): Promise<void> {
  const ts = now()
  const { wes, sets } = await workoutParts(w.id)
  const open = sets.filter((s) => s.completed_at === null)
  const doneByExercise = new Set(sets.filter((s) => s.completed_at !== null).map((s) => s.workout_exercise_id))
  const emptyExercises = wes.filter((we) => !doneByExercise.has(we.id))
  if (open.length) await saveRows('workout_set', open.map((s) => ({ ...s, deleted_at: ts })))
  if (emptyExercises.length) await saveRows('workout_exercise', emptyExercises.map((we) => ({ ...we, deleted_at: ts })))
  await updateWorkout(w, { finished_at: ts })
}

/** Discards the whole workout (soft delete). */
export async function cancelWorkout(w: Workout): Promise<void> {
  const ts = now()
  const { wes, sets } = await workoutParts(w.id)
  if (sets.length) await saveRows('workout_set', sets.map((s) => ({ ...s, deleted_at: ts })))
  if (wes.length) await saveRows('workout_exercise', wes.map((we) => ({ ...we, deleted_at: ts })))
  await updateWorkout(w, { deleted_at: ts })
}

/** Effective tracking settings and device settings of an exercise (variants inherit from the parent). */
export function effective(ex: Exercise, byId: Map<string, Exercise>) {
  const parent = ex.parent_id ? byId.get(ex.parent_id) : undefined
  return {
    trackingType: ex.tracking_type ?? parent?.tracking_type ?? 'weight_reps',
    isUnilateral: ex.is_unilateral ?? parent?.is_unilateral ?? false,
    floor: ex.floor ?? parent?.floor ?? null,
    seat: ex.seat ?? parent?.seat ?? null,
    footPosition: ex.foot_position ?? parent?.foot_position ?? null,
    setupNote: ex.setup_note ?? parent?.setup_note ?? null,
  }
}

// --- formatting and parsing -------------------------------------------------------

/** Parses "12,5" or "12.5"; empty input gives null; invalid gives undefined. */
export function parseNumber(input: string): number | null | undefined {
  const s = input.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Parses "mm:ss", "h:mm:ss" or minutes ("7", "7,5") into seconds. */
export function parseDuration(input: string): number | null | undefined {
  const s = input.trim()
  if (s === '') return null
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p))
    if (parts.some((p) => !Number.isInteger(p) || p < 0)) return undefined
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  const minutes = parseNumber(s)
  return minutes == null ? minutes : Math.round(minutes * 60)
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const sec = seconds % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

export function formatNumber(n: number | null): string {
  return n === null ? '' : String(n)
}

/** Two short lines describing a set for the "Vorher" column. */
export function describeSet(s: WorkoutSet | undefined, trackingType: string, unilateral: boolean): [string, string] {
  if (!s) return ['–', '']
  if (trackingType === 'duration') return [formatDuration(s.duration_s), '']
  if (trackingType === 'distance_duration') return [`${s.distance_km ?? '–'} km`, formatDuration(s.duration_s)]
  const reps = unilateral ? `${s.reps_left ?? '–'} / ${s.reps_right ?? '–'}` : `× ${s.reps ?? '–'}`
  // Bodyweight sets have no weight: show only the repetitions
  return s.weight === null ? [reps, ''] : [`${s.weight} kg`, reps]
}
