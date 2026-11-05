import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import AppBar from '../components/AppBar'
import ExerciseSheet from '../components/ExerciseSheet'
import SyncBadge from '../components/SyncBadge'
import ThemeToggle from '../components/ThemeToggle'
import BodyTab, { PassphraseSheet } from './BodyTab'
import Sheet from '../components/Sheet'
import AppIcon from '../components/AppIcon'
import { DragHandle, MoveButtons } from '../components/ReorderParts'
import { photoKeyState } from '../lib/photos'
import ExercisesTab from './ExercisesTab'
import HistoryTab from './HistoryTab'
import StatsTab from './StatsTab'
import FoodTab from './FoodTab'
import { signOut, type LocalUser } from '../lib/auth'
import { db, displayName, type Exercise } from '../lib/db'
import { getTemplateOrder, sortByOrder } from '../lib/settings'
import { saveTemplateOrder } from '../lib/reorderSave'
import { useLongPressReorder } from '../lib/useLongPressReorder'
import { createTemplate, deleteTemplate, unarchiveTemplate } from '../lib/template'
import { offerUndo } from '../lib/undo'
import { startWorkout } from '../lib/workout'
import ChangePasswordSheet from '../components/ChangePasswordSheet'
import HomeTab, { type HomeTarget } from './HomeTab'
import TemplateEditor from './TemplateEditor'
import TrashPage from './TrashPage'
import InfoPage from './InfoPage'
import TrainingSettingsPage from './TrainingSettingsPage'
import { isBetaSandbox } from '../lib/environment'
import { BUILD_TIME, checkForUpdate } from '../lib/update'
import { useWide } from '../lib/useWide'

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
  /** Archived workouts are listed in the section Archive (decision 9 October 2026) */
  archivedAt: string | null
}

type Tab = 'home' | 'templates' | 'exercises' | 'history' | 'stats' | 'body' | 'food'
// Food in the middle and highlighted, used daily (decision 1 November 2026)
const TABS: Tab[] = ['home', 'templates', 'food', 'stats', 'body']
// Laptop sidebar: also Exercises and History directly (decision 3 November 2026)
const DESKTOP_TABS: Tab[] = ['exercises', 'history']
// The tab shows the training templates; in the UI they are called workouts (decision 5 October 2026)
const TAB_LABEL: Record<Tab, string> = { home: 'Home', templates: 'Workouts', exercises: 'Exercises', history: 'History', stats: 'Stats', body: 'Body', food: 'Food' }

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'long' })

async function loadTemplates(): Promise<TemplateCard[]> {
  const [templates, templateExercises, exercises, workouts, order] = await Promise.all([
    db.template.filter((t) => t.deleted_at === null).toArray(),
    db.template_exercise.filter((te) => te.deleted_at === null).toArray(),
    db.exercise.toArray(),
    db.workout.filter((w) => w.deleted_at === null && w.finished_at !== null).toArray(),
    getTemplateOrder(),
  ])
  const byId = new Map<string, Exercise>(exercises.map((e) => [e.id, e]))

  // Order chosen by the user in Workouts (user_setting template_order), else by name
  return sortByOrder(templates, order).map((t) => {
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
      return { id: t.id, name: t.name, exercises: items, lastDone: last ?? null, archivedAt: t.archived_at ?? null }
  })
}

