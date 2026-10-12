import type { Exercise, TemplateSet } from './db'

export const DEFAULT_TARGET_REPS = 10
export const DEFAULT_MIN_REPS = 7

/** Preparation reminders for the main loaded movements in the personal training plan. */
export const RECOMMENDED_WARM_UP_IDS = new Set([
  '1f3d184e-fccb-514f-a554-b6a6cbbc7380', // Chest Press
  '8ca6bcc2-1cc1-5f1f-b6a5-609954173d50', // Lat Pulldown
  '09ab0a44-dcd2-5c33-989a-3986f73cdb06', // Seated Row
  '6144fd76-baee-5c78-a409-4ce968051388', // Leg Press
  'fb2adc06-d45c-58f6-b67b-ed1ba6ec8fe7', // Lying Leg Curl
])

export function hasRecommendedWarmUp(ex: Exercise): boolean {
  return RECOMMENDED_WARM_UP_IDS.has(ex.parent_id ?? ex.id)
}

export interface RepetitionTargets {
  target: number
  minimum: number
}

export function exerciseTrainingSettings(ex: Exercise, byId: Map<string, Exercise>) {
  const parent = ex.parent_id ? byId.get(ex.parent_id) : undefined
  return {
    targetReps: ex.target_reps ?? parent?.target_reps ?? DEFAULT_TARGET_REPS,
    minReps: ex.min_reps ?? parent?.min_reps ?? DEFAULT_MIN_REPS,
    warmUp: ex.warm_up ?? parent?.warm_up ?? hasRecommendedWarmUp(ex),
  }
}

/** Template work-set values override exercise defaults; warm-ups never supply targets. */
export function repetitionTargets(ex: Exercise, byId: Map<string, Exercise>, planned: TemplateSet[] = []): RepetitionTargets {
  const settings = exerciseTrainingSettings(ex, byId)
  const working = planned.filter((s) => s.deleted_at === null && s.set_type === 'working')
  const upper = working.flatMap((s) => s.target_reps_max === null ? [] : [s.target_reps_max])
  const lower = working.flatMap((s) => s.target_reps_min === null ? [] : [s.target_reps_min])
  const target = upper.length ? Math.max(...upper) : settings.targetReps
  const minimum = lower.length ? Math.max(...lower) : settings.minReps
  return { target, minimum: Math.min(minimum, target) }
}

export function validRepetitionTargets(target: number, minimum: number): boolean {
  return Number.isInteger(target) && Number.isInteger(minimum) && minimum >= 1 && target >= minimum && target <= 100
}
