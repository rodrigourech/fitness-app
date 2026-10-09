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
 * Sets of the most recent finished workout containing the exercise (skipped exercises do not count).
 * In a finished workout every remaining set counts as done (open sets are discarded at finish;
 * imported history has no completed_at).
 * With templateId, a workout of that template is preferred; other workouts are the fallback
 * (decision 9 October 2026: a Bonus Day uses lighter weights than the Main Days).
 */
export async function previousSets(exerciseId: string, excludeWorkoutId?: string, templateId?: string | null): Promise<WorkoutSet[]> {
  if (templateId) {
    const own = await latestSets(exerciseId, excludeWorkoutId, templateId)
    if (own.length) return own
  }
  return latestSets(exerciseId, excludeWorkoutId, null)
}

/** Like previousSets, but only workouts of this template (no fallback). */
export async function previousSetsOfTemplate(exerciseId: string, templateId: string, excludeWorkoutId?: string): Promise<WorkoutSet[]> {
  return latestSets(exerciseId, excludeWorkoutId, templateId)
}

async function latestSets(exerciseId: string, excludeWorkoutId: string | undefined, templateId: string | null): Promise<WorkoutSet[]> {
  const candidates = await db.workout_exercise
    .where('exercise_id')
    .equals(exerciseId)
    .filter((we) => we.deleted_at === null && !we.skipped_at && we.workout_id !== excludeWorkoutId)
    .toArray()
  if (candidates.length === 0) return []
  const workouts = await db.workout.bulkGet(candidates.map((c) => c.workout_id))
  let best: { we: WorkoutExercise; started: string } | undefined
  candidates.forEach((we, i) => {
    const w = workouts[i]
    if (!w || w.deleted_at !== null || w.finished_at === null) return
    if (templateId && w.template_id !== templateId) return
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

/** RIR the last working set starts with (training plan 9 October 2026: 1–2 in reserve, no failure). */
export const DEFAULT_RIR = 2

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
  // Only one running workout: a minimised one is continued instead of starting a second
  const running = await getActiveWorkout()
  if (running) return running
  const template = await db.template.get(templateId)
  if (!template) throw new Error('Template not found')
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
    // Prefill: last performance in this template; else the template targets; else any last performance
    const own = await previousSetsOfTemplate(te.exercise_id, templateId)
    const hasTargets = planned.some((p) => p.target_weight !== null)
    const prev = own.length || hasTargets ? own : await previousSets(te.exercise_id)
    const prevWorking = prev.filter((s) => s.set_type === 'working')
    const prevWarmup = prev.filter((s) => s.set_type === 'warmup')
    const lastWorking = planned.filter((p) => p.set_type === 'working').at(-1)

    let workingIndex = 0
    let warmupIndex = 0
    for (const p of planned) {
      const source =
        p.set_type === 'working'
          ? (prevWorking[workingIndex++] ?? prevWorking.at(-1))
          : (prevWarmup[warmupIndex++] ?? prevWarmup.at(-1))
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
        rir: p === lastWorking ? DEFAULT_RIR : null,
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

/** Appends an exercise to a running workout, with sets prefilled from the last performance. */
export async function addExerciseToWorkout(w: Workout, exerciseId: string): Promise<void> {
  const ex = await db.exercise.get(exerciseId)
  if (!ex) throw new Error('Exercise not found')
  const parent = ex.parent_id ? await db.exercise.get(ex.parent_id) : undefined
  const eff = effective(ex, new Map([[ex.id, ex], ...(parent ? ([[parent.id, parent]] as const) : [])]))
  const existing = (await db.workout_exercise.where('workout_id').equals(w.id).toArray()).filter((we) => we.deleted_at === null)
  const ts = now()
  const we: WorkoutExercise = {
    id: uuid(),
    workout_id: w.id,
    exercise_id: ex.id,
    position: Math.max(0, ...existing.map((e) => e.position)) + 1,
    rest_s: eff.restS,
    comment: null,
    ...base(w.user_id, ts),
  }
  const prev = (await previousSets(ex.id, w.id)).filter((s) => s.set_type === 'working')
  const count = prev.length || (eff.trackingType === 'weight_reps' ? 3 : 1)
  const sets: WorkoutSet[] = Array.from({ length: count }, (_, i) => {
    const p = prev[i] ?? prev.at(-1)
    return {
      id: uuid(),
      workout_exercise_id: we.id,
      position: i + 1,
      set_type: 'working',
      ...(p ? measureOf(p) : { weight: null, reps: null, reps_left: null, reps_right: null, duration_s: null, distance_km: null }),
      rir: i === count - 1 ? DEFAULT_RIR : null,
      completed_at: null,
      ...base(w.user_id, ts),
    }
  })
  await saveRows('workout_exercise', [we])
  await saveRows('workout_set', sets)
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
      // The new set becomes the last working set, which carries the RIR
      rir: last?.set_type === 'working' ? last.rir : DEFAULT_RIR,
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
  if (!target) return
  await saveRows('workout_set', [{ ...target, deleted_at: now() }])
  // Removing the last set skips the exercise (decision 9 October 2026); it stays in the history as skipped
  if (sets.length === 1) {
    const current = (await db.workout_exercise.get(we.id)) ?? we
    await saveRows('workout_exercise', [{ ...current, skipped_at: now() }])
  }
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

/** Number of sets that would be discarded when finishing (sets of skipped exercises do not count). */
export async function openSetCount(workoutId: string): Promise<number> {
  const { wes, sets } = await workoutParts(workoutId)
  const skipped = new Set(wes.filter((we) => we.skipped_at).map((we) => we.id))
  return sets.filter((s) => s.completed_at === null && !skipped.has(s.workout_exercise_id)).length
}

/** Finishes a workout: open sets and exercises without completed sets are discarded. */
export async function finishWorkout(w: Workout): Promise<void> {
  const ts = now()
  const { wes, sets } = await workoutParts(w.id)
  const open = sets.filter((s) => s.completed_at === null)
  const doneByExercise = new Set(sets.filter((s) => s.completed_at !== null).map((s) => s.workout_exercise_id))
  // Skipped exercises stay (shown as skipped in the history); their open sets are discarded
  const emptyExercises = wes.filter((we) => !doneByExercise.has(we.id) && !we.skipped_at)
  if (open.length) await saveRows('workout_set', open.map((s) => ({ ...s, deleted_at: ts })))
  if (emptyExercises.length) await saveRows('workout_exercise', emptyExercises.map((we) => ({ ...we, deleted_at: ts })))
  await updateWorkout(w, { finished_at: ts })
}

/** Skips an exercise as a whole in a running workout; only possible while none of its sets is done. */
export async function skipExercise(we: WorkoutExercise): Promise<void> {
  const current = (await db.workout_exercise.get(we.id)) ?? we
  const sets = await db.workout_set.where('workout_exercise_id').equals(we.id).toArray()
  if (sets.some((s) => s.deleted_at === null && s.completed_at !== null)) throw new Error('Some sets are already done.')
  await saveRows('workout_exercise', [{ ...current, skipped_at: now() }])
}

/** Undoes a skip; if no set is left, the most recently removed set comes back. */
export async function unskipExercise(we: WorkoutExercise): Promise<void> {
  const current = (await db.workout_exercise.get(we.id)) ?? we
  await saveRows('workout_exercise', [{ ...current, skipped_at: null }])
  const sets = await db.workout_set.where('workout_exercise_id').equals(we.id).toArray()
  if (sets.some((s) => s.deleted_at === null)) return
  const last = sets.filter((s) => s.deleted_at !== null).sort((a, b) => b.deleted_at!.localeCompare(a.deleted_at!))[0]
  if (last) await saveRows('workout_set', [{ ...last, deleted_at: null }])
  else await addSet(current)
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
    focusMuscles: ex.focus_muscles ?? parent?.focus_muscles ?? [],
    focusCue: ex.focus_cue ?? parent?.focus_cue ?? null,
    restS: ex.default_rest_s ?? parent?.default_rest_s ?? null,
    weightStep: ex.weight_step ?? parent?.weight_step ?? null,
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

/** Pace in seconds per km, or null if distance or duration is missing. */
export function paceSeconds(durationS: number | null, distanceKm: number | null): number | null {
  if (durationS === null || distanceKm === null || distanceKm <= 0) return null
  return Math.round(durationS / distanceKm)
}

/**
 * Applies a manually entered pace: with a distance the duration is derived,
 * otherwise with a duration the distance is derived.
 */
export function applyPace(
  paceS: number,
  distanceKm: number | null,
  durationS: number | null,
): { duration_s?: number; distance_km?: number } {
  if (paceS <= 0) return {}
  if (distanceKm !== null && distanceKm > 0) return { duration_s: Math.round(paceS * distanceKm) }
  if (durationS !== null && durationS > 0) return { distance_km: Math.round((durationS / paceS) * 100) / 100 }
  return {}
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
