import { CROWD_LABEL } from '../lib/analytics'

// Rating 1–5 of how crowded the gym was when leaving (workout.crowd_level, migration 0007).

interface Props {
  value: number | null
  onChange: (value: number | null) => void
}

export default function CrowdPicker({ value, onChange }: Props) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm text-neutral-500 dark:text-neutral-400">
        Gym crowd when leaving{value !== null && <span className="text-neutral-900 dark:text-neutral-100"> · {CROWD_LABEL[value]}</span>}
      </legend>
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n
          return (
            <button
              key={n}
              type="button"
              aria-pressed={active}
              aria-label={`${n} – ${CROWD_LABEL[n]}`}
              // Tapping the selected value again clears it
              onClick={() => onChange(active ? null : n)}
              className={`h-10 rounded-md text-base font-semibold tabular-nums ${
                active
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
              }`}
            >
              {n}
            </button>
          )
        })}
      </div>
      <div className="flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span>1 = empty</span>
        <span>5 = packed</span>
      </div>
    </fieldset>
  )
}
