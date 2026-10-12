import type { ReactNode } from 'react'
import AppBar from '../components/AppBar'

const SOURCES = [
  ['ACSM 2026', 'Training principles', 'https://pubmed.ncbi.nlm.nih.gov/41843416/'],
  ['Lopez 2021', 'Rep ranges', 'https://pubmed.ncbi.nlm.nih.gov/33433148/'],
  ['Plotkin 2022', 'Reps or weight progression', 'https://pubmed.ncbi.nlm.nih.gov/36199287/'],
  ['Refalo 2024', 'Effort without failure', 'https://pubmed.ncbi.nlm.nih.gov/38393985/'],
  ['Singer 2024', 'Rest between sets', 'https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2024.1429789/full'],
  ['Fradkin 2010', 'Warm-up and performance', 'https://pubmed.ncbi.nlm.nih.gov/19996770/'],
  ['Viveiros 2024', 'Short warm-up sets', 'https://pubmed.ncbi.nlm.nih.gov/39593476/'],
] as const

/** A short decision guide; precise conditions and research remain available on demand. */
export default function InfoPage({ onDone }: { onDone: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <button onClick={onDone} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg">Back</button>
      </AppBar>

      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Training guide</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Build reps. Then add weight.</p>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-accent-soft p-3 text-accent-ink">
          <p className="text-2xl font-semibold tabular-nums">10</p><p className="text-xs">Target reps</p>
        </div>
        <div className="card p-3">
          <p className="text-2xl font-semibold tabular-nums">7</p><p className="text-xs text-zinc-500 dark:text-zinc-400">Minimum reps</p>
        </div>
      </div>
      <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">Defaults per set and side. Your exercise or workout can override them.</p>

      <section aria-labelledby="weight-hints" className="card overflow-hidden">
        <h2 id="weight-hints" className="px-4 pt-3 text-sm font-semibold">Next workout</h2>
        <Decision title="Increase weight" description="Every work set reaches the target." values={[10, 10, 10]} tone="increase" />
        <Decision title="Keep weight" description="Build reps at the same weight." values={[10, 9, 7]} tone="hold" />
        <Decision title="Reduce weight" description="First set below minimum in two comparable workouts." values={[6, 6]} tone="reduce" label="First set, last two workouts" />
      </section>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
        <Tip title="Warm Up">5–6 light reps.</Tip>
        <Tip title="Effort & rest">Clean reps, about 1–2 more possible. Rest enough to repeat good form.</Tip>
        <Tip title="Progress">27 → 28 total reps is progress at the same weight and set count.</Tip>
      </div>

      <div className="mt-4 flex flex-col gap-2 text-sm">
        <Details title="How the app decides">
          <ul className="list-disc space-y-1 pl-4">
            <li>Compare the same workout and variant. Work sets only.</li>
            <li>Increase: every set reaches the target, on both sides.</li>
            <li>Reduce: first set below minimum twice. Same weight, sets and rest.</li>
            <li>Rep change: all sets complete, same weights and set count.</li>
          </ul>
          <p className="mt-2 text-xs">You decide whether to change the weight.</p>
        </Details>
        <Details title="Sources">
          <p className="text-xs">Research informs the approach. Exact thresholds are practical rules.</p>
          <ul className="mt-2 space-y-2">
            {SOURCES.map(([name, topic, href]) => (
              <li key={href}><a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-ink underline underline-offset-2">{name}</a><span className="text-zinc-500 dark:text-zinc-400"> · {topic}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Reviewed 12 October 2026. Sources need an internet connection.</p>
        </Details>
      </div>
    </main>
  )
}

function Decision({ title, description, values, tone, label = 'Work-set reps' }: {
  title: string; description: string; values: number[]; tone: 'increase' | 'hold' | 'reduce'; label?: string
}) {
  const colours = tone === 'increase' ? 'bg-accent-soft text-accent-ink' : tone === 'reduce'
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 last:border-0 dark:border-zinc-800">
      <div className="min-w-0 flex-1 basis-40">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <div role="img" aria-label={`${label}: ${values.join(', ')}`} className="flex gap-1">
        {values.map((value, index) => <span key={index} className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold tabular-nums ${colours}`}>{value}</span>)}
      </div>
    </div>
  )
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs leading-relaxed dark:bg-zinc-900"><strong>{title}</strong><span className="text-zinc-600 dark:text-zinc-300"> · {children}</span></p>
}

function Details({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="card p-3">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{children}</div>
    </details>
  )
}
