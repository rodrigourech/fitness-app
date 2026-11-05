import { restoreItem, trashItems } from './trash'

// Short "Undo" notice after moving something to the trash (decision 8 October 2026).

export interface UndoOffer {
  key: number
  message: string
  /** Id of the trash item (body weight entry, photo or workout) */
  id: string
  /** Own undo step instead of restoring a trash item (removed set in a running workout) */
  action?: () => Promise<void>
}

const SHOW_MS = 6000

let current: UndoOffer | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let seq = 0
const listeners = new Set<() => void>()

function set(next: UndoOffer | null) {
  current = next
  listeners.forEach((l) => l())
}

export function getUndo(): UndoOffer | null {
  return current
}

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows the notice for a few seconds; a newer offer replaces an older one. */
export function offerUndo(message: string, id: string, action?: () => Promise<void>): void {
  clearTimeout(timer)
  set({ key: ++seq, message, id, action })
  timer = setTimeout(() => set(null), SHOW_MS)
}

export function dismissUndo(): void {
  clearTimeout(timer)
  set(null)
}

/** Restores the item of the current offer. */
export async function undo(): Promise<void> {
  const offer = current
  dismissUndo()
  if (!offer) return
  if (offer.action) return offer.action()
  const item = (await trashItems()).find((i) => i.id === offer.id)
  if (item) await restoreItem(item)
}
