import { db, type UserSetting } from './db'
import { saveRows } from './sync'

// Settings shared across devices (table user_setting, migration 0009).
// Each key has a fixed id, so all devices update the same row instead of creating duplicates.

export interface WeeklyGoal {
  /** Strength workouts per week (1–7) */
  strength: number
  /** Runs per week (0 = running is optional) */
  run: number
}

const WEEKLY_GOAL_ID = '6d0f3a52-9c4e-4b1a-8f27-3e5d7c9a1b04'

// Default until the user sets a goal: 2 strength workouts, running optional (decision 5 October 2026)
export const DEFAULT_WEEKLY_GOAL: WeeklyGoal = { strength: 2, run: 0 }

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}

/** Reads a stored value defensively (it may come from an older or newer app version). */
export function parseWeeklyGoal(value: unknown): WeeklyGoal {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    strength: clamp(v.strength, 1, 7, DEFAULT_WEEKLY_GOAL.strength),
    run: clamp(v.run, 0, 7, DEFAULT_WEEKLY_GOAL.run),
  }
}

export async function getWeeklyGoal(): Promise<WeeklyGoal> {
  const row = await db.user_setting.get(WEEKLY_GOAL_ID)
  return row && row.deleted_at === null ? parseWeeklyGoal(row.value) : DEFAULT_WEEKLY_GOAL
}

export async function saveWeeklyGoal(userId: string, goal: WeeklyGoal): Promise<void> {
  const existing = await db.user_setting.get(WEEKLY_GOAL_ID)
  const ts = new Date().toISOString()
  const row: UserSetting = existing
    ? { ...existing, value: parseWeeklyGoal(goal), deleted_at: null }
    : { id: WEEKLY_GOAL_ID, user_id: userId, key: 'weekly_goal', value: parseWeeklyGoal(goal), created_at: ts, updated_at: ts, deleted_at: null }
  await saveRows('user_setting', [row])
}

// --- order of the workouts (decision 9 October 2026) ------------------------------------------

const TEMPLATE_ORDER_ID = '9b2e7c41-5d3a-4f86-a1c9-0e4f8d2b6a17'

export async function getTemplateOrder(): Promise<string[]> {
  const row = await db.user_setting.get(TEMPLATE_ORDER_ID)
  const v = row && row.deleted_at === null ? row.value : null
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** Sorts workouts by the stored order; workouts not in the order follow by name. */
export function sortByOrder<T extends { id: string; name: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...items].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name))
}

/** Moves a workout one place up (-1) or down (+1) within the given list and stores the new order. */
export async function moveTemplate(userId: string, list: string[], id: string, direction: -1 | 1): Promise<void> {
  const i = list.indexOf(id)
  const j = i + direction
  if (i < 0 || j < 0 || j >= list.length) return
  const next = [...list]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  const existing = await db.user_setting.get(TEMPLATE_ORDER_ID)
  const ts = new Date().toISOString()
  const row: UserSetting = existing
    ? { ...existing, value: next, deleted_at: null }
    : { id: TEMPLATE_ORDER_ID, user_id: userId, key: 'template_order', value: next, created_at: ts, updated_at: ts, deleted_at: null }
  await saveRows('user_setting', [row])
}

// --- training shares (decision 19 October 2026) ------------------------------------------------

const TRAINING_SHARES_ID = '3c8a51e7-2f4d-4b96-9e1a-7d06b2c4f835'

/** Shares of today's top set for the warm-up set and the back-off sets, in percent. */
export interface TrainingShares {
  warmUp: number
  backOff: number
}

export const DEFAULT_TRAINING_SHARES: TrainingShares = { warmUp: 50, backOff: 85 }

export function parseTrainingShares(value: unknown): TrainingShares {
  const v = (value ?? {}) as Record<string, unknown>
  return {
    warmUp: clamp(v.warmUp, 20, 90, DEFAULT_TRAINING_SHARES.warmUp),
    backOff: clamp(v.backOff, 50, 95, DEFAULT_TRAINING_SHARES.backOff),
  }
}

export async function getTrainingShares(): Promise<TrainingShares> {
  const row = await db.user_setting.get(TRAINING_SHARES_ID)
  return row && row.deleted_at === null ? parseTrainingShares(row.value) : DEFAULT_TRAINING_SHARES
}

