import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import AppBar from '../components/AppBar'
import ExercisePicker from '../components/ExercisePicker'
import ExerciseSheet from '../components/ExerciseSheet'
import Field from '../components/Field'
import { db, displayName, type Exercise, type TemplateExercise, type TemplateSet } from '../lib/db'
import {
  activeSets,
  addTemplateExercise,
  deleteTemplate,
  moveTemplateExercise,
  removeTemplateExercise,
  renameTemplate,
  setPlannedSetCount,
  setPlannedTargets,
  setTemplateExerciseVariant,
} from '../lib/template'
import { effective, formatDuration, formatNumber, parseDuration, parseNumber } from '../lib/workout'

interface Props {
  templateId: string
  onDone: () => void
}

interface Row {
  te: TemplateExercise
  name: string
  trackingType: string
  sets: TemplateSet[]
  /** Main exercise and its variants, to switch the variant used in this template */
  family: { id: string; label: string }[]
}

async function load(templateId: string) {
  const template = await db.template.get(templateId)
  if (!template || template.deleted_at !== null) return null
  const exercises = await db.exercise.toArray()
  const byId = new Map<string, Exercise>(exercises.map((e) => [e.id, e]))
  const tes = (await db.template_exercise.where('template_id').equals(templateId).toArray())
    .filter((te) => te.deleted_at === null)
    .sort((a, b) => a.position - b.position)
  const rows: Row[] = await Promise.all(
    tes.map(async (te) => {
      const ex = byId.get(te.exercise_id)
      const mainId = ex?.parent_id ?? ex?.id
      const family = exercises
        .filter((e) => e.deleted_at === null && (e.id === mainId || e.parent_id === mainId))
        .sort((a, b) => (a.parent_id === null ? -1 : b.parent_id === null ? 1 : a.name.localeCompare(b.name)))
        .map((e) => ({ id: e.id, label: e.parent_id === null ? 'Main' : e.name }))
      return {
        te,
        name: ex ? displayName(ex, byId) : 'Unknown exercise',
        trackingType: ex ? effective(ex, byId).trackingType : 'weight_reps',
        sets: await activeSets(te.id),
        family,
      }
    }),
  )
  return { template, rows }
}

const iconBtn = 'h-9 w-9 rounded-md bg-zinc-100 text-base disabled:opacity-30 dark:bg-zinc-800'

