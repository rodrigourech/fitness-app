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

const CATEGORIES = [
  ['Compound', '6–9', 'yes', 'Chest Press, Lat Pulldown, Seated Row'],
  ['Isolation', '8–12', 'no', 'Triceps Pushdown, Preacher Curl, Leg Press and Leg Curl (with warm-up)'],
  ['Small muscle', '10–15', 'no', 'Lateral Raise'],
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
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Build reps in the range. Then add weight.</p>
      </header>

      <Section title="1 · Rep ranges">
        <table className="w-full text-xs">
          <thead className="text-left text-zinc-500 dark:text-zinc-400">
            <tr><th className="py-1 pr-2 font-medium">Category</th><th className="py-1 pr-2 font-medium">Reps</th><th className="py-1 pr-2 font-medium">Warm-up</th><th className="py-1 font-medium">Exercises</th></tr>
          </thead>
          <tbody>
            {CATEGORIES.map(([name, reps, warm, examples]) => (
              <tr key={name} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-1.5 pr-2 font-semibold">{name}</td><td className="py-1.5 pr-2 tabular-nums">{reps}</td><td className="py-1.5 pr-2">{warm}</td>
                <td className="py-1.5 text-zinc-500 dark:text-zinc-400">{examples}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Min Reps and Max Reps per set and side. Each exercise can override its range and warm-up.</p>
      </Section>

      <Section title="2 · Next workout">
        <Decision title="Increase weight" description="Top set (or every set without top set) reaches Max Reps." values={[9, 9, 9]} tone="increase" />
        <Decision title="Keep weight" description="Add reps at the same weight." values={[9, 8, 6]} tone="hold" />
        <Decision title="Reduce weight" description="Top set (or first set) below Min Reps in the last two workouts." values={[5, 5]} tone="reduce" label="Top set, last two workouts" />
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">Example Compound 6–9. With top set on, back-off sets do not count.</p>
      </Section>

      <Section title="3 · Top set and Rec. kg">
        <p className="text-sm">Setting <strong>Top set</strong> per exercise. <span className="text-zinc-500 dark:text-zinc-400">On for Chest Press, Lat Pulldown, Seated Row, Leg Press, Triceps Pushdown, Preacher Curl and Leg Curl; off for Lateral Raise.</span></p>
        <div className="mt-2 flex items-center gap-1.5 text-center text-xs">
          <Step label="Top set today" value="40" />
          <span className="text-zinc-400" aria-hidden="true">→</span>
          <Step label="Back-off 80 %" value="32" />
          <span className="text-zinc-400" aria-hidden="true">→</span>
          <Step label="Rec. kg" value="30" highlight />
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-zinc-600 dark:text-zinc-300">
          <li><strong>On:</strong> the heaviest set is TOP; every other set is recommended at 80 % of today's top set (starting rule, adjusted after feedback). The percentage shows the share after rounding.</li>
          <li><strong>Off:</strong> equal sets, no TOP and no recommendations for work sets.</li>
          <li>Best practice: top set as the first work set right after the warm-up, then the back-off sets.</li>
          <li>Rounded to 5 kg from 20 kg, below that to 0.5 kg; exact halves round down.</li>
          <li>Tap a recommendation to use it. Fields never change by themselves.</li>
          <li><span className="font-semibold text-orange-700 dark:text-orange-300">Orange field ↑</span> = raise this weight. It clears once raised or checked.</li>
        </ul>
      </Section>

      <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
        <Tip title="Warm-up">Set W, 10 reps at about 50 % of the top set. An empty weight takes the recommendation when checked. Not counted in volume, records or progression.</Tip>
        <Tip title="Effort & rest">Clean reps, about 1–2 more possible. Rest enough to repeat good form.</Tip>
        <Tip title="Progress">More reps at the same weight is progress too.</Tip>
      </div>

      <div className="mt-4 flex flex-col gap-2 text-sm">
        <Details title="How the app decides">
          <ul className="list-disc space-y-1 pl-4">
            <li>Same exercise across all workouts, work sets only.</li>
            <li>Top set on: the sets at the top weight of the last workout decide. Off: every work set decides.</li>
            <li>Increase: every deciding set reaches Max Reps, on both sides, with at least the planned sets.</li>
            <li>Reduce: first deciding set below Min Reps twice, same weight and rest.</li>
            <li>Back-off sets: 80 % of today's top set.</li>
            <li>Warm-up ≈ 50 % of today's top set.</li>
          </ul>
          <p className="mt-2 text-xs">You decide the weight. The app only marks and recommends.</p>
        </Details>
        <Details title="Sources">
          <p className="text-xs">Research informs the approach. Exact thresholds are practical rules.</p>
          <ul className="mt-2 space-y-2">
            {SOURCES.map(([name, topic, href]) => (
              <li key={href}><a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-ink underline underline-offset-2">{name}</a><span className="text-zinc-500 dark:text-zinc-400"> · {topic}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Reviewed 18 October 2026. Sources need an internet connection.</p>
        </Details>
      </div>
    </main>
  )
}

function Decision({ title, description, values, tone, label = 'Work-set reps' }: {
  title: string; description: string; values: number[]; tone: 'increase' | 'hold' | 'reduce'; label?: string
}) {
  const colours = tone === 'increase' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' : tone === 'reduce'
    ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 py-3 first:pt-0 dark:border-zinc-800">
      <div className="min-w-0 flex-1 basis-40">
        <h3 className={`text-sm font-semibold ${tone === 'increase' ? 'text-orange-700 dark:text-orange-300' : tone === 'reduce' ? 'text-red-700 dark:text-red-300' : ''}`}>{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <div role="img" aria-label={`${label}: ${values.join(', ')}`} className="flex gap-1">
        {values.map((value, index) => <span key={index} className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-semibold tabular-nums ${colours}`}>{value}</span>)}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-3 p-3">
      <h2 className="mb-2 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{title}</h2>
      {children}
    </section>
  )
}

function Step({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <span className="flex-1 rounded-lg bg-zinc-100 px-1.5 py-1.5 leading-snug dark:bg-zinc-800">
      <span className="block text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className={`block font-semibold tabular-nums ${highlight ? 'text-orange-700 dark:text-orange-300' : ''}`}>{value}</span>
    </span>
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
