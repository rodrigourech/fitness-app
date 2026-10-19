import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { db, displayName, type Exercise } from '../lib/db'
import { addLink, createVariant, linkLabel, linksFor, normalizeUrl, removeLink, updateExercise } from '../lib/exercise'
import { effective, parseNumber } from '../lib/workout'
import { regionName } from '../lib/muscles'
import BodyMap from './BodyMap'
import RestStepper from './RestStepper'
import { formatDuration } from '../lib/workout'
import Field from './Field'
import { validRepetitionTargets } from '../lib/training'
import { DEFAULT_TRAINING_SHARES, getTrainingShares } from '../lib/settings'
import { poundStep } from '../lib/topset'

interface Props {
  exerciseId: string
  onClose: () => void
}

/** Bottom sheet of an exercise as a settings list: Exercise details, Training, Setup; each row opens a detail view. */
export default function ExerciseSheet({ exerciseId, onClose }: Props) {
  // The sheet can navigate between a main exercise and its variants
  const [currentId, setCurrentId] = useState(exerciseId)
  // Detail view of one setting (list on the first level, decision 19 October 2026)
  const [page, setPage] = useState<Page | null>(null)
  const [variantName, setVariantName] = useState('')
  const data = useLiveQuery(async () => {
    const ex = await db.exercise.get(currentId)
    if (!ex) return null
    const parent = ex.parent_id ? await db.exercise.get(ex.parent_id) : undefined
    const byId = new Map<string, Exercise>([[ex.id, ex], ...(parent ? ([[parent.id, parent]] as const) : [])])
    const mainId = parent?.id ?? ex.id
    const variants = (await db.exercise.where('parent_id').equals(mainId).toArray())
      .filter((v) => v.deleted_at === null)
      .sort((a, b) => a.name.localeCompare(b.name))
    return { ex, parent, byId, variants, links: await linksFor(ex) }
  }, [currentId])

  const shares = useLiveQuery(getTrainingShares, []) ?? DEFAULT_TRAINING_SHARES
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [urlError, setUrlError] = useState(false)

  if (data === undefined) return null
  if (data === null) return null
  const { ex, parent, byId, variants, links } = data
  const main = parent ?? ex
  const eff = effective(ex, byId)
  const lbStep = poundStep(ex.weight_step ?? parent?.weight_step ?? null)
  const focusInherited = ex.parent_id !== null && ex.focus_muscles == null

  function toggleRegion(region: string) {
    const current = eff.focusMuscles
    const next = current.includes(region) ? current.filter((r) => r !== region) : [...current, region]
    void updateExercise(ex, { focus_muscles: next })
  }

  async function submitVariant(e: FormEvent) {
    e.preventDefault()
    if (!variantName.trim()) return
    const id = await createVariant(main, variantName, null)
    setVariantName('')
    setCurrentId(id)
  }

  async function submitLink(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizeUrl(url)
    if (!normalized) {
      setUrlError(true)
      return
    }
    await addLink(ex, normalized, title.trim() || null)
    setUrl('')
    setTitle('')
    setUrlError(false)
  }


  const weightReps = eff.trackingType === 'weight_reps'
  const stepKg = ex.weight_step ?? parent?.weight_step ?? null
  const restS = ex.default_rest_s ?? parent?.default_rest_s ?? null
  const equipment = EQUIPMENT.find(([value]) => value === main.equipment)?.[1] ?? 'Not set'
  const inheritsSwitch = parent && (ex.warm_up != null || ex.top_set != null)
  const back = () => setPage(null)

  let body: React.ReactNode
  if (page === 'details') {
    body = (
      <Detail title="Exercise details" onBack={back}>
        <TextField
          label={parent ? 'Exercise (shared by all variants)' : 'Exercise'}
          value={main.name}
          required
          onSave={(v) => updateExercise(main, { name: v ?? main.name })}
        />
        <div className="flex flex-col gap-2">
          <span className="text-sm font-semibold">Variant</span>
          <ul className="flex flex-wrap gap-1.5">
            <li>
              <button onClick={() => setCurrentId(main.id)} aria-current={!parent} className={`rounded-full px-3 py-1 text-sm ${chip(!parent)}`}>
                Main
              </button>
            </li>
            {variants.map((v) => (
              <li key={v.id}>
                <button onClick={() => setCurrentId(v.id)} aria-current={v.id === ex.id} className={`rounded-full px-3 py-1 text-sm ${chip(v.id === ex.id)}`}>
                  {v.name}
                </button>
              </li>
            ))}
          </ul>
          {parent && <TextField label="Variant name" value={ex.name} required onSave={(v) => updateExercise(ex, { name: v ?? ex.name })} />}
          <form onSubmit={(e) => void submitVariant(e)} className="flex gap-2">
            <input
              aria-label="New variant name"
              placeholder="New variant, e.g. Rope"
              value={variantName}
              onChange={(e) => setVariantName(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700"
            />
            <button type="submit" disabled={!variantName.trim()} className="rounded-lg bg-accent px-3 text-sm font-semibold text-accent-fg disabled:opacity-40">
              + Add variant
            </button>
          </form>
        </div>
        <TextField
          label="Notes"
          value={ex.setup_note ?? ''}
          placeholder={parent?.setup_note ? `Inherited: ${parent.setup_note}` : 'Floor, seat, grip, …'}
          multiline
          onSave={(v) => updateExercise(ex, { setup_note: v })}
        />
      </Detail>
    )
  } else if (page === 'reps') {
    body = (
      <Detail title="Reps" onBack={back} note="Increase when every deciding set reaches Max reps; reps start in the middle of the range.">
        <div className="grid grid-cols-2 gap-3">
          {(['target_reps', 'min_reps'] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{field === 'target_reps' ? 'Max reps' : 'Min reps'}</span>
              <Field
                label={field === 'target_reps' ? 'Exercise max reps' : 'Exercise min reps'}
                inputMode="numeric"
                value={ex[field] == null ? '' : String(ex[field])}
                placeholder={`${field === 'target_reps' ? eff.targetReps : eff.minReps}${parent ? ' (inherited)' : ' (default)'}`}
                onCommit={(input) => {
                  const n = parseNumber(input)
                  if (n === undefined) return false
                  const target = field === 'target_reps' ? n ?? parent?.target_reps ?? 10 : eff.targetReps
                  const minimum = field === 'min_reps' ? n ?? parent?.min_reps ?? 7 : eff.minReps
                  if (!validRepetitionTargets(target, minimum)) return false
                  void updateExercise(ex, { [field]: n })
                  return true
                }}
              />
            </label>
          ))}
        </div>
      </Detail>
    )
  } else if (page === 'step') {
    body = (
      <Detail title="Weight step" onBack={back} note="Distance between two plates as labelled, e.g. 4.5 or 10. Empty: recommendations are estimates (≈).">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">Step in kg</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="w-24">
              <Field
                label="Weight step kg"
                inputMode="decimal"
                value={ex.weight_step == null ? '' : String(ex.weight_step)}
                placeholder={parent?.weight_step ? `${parent.weight_step} (inh.)` : 'Not set'}
                onCommit={(input) => {
                  const n = parseNumber(input)
                  if (n === undefined || (n !== null && (n <= 0 || n > 50))) return false
                  void updateExercise(ex, { weight_step: n })
                  return true
                }}
              />
            </span>
            {lbStep !== null && <span className="text-xs whitespace-nowrap text-zinc-500 tabular-nums dark:text-zinc-400">({lbStep} lb)</span>}
          </span>
        </label>
      </Detail>
    )
  } else if (page === 'rest') {
    body = (
      <Detail title="Rest" onBack={back} note="Default rest between sets; a workout can override it.">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Rest between sets</span>
          <RestStepper
            value={ex.default_rest_s}
            onChange={(sec) => void updateExercise(ex, { default_rest_s: sec })}
            fallbackLabel={parent?.default_rest_s ? `${formatDuration(parent.default_rest_s)} (inh.)` : 'Off'}
          />
        </div>
      </Detail>
    )
  } else if (page === 'equipment') {
    body = (
      <Detail title="Equipment" onBack={back} note={parent ? 'Shared by all variants.' : undefined}>
        <List>
          {EQUIPMENT.map(([value, text]) => (
            <Row key={value} label={text} onClick={() => void updateExercise(main, { equipment: value })}>
              {main.equipment === value && <span className="font-semibold text-accent-ink">✓</span>}
            </Row>
          ))}
        </List>
      </Detail>
    )
  } else if (page === 'muscles') {
    body = (
      <Detail title="Muscles to feel" onBack={back} note={`Tap a muscle to add or remove it.${focusInherited ? ' Currently inherited from the main exercise.' : ''}`}>
        <BodyMap regions={eff.focusMuscles} onToggle={toggleRegion} />
      </Detail>
    )
  } else if (page === 'videos') {
    body = (
      <Detail title="Videos" onBack={back}>
        {links.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No videos yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {links.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
                  ▶ {linkLabel(l)}
                  {l.inherited && <span className="ml-1 text-xs text-zinc-500"> (main exercise)</span>}
                </a>
                {!l.inherited && (
                  <button onClick={() => void removeLink(l)} className="px-2 py-2 text-sm text-red-600 dark:text-red-400">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => void submitLink(e)} className="flex flex-col gap-2">
          <input
            aria-label="Video URL"
            inputMode="url"
            autoCapitalize="none"
            placeholder="https://…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setUrlError(false)
            }}
            className={`rounded-lg border bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700 ${urlError ? 'border-red-500' : 'border-zinc-300'}`}
          />
          <input
            aria-label="Title (optional)"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none dark:border-zinc-700"
          />
          {urlError && <p className="text-sm text-red-600 dark:text-red-400">Please enter a valid web address.</p>}
          <button type="submit" className="rounded-lg bg-accent py-2 text-sm font-semibold text-accent-fg">Add video</button>
        </form>
      </Detail>
    )
  } else {
    body = (
      <>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{main.name}</h2>
            {parent && <p className="text-sm text-zinc-600 dark:text-zinc-300">{ex.name}</p>}
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-zinc-500 dark:text-zinc-400">Close</button>
        </div>
        <List>
          <Row label="Exercise details" onClick={() => setPage('details')} />
        </List>
        <Group title="Training">
          <List>
            {weightReps && <Row label="Reps" value={`${eff.minReps}–${eff.targetReps}`} onClick={() => setPage('reps')} />}
            {weightReps && <SwitchRow label="Warm-up set" checked={eff.warmUp} onChange={(v) => void updateExercise(ex, { warm_up: v })} />}
            {weightReps && <SwitchRow label="Top set" checked={eff.topSet} onChange={(v) => void updateExercise(ex, { top_set: v })} />}
            {weightReps && <Row label="Weight step" value={stepKg === null ? 'Not set' : `${stepKg} kg${lbStep !== null ? ` (${lbStep} lb)` : ''}`} muted={stepKg === null} onClick={() => setPage('step')} />}
            <Row label="Rest" value={restS ? formatDuration(restS) : 'Off'} muted={!restS} onClick={() => setPage('rest')} />
          </List>
          {inheritsSwitch && (
            <button onClick={() => void updateExercise(ex, { warm_up: null, top_set: null })} className="mt-1.5 px-1 text-left text-xs font-medium text-accent-ink">
              Use main exercise’s warm-up and top set
            </button>
          )}
        </Group>
        <Group title="Setup">
          <List>
            {weightReps && <Row label="Equipment" value={equipment} muted={!main.equipment} onClick={() => setPage('equipment')} />}
            <Row label="Muscles to feel" value={eff.focusMuscles.length ? eff.focusMuscles.map(regionName).join(', ') : 'None'} muted={!eff.focusMuscles.length} onClick={() => setPage('muscles')} />
            <Row label="Videos" value={String(links.length)} onClick={() => setPage('videos')} />
          </List>
        </Group>
        <p className="mt-3 px-1 text-xs text-zinc-500 dark:text-zinc-400">Warm-up {shares.warmUp} % and back-off {shares.backOff} % of the top set: More › Training settings.</p>
      </>
    )
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/50 sm:items-center sm:justify-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label={displayName(ex, byId)}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(env(safe-area-inset-bottom),1.25rem)] sm:max-w-md sm:rounded-2xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  )
}

type Page = 'details' | 'reps' | 'step' | 'rest' | 'equipment' | 'muscles' | 'videos'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 px-1 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{title}</h3>
      {children}
    </section>
  )
}

