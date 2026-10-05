import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import AppBar from '../components/AppBar'
import ExerciseSheet from '../components/ExerciseSheet'
import SyncBadge from '../components/SyncBadge'
import ThemeToggle from '../components/ThemeToggle'
import BodyTab from './BodyTab'
import ExercisesTab from './ExercisesTab'
import HistoryTab from './HistoryTab'
import StatsTab from './StatsTab'
import { signOut, type LocalUser } from '../lib/auth'
import { db, displayName, type Exercise } from '../lib/db'
import { createTemplate } from '../lib/template'
import { startWorkout } from '../lib/workout'
import TemplateEditor from './TemplateEditor'

interface Props {
  user: LocalUser
  onSignedOut: () => void
  /** A workout is running (minimised) */
  running?: boolean
  onResume?: () => void
}

interface TemplateCard {
  id: string
  name: string
  exercises: { id: string; name: string }[]
  lastDone: string | null
}

type Tab = 'templates' | 'exercises' | 'history' | 'stats' | 'body'
const TABS: Tab[] = ['templates', 'exercises', 'history', 'stats', 'body']
// The tab shows the training templates; in the UI they are called workouts (decision 5 October 2026)
const TAB_LABEL: Record<Tab, string> = { templates: 'Workouts', exercises: 'Exercises', history: 'History', stats: 'Stats', body: 'Body' }

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

export default function Home({ user, onSignedOut, running = false, onResume }: Props) {
  const cards = useLiveQuery(loadTemplates, [])
  const [sheet, setSheet] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('templates')
  const [editing, setEditing] = useState<string | null>(null)

  async function handleSignOut() {
    await signOut()
    onSignedOut()
  }

  if (editing) return <TemplateEditor templateId={editing} onDone={() => setEditing(null)} />

  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <SyncBadge onReauth={() => void handleSignOut()} />
        <ThemeToggle />
        <button
          onClick={() => void handleSignOut()}
          title={`Signed in as ${user.username}`}
          className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Sign out
        </button>
      </AppBar>

      <div role="tablist" className="mb-4 grid grid-cols-5 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md py-2 text-xs font-semibold sm:text-sm ${
              tab === t ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === 'exercises' ? (
        <ExercisesTab userId={user.id} />
      ) : tab === 'history' ? (
        <HistoryTab />
      ) : tab === 'stats' ? (
        <StatsTab userId={user.id} />
      ) : tab === 'body' ? (
        <BodyTab userId={user.id} />
      ) : cards === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : cards.length === 0 ? (
        <p className="text-zinc-500">No workouts yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {c.lastDone ? `last ${dateFormat.format(new Date(c.lastDone))}` : 'never'}
                  </span>
                  <button
                    onClick={() => setEditing(c.id)}
                    className="rounded-md bg-zinc-100 px-2.5 py-1 text-sm font-medium dark:bg-zinc-800"
                  >
                    Edit
                  </button>
                </div>
              </div>
              <ol className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                {c.exercises.map((ex, i) => (
                  <li key={i}>
                    <button onClick={() => setSheet(ex.id)} className="text-left hover:underline">
                      {ex.name}
                    </button>
                  </li>
                ))}
              </ol>
              <button
                onClick={() => (running ? onResume?.() : void startWorkout(c.id, user.id))}
                className="mt-3 w-full rounded-lg bg-accent py-3 text-base font-semibold text-accent-fg"
              >
                {running ? 'Open running workout' : 'Start workout'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === 'templates' && cards !== undefined && (
        <button
          onClick={() => void createTemplate(user.id, 'New workout').then(setEditing)}
          className="mt-3 w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
        >
          + New workout
        </button>
      )}

      {sheet && <ExerciseSheet exerciseId={sheet} onClose={() => setSheet(null)} />}
    </main>
  )
}
