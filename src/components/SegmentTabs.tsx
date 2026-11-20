import AppIcon, { type AppIconName } from './AppIcon'

// Section switch of Training and Food (decision Rodrigo 20 November 2026, design 1 «gleitende Pille mit Symbolen»):
// grey track, the active section as a white pill with icon and accent text. Large enough to hit in the gym.

export interface Segment<K extends string> {
  key: K
  label: string
  icon: AppIconName
}

export default function SegmentTabs<K extends string>({ items, value, onChange, label }: { items: Segment<K>[]; value: K; onChange: (key: K) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-0.5 rounded-2xl bg-zinc-200/80 p-1 dark:bg-zinc-900">
      {items.map((s) => {
        const on = s.key === value
        return (
          <button key={s.key} role="tab" aria-selected={on} onClick={() => onChange(s.key)}
            className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 pt-1.5 pb-1 text-[11px] font-semibold transition-colors ${on
              ? 'bg-white text-accent-ink shadow-sm dark:bg-zinc-700'
              : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'}`}>
            <AppIcon name={s.icon} className="h-[18px] w-[18px]" />
            <span className="truncate">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}
