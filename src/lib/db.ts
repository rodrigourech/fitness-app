import Dexie, { type EntityTable } from 'dexie'

// Local schema mirrors docs/03_datenmodell.md. Field names match Postgres columns.

export type TrackingType = 'weight_reps' | 'duration' | 'distance_duration'
export type SetType = 'warmup' | 'working'
export type Floor = 'oben' | 'unten'

interface SyncColumns {
  id: string
  user_id: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface Exercise extends SyncColumns {
  parent_id: string | null
  name: string
  equipment: string | null
  muscles_primary: string[] | null
  muscles_secondary: string[] | null
  tracking_type: TrackingType | null
  is_unilateral: boolean | null
  weight_step: number | null
  default_rest_s: number | null
  floor: Floor | null
  seat: string | null
  foot_position: string | null
  setup_note: string | null
  source_id: string | null
  /** Regions of the body map to feel (mind-muscle connection); null on a variant = inherit */
  focus_muscles: string[] | null
  focus_cue: string | null
}

export interface ExerciseLink extends SyncColumns {
  exercise_id: string
  url: string
  title: string | null
}

export interface Template extends SyncColumns {
  name: string
  note: string | null
}

export interface TemplateExercise extends SyncColumns {
  template_id: string
  exercise_id: string
  position: number
  rest_s: number | null
  comment: string | null
}

export interface TemplateSet extends SyncColumns {
  template_exercise_id: string
  position: number
  set_type: SetType
  target_reps_min: number | null
  target_reps_max: number | null
  target_weight: number | null
  target_duration_s: number | null
  target_distance_km: number | null
}

export interface Workout extends SyncColumns {
  template_id: string | null
  template_name_snapshot: string | null
  started_at: string
  finished_at: string | null
  note: string | null
  /** How crowded the gym was when leaving: 1 = empty … 5 = packed (migration 0007) */
  crowd_level?: number | null
}

export interface WorkoutExercise extends SyncColumns {
  workout_id: string
  exercise_id: string
  position: number
  rest_s: number | null
  comment: string | null
}

export interface WorkoutSet extends SyncColumns {
  workout_exercise_id: string
  position: number
  set_type: SetType
  weight: number | null
  reps: number | null
  reps_left: number | null
  reps_right: number | null
  rir: number | null
  duration_s: number | null
  distance_km: number | null
  completed_at: string | null
}

export type BodyCondition = 'morning_fasted' | 'after_workout' | 'after_meal' | 'other'

export interface BodyWeight extends SyncColumns {
  measured_on: string
  weight_kg: number
  /** Circumstance of the measurement (migration 0010) */
  condition?: BodyCondition | null
  note?: string | null
}

export type PhotoPose = 'front' | 'side' | 'back'

/** Metadata of an encrypted progress photo; the bytes live in the bucket body-photos (migration 0010). */
export interface BodyPhoto extends SyncColumns {
  measured_on: string
  pose: PhotoPose | null
  object_key: string
  /** AES-GCM nonce, base64 */
  iv: string
  mime: string
  width: number | null
  height: number | null
  bytes: number | null
}

/** Encrypted photo bytes on this device; uploaded = 0 until the proxy has stored them. */
export interface PhotoBlob {
  id: string
  data: ArrayBuffer
  uploaded: 0 | 1
}

/** Device-local secrets, e.g. the non-extractable photo key. Never synchronised. */
export interface KeyEntry {
  id: string
  key: CryptoKey
}

/** Setting that follows the user across devices (migration 0009); fixed id per key. */
export interface UserSetting extends SyncColumns {
  key: string
  value: unknown
}

export interface CatalogExercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  primary_muscles: string[]
  secondary_muscles: string[]
}

/** Tables that are synchronised with Neon, in dependency order (parents first). */
export const SYNC_TABLES = [
  'exercise',
  'exercise_link',
  'template',
  'template_exercise',
  'template_set',
  'workout',
  'workout_exercise',
  'workout_set',
  'body_weight',
  'user_setting',
  'body_photo',
] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

export interface OutboxEntry {
  seq?: number
  table: SyncTable
  row_id: string
  queued_at: string
}

export interface SyncState {
  table: SyncTable
  last_synced_at: string
}

/** Local key/value settings, e.g. the signed-in user. */
export interface Meta {
  key: string
  value: string
}

// The beta build uses its own local database (VITE_DB_NAME), so it never upgrades the live app's data
export const db = new Dexie(import.meta.env.VITE_DB_NAME || 'fitness-app') as Dexie & {
  exercise_catalog: EntityTable<CatalogExercise, 'id'>
  exercise: EntityTable<Exercise, 'id'>
  exercise_link: EntityTable<ExerciseLink, 'id'>
  template: EntityTable<Template, 'id'>
  template_exercise: EntityTable<TemplateExercise, 'id'>
  template_set: EntityTable<TemplateSet, 'id'>
  workout: EntityTable<Workout, 'id'>
  workout_exercise: EntityTable<WorkoutExercise, 'id'>
  workout_set: EntityTable<WorkoutSet, 'id'>
  body_weight: EntityTable<BodyWeight, 'id'>
  user_setting: EntityTable<UserSetting, 'id'>
  body_photo: EntityTable<BodyPhoto, 'id'>
  photo_blob: EntityTable<PhotoBlob, 'id'>
  keystore: EntityTable<KeyEntry, 'id'>
  outbox: EntityTable<OutboxEntry, 'seq'>
  sync_state: EntityTable<SyncState, 'table'>
  meta: EntityTable<Meta, 'key'>
}

db.version(1).stores({
  exercise_catalog: 'id, name',
  exercise: 'id, parent_id, name',
  exercise_link: 'id, exercise_id',
  template: 'id, name',
  template_exercise: 'id, template_id, exercise_id',
  template_set: 'id, template_exercise_id',
  workout: 'id, template_id, started_at',
  workout_exercise: 'id, workout_id, exercise_id',
  workout_set: 'id, workout_exercise_id',
  body_weight: 'id, measured_on',
  outbox: '++seq, &[table+row_id]',
  sync_state: 'table',
  meta: 'key',
})

// Version 2: user_setting (migration 0009)
db.version(2).stores({
  user_setting: 'id, key',
})

// Version 3: progress photos (migration 0010), local encrypted photo cache and key store
db.version(3).stores({
  body_photo: 'id, measured_on',
  photo_blob: 'id, uploaded',
  keystore: 'id',
})

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

/** Display name of an exercise; variants are shown as "Parent – Variant". */
export function displayName(exercise: Exercise, byId: Map<string, Exercise>): string {
  const parent = exercise.parent_id ? byId.get(exercise.parent_id) : undefined
  return parent ? `${parent.name} – ${exercise.name}` : exercise.name
}
