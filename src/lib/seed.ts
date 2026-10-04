import history from '../../seed/history.json'
import plan from '../../seed/trainingsplan.json'
import {
  db,
  getMeta,
  setMeta,
  type Exercise,
  type SyncTable,
  type Template,
  type TemplateExercise,
  type TemplateSet,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
} from './db'

// Seed rows carry a fixed timestamp so that any later edit wins (last write wins).
const SEED_VERSION = '1'

type Row = { id: string }

function stamp(userId: string, ts: string) {
  return { user_id: userId, created_at: ts, updated_at: ts, deleted_at: null }
}

/** Imports seed/trainingsplan.json and seed/history.json once per device and user. */
export async function importSeedIfNeeded(userId: string): Promise<boolean> {
  if ((await getMeta('seed_version')) === SEED_VERSION) return false

  const ts = plan.seed_timestamp
  const s = stamp(userId, ts)

  const exercises: Exercise[] = plan.exercises.map((e) => ({
    id: e.id,
    parent_id: e.parent_id,
    name: e.name,
    equipment: e.equipment,
    muscles_primary: e.muscles_primary,
    muscles_secondary: e.muscles_secondary,
    tracking_type: e.tracking_type as Exercise['tracking_type'],
    is_unilateral: e.is_unilateral,
    weight_step: e.weight_step,
    default_rest_s: e.default_rest_s,
    floor: e.floor as Exercise['floor'],
    seat: e.seat,
    foot_position: e.foot_position,
    setup_note: e.setup_note,
    source_id: e.source_id,
    ...s,
  }))

  const templates: Template[] = []
  const templateExercises: TemplateExercise[] = []
  const templateSets: TemplateSet[] = []
  for (const t of plan.templates) {
    templates.push({ id: t.id, name: t.name, note: t.note, ...s })
    for (const te of t.exercises) {
      templateExercises.push({
        id: te.id,
        template_id: t.id,
        exercise_id: te.exercise_id,
        position: te.position,
        rest_s: te.rest_s,
        comment: te.comment,
        ...s,
      })
      for (const ts_ of te.sets) {
        templateSets.push({
          id: ts_.id,
          template_exercise_id: te.id,
          position: ts_.position,
          set_type: ts_.set_type as TemplateSet['set_type'],
          target_reps_min: ts_.target_reps_min,
          target_reps_max: ts_.target_reps_max,
          target_weight: ts_.target_weight,
          target_duration_s: ts_.target_duration_s,
          target_distance_km: ts_.target_distance_km,
          ...s,
        })
      }
    }
  }

  const hs = stamp(userId, history.seed_timestamp)
  const workouts: Workout[] = []
  const workoutExercises: WorkoutExercise[] = []
  const workoutSets: WorkoutSet[] = []
  for (const w of history.workouts) {
    workouts.push({
      id: w.id,
      template_id: w.template_id,
      template_name_snapshot: w.template_name_snapshot,
      started_at: w.started_at,
      finished_at: w.finished_at,
      note: w.note,
      ...hs,
    })
    for (const we of w.exercises) {
      workoutExercises.push({
        id: we.id,
        workout_id: w.id,
        exercise_id: we.exercise_id,
        position: we.position,
        rest_s: we.rest_s,
        comment: we.comment,
        ...hs,
      })
      for (const ws of we.sets) {
        workoutSets.push({
          id: ws.id,
          workout_exercise_id: we.id,
          position: ws.position,
          set_type: ws.set_type as WorkoutSet['set_type'],
          weight: ws.weight,
          reps: ws.reps,
          reps_left: ws.reps_left,
          reps_right: ws.reps_right,
          rir: ws.rir,
          duration_s: ws.duration_s,
          distance_km: ws.distance_km,
          completed_at: ws.completed_at,
          ...hs,
        })
      }
    }
  }

  const batches: [SyncTable, Row[]][] = [
    ['exercise', exercises],
    ['template', templates],
    ['template_exercise', templateExercises],
    ['template_set', templateSets],
    ['workout', workouts],
    ['workout_exercise', workoutExercises],
    ['workout_set', workoutSets],
  ]

  const now = new Date().toISOString()
  await db.transaction('rw', [...batches.map(([t]) => db.table(t)), db.outbox, db.meta], async () => {
    for (const [table, rows] of batches) {
      // Keep local rows that are newer than the seed (e.g. already edited or pulled)
      const existing = await db.table(table).bulkGet(rows.map((r) => r.id))
      const fresh = rows.filter((_, i) => existing[i] === undefined)
      await db.table(table).bulkPut(fresh)
      await db.outbox.bulkPut(fresh.map((r) => ({ table, row_id: r.id, queued_at: now })))
    }
    await setMeta('seed_version', SEED_VERSION)
  })
  return true
}
