// Stores a complete new order after a drag (decision 5 November 2026), using the existing save paths.
import { db } from './db'
import { moveTemplate } from './settings'
import { adjacentSwaps, moveById, sameMembers } from './reorder'
import { saveRows } from './sync'

/**
 * Stores the order of the workouts (user_setting template_order) through moveTemplate,
 * as a series of neighbour swaps from the current to the new order.
 */
export async function saveTemplateOrder(userId: string, current: string[], next: string[]): Promise<void> {
  if (!sameMembers(current, next)) return
  let list = [...current]
  for (const swap of adjacentSwaps(current, next)) {
    await moveTemplate(userId, list, swap.id, swap.direction)
    list = moveById(list, swap.id, swap.direction) ?? list
  }
}

/** Renumbers template_exercise.position 1..n in the given order; only changed rows are saved. */
export async function saveTemplateExerciseOrder(templateId: string, next: string[]): Promise<void> {
  const rows = (await db.template_exercise.where('template_id').equals(templateId).toArray()).filter((te) => te.deleted_at === null)
  const byId = new Map(rows.map((te) => [te.id, te]))
  // Rows missing in `next` (e.g. added on another device meanwhile) keep their relative order after it
  const rest = rows.filter((te) => !next.includes(te.id)).sort((a, b) => a.position - b.position)
  const ordered = [...next.map((id) => byId.get(id)).filter((te) => te !== undefined), ...rest]
  const changed = ordered.map((te, k) => ({ ...te, position: k + 1 })).filter((te) => byId.get(te.id)!.position !== te.position)
  if (changed.length) await saveRows('template_exercise', changed)
}