export default function TemplateEditor({ templateId, onDone }: Props) {
  const data = useLiveQuery(() => load(templateId), [templateId])
  const [picking, setPicking] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [sheet, setSheet] = useState<string | null>(null)

  if (data === undefined) return null
  if (data === null) {
    return (
      <main className="mx-auto max-w-xl px-4">
        <AppBar />
        <p className="mb-4 text-zinc-500">This workout no longer exists.</p>
        <button onClick={onDone} className="rounded-lg bg-accent px-4 py-2 text-accent-fg">
          Back
        </button>
      </main>
    )
  }
  const { template, rows } = data

  return (
    <main className="mx-auto max-w-xl px-4 pb-16">
      <AppBar>
        <button onClick={onDone} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg">
          Done
        </button>
      </AppBar>

      <label className="mb-4 flex flex-col gap-1">
        <span className="text-sm font-semibold">Workout name</span>
        <input
          key={template.name}
          defaultValue={template.name}
          onBlur={(e) => void renameTemplate(template, e.target.value)}
          className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-lg font-semibold outline-none dark:border-zinc-700"
        />
      </label>

      <ol className="flex flex-col gap-3">
        {rows.map((r, i) => {
          const first = r.sets[0]
          return (
            <li key={r.te.id} className="card p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <button onClick={() => setSheet(r.te.exercise_id)} className="text-left">
                  <h2 className="font-semibold underline-offset-2 hover:underline">
                    <span className="mr-1 text-zinc-400 tabular-nums">{i + 1}.</span>
                    {r.name} <span className="text-zinc-400">›</span>
                  </h2>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button aria-label="Move up" disabled={i === 0} onClick={() => void moveTemplateExercise(r.te, -1)} className={iconBtn}>
                    ↑
                  </button>
                  <button aria-label="Move down" disabled={i === rows.length - 1} onClick={() => void moveTemplateExercise(r.te, 1)} className={iconBtn}>
                    ↓
                  </button>
                  <button aria-label="Remove exercise" onClick={() => void removeTemplateExercise(r.te)} className={`${iconBtn} text-red-600 dark:text-red-400`}>
                    ✕
                  </button>
                </div>
              </div>

              {r.family.length > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-zinc-500 dark:text-zinc-400">Variant</span>
                  {r.family.map((f) => (
                    <button
                      key={f.id}
                      aria-pressed={f.id === r.te.exercise_id}
                      onClick={() => void setTemplateExerciseVariant(r.te, f.id)}
                      className={`rounded-full px-3 py-1 text-sm ${
                        f.id === r.te.exercise_id
                          ? 'bg-accent text-accent-fg'
                          : 'bg-zinc-100 dark:bg-zinc-800'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">Sets</span>
                  <div className="flex items-center gap-1">
                    <button aria-label="Fewer sets" disabled={r.sets.length <= 1} onClick={() => void setPlannedSetCount(r.te, r.sets.length - 1)} className={iconBtn}>
                      −
                    </button>
                    <span className="w-6 text-center tabular-nums">{r.sets.length}</span>
                    <button aria-label="More sets" disabled={r.sets.length >= 10} onClick={() => void setPlannedSetCount(r.te, r.sets.length + 1)} className={iconBtn}>
                      +
                    </button>
                  </div>
                </div>

                {r.trackingType === 'weight_reps' && (
                  <>
                    <Target label="Reps from">
                      <Field
                        label="Target reps from"
                        inputMode="numeric"
                        value={formatNumber(first?.target_reps_min ?? null)}
                        onCommit={(v) => commitInt(v, (n) => setPlannedTargets(r.te, { target_reps_min: n, target_reps_max: Math.max(n ?? 0, first?.target_reps_max ?? 0) || n }))}
                      />
                    </Target>
                    <Target label="to">
                      <Field
                        label="Target reps to"
                        inputMode="numeric"
                        value={formatNumber(first?.target_reps_max ?? null)}
                        onCommit={(v) => commitInt(v, (n) => setPlannedTargets(r.te, { target_reps_max: n }))}
                      />
                    </Target>
                    <Target label="kg">
                      <Field
                        label="Target weight kg"
                        inputMode="decimal"
                        value={formatNumber(first?.target_weight ?? null)}
                        onCommit={(v) => commitNum(v, (n) => setPlannedTargets(r.te, { target_weight: n }))}
                      />
                    </Target>
                  </>
                )}
                {r.trackingType === 'distance_duration' && (
                  <Target label="km">
                    <Field
                      label="Target distance km"
                      inputMode="decimal"
                      value={formatNumber(first?.target_distance_km ?? null)}
                      onCommit={(v) => commitNum(v, (n) => setPlannedTargets(r.te, { target_distance_km: n }))}
                    />
                  </Target>
                )}
                {r.trackingType !== 'weight_reps' && (
                  <Target label="Time" wide>
                    <Field
                      label="Target time"
                      inputMode="text"
                      placeholder="mm:ss"
                      value={formatDuration(first?.target_duration_s ?? null)}
                      onCommit={(v) => {
                        const n = parseDuration(v)
                        if (n === undefined) return false
                        void setPlannedTargets(r.te, { target_duration_s: n })
                        return true
                      }}
                    />
                  </Target>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {rows.length === 0 && <p className="text-zinc-500">No exercises yet.</p>}

      <button
        onClick={() => setPicking(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-zinc-300 py-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
      >
        + Add exercise
      </button>

      {confirmDelete ? (
        <div className="mt-8 rounded-xl border border-red-300 p-3 dark:border-red-900">
          <p className="mb-3 text-sm">Delete «{template.name}»? Past workouts stay in the history.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDelete(false)} className="flex-1 rounded-lg py-2 text-sm">
              Cancel
            </button>
            <button
              onClick={() => void deleteTemplate(template).then(onDone)}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-semibold text-white"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)} className="mt-8 w-full py-3 text-sm text-red-600 dark:text-red-400">
          Delete workout
        </button>
      )}

      {sheet && <ExerciseSheet exerciseId={sheet} onClose={() => setSheet(null)} />}
      {picking && (
        <ExercisePicker
          userId={template.user_id}
          title="Add to workout"
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false)
            void addTemplateExercise(template.id, id)
          }}
        />
      )}
    </main>
  )
}

function Target({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${wide ? 'w-24' : 'w-16'}`}>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      {children}
    </div>
  )
}

function commitInt(input: string, save: (n: number | null) => Promise<void>): boolean {
  const n = parseNumber(input)
  if (n === undefined || (n !== null && !Number.isInteger(n))) return false
  void save(n)
  return true
}

function commitNum(input: string, save: (n: number | null) => Promise<void>): boolean {
  const n = parseNumber(input)
  if (n === undefined) return false
  void save(n)
  return true
}
