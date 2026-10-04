import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import AppBar from '../components/AppBar'
import ExerciseSheet from '../components/ExerciseSheet'
import SyncBadge from '../components/SyncBadge'
import { signOut, type LocalUser } from '../lib/auth'
import { db, displayName, type Exercise } from '../lib/db'
import { startWorkout } from '../lib/workout'

interface Props {
  user: LocalUser
  onSignedOut: () => void
}

interface TemplateCard {
  id: string
  name: string
  exercises: { id: string; name: string }[]
  lastDone: string | null
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })

async function loadTemplates(): Promise<TemplateCard[]> {
  const [templates, templateExercises, exercises, workouts] = await Promise.all([
    db.template.filter((t) => t.deleted_at === null).toArray(),
    db.template_exercise.filter((te) => te.deleted_at === null).toArray(),
    db.exercise.toArray(),
    db.workout.filter((w) => w.deleted_at === null && w.finished_at !== null).toArray(),
  ])
  const byId = new Map<string, Exercise>(exercises.map((e) => [e.id, e]))

  return templates
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => {
      const items = templateExercises
        .filter((te) => te.template_id === t.id)
        .sort((a, b) => a.position - b.position)
        .map((te) => {
          const ex = byId.get(te.exercise_id)
          return { id: te.exercise_id, name: ex ? displayName(ex, byId) : 'Unknown exercise' }
        })
      const last = workouts
        .filter((w) => w.template_id === t.id)
        .map((w) => w.started_at)
        .sort()
        .at(-1)
      return { id: t.id, name: t.name, exercises: items, lastDone: last ?? null }
    })
}

export default function Home({ user, onSignedOut }: Props) {
  const cards = useLiveQuery(loadTemplates, [])
  const [sheet, setSheet] = useState<string | null>(null)

  async function handleSignOut() {
    await signOut()
    onSignedOut()
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <SyncBadge onReauth={() => void handleSignOut()} />
        <button
          onClick={() => void handleSignOut()}
          title={`Signed in as ${user.username}`}
          className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          Sign out
        </button>
      </AppBar>

      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Templates</h1>

      {cards === undefined ? (
        <p className="text-neutral-500">Loading …</p>
      ) : cards.length === 0 ? (
        <p className="text-neutral-500">No templates yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((c) => (
            <li key={c.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {c.lastDone ? `last ${dateFormat.format(new Date(c.lastDone))}` : 'never'}
                </span>
              </div>
              <ol className="text-sm leading-7 text-neutral-600 dark:text-neutral-300">
                {c.exercises.map((ex, i) => (
                  <li key={i}>
                    <button onClick={() => setSheet(ex.id)} className="text-left hover:underline">
                      {ex.name}
                    </button>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => void startWorkout(c.id, user.id)}
                className="mt-3 w-full rounded-lg bg-neutral-900 py-3 text-base font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
              >
                Start workout
              </button>
            </li>
          ))}
        </ul>
      )}

      {sheet && <ExerciseSheet exerciseId={sheet} onClose={() => setSheet(null)} />}
    </main>
  )
}
