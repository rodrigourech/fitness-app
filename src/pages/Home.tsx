import { useLiveQuery } from 'dexie-react-hooks'
import SyncBadge from '../components/SyncBadge'
import { signOut, type LocalUser } from '../lib/auth'
import { db, displayName, type Exercise } from '../lib/db'

interface Props {
  user: LocalUser
  onSignedOut: () => void
}

interface TemplateCard {
  id: string
  name: string
  exercises: string[]
  lastDone: string | null
}

const dateFormat = new Intl.DateTimeFormat('de-CH', { weekday: 'short', day: 'numeric', month: 'long' })

async function loadTemplates(): Promise<TemplateCard[]> {
  const [templates, templateExercises, exercises, workouts] = await Promise.all([
    db.template.filter((t) => t.deleted_at === null).toArray(),
    db.template_exercise.filter((te) => te.deleted_at === null).toArray(),
    db.exercise.toArray(),
    db.workout.filter((w) => w.deleted_at === null).toArray(),
  ])
  const byId = new Map<string, Exercise>(exercises.map((e) => [e.id, e]))

  return templates
    .sort((a, b) => a.name.localeCompare(b.name, 'de-CH'))
    .map((t) => {
      const names = templateExercises
        .filter((te) => te.template_id === t.id)
        .sort((a, b) => a.position - b.position)
        .map((te) => {
          const ex = byId.get(te.exercise_id)
          return ex ? displayName(ex, byId) : 'Unbekannte Übung'
        })
      const last = workouts
        .filter((w) => w.template_id === t.id)
        .map((w) => w.started_at)
        .sort()
        .at(-1)
      return { id: t.id, name: t.name, exercises: names, lastDone: last ?? null }
    })
}

export default function Home({ user, onSignedOut }: Props) {
  const cards = useLiveQuery(loadTemplates, [])

  async function handleSignOut() {
    await signOut()
    onSignedOut()
  }

  return (
    <main className="mx-auto max-w-xl px-4 pt-[max(env(safe-area-inset-top),1.5rem)] pb-10">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Vorlagen</h1>
        <div className="flex items-center gap-1">
          <SyncBadge onReauth={handleSignOut} />
          <button
            onClick={handleSignOut}
            title={`Angemeldet als ${user.username}`}
            className="rounded-md px-2 py-1 text-sm text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
          >
            Abmelden
          </button>
        </div>
      </header>

      {cards === undefined ? (
        <p className="text-neutral-500">Laden …</p>
      ) : cards.length === 0 ? (
        <p className="text-neutral-500">Keine Vorlagen vorhanden.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {cards.map((c) => (
            <li key={c.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">{c.name}</h2>
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
                  {c.lastDone ? `zuletzt ${dateFormat.format(new Date(c.lastDone))}` : 'noch nie'}
                </span>
              </div>
              <ol className="text-sm leading-6 text-neutral-600 dark:text-neutral-300">
                {c.exercises.map((name, i) => (
                  <li key={i}>{name}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
