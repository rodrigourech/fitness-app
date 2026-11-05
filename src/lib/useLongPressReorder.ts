// iOS-style reordering of a vertical list: long press on an item enters reorder mode, the item
// lifts and follows the finger, the others move aside (decision 5 November 2026).
// In reorder mode items can be dragged directly; arrow keys and move() keep it usable without drag.
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { dropIndex, gapOf, moveById, moveItem, placeholderTop, sameMembers, sameOrder, shiftFor, type Slot } from './reorder'

export interface ReorderOptions {
  /** Ids in the stored order */
  ids: string[]
  /** Stores the new order; the hook shows it until `ids` reflect it */
  onCommit: (next: string[]) => Promise<void> | void
  /** Name of an item for screen reader announcements */
  label?: (id: string) => string
  /** Long press duration in ms */
  delay?: number
  /** Movement in px that cancels a long press (normal scrolling) */
  slop?: number
  enabled?: boolean
}

interface Drag {
  id: string
  from: number
  to: number
  dy: number
  slots: Slot[] | null
  gap: number
}

interface Gesture {
  pointerId: number
  id: string
  el: HTMLElement
  /** Element that receives the touch events of this gesture */
  touchTarget: EventTarget
  startX: number
  startY: number
  timer: ReturnType<typeof setTimeout> | null
  dragging: boolean
  anchorY: number
  anchorScroll: number
  lastY: number
  drag: Drag | null
}

const IGNORE = 'input, textarea, select, [contenteditable="true"], [data-reorder-ignore]'
const KEEP = '[data-reorder-keep]'
const EDGE = 80