export async function saveTrainingShares(userId: string, shares: TrainingShares): Promise<void> {
  const existing = await db.user_setting.get(TRAINING_SHARES_ID)
  const ts = new Date().toISOString()
  const value = parseTrainingShares(shares)
  const row: UserSetting = existing
    ? { ...existing, value, deleted_at: null }
    : { id: TRAINING_SHARES_ID, user_id: userId, key: 'training_shares', value, created_at: ts, updated_at: ts, deleted_at: null }
  await saveRows('user_setting', [row])
}

// --- goal body weight (decision 1 November 2026) ---------------------------------------------

const GOAL_WEIGHT_ID = 'e4b7c2a9-1f3d-4c86-b5e0-7a9d2f6c3b18'

/** Goal weight in kg (30–300, one decimal); null when not set or invalid. */
export function parseGoalWeight(value: unknown): number | null {
  const kg = typeof value === 'number' ? value : (value as { kg?: unknown } | null)?.kg
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= 30 && kg <= 300 ? Math.round(kg * 10) / 10 : null
}

export async function getGoalWeight(): Promise<number | null> {
  const row = await db.user_setting.get(GOAL_WEIGHT_ID)
  return row && row.deleted_at === null ? parseGoalWeight(row.value) : null
}

export async function saveGoalWeight(userId: string, kg: number): Promise<void> {
  const value = parseGoalWeight(kg)
  if (value === null) return
  const existing = await db.user_setting.get(GOAL_WEIGHT_ID)
  const ts = new Date().toISOString()
  const row: UserSetting = existing
    ? { ...existing, value: { kg: value }, deleted_at: null }
    : { id: GOAL_WEIGHT_ID, user_id: userId, key: 'goal_weight', value: { kg: value }, created_at: ts, updated_at: ts, deleted_at: null }
  await saveRows('user_setting', [row])
}

// --- nutrition targets (decision 2 November 2026) ---------------------------------------------
// Set by hand in Food › Targets. Need (maintenance) minus the deficit goal gives the daily kcal target. Nutrition stays
// separate from the weight forecast. shake and espresso switch the automatic daily entries (see food.ts).

const NUTRITION_ID = '9b2e6f14-7c3a-4d58-a1e9-5f0c8d2b7a63'

export interface NutritionTargets {
  /** Daily need (maintenance) in kcal */
  needKcal: number
  /** Deficit goal per day in kcal */
  deficitKcal: number
  proteinG: number
  /** ESN shake with water every day at 08:00 */
  shake: boolean
  /** 3 espressos with milk Monday to Friday at 09:30 */
  espresso: boolean
}

/** Rodrigo's values of 2 November 2026: need 2 400 (Mifflin-St Jeor estimate 2 440, rounded), deficit 400, target 2 000 */
export const DEFAULT_NUTRITION: NutritionTargets = { needKcal: 2400, deficitKcal: 400, proteinG: 140, shake: true, espresso: true }

export function parseNutrition(value: unknown): NutritionTargets {
  const v = (value ?? {}) as Partial<Record<keyof NutritionTargets, unknown>>
  const n = (x: unknown, min: number, max: number, fallback: number) => (typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? Math.round(x) : fallback)
  const b = (x: unknown, fallback: boolean) => (typeof x === 'boolean' ? x : fallback)
  return {
    needKcal: n(v.needKcal, 1200, 5000, DEFAULT_NUTRITION.needKcal),
    deficitKcal: n(v.deficitKcal, 0, 1500, DEFAULT_NUTRITION.deficitKcal),
    proteinG: n(v.proteinG, 40, 300, DEFAULT_NUTRITION.proteinG),
    shake: b(v.shake, DEFAULT_NUTRITION.shake),
    espresso: b(v.espresso, DEFAULT_NUTRITION.espresso),
  }
}

export async function getNutrition(): Promise<NutritionTargets> {
  const row = await db.user_setting.get(NUTRITION_ID)
  return row && row.deleted_at === null ? parseNutrition(row.value) : DEFAULT_NUTRITION
}

export async function saveNutrition(userId: string, targets: NutritionTargets): Promise<void> {
  const value = parseNutrition(targets)
  const existing = await db.user_setting.get(NUTRITION_ID)
  const ts = new Date().toISOString()
  const row: UserSetting = existing
    ? { ...existing, key: 'nutrition_targets', value, deleted_at: null }
    : { id: NUTRITION_ID, user_id: userId, key: 'nutrition_targets', value, created_at: ts, updated_at: ts, deleted_at: null }
  await saveRows('user_setting', [row])
}
