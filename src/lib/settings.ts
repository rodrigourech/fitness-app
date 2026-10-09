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
