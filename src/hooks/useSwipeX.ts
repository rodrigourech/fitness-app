import { useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { swipeDirection } from '../lib/focus'

/**
 * Horizontal swipe on a card (decision 5 November 2026): the card follows the finger once the move is clearly
 * horizontal; on release past the threshold `onSwipe` gets the direction. Vertical moves keep scrolling the page
 * (touch-action: pan-y on the element). A click right after a swipe is swallowed.
 */
export function useSwipeX(onSwipe: (direction: 'left' | 'right') => void, allowed: { left: boolean; right: boolean }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const horizontal = useRef(false)
  const swallow = useRef(false)
  const [dx, setDx] = useState(0)

  const reset = () => {
    start.current = null
    horizontal.current = false
    setDx(0)
  }
  const clamp = (v: number) => (v < 0 ? (allowed.left ? Math.max(v, -140) : 0) : allowed.right ? Math.min(v, 140) : 0)

  return {
    dx,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
        horizontal.current = false
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const s = start.current
        if (!s || s.id !== e.pointerId) return
        const mx = e.clientX - s.x
        const my = e.clientY - s.y
        if (!horizontal.current) {
          if (Math.abs(my) > 12 && Math.abs(my) > Math.abs(mx)) return reset()
          if (Math.abs(mx) < 12 || Math.abs(mx) < 1.5 * Math.abs(my)) return
          horizontal.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        setDx(clamp(mx))
      },
      onPointerUp: (e: PointerEvent<HTMLElement>) => {
        const s = start.current
        if (s && horizontal.current) {
          swallow.current = true
          const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y)
          if (dir && allowed[dir]) onSwipe(dir)
        }
        reset()
      },
      onPointerCancel: reset,
      onClickCapture: (e: MouseEvent) => {
        if (swallow.current) {
          swallow.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      },
    },
  }
}
