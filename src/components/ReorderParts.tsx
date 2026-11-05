// Shared parts of the reorder mode (see src/lib/useLongPressReorder.ts)

/** Grip shown on each item in reorder mode */
export function DragHandle() {
  return (
    <svg width="18" height="24" viewBox="0 0 18 24" aria-hidden="true" className="reorder-handle">
      {[5, 12, 19].flatMap((y) => [5, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill="currentColor" />))}
    </svg>
  )
}

/** Move up and down without dragging: visually hidden, reachable by keyboard and screen readers */
export function MoveButtons({ name, first, last, onMove }: { name: string; first: boolean; last: boolean; onMove: (delta: -1 | 1) => void }) {
  return (
    <span className="sr-only" data-reorder-keep="">
      <button type="button" disabled={first} onClick={() => onMove(-1)}>
        Move {name} up
      </button>
      <button type="button" disabled={last} onClick={() => onMove(1)}>
        Move {name} down
      </button>
    </span>
  )
}
