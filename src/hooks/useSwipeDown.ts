import { useRef, type PointerEvent } from 'react'

/**
 * Pointer handlers that call `onSwipe` when the user drags down by at least `threshold` pixels.
 * Attach to a handle or header with `touch-action: none`, so the drag does not scroll the page.
 */
export function useSwipeDown(onSwipe: () => void, threshold = 70) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onPointerDown: (e: PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY }
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      const dy = e.clientY - s.y
      const dx = Math.abs(e.clientX - s.x)
      if (dy >= threshold && dx < dy) onSwipe()
    },
    onPointerCancel: () => {
      start.current = null
    },
  }
}
