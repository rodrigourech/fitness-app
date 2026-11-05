import { useState } from 'react'

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
}

/** Compact input: shows the stored value, keeps a draft while focused and commits valid input while typing. */
export default function Field({ value, onCommit, inputMode, label, placeholder, disabled, warn, mark, good }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const shown = draft ?? value

  return (
    <input
      aria-label={label}
      inputMode={inputMode}
      enterKeyHint="done"
      placeholder={placeholder}
      disabled={disabled}
      value={shown}
      onFocus={(e) => {
        setDraft(value)
        e.target.select()
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        setInvalid(!onCommit(e.target.value))
      }}
      onBlur={() => {
        setDraft(null)
        setInvalid(false)
      }}
      className={`h-10 w-full min-w-0 rounded-md px-1 text-center text-base tabular-nums outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-60 ${
        warn ? 'bg-orange-100 font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300'
          : good ? 'bg-emerald-100 font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-zinc-100 dark:bg-zinc-800'
      } ${invalid ? 'ring-2 ring-red-500' : mark ? 'font-semibold text-emerald-700 ring-2 ring-emerald-600 dark:text-emerald-300' : ''}`}
    />
  )
}