export default function Home({ user, onSignedOut, running = false, onResume }: Props) {
  const cards = useLiveQuery(loadTemplates, [])
  const [sheet, setSheet] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('home')
  const [account, setAccount] = useState(false)
  const [info, setInfo] = useState(false)
  const [training, setTraining] = useState(false)
  const [more, setMore] = useState(false)
  const wide = useWide()
  const [photos, setPhotos] = useState(false)
  const photoAccess = useLiveQuery(photoKeyState, [])
  const [showArchive, setShowArchive] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const active = cards?.filter((c) => !c.archivedAt)
  const archived = cards?.filter((c) => c.archivedAt).sort((a, b) => b.archivedAt!.localeCompare(a.archivedAt!))

  function open(target: HomeTarget) {
    setMore(false)
    if (target === 'trash') setTrash(true)
    else if (target === 'info') setInfo(true)
    else if (target === 'account') setAccount(true)
    else if (target === 'photos') setPhotos(true)
    else setTab(target)
  }
  const [editing, setEditing] = useState<string | null>(null)
  const [trash, setTrash] = useState(false)

  async function handleSignOut() {
    await signOut()
    onSignedOut()
  }

  if (editing) return <TemplateEditor templateId={editing} onDone={() => setEditing(null)} />
  if (trash) return <TrashPage onDone={() => setTrash(false)} />
  if (info) return <InfoPage onDone={() => setInfo(false)} />
  if (training) return <TrainingSettingsPage userId={user.id} onDone={() => setTraining(false)} />

  return (
    <main className="home-shell mx-auto max-w-xl px-4">
      <AppBar>
        <button onClick={() => setInfo(true)} className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
          Info
        </button>
        <SyncBadge onReauth={() => void handleSignOut()} />
        <ThemeToggle />
      </AppBar>

      <nav className="home-navigation" aria-label="Main navigation">
        <span className="home-nav-brand"><span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />Fitness App</span>
        {[...TABS, ...DESKTOP_TABS].map((t) => (
          <button
            key={t}
            className={DESKTOP_TABS.includes(t) ? 'home-nav-desktop' : undefined}
            aria-current={tab === t ? 'page' : undefined}
            onClick={() => setTab(t)}
          >
            <span className="home-nav-icon"><AppIcon name={{ home: 'home', templates: 'workout', stats: 'stats', body: 'body', exercises: 'workout', history: 'history', food: 'food' }[t]} /></span>
            {TAB_LABEL[t]}
          </button>
        ))}
        <span className="home-nav-desktop home-nav-gap" aria-hidden="true" />
        <button onClick={() => setMore(true)} aria-expanded={more} aria-current={!wide && (tab === 'exercises' || tab === 'history') ? 'page' : undefined}><span className="home-nav-icon"><AppIcon name="more" /></span>More</button>
      </nav>
      {tab !== 'home' && tab !== 'food' && <h1 className="mb-4 text-2xl font-semibold tracking-tight">{TAB_LABEL[tab]}</h1>}

      {tab === 'exercises' ? (
        <ExercisesTab userId={user.id} />
      ) : tab === 'history' ? (
        <HistoryTab />
      ) : tab === 'food' ? (
        <FoodTab userId={user.id} />
      ) : tab === 'stats' ? (
        <StatsTab userId={user.id} />
      ) : tab === 'body' ? (
        <BodyTab userId={user.id} />
      ) : tab === 'home' ? (
        <HomeTab
          cards={active?.map((c) => ({ id: c.id, name: c.name, lastDone: c.lastDone, exerciseCount: c.exercises.length }))}
          running={running}
          onStart={(id) => void startWorkout(id, user.id)}
          onResume={onResume}
          onOpen={open}
        />
      ) : cards === undefined ? (
        <p className="text-zinc-500">Loading …</p>
      ) : (
        <>
          <ActiveWorkouts
            cards={active ?? []}
            userId={user.id}
            running={running}
            onResume={onResume}
            onEdit={setEditing}
            onShowExercise={setSheet}
          />

          <div className="mt-6">
            <SectionToggle label="Archive" count={archived?.length ?? 0} open={showArchive} onToggle={() => setShowArchive((v) => !v)} />
          </div>
          {showArchive && (
            <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:items-start xl:grid-cols-3">
              {archived?.length === 0 && <p className="text-sm text-zinc-500">Archived workouts appear here.</p>}
              {archived?.map((c) => (
                <li key={c.id} className="card p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.name}</span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        Archived {archiveFormat.format(new Date(c.archivedAt!))} · {c.exercises.length} {c.exercises.length === 1 ? 'exercise' : 'exercises'}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button
                        onClick={() => void db.template.get(c.id).then((row) => row && unarchiveTemplate(row))}
                        className="rounded-md bg-zinc-100 px-2.5 py-1 text-sm font-medium dark:bg-zinc-800"
                      >
                        Restore
                      </button>
                      <button onClick={() => setEditing(c.id)} className="rounded-md px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">
                        Edit
                      </button>
                      <button onClick={() => setConfirmDelete(c.id)} aria-label="Delete" className="rounded-md px-2 py-1 text-sm text-red-600 dark:text-red-400">
                        Delete
                      </button>
                    </span>
                  </div>
                  {confirmDelete === c.id && (
                    <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <p className="mb-2 text-sm">Move «{c.name}» to the trash? It can be restored there for 30 days.</p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-lg py-2 text-sm">
                          Cancel
                        </button>
                        <button
                          onClick={() =>
                            void db.template.get(c.id).then(async (row) => {
                              if (!row) return
                              await deleteTemplate(row)
                              setConfirmDelete(null)
                              offerUndo(`${c.name} moved to trash`, c.id)
                            })
                          }
                          className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {account && (isBetaSandbox ? (
        <div className="mt-4 card p-4 text-sm">Password changes are available in the live app. <button onClick={() => setAccount(false)} className="ml-2 font-semibold text-accent-ink">Close</button></div>
      ) : <ChangePasswordSheet onClose={() => setAccount(false)} />)}
      {more && <Sheet title="More" onClose={() => setMore(false)}>
        <div className="home-more-links">
          <button onClick={() => open('exercises')}><AppIcon name="workout" />Exercises</button>
          <button onClick={() => open('history')}><AppIcon name="history" />History</button>
          <button onClick={() => open('photos')}><AppIcon name="photos" />Photo passphrase</button>
          <button onClick={() => open('trash')}><AppIcon name="trash" />Trash</button>
          <button onClick={() => { setMore(false); setTraining(true) }}><AppIcon name="stats" />Training settings</button>
          <button onClick={() => open('info')}><AppIcon name="guide" />Training guide</button>
          <button onClick={() => open('account')}><AppIcon name="body" />Change password</button>
          <button onClick={() => void handleSignOut()}><AppIcon name="arrow" />Sign out · {user.username}</button>
        </div>
        <UpdateRow />
      </Sheet>}
      {photos && (isBetaSandbox ? <Sheet title="Photo passphrase" onClose={() => setPhotos(false)}><p className="text-sm">Photo changes are available in the live app.</p><button onClick={() => { setPhotos(false); setTab('body') }} className="home-primary mt-4">Open Body</button></Sheet> : photoAccess === undefined ? <Sheet title="Photo passphrase" onClose={() => setPhotos(false)}>Checking photo access …</Sheet> : <PassphraseSheet mode={photoAccess === 'ready' ? 'change' : photoAccess} userId={user.id} onClose={() => setPhotos(false)} />)}
      {sheet && <ExerciseSheet exerciseId={sheet} onClose={() => setSheet(null)} />}
    </main>
  )
}

interface ActiveWorkoutsProps {
  cards: TemplateCard[]
  userId: string
  running: boolean
  onResume?: () => void
  onEdit: (id: string) => void
  onShowExercise: (id: string) => void
}

/** Active workouts; long press on a card reorders them (decision 5 November 2026, replaces the button Reorder). */
function ActiveWorkouts({ cards, userId, running, onResume, onEdit, onShowExercise }: ActiveWorkoutsProps) {
  const [showActive, setShowActive] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const ids = useMemo(() => cards.map((c) => c.id), [cards])
  const byId = new Map(cards.map((c) => [c.id, c]))
  const reorder = useLongPressReorder({
    ids,
    enabled: cards.length > 1,
    label: (id) => byId.get(id)?.name ?? 'Workout',
    onCommit: (next) => saveTemplateOrder(userId, ids, next),
  })
  const sorting = reorder.active && showActive

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <SectionToggle label="Active" count={cards.length} open={showActive} onToggle={() => { reorder.setActive(false); setShowActive((v) => !v) }} />
        </div>
        {sorting && (
          <button onClick={() => reorder.setActive(false)} className="mb-2 rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
            Done
          </button>
        )}
      </div>
      {showActive && (
        <>
          {sorting && <p className="-mt-1 mb-2 text-sm text-zinc-500 dark:text-zinc-400">Drag to reorder</p>}
          {cards.length === 0 && <p className="mb-2 text-zinc-500">No active workouts.</p>}
          <ul
            {...reorder.listProps}
            aria-label="Active workouts"
            className={`${reorder.listProps.className} flex flex-col gap-3 ${sorting ? '' : 'lg:grid lg:grid-cols-2 lg:items-start xl:grid-cols-3'}`}
          >
            {reorder.order.map((id, idx) => {
              const c = byId.get(id)
              if (!c) return null
              const open = expanded.has(c.id) && !sorting
              const subtitle = `${c.exercises.length} ${c.exercises.length === 1 ? 'exercise' : 'exercises'} · ${c.lastDone ? `last ${dateFormat.format(new Date(c.lastDone))}` : 'never'}`
              return (
                <li key={c.id} {...reorder.itemProps(c.id, 'card p-3')} aria-label={sorting ? `${c.name}, position ${idx + 1} of ${cards.length}` : undefined}>
                  {sorting ? (
                    <div className="flex min-h-11 items-center gap-3">
                      <DragHandle />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-semibold">{c.name}</span>
                        <span className="block text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</span>
                      </span>
                      <MoveButtons name={c.name} first={idx === 0} last={idx === cards.length - 1} onMove={(d) => reorder.move(c.id, d)} />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n })}
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={`shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-90' : ''}`}>
                          <path d="M9 6l6 6-6 6" />
                        </svg>
                        <span className="min-w-0">
                          <span className="block truncate text-base font-semibold">{c.name}</span>
                          <span className="block text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</span>
                        </span>
                      </button>
                      <button
                        onClick={() => (running ? onResume?.() : void startWorkout(c.id, userId))}
                        className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg"
                      >
                        {running ? 'Open' : 'Start'}
                      </button>
                    </div>
                  )}
                  {open && (
                    <div className="mt-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                      <ol className="text-sm leading-7 text-zinc-600 dark:text-zinc-300">
                        {c.exercises.map((ex, i) => (
                          <li key={i}>
                            <button onClick={() => onShowExercise(ex.id)} className="text-left hover:underline">
                              {ex.name}
                            </button>
                          </li>
                        ))}
                      </ol>
                      <button onClick={() => onEdit(c.id)} className="mt-2 rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium dark:bg-zinc-800">
                        Edit workout
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
            {reorder.placeholder && <li aria-hidden="true" className="reorder-placeholder" style={reorder.placeholder} />}
          </ul>
          <p className="sr-only" aria-live="polite">{reorder.announcement}</p>
          {!sorting && (
            <button
              onClick={() => void createTemplate(userId, 'New workout').then(onEdit)}
              className="mt-3 w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm font-semibold text-zinc-600 lg:w-auto lg:px-8 dark:border-zinc-700 dark:text-zinc-300"
            >
              + New workout
            </button>
          )}
        </>
      )}
    </>
  )
}

const archiveFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function SectionToggle({ label, count, open, onToggle }: { label: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={open} className="mb-2 flex w-full items-center justify-between py-1 text-left">
      <span className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">
        {label} <span className="font-normal">({count})</span>
      </span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={`text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}>
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  )
}

const versionFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Version and a manual update check (decision 5 November 2026: no more clearing Safari data). */
function UpdateRow() {
  const [state, setState] = useState<'idle' | 'checking' | 'updating' | 'current' | 'offline' | 'unsupported'>('idle')
  const text = { idle: 'Check for updates', checking: 'Checking …', updating: 'Updating, the app reloads …', current: 'Up to date', offline: 'Offline', unsupported: 'Reload' }[state]
  return (
    <div className="mt-4 flex items-center justify-between gap-3 px-1 text-xs text-zinc-500 dark:text-zinc-400">
      <span>Version {versionFormat.format(new Date(BUILD_TIME))}</span>
      <button
        disabled={state === 'checking' || state === 'updating'}
        onClick={() => {
          if (state === 'unsupported') return window.location.reload()
          setState('checking')
          void checkForUpdate().then(setState).catch(() => setState('unsupported'))
        }}
        className="rounded-md bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-200"
      >
        {text}
      </button>
    </div>
  )
}
