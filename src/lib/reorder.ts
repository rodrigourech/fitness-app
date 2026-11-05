// Pure logic for drag reordering of a vertical list (long press and drag, decision 5 November 2026).
// Positions are layout values (offsetTop, offsetHeight) relative to the list, without transforms.

export interface Slot {
  top: number
  height: number
}

/** Returns a copy of the list with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || from >= next.length) return next
  const target = Math.max(0, Math.min(next.length - 1, to))
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item as T)
  return next
}

/** Moves the item with the given id by `delta` places; returns null if that is not possible. */
export function moveById(list: readonly string[], id: string, delta: number): string[] | null {
  const from = list.indexOf(id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return null
  return moveItem(list, from, to)
}

/** Space between two neighbouring items, measured from the first two slots. */
export function gapOf(slots: readonly Slot[]): number {
  if (slots.length < 2) return 0
  return Math.max(0, slots[1]!.top - slots[0]!.top - slots[0]!.height)
}

/**
 * Index where the dragged item would land: the number of other items whose
 * centre lies above the centre of the dragged item after moving it by `dy`.
 */
export function dropIndex(slots: readonly Slot[], from: number, dy: number): number {
  const dragged = slots[from]
  if (!dragged) return from
  const centre = dragged.top + dragged.height / 2 + dy
  let index = 0
  slots.forEach((s, i) => {
    if (i !== from && s.top + s.height / 2 < centre) index++
  })
  return index
}

/** Vertical offset of a non-dragged item while the dragged item hovers over slot `to`. */
export function shiftFor(index: number, from: number, to: number, distance: number): number {
  if (from < to && index > from && index <= to) return -distance
  if (to < from && index >= to && index < from) return distance
  return 0
}

/** Top of the drop slot (dashed placeholder) when the item at `from` is dropped at `to`. */
export function placeholderTop(slots: readonly Slot[], from: number, to: number): number {
  const dragged = slots[from]
  const target = slots[to]
  if (!dragged || !target) return dragged?.top ?? 0
  return to > from ? target.top + target.height - dragged.height : target.top
}

/** True if both lists contain the same ids, ignoring order. */
export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((x) => set.has(x))
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/**
 * Adjacent swaps that turn `from` into `to` (both with the same members).
 * Each entry is the id to move and the direction; applied in order they yield `to`.
 */
export function adjacentSwaps(from: readonly string[], to: readonly string[]): { id: string; direction: -1 }[] {
  const list = [...from]
  const swaps: { id: string; direction: -1 }[] = []
  to.forEach((id, k) => {
    let p = list.indexOf(id)
    while (p > k) {
      ;[list[p - 1], list[p]] = [list[p]!, list[p - 1]!]
      swaps.push({ id, direction: -1 })
      p--
    }
  })
  return swaps
}
