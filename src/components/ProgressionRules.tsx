import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../lib/db'
import { effective } from '../lib/workout'
import Sheet from './Sheet'

// «How progression works» (decision 19 November 2026, card «Progression_Regeln_Karte»): the rules of the app in short,
// general wording with Min and Max instead of fixed numbers. Opened from the progression sheet and from More.

function Outcome({ icon, tone, title, text }: { icon: string; tone: string; title: string; text: string }) {
  return (
    <div className={`grid grid-cols-[36px_1fr] items-center gap-3 rounded-2xl px-3 py-2.5 ${tone}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-current/15 text-lg font-extrabold">{icon}</span>
      <span>
        <span className="block text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</span>
        <span className="block text-sm text-zinc-600 dark:text-zinc-300">{text}</span>
      </span>
    </div>
  )
}

const head = 'mt-5 mb-2 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400'

interface Groups { topOn: string[]; topOff: string[]; sides: string[] }

/** Exercises of the active plans by progression type (decision 20 November 2026): top set on, off, left and right. */
async function loadGroups(): Promise<Groups> {
  const [templates, slots, exercises] = await Promise.all([db.template.toArray(), db.template_exercise.toArray(), db.exercise.toArray()])
  const active = new Set(templates.filter((t) => t.deleted_at === null && !t.archived_at).map((t) => t.id))
  const byId = new Map(exercises.map((e) => [e.id, e]))
  const ids = [...new Set(slots.filter((s) => s.deleted_at === null && active.has(s.template_id)).map((s) => s.exercise_id))]
  const groups: Groups = { topOn: [], topOff: [], sides: [] }
  for (const id of ids) {
    const ex = byId.get(id)
    if (!ex || ex.deleted_at !== null) continue
    const eff = effective(ex, byId)
    if (eff.trackingType !== 'weight_reps') continue
    const parent = ex.parent_id ? byId.get(ex.parent_id) : undefined
    const name = parent ? `${parent.name} · ${ex.name}` : ex.name
    ;(eff.topSet ? groups.topOn : groups.topOff).push(name)
    if (eff.isUnilateral) groups.sides.push(name)
  }
  for (const list of Object.values(groups)) list.sort((a: string, b: string) => a.localeCompare(b))
  return groups
}

/** «Show exercises (N)»: the exercises of the active plans that follow this type. */
function ExerciseList({ names }: { names: string[] | undefined }) {
  const [open, setOpen] = useState(false)
  if (!names) return null
  if (names.length === 0) return <div className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No exercise in your plans.</div>
  return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs font-semibold text-accent">
        {open ? 'Hide exercises' : `Show exercises (${names.length})`}
      </button>
      {open && (
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-300">
          {names.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </div>
  )
}

export default function ProgressionRules({ onClose }: { onClose: () => void }) {
  const groups = useLiveQuery(loadGroups, [])
  return (
    <Sheet title="How progression works" onClose={onClose}>
      <h3 className={`${head} mt-0`}>Your range</h3>
      <div className="rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/70">
        <p className="text-sm text-zinc-600 dark:text-zinc-300">Each exercise has a range, e.g. 8–12.</p>
        <div className="mt-2 flex h-8 items-center justify-between rounded-lg bg-gradient-to-r from-zinc-200 to-emerald-200 px-3 text-sm font-bold dark:from-zinc-700 dark:to-emerald-900">
          <span>Min 8</span><span>Max 12</span>
        </div>
      </div>

      <h3 className={head}>Which sets count</h3>
      <div className="grid grid-cols-2 items-start gap-2">
        <div className="rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/70">
          <div className="text-sm font-bold">Top set on</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-300">Only the top set, the first at the heaviest weight.</div>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            <span className="h-5 flex-1 rounded border border-orange-500 bg-orange-50 dark:bg-orange-500/10" />
            <span className="h-5 flex-1 rounded border border-dashed border-orange-400" />
            <span className="h-5 flex-1 rounded border border-dashed border-orange-400" />
          </div>
          <ExerciseList names={groups?.topOn} />
        </div>
        <div className="rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/70">
          <div className="text-sm font-bold">Top set off</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-300">All sets.</div>
          <div className="mt-2 flex gap-1" aria-hidden="true">
            <span className="h-5 flex-1 rounded bg-accent" /><span className="h-5 flex-1 rounded bg-accent" /><span className="h-5 flex-1 rounded bg-accent" />
          </div>
          <ExerciseList names={groups?.topOff} />
        </div>
      </div>
      <div className="mt-2 rounded-2xl bg-zinc-100 p-3 dark:bg-zinc-800/70">
        <div className="text-sm text-zinc-600 dark:text-zinc-300">Left and right: the weaker side counts.</div>
        <ExerciseList names={groups?.sides} />
      </div>

      <h3 className={head}>After each workout</h3>
      <div className="flex flex-col gap-2">
        <Outcome icon="↑" tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300" title="All at Max" text="Next time heavier." />
        <Outcome icon="=" tone="bg-zinc-100 text-zinc-600 dark:bg-zinc-800/70 dark:text-zinc-300" title="Not yet" text="Same weight. Try one more rep." />
        <Outcome icon="↓" tone="bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300" title="Below Min twice" text="Go one step lighter." />
        <Outcome icon="↗" tone="bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" title="You went heavier yourself" text="At least Min: keep it. Less: back to the old weight." />
      </div>

      <h3 className={head}>Good to know</h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-300">Log all sets. The app suggests, you tap to take it.</p>
    </Sheet>
  )
}
