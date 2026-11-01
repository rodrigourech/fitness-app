import { useLiveQuery } from 'dexie-react-hooks'
import AppBar from '../components/AppBar'
import type { ReactNode } from 'react'
import { changeCounts, formatMinutes, formatTopSet, nextTimeSummary, topSetChange, workoutReport, type ReportLine, type ReportTotals, type WorkoutReport } from '../lib/report'
import { MONTHS } from '../lib/forecast'
import { formatDuration, paceSeconds } from '../lib/workout'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayFormat = { format: (d: Date) => `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` }
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })

function kg(v: number): string {
  return `${Math.round(v * 10) / 10}`
}

/** Report shown after «Finish workout» and from Stats › Reports (decision 19 October 2026). */
export default function ReportPage({ workoutId, onDone }: { workoutId: string; onDone: () => void }) {
  const report = useLiveQuery(() => workoutReport(workoutId), [workoutId])
  return (
    <main className="mx-auto max-w-xl px-4 pb-10">
      <AppBar>
        <button onClick={onDone} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-accent-fg">Done</button>
      </AppBar>
      {report === undefined ? null : report === null ? <p className="text-zinc-500">This workout is no longer available.</p> : <ReportCard report={report} />}
      <button onClick={onDone} className="mt-4 w-full rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">Done</button>
    </main>
  )
}

/** Report inside another page (Stats › Reports). */
export function ReportView({ workoutId }: { workoutId: string }) {
  const report = useLiveQuery(() => workoutReport(workoutId), [workoutId])
  return report === undefined ? null : report === null ? <p className="text-zinc-500">This workout is no longer available.</p> : <ReportCard report={report} />
}

/** Report A (decision 1 November 2026): header, three tiles, one row per exercise with today, last time, the change
 * and the weight for next time, then a one-line summary for the next workout. */
export function ReportCard({ report }: { report: WorkoutReport }) {
  const { totals: t, previous: p } = report
  const start = new Date(report.workout.started_at)
  const end = report.workout.finished_at ? new Date(report.workout.finished_at) : null
  const summary = report.kind === 'strength' ? nextTimeSummary(report.lines) : ''
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{report.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {dayFormat.format(start)} · {timeFormat.format(start)}{end && ` to ${timeFormat.format(end)}`}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {report.kind === 'run' ? <RunTiles t={t} p={p} /> : <StrengthTiles t={t} p={p} report={report} />}
      </div>
      {report.lines.length > 0 && (
        <section className="card px-4 py-1">
          {report.lines.map((l) => <ExerciseRow key={l.exerciseId} line={l} />)}
        </section>
      )}
      {summary && (
        <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/60">
          <span className="font-semibold">Next time</span> · {summary}
        </p>
      )}
    </div>
  )
}

function Chip({ tone, children }: { tone: 'up' | 'same' | 'down' | 'new'; children: ReactNode }) {
  const cls = {
    up: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    same: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    down: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
    new: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  }[tone]
  return <span className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums ${cls}`}>{children}</span>
}

/** Better, same, lower and new exercises against the last time (report list and tile). */
export function ChangeChips({ report }: { report: WorkoutReport }) {
  const c = changeCounts(report.lines)
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {c.up > 0 && <Chip tone="up">▲ {c.up}</Chip>}
      {c.same > 0 && <Chip tone="same">= {c.same}</Chip>}
      {c.down > 0 && <Chip tone="down">▼ {c.down}</Chip>}
      {c.new > 0 && <Chip tone="new">+ {c.new}</Chip>}
    </span>
  )
}

function ExerciseRow({ line: l }: { line: ReportLine }) {
  const change = l.today && l.last ? topSetChange(l.today, l.last) : null
  const skipped = l.status === 'skipped'
  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 py-3 last:border-0 dark:border-zinc-800">
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${skipped ? 'text-zinc-400 dark:text-zinc-500' : ''}`}>
          {l.name}
          {l.record && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-px align-[1px] text-[10px] font-extrabold text-amber-800 dark:bg-amber-900 dark:text-amber-200">PR</span>}
        </div>
        <div className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{l.last ? `last ${formatTopSet(l.last, l.unilateral)}` : 'first time'}</div>
      </div>
      <div className="shrink-0 text-right">
        {skipped ? <span className="text-sm text-zinc-400 dark:text-zinc-500">skipped</span> : (
          <>
            <div className="text-[15px] font-semibold tabular-nums">{l.today && formatTopSet(l.today, l.unilateral)}</div>
            <NextPill line={l} />
          </>
        )}
      </div>
      <div className="w-16 shrink-0 text-right">
        {skipped ? <span className="text-zinc-400">–</span> : change ? <Chip tone={change.tone}>{change.text}</Chip> : <Chip tone="new">new</Chip>}
      </div>
    </div>
  )
}

