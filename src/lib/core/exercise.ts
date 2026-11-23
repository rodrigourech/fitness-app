// Exercise settings without database access (shared by the app and the Food connector, decision 23 November 2026).
import type { Exercise } from '../db'
import { exerciseTrainingSettings } from '../training'

/** Display name of an exercise; variants are shown as "Parent – Variant". */
export function displayName(exercise: Exercise, byId: Map<string, Exercise>): string {
  const parent = exercise.parent_id ? byId.get(exercise.parent_id) : undefined
  return parent ? `${parent.name} – ${exercise.name}` : exercise.name
}

/**
 * Dumbbells in pairs (decision 5 November 2026): the weight is entered as the total of both dumbbells (2 × 12 = 24),
 * the weight step as labelled on one dumbbell (2 kg). The next total is therefore two steps higher (24 → 28).
 * One-sided dumbbell exercises use one dumbbell and keep the step.
 */
export function pairStep(step: number | null, equipment: string | null, unilateral: boolean): number | null {
  return step !== null && equipment === 'dumbbell' && !unilateral ? step * 2 : step
}

/**
 * Bodyweight exercise (Calisthenics Bonus, decision 23 November 2026): reps without kg. Progress means the next stage
 * of the movement (band → free, push-up → deficit) instead of more weight.
 */
export function isBodyweight(trackingType: string, equipment: string | null): boolean {
  return trackingType === 'weight_reps' && equipment === 'bodyweight'
}

/** Effective tracking settings and device settings of an exercise (variants inherit from the parent). */
export function effective(ex: Exercise, byId: Map<string, Exercise>) {
  const parent = ex.parent_id ? byId.get(ex.parent_id) : undefined
  const trackingType = ex.tracking_type ?? parent?.tracking_type ?? 'weight_reps'
  return {
    trackingType,
    /** Reps without kg (equipment «bodyweight», decision 23 November 2026): no kg column, progression by stages */
    bodyweight: isBodyweight(trackingType, ex.equipment ?? parent?.equipment ?? null),
    isUnilateral: ex.is_unilateral ?? parent?.is_unilateral ?? false,
    floor: ex.floor ?? parent?.floor ?? null,
    seat: ex.seat ?? parent?.seat ?? null,
    footPosition: ex.foot_position ?? parent?.foot_position ?? null,
    setupNote: ex.setup_note ?? parent?.setup_note ?? null,
    focusMuscles: ex.focus_muscles ?? parent?.focus_muscles ?? [],
    focusCue: ex.focus_cue ?? parent?.focus_cue ?? null,
    instructions: ex.instructions ?? parent?.instructions ?? null,
    restS: ex.default_rest_s ?? parent?.default_rest_s ?? null,
    equipment: ex.equipment ?? parent?.equipment ?? null,
    weightStep: pairStep(ex.weight_step ?? parent?.weight_step ?? null, ex.equipment ?? parent?.equipment ?? null, ex.is_unilateral ?? parent?.is_unilateral ?? false),
    ...exerciseTrainingSettings(ex, byId),
  }
}
