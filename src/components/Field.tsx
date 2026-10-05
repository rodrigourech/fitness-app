import { useState } from 'react'

interface Props {
  value: string
  /** Returns false if the input is invalid; the field is then marked red. */
  onCommit: (input: string) => boolean
  inputMode: 'decimal' | 'numeric' | 'text'
  label: string
  placeholder?: string
  disabled?: boolean
}

/** Compact input: shows the stored value, keeps a draft while focused and commits valid input while typing. */
export default function Field({ value, onCommit, inputMode, label, placeholder, disabled }: Props) {
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
      className={`h-10 w-full min-w-0 rounded-md bg-zinc-100 px-1 text-center text-base tabular-nums outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-60 dark:bg-zinc-800 ${
        invalid ? 'ring-2 ring-red-500' : ''
      }`}
    />
  )
}
