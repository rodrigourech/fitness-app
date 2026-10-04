import { formatDuration } from '../lib/workout'

interface Props {
  value: number | null
  onChange: (seconds: number | null) => void
  /** Shown when value is null, e.g. the inherited rest. */
  fallbackLabel?: string
}

const STEP = 15

/** Rest time in 15 s steps; null means "no rest timer" or "inherit". */
export default function RestStepper({ value, onChange, fallbackLabel = 'Off' }: Props) {
  const btn = 'h-9 w-11 rounded-md bg-neutral-100 text-base font-medium dark:bg-neutral-800'
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Shorter rest" className={btn} onClick={() => onChange(value && value > STEP ? value - STEP : null)}>
        −
      </button>
      <span className="min-w-20 text-center text-base tabular-nums">{value ? formatDuration(value) : fallbackLabel}</span>
      <button type="button" aria-label="Longer rest" className={btn} onClick={() => onChange((value ?? 0) + STEP)}>
        +
      </button>
    </div>
  )
}
