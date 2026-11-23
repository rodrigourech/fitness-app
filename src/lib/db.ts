import Dexie, { type EntityTable } from 'dexie'
import { isBetaSandbox } from './environment'

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
  /** Null on a variant means inherit (migration 0014). */
  target_reps?: number | null
  min_reps?: number | null
  warm_up?: boolean | null
  /** Top set with back-off sets (migration 0018); null on a variant = inherit, null on a main exercise = off */
  top_set?: boolean | null
  /** Exercise to switch to in a running workout when this one is taken (migration 0026); null on a variant = inherit */
  alternative_id?: string | null
  /** Short execution steps in German, one per line «1) …» (migration 0051); null on a variant = inherit */
  instructions?: string | null
}

export interface ExerciseLink extends SyncColumns {
  exercise_id: string
  url: string
  title: string | null
}

export interface Template extends SyncColumns {
  name: string
  note: string | null
  /** Archived instead of deleted (migration 0012); shown in the section Archive */
  archived_at?: string | null
  /** Removed from the trash for good (migration 0012) */
  purged_at?: string | null
}

export interface TemplateExercise extends SyncColumns {
  template_id: string
  exercise_id: string
  position: number
  /** Rest override for this template; null = the exercise's default rest (decision 9 October 2026) */
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
  /** How crowded the gym was when leaving: 1 = empty … 10 = packed (migrations 0007, 0015) */
  crowd_level?: number | null
  /** Removed from the trash for good (migration 0011) */
  purged_at?: string | null
}

export interface WorkoutExercise extends SyncColumns {
  workout_id: string
  exercise_id: string
  position: number
  rest_s: number | null
  comment: string | null
  /** Skipped as a whole in this workout (migration 0012) */
  skipped_at?: string | null
  /** Training settings copied at workout start (migration 0014). */
  target_reps?: number | null
  min_reps?: number | null
  warm_up?: boolean | null
  /** Planned exercise when the alternative is trained instead (migration 0026); null = as planned */
  original_exercise_id?: string | null
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
  /** Removed from the trash for good (migration 0011); the row stays as a sync tombstone */
  purged_at?: string | null
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
  /** Removed from the trash for good; the encrypted object is deleted in the bucket (migration 0011) */
  purged_at?: string | null
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

/** Staple with fixed values per 100 g, per piece or per serving (migration 0030). */
export interface FoodItem extends SyncColumns {
  name: string
  store: string | null
  basis: '100g' | 'piece' | 'serving'
  kcal: number
  protein_g: number
  /** Grams of one piece or serving, if known */
  piece_g: number | null
  /** Grams of one package, if known */
  package_g: number | null
  note: string | null
}

export type FoodCategory = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'cheat' | 'dessert' | 'drinks'

/** Ingredient of an entry as stored (values of the whole amount, before portions). */
export interface FoodEntryItem {
  name: string
  food_item_id?: string | null
  /** «250 g», «2 pieces», «1 pack» */
  amount: string
  kcal: number
  protein_g: number
  source: 'staple' | 'label' | 'estimate'
}

/** One meal or snack (migration 0030); kcal and protein_g are the eaten portion. */
export interface FoodEntry extends SyncColumns {
  eaten_at: string
  category: FoodCategory
  title: string
  detail: string | null
  items: FoodEntryItem[]
  kcal: number
  protein_g: number
  portions_cooked: number | null
  portions_eaten: number | null
  source: 'app' | 'claude' | 'auto'
}

// --- recipes and kitchen (migration 0052, decision 19 November 2026) ---------------------------------

export type RecipeCategory = 'meal' | 'dessert' | 'snack'
export type ProteinType = 'beef' | 'chicken' | 'pork' | 'fish' | 'veggie' | 'mixed'

/** Ingredient of a recipe; values for the whole recipe at its base portions. */
export interface RecipeItem {
  /** Local id within the recipe, referenced by steps («i1») */
  id: string
  name: string
  food_item_id: string | null
  /** Amount in unit for the base portions; null for «nach Geschmack» */
  qty: number | null
  unit: 'g' | 'ml' | 'piece' | 'serving' | null
  /** Grey count before the weight, scales too: {n: 1, label: 'Becher'} gives «1 Becher · 170 g» */
  hint: { n: number; label: string } | null
  to_taste: boolean
  kcal: number
  protein_g: number
  source: 'staple' | 'label' | 'estimate'
}

export interface RecipeStep {
  /** Text with placeholders {item id} for the scaled amounts */
  text: string
  timer_s: number | null
  items: string[]
}

export interface Recipe extends SyncColumns {
  name: string
  lang: string
  category: RecipeCategory
  protein_type: ProteinType | null
  portions: number
  prep_min: number | null
  meal_prep: boolean
  keeps_days: number
  notes: string | null
  items: RecipeItem[]
  steps: RecipeStep[]
}

/** Cooked portions without a day; values and items per portion, frozen when cooked. */
export interface FridgeItem extends SyncColumns {
  recipe_id: string | null
  title: string
  portions: number
  kcal: number
  protein_g: number
  items: FoodEntryItem[]
  cooked_at: string
  /** Local day YYYY-MM-DD */
  eat_by: string
}

export type StockLocation = 'fridge' | 'freezer' | 'shelf'

/** Stock item; tracked false = present yes/no only (oil, spices, sauces). */
export interface InventoryItem extends SyncColumns {
  food_item_id: string | null
  name: string
  location: StockLocation
  unit: 'g' | 'ml' | 'piece' | null
  qty_initial: number | null
  qty_left: number | null
  tracked: boolean
  best_before: string | null
  opened_at: string | null
  last_used_at: string | null
  note: string | null
}

export type StockReason = 'purchase' | 'meal' | 'recipe' | 'used_up' | 'discard' | 'correction'

export interface InventoryMove extends SyncColumns {
  item_id: string
  delta: number
  reason: StockReason
  food_entry_id: string | null
}

export interface CatalogExercise {
  id: string
  name: string
  category: string | null
  equipment: string | null
  primary_muscles: string[]
  secondary_muscles: string[]
}

/** Photo of a recipe (kind dish) or of a product in the staples (pack, label); migration 0053. The JPEG lies
 * unencrypted in the private bucket under <user_id>/<id>; the bytes are cached in photo_blob. */
export interface FoodPhoto extends SyncColumns {
  recipe_id: string | null
  food_item_id: string | null
  kind: 'dish' | 'pack' | 'label'
  is_cover: boolean
  taken_on: string | null
  mime: string
  width: number | null
  height: number | null
  bytes: number | null
  purged_at?: string | null
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
