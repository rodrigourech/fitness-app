import { useRef, useState } from 'react'

interface Props {
  value: string
  /** Returns false if the input is invalid; the field is then marked red. */
  onCommit: (input: string) => boolean
  inputMode: 'decimal' | 'numeric' | 'text'
  label: string
  placeholder?: string
  disabled?: boolean
  /** Marks the value orange, e.g. reps below the minimum */
  warn?: boolean
  /** Orange outline, e.g. a weight that should be raised */
  mark?: boolean
  /** Light green, e.g. reps of a deciding set that reached Max reps */
  good?: boolean
  /** Thin green outline: the reps of this set decide the next weight */
  goal?: boolean
  /**
   * A tap empties the field and shows the old value in grey; typing replaces it. Leaving without input keeps the old
   * value and saves nothing (decision 19 November 2026, workout fields kg and reps)
   */
  clearOnFocus?: boolean
}

/** Compact input: shows the stored value, keeps a draft while focused and commits valid input while typing. */
export default function Field({ value, onCommit, inputMode, label, placeholder, disabled, warn, mark, good, goal, clearOnFocus }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  // Value at focus and whether this focus already saved something (to restore it if the input is deleted again)
  const before = useRef<{ value: string; changed: boolean } | null>(null)
  const shown = draft ?? value
  const hint = clearOnFocus && draft !== null ? value || placeholder : placeholder

  return (
    <input
      aria-label={label}
      inputMode={inputMode}
      enterKeyHint="done"
      placeholder={hint}
      disabled={disabled}
      value={shown}
      onFocus={(e) => {
        if (clearOnFocus) {
          before.current = { value, changed: false }
          setDraft('')
          return
        }
        setDraft(value)
        e.target.select()
      }}
      onChange={(e) => {
        const input = e.target.value
        setDraft(input)
        if (clearOnFocus && input.trim() === '') {
          setInvalid(false)
          return
        }
        const ok = onCommit(input)
        setInvalid(!ok)
        if (ok && before.current) before.current.changed = true
      }}
      onBlur={(e) => {
        const b = before.current
        // Typed and deleted again: back to the value from before the tap
        if (clearOnFocus && b && b.changed && e.target.value.trim() === '') onCommit(b.value)
        before.current = null
        setDraft(null)
        setInvalid(false)
      }}
      className={`h-10 w-full min-w-0 rounded-md px-1 text-center text-base tabular-nums outline-none placeholder:font-normal placeholder:text-zinc-400 focus:ring-2 focus:ring-zinc-400 disabled:opacity-60 dark:placeholder:text-zinc-500 ${
        warn ? 'bg-orange-100 font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300'
          : good ? 'bg-emerald-100 font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-zinc-100 dark:bg-zinc-800'
      } ${invalid ? 'ring-2 ring-red-500' : mark ? 'font-semibold text-emerald-700 ring-2 ring-emerald-600 dark:text-emerald-300' : goal ? 'ring-1 ring-emerald-500 dark:ring-emerald-500/80' : ''}`}
    />
  )
}