function List({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl bg-zinc-100 dark:divide-zinc-700 dark:bg-zinc-800">{children}</div>
}

function Row({ label, value, muted, onClick, children }: { label: string; value?: string; muted?: boolean; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-[15px]">
      <span className="shrink-0">{label}</span>
      <span className={`flex min-w-0 items-center gap-1.5 ${muted ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'}`}>
        {value !== undefined && <span className="truncate tabular-nums">{value}</span>}
        {children ?? <span aria-hidden="true" className="text-zinc-400">›</span>}
      </span>
    </button>
  )
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-[15px]">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className="relative h-[26px] w-11 shrink-0 rounded-full bg-zinc-300 transition-colors peer-checked:bg-orange-500 peer-focus-visible:ring-2 peer-focus-visible:ring-orange-300 after:absolute after:top-[3px] after:left-[3px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-[18px] dark:bg-zinc-600" />
    </label>
  )
}

function Detail({ title, onBack, note, children }: { title: string; onBack: () => void; note?: string; children: React.ReactNode }) {
  return (
    <>
      <button onClick={onBack} className="mb-2 text-sm font-medium text-accent-ink">‹ Back</button>
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
      {note && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>}
    </>
  )
}

const EQUIPMENT = [['plate_loaded', 'Plate'], ['pin_loaded', 'Pin'], ['dumbbell', 'Dumbbell']] as const

function chip(active: boolean): string {
  return active ? 'bg-accent text-accent-fg' : 'bg-zinc-100 dark:bg-zinc-800'
}

interface TextFieldProps {
  label: string
  value: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
  /** Called on blur with the trimmed value (null when empty). */
  onSave: (value: string | null) => Promise<void> | void
}

/** Text input that saves on blur; multi-line keeps line breaks. */
function TextField({ label, value, placeholder, multiline, required, onSave }: TextFieldProps) {
  const className =
    'rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-base outline-none focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-100'
  function save(raw: string) {
    const v = multiline ? raw.replace(/\s+$/, '').replace(/^\s*\n/, '') : raw.trim()
    if (required && !v) return
    if ((v || '') !== value) void onSave(v || null)
  }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      {multiline ? (
        <textarea
          key={value}
          defaultValue={value}
          placeholder={placeholder}
          rows={Math.max(3, value.split('\n').length + 1)}
          onBlur={(e) => save(e.target.value)}
          className={className}
        />
      ) : (
        <input key={value} defaultValue={value} placeholder={placeholder} onBlur={(e) => save(e.target.value)} className={className} />
      )}
    </label>
  )
}
