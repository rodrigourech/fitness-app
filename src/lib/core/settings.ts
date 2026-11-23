// Parsing of stored settings without database access (shared by the app and the Food connector, decision 23 November 2026).

export interface WeeklyGoal {
  /** Strength workouts per week (1–7) */
  strength: number
  /** Runs per week (0 = running is optional) */
  run: number
}

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

/** Goal weight in kg (30–300, one decimal); null when not set or invalid. */
export function parseGoalWeight(value: unknown): number | null {
  const kg = typeof value === 'number' ? value : (value as { kg?: unknown } | null)?.kg
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= 30 && kg <= 300 ? Math.round(kg * 10) / 10 : null
}

export interface NutritionTargets {
  /** Daily need (maintenance) in kcal */
  needKcal: number
  /** Deficit goal per day in kcal */
  deficitKcal: number
  proteinG: number
  /** ESN shake with water every day at 08:00 */
  shake: boolean
  /** 2 espressos with milk Monday to Friday at 09:30 */
  espresso: boolean
  /** Creatine taken daily from a start day on (marker under Protein, no kcal); null = not taken */
  creatine: Creatine | null
}

export interface Creatine {
  doseG: number
  /** First day taken, YYYY-MM-DD */
  since: string
}

/**
 * Rodrigo's values of 2 November 2026: need 2 400 (Mifflin-St Jeor estimate 2 440, rounded), deficit 400, target 2 000.
 * Protein minimum 140 g (about 1.6 g/kg, decision 23 November 2026). Creatine 5 g a day from 23 November 2026 (Rodrigo, 23 November 2026); a stored row without the key gets this default.
 */
export const DEFAULT_CREATINE: Creatine = { doseG: 5, since: '2026-11-23' }
export const DEFAULT_NUTRITION: NutritionTargets = { needKcal: 2400, deficitKcal: 400, proteinG: 140, shake: true, espresso: true, creatine: DEFAULT_CREATINE }

function parseCreatine(x: unknown): Creatine | null {
  if (x === null) return null
  if (typeof x !== 'object') return DEFAULT_CREATINE
  const c = x as Partial<Record<keyof Creatine, unknown>>
  const doseG = typeof c.doseG === 'number' && Number.isFinite(c.doseG) && c.doseG > 0 && c.doseG <= 50 ? Math.round(c.doseG * 10) / 10 : DEFAULT_CREATINE.doseG
  const since = typeof c.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.since) ? c.since : DEFAULT_CREATINE.since
  return { doseG, since }
}

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
    creatine: parseCreatine(v.creatine),
  }
}
