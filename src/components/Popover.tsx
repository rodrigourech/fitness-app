import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  /** Content of the trigger button. */
  label: ReactNode
  ariaLabel?: string
  triggerClassName?: string
  align?: 'left' | 'right'
  /** Open on mouse hover as well (desktop); touch devices open on tap. */
  hover?: boolean
  children: ReactNode | ((close: () => void) => ReactNode)
}

/** Small floating panel next to a button. Does not change the layout; closes on outside tap or Escape. */
export default function Popover({ label, ariaLabel, triggerClassName, align = 'left', hover, children }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const lastPointer = useRef('')

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)
  const mouse = (fn: () => void) => (e: React.PointerEvent) => {
    if (hover && e.pointerType === 'mouse') fn()
  }

  return (
    <span ref={ref} className="relative inline-flex" onPointerEnter={mouse(() => setOpen(true))} onPointerLeave={mouse(close)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        // With a mouse, hover already opened it: a click keeps it open instead of toggling it closed
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType
        }}
        onClick={() => setOpen((v) => (hover && lastPointer.current === 'mouse' ? true : !v))}
        className={triggerClassName}
      >
        {label}
      </button>
      {open && (
        <span
          role="dialog"
          className={`absolute top-full z-20 mt-1 w-64 max-w-[80vw] rounded-xl border border-zinc-200 bg-white p-3 text-left text-sm font-normal text-zinc-800 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {typeof children === 'function' ? children(close) : children}
        </span>
      )}
    </span>
  )
}