/** Next workout: «next 39 kg»; increase green «↑ 4.5 → 9 kg»; reduce blue «↓ 20 → 15 kg». */
export function NextPill({ line }: { line: ReportLine }) {
  const base = 'inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums'
  if (line.advice === 'hold') return <span className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">next {kg(line.current)} kg</span>
  const up = line.advice === 'increase'
  const text = line.next === null ? (up ? 'increase' : 'reduce') : `${kg(line.current)} → ${kg(line.next)} kg`
  return <span className={`${base} ${up ? 'bg-emerald-700 text-white dark:bg-emerald-600' : 'bg-blue-600 text-white'}`}>{up ? '↑' : '↓'} {text}</span>
}

function Tile({ label, value, delta, tone = 'neutral' }: { label: string; value: string; delta: string | null; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
  return (
    <div className="rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-800">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-lg leading-tight font-bold tabular-nums">{value}</div>
      <div className={`mt-0.5 min-h-4 truncate text-xs tabular-nums ${color}`}>{delta ?? ''}</div>
    </div>
  )
}

function signedMinutes(diffS: number): string {
  const m = Math.round(diffS / 60)
  return m === 0 ? '± 0 min' : `${m > 0 ? '+' : '−'}${Math.abs(m)} min`
}

/** Duration, sets done of planned, change against the last time (decision 1 November 2026). */
function StrengthTiles({ t, p, report }: { t: ReportTotals; p: ReportTotals | null; report: WorkoutReport }) {
  const missing = t.planned - t.sets
  return (
    <>
      <Tile label="Duration" value={formatMinutes(t.durationS)} delta={p && t.durationS !== null && p.durationS !== null ? signedMinutes(t.durationS - p.durationS) : null} />
      <Tile label="Sets" value={`${t.sets} / ${t.planned}`} delta={missing <= 0 ? 'as planned' : `${missing} not done`} />
      <div className="rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-800">
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">vs last time</div>
        <div className="mt-1.5"><ChangeChips report={report} /></div>
      </div>
    </>
  )
}

function RunTiles({ t, p }: { t: ReportTotals; p: ReportTotals | null }) {
  const pace = paceSeconds(t.runS, t.distanceKm)
  const before = p ? paceSeconds(p.runS, p.distanceKm) : null
  const diff = pace !== null && before !== null ? pace - before : null
  return (
    <>
      <Tile label="Distance" value={`${t.distanceKm.toFixed(1)} km`} delta={p ? `${t.distanceKm - p.distanceKm >= 0 ? '+' : '−'}${Math.abs(t.distanceKm - p.distanceKm).toFixed(1)} km` : null} />
      <Tile label="Time" value={formatDuration(t.runS) || '–'} delta={null} />
      <Tile label="Pace /km" value={pace === null ? '–' : formatDuration(pace)} delta={diff === null ? null : `${diff > 0 ? '+' : diff < 0 ? '−' : '± '}${formatDuration(Math.abs(diff))}`} tone={diff === null || diff === 0 ? 'neutral' : diff < 0 ? 'good' : 'bad'} />
    </>
  )
}
