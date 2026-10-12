import type { Exercise, TemplateSet } from './db'

export const DEFAULT_TARGET_REPS = 10
export const DEFAULT_MIN_REPS = 7

export interface RepetitionTargets {
  target: number
  minimum: number
}

export function exerciseTrainingSettings(ex: Exercise, byId: Map<string, Exercise>) {
  const parent = ex.parent_id ? byId.get(ex.parent_id) : undefined
  return {
    targetReps: ex.target_reps ?? parent?.target_reps ?? DEFAULT_TARGET_REPS,
    minReps: ex.min_reps ?? parent?.min_reps ?? DEFAULT_MIN_REPS,
    warmUp: ex.warm_up ?? parent?.warm_up ?? false,
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
