import Dexie, { type EntityTable } from 'dexie'
import { isBetaSandbox } from './environment'

import type { BodyPhoto, BodyWeight, CatalogExercise, Exercise, ExerciseLink, FoodEntry, FoodItem, FoodPhoto, FridgeItem, InventoryItem, InventoryMove, Recipe, Template, TemplateExercise, TemplateSet, UserSetting, Workout, WorkoutExercise, WorkoutSet } from './core/rows'

export type * from './core/rows'

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
  'food_item',
  'food_entry',
  'recipe',
  'fridge_item',
  'inventory_item',
  'inventory_move',
  'food_photo',
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
const databaseName = isBetaSandbox ? 'fitness-app-beta-progression-v1' : (import.meta.env.VITE_DB_NAME || 'fitness-app')
export const db = new Dexie(databaseName) as Dexie & {
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
  food_item: EntityTable<FoodItem, 'id'>
  food_entry: EntityTable<FoodEntry, 'id'>
  recipe: EntityTable<Recipe, 'id'>
  fridge_item: EntityTable<FridgeItem, 'id'>
  inventory_item: EntityTable<InventoryItem, 'id'>
  inventory_move: EntityTable<InventoryMove, 'id'>
  food_photo: EntityTable<FoodPhoto, 'id'>
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

// Version 4: nutrition (migration 0030)
db.version(4).stores({
  food_item: 'id, name',
  food_entry: 'id, eaten_at',
})

// Version 5: recipes, fridge and stock (migration 0052)
db.version(5).stores({
  recipe: 'id, name',
  fridge_item: 'id, eat_by',
  inventory_item: 'id, food_item_id',
  inventory_move: 'id, item_id',
})

// Version 6: photos of recipes and products (migration 0053)
db.version(6).stores({
  food_photo: 'id, recipe_id, food_item_id',
})

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value })
}

export { displayName } from './core/exercise'