export function useLongPressReorder({ ids, onCommit, label, delay = 450, slop = 8, enabled = true }: ReorderOptions) {
  const [active, setActiveState] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<string[] | null>(null)
  const [settling, setSettling] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  // Optimistic order until the stored order arrives; dropped when the members change
  if (pending && (sameOrder(pending, ids) || !sameMembers(pending, ids))) setPending(null)
  const order = pending && sameMembers(pending, ids) ? pending : ids

  const latest = useRef({ order, onCommit, label, delay, slop, enabled })
  useEffect(() => {
    latest.current = { order, onCommit, label, delay, slop, enabled }
  })

  const items = useRef(new Map<string, HTMLElement>())
  const list = useRef<HTMLElement | null>(null)
  const gesture = useRef<Gesture | null>(null)
  const scrollFrame = useRef<number | null>(null)

  const commit = useCallback((next: string[], movedId: string) => {
    const { order: current, onCommit: save, label: name } = latest.current
    if (sameOrder(next, current)) return
    setPending(next)
    const position = next.indexOf(movedId) + 1
    setAnnouncement(`${name?.(movedId) ?? 'Item'} moved to position ${position} of ${next.length}`)
    void Promise.resolve(save(next)).catch(() => setPending(null))
  }, [])

  const stopScroll = useCallback(() => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = null
  }, [])

  const measure = useCallback((g: Gesture, d: Drag): Drag => {
    const root = list.current
    const { order: current } = latest.current
    const slots = current.map((id) => {
      const el = items.current.get(id)
      return { top: el?.offsetTop ?? 0, height: el?.offsetHeight ?? 0 }
    })
    const own = slots[d.from]
    if (root && own) {
      // The layout may have changed on entering reorder mode (compact rows, one column): scroll so the
      // item lies under the pointer again where possible; from here the item follows the pointer relatively
      const itemTop = root.getBoundingClientRect().top + root.clientTop + own.top
      if (g.lastY < itemTop || g.lastY > itemTop + own.height) window.scrollBy(0, itemTop + own.height / 2 - g.lastY)
    }
    g.anchorY = g.lastY
    g.anchorScroll = window.scrollY
    return { ...d, slots, gap: gapOf(slots) }
  }, [])

  const update = useCallback(() => {
    const g = gesture.current
    if (!g?.drag) return
    let d = g.drag
    if (!d.slots) d = measure(g, d)
    const dy = g.lastY - g.anchorY + (window.scrollY - g.anchorScroll)
    const to = dropIndex(d.slots!, d.from, dy)
    g.drag = { ...d, dy, to }
    setDrag(g.drag)
  }, [measure])

  const autoScroll = useCallback(function tick() {
    const g = gesture.current
    if (!g?.dragging) return stopScroll()
    const y = g.lastY
    const speed = y < EDGE ? -Math.ceil((EDGE - y) / 8) : y > window.innerHeight - EDGE ? Math.ceil((y - window.innerHeight + EDGE) / 8) : 0
    if (!speed) return stopScroll()
    window.scrollBy(0, speed)
    update()
    scrollFrame.current = requestAnimationFrame(tick)
  }, [stopScroll, update])

  // Browsers decide about scrolling on touchmove: block it while an item is dragged. Registered
  // non-passive on the list (so scrolling elsewhere is unaffected) and on the touched element, because
  // touch events stay with that element even when reorder mode removes it from the list.
  const blockTouch = useCallback((e: Event) => {
    if (gesture.current?.dragging) e.preventDefault()
  }, [])
  // Window listeners (they also run before pointer capture); stable wrappers around the current handlers
  const handlers = useRef({
    move: (_e: globalThis.PointerEvent) => {},
    up: (_e: globalThis.PointerEvent) => {},
    cancel: (_e: globalThis.PointerEvent) => {},
  })
  const listeners = useRef({
    move: (e: globalThis.PointerEvent) => handlers.current.move(e),
    up: (e: globalThis.PointerEvent) => handlers.current.up(e),
    cancel: (e: globalThis.PointerEvent) => handlers.current.cancel(e),
  })

  const endGesture = useCallback(() => {
    const g = gesture.current
    if (!g) return
    if (g.timer !== null) clearTimeout(g.timer)
    gesture.current = null
    g.touchTarget.removeEventListener('touchmove', blockTouch)
    stopScroll()
    window.removeEventListener('pointermove', listeners.current.move)
    window.removeEventListener('pointerup', listeners.current.up)
    window.removeEventListener('pointercancel', listeners.current.cancel)
  }, [blockTouch, stopScroll])

  const finishDrag = useCallback((drop: boolean) => {
    const g = gesture.current
    const d = g?.drag
    endGesture()
    if (!d) return
    if (drop && d.to !== d.from) commit(moveItem(latest.current.order, d.from, d.to), d.id)
    // Without transitions for one frame, so the items do not animate from their old offsets
    setSettling(true)
    setDrag(null)
    requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)))
  }, [commit, endGesture])

  useEffect(() => {
    handlers.current.move = (e) => {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > latest.current.slop) endGesture()
        return
      }
      g.lastY = e.clientY
      update()
      if (scrollFrame.current === null && (e.clientY < EDGE || e.clientY > window.innerHeight - EDGE)) {
        scrollFrame.current = requestAnimationFrame(autoScroll)
      }
    }
    handlers.current.up = (e) => {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      if (g.dragging) finishDrag(true)
      else endGesture()
    }
    handlers.current.cancel = (e) => {
      const g = gesture.current
      if (!g || e.pointerId !== g.pointerId) return
      if (g.dragging) finishDrag(false)
      else endGesture()
    }
  })

  const startDrag = useCallback((g: Gesture) => {
    const from = latest.current.order.indexOf(g.id)
    if (from < 0) return endGesture()
    g.timer = null
    g.dragging = true
    g.drag = { id: g.id, from, to: from, dy: 0, slots: null, gap: 0 }
    try {
      g.el.setPointerCapture(g.pointerId)
    } catch {
      // The pointer may already be gone; window listeners still end the gesture
    }
    setActiveState(true)
    setDrag(g.drag)
    // Measure once the reorder layout is rendered
    requestAnimationFrame(() => {
      if (gesture.current === g && g.drag && !g.drag.slots) update()
    })
  }, [endGesture, update])

  const listRef = useCallback((el: HTMLElement | null) => {
    list.current?.removeEventListener('touchmove', blockTouch)
    list.current = el
    el?.addEventListener('touchmove', blockTouch, { passive: false })
  }, [blockTouch])

  useEffect(() => endGesture, [endGesture])

  function onPointerDown(id: string, e: PointerEvent<HTMLElement>) {
    const { enabled: on, delay: wait } = latest.current
    if (!on || gesture.current || !e.isPrimary) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.target as Element
    if (target.closest(IGNORE) || target.closest(KEEP)) return
    const g: Gesture = {
      pointerId: e.pointerId, id, el: e.currentTarget, touchTarget: e.target, startX: e.clientX, startY: e.clientY,
      timer: null, dragging: false, anchorY: e.clientY, anchorScroll: window.scrollY, lastY: e.clientY, drag: null,
    }
    gesture.current = g
    if (e.pointerType !== 'mouse') g.touchTarget.addEventListener('touchmove', blockTouch, { passive: false })
    window.addEventListener('pointermove', listeners.current.move)
    window.addEventListener('pointerup', listeners.current.up)
    window.addEventListener('pointercancel', listeners.current.cancel)
    if (active) {
      // Reorder mode: drag directly; no text selection on desktop
      if (e.pointerType === 'mouse') e.preventDefault()
      startDrag(g)
    } else {
      g.timer = setTimeout(() => {
        if (gesture.current === g) {
          navigator.vibrate?.(10)
          startDrag(g)
        }
      }, wait)
    }
  }

  // In reorder mode taps neither open nor expand items
  function onClickCapture(e: MouseEvent<HTMLElement>) {
    if (!active || (e.target as Element).closest(KEEP)) return
    e.preventDefault()
    e.stopPropagation()
  }

  function onContextMenu(e: MouseEvent<HTMLElement>) {
    if (gesture.current || active) e.preventDefault()
  }

  const move = useCallback((id: string, delta: number) => {
    const next = moveById(latest.current.order, id, delta)
    if (next) commit(next, id)
  }, [commit])

  const setActive = useCallback((on: boolean) => {
    if (!on && gesture.current) finishDrag(false)
    setActiveState(on)
  }, [finishDrag])

  function onKeyDown(id: string, e: KeyboardEvent<HTMLElement>) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      move(id, e.key === 'ArrowUp' ? -1 : 1)
    } else if (e.key === 'Escape') {
      setActive(false)
    }
  }

  function itemProps(id: string, className = '') {
    const index = order.indexOf(id)
    const dragged = drag?.id === id
    const style: CSSProperties = {}
    if (drag?.slots) {
      const shift = dragged ? drag.dy : shiftFor(index, drag.from, drag.to, drag.slots[drag.from]!.height + drag.gap)
      if (shift) style.translate = `0 ${shift}px`
    }
    if (dragged) style.touchAction = 'none'
    return {
      ref: (el: HTMLElement | null) => {
        if (el) items.current.set(id, el)
        else items.current.delete(id)
      },
      className: `reorder-item ${className}`,
      style,
      'data-reorder': dragged ? 'dragging' : active ? 'wiggle' : undefined,
      tabIndex: active ? 0 : undefined,
      'aria-keyshortcuts': active ? 'ArrowUp ArrowDown' : undefined,
      onPointerDown: (e: PointerEvent<HTMLElement>) => onPointerDown(id, e),
      onClickCapture,
      onContextMenu,
      onKeyDown: active ? (e: KeyboardEvent<HTMLElement>) => onKeyDown(id, e) : undefined,
    }
  }

  const placeholder = drag?.slots
    ? { top: placeholderTop(drag.slots, drag.from, drag.to), height: drag.slots[drag.from]!.height }
    : null

  return {
    /** Ids in display order (includes a just dropped order not yet stored) */
    order,
    active,
    setActive,
    dragging: drag !== null,
    move,
    itemProps,
    /** Ref and attributes for the list element (it is made position: relative by the CSS) */
    listProps: { ref: listRef, className: 'reorder-list', 'data-reorder-settling': settling || undefined },
    placeholder,
    announcement,
  }
}
