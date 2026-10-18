import { useLiveQuery } from 'dexie-react-hooks'
import type { ReactNode } from 'react'
import AppBar from '../components/AppBar'
import { DEFAULT_TRAINING_SHARES, getTrainingShares } from '../lib/settings'

const CATEGORIES = [
  ['Compound', '6–10', 'Chest Press, Lat Pulldown, Seated Row'],
  ['Isolation', '8–12', 'Triceps Pushdown, Overhead Extension, Preacher Curl, Leg Press, Leg Curl'],
  ['Small muscle', '10–15', 'Lateral Raise'],
] as const

/** Training guide: how the workout screen decides and where it is set (rewritten 19 October 2026). */
export default function InfoPage({ onDone }: { onDone: () => void }) {
  const shares = useLiveQuery(getTrainingShares, []) ?? DEFAULT_TRAINING_SHARES
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
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-zinc-500 dark:text-zinc-400">
            <tr><th className="pb-1 font-medium">Category</th><th className="pb-1 font-medium">Reps</th><th className="pb-1 font-medium">Exercises</th></tr>
          </thead>
          <tbody>
            {CATEGORIES.map(([name, reps, examples]) => (
              <tr key={name} className="border-t border-zinc-100 align-top dark:border-zinc-800">
                <td className="py-2 pr-2 font-semibold">{name}</td>
                <td className="py-2 pr-2 tabular-nums">{reps}</td>
                <td className="py-2 text-zinc-500 dark:text-zinc-400">{examples}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note>Min and Max reps count per set and side.</Note>
      </Section>

      <Section title="2 · Next workout">
        <Decision title="Increase weight" text="Every deciding set reaches Max Reps." values={[9, 9, 9]} tone="increase" />
        <Decision title="Keep weight" text="Add reps at the same weight." values={[9, 8, 6]} tone="hold" />
        <Decision title="Reduce weight" text="First deciding set below Min Reps in the last two workouts." values={[5, 5]} tone="reduce" />
        <Note>Deciding sets: with Top set on, the sets at the top weight; otherwise every work set.</Note>
      </Section>

      <Section title="3 · Sets and Rec. kg">
        <ul className="flex flex-col gap-2 text-sm">
          <Item swatch="border border-sky-400 border-dashed" title={`W · Warm-up ${shares.warmUp} %`}>10 reps before the work sets. Not counted in volume, records or progression. An empty weight takes the recommendation when checked.</Item>
          <Item swatch="border border-orange-500 bg-orange-100 dark:bg-orange-500/20" title="TOP · Top set">Heaviest set, first after the warm-up. On Increase it shows ↑ and the next weight.</Item>
          <Item swatch="border border-orange-400 border-dashed" title={`Back-off ${shares.backOff} %`}>The other sets, recommended from today’s top set.</Item>
        </ul>
        <Note>Tap a recommendation to use it. Fields never change by themselves. An orange field with ↑ should be raised.</Note>
      </Section>

      <Section title="4 · Weight step">
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <Box title="Step set · exact">
            Walks down from the top set in whole steps, as close as possible to the share. Every value exists on the machine.
            <Example>Step 4.5 · top 36 → 32</Example>
          </Box>
          <Box title="No step · estimate ≈">
            Rounded to 5 kg from 20 kg, to 1 kg below. Increase shows only ↑.
            <Example>Top 36 → ≈ 30</Example>
          </Box>
        </div>
      </Section>

      <Section title="5 · Where to set it">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="font-semibold">More › Training settings</dt><dd className="text-zinc-500 dark:text-zinc-400">Warm-up and back-off share for all exercises</dd>
          <dt className="font-semibold">Exercise · Reps</dt><dd className="text-zinc-500 dark:text-zinc-400">Max and Min reps</dd>
          <dt className="font-semibold">Exercise · Sets</dt><dd className="text-zinc-500 dark:text-zinc-400">Warm-up set, Top set</dd>
          <dt className="font-semibold">Exercise · Weights</dt><dd className="text-zinc-500 dark:text-zinc-400">Equipment, weight step in kg</dd>
        </dl>
        <Note>Open an exercise by tapping its name in the workout.</Note>
      </Section>

      <div className="flex flex-col gap-2">
        <Tip title="Effort & rest">Clean reps, about 1–2 more possible. Rest enough to repeat good form.</Tip>
        <Tip title="Progress">More reps at the same weight is progress too.</Tip>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mb-3 p-4">
      <h2 className="mb-3 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{title}</h2>
      {children}
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{children}</p>
}

function Decision({ title, text, values, tone }: { title: string; text: string; values: number[]; tone: 'increase' | 'hold' | 'reduce' }) {
  const box = tone === 'increase' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200'
    : tone === 'reduce' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
  const head = tone === 'increase' ? 'text-orange-700 dark:text-orange-300' : tone === 'reduce' ? 'text-red-700 dark:text-red-300' : ''
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-100 py-3 first:pt-0 last:border-0 dark:border-zinc-800">
      <div className="min-w-0">
        <h3 className={`text-sm font-semibold ${head}`}>{title}</h3>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{text}</p>
      </div>
      <div className="flex shrink-0 gap-1" aria-label={values.join(', ')}>
        {values.map((v, i) => <span key={i} className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold tabular-nums ${box}`}>{v}</span>)}
      </div>
    </div>
  )
}

function Item({ swatch, title, children }: { swatch: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className={`mt-1 h-4 w-6 shrink-0 rounded ${swatch}`} aria-hidden="true" />
      <span><strong className="block">{title}</strong><span className="text-zinc-500 dark:text-zinc-400">{children}</span></span>
    </li>
  )
}

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <strong className="mb-1 block">{title}</strong>
      <span className="text-zinc-600 dark:text-zinc-300">{children}</span>
    </div>
  )
}

function Example({ children }: { children: ReactNode }) {
  return <span className="mt-2 block font-semibold text-orange-700 tabular-nums dark:text-orange-300">{children}</span>
}

function Tip({ title, children }: { title: string; children: ReactNode }) {
  return <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs leading-relaxed dark:bg-zinc-900"><strong>{title}</strong><span className="text-zinc-600 dark:text-zinc-300"> · {children}</span></p>
}
