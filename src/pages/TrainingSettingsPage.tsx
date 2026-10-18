import { useLiveQuery } from 'dexie-react-hooks'
import AppBar from '../components/AppBar'
import Field from '../components/Field'
import { DEFAULT_TRAINING_SHARES, getTrainingShares, saveTrainingShares, type TrainingShares } from '../lib/settings'
import { parseNumber } from '../lib/workout'

/** Central training parameters (decision 19 October 2026): shares of the top set for warm-up and back-off sets. */
export default function TrainingSettingsPage({ userId, onDone }: { userId: string; onDone: () => void }) {
  const shares = useLiveQuery(getTrainingShares, []) ?? DEFAULT_TRAINING_SHARES

  function commit(key: keyof TrainingShares, min: number, max: number) {
    return (input: string) => {
      const n = parseNumber(input)
      if (n === undefined || n === null || !Number.isInteger(n) || n < min || n > max) return false
      void saveTrainingShares(userId, { ...shares, [key]: n })
      return true
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <button onClick={onDone} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg">Back</button>
      </AppBar>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Training settings</h1>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">Apply to every exercise. Rep ranges, top set and weight step are set per exercise.</p>
      <section className="card flex flex-col divide-y divide-zinc-100 px-4 dark:divide-zinc-800">
        <Row title="Warm-up" hint="Share of the top set for set W (20–90 %)">
          <Field label="Warm-up percent" inputMode="numeric" value={String(shares.warmUp)} onCommit={commit('warmUp', 20, 90)} />
        </Row>
        <Row title="Back-off sets" hint="Share of the top set for the other sets (50–95 %)">
          <Field label="Back-off percent" inputMode="numeric" value={String(shares.backOff)} onCommit={commit('backOff', 50, 95)} />
        </Row>
      </section>
    </main>
  )
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
      </span>
      <span className="flex w-24 shrink-0 items-center gap-1">{children}<span className="text-sm text-zinc-500">%</span></span>
    </div>
  )
}
