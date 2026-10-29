import { useLiveQuery } from 'dexie-react-hooks'
import AppBar from '../components/AppBar'
import { formatMinutes, topSetChange, workoutReport, type ReportLine, type ReportTotals, type TopSet, type WorkoutReport } from '../lib/report'
import { formatDuration, paceSeconds } from '../lib/workout'

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

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

export function ReportCard({ report }: { report: WorkoutReport }) {
  const { totals: t, previous: p } = report
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{report.name}</h1>
        <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{dayFormat.format(new Date(report.workout.started_at))}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {report.kind === 'run' ? <RunTiles t={t} p={p} /> : <StrengthTiles t={t} p={p} lines={report.lines} />}
      </div>
      {report.lines.length > 0 && <ExerciseTable lines={report.lines} />}
    </section>
  )
}

/** Top set as «45 × 10» or, one-sided, «4.5 × 12/12». */
function topSetText(t: TopSet, unilateral: boolean): string {
  const reps = unilateral || t.reps === null ? `${t.repsLeft ?? '–'}/${t.repsRight ?? '–'}` : `${t.reps}`
  return `${kg(t.weight)} × ${reps}`
}

/** Last time this exercise or variant · today · next workout (decision 29 October 2026). */
function ExerciseTable({ lines }: { lines: ReportLine[] }) {
  const tone = { up: 'text-emerald-700 dark:text-emerald-400', down: 'text-red-700 dark:text-red-400', same: 'text-zinc-500 dark:text-zinc-400' }
  return (
    <table className="mt-4 w-full table-fixed text-[12.5px] tabular-nums">
      <colgroup><col className="w-[31%]" /><col className="w-[24%]" /><col className="w-[27%]" /><col className="w-[18%]" /></colgroup>
      <thead>
        <tr className="text-[11px] font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          <th className="py-1.5 text-left font-bold">Exercise</th>
          <th className="py-1.5 text-right font-bold">Last</th>
          <th className="py-1.5 text-right font-bold">Today</th>
          <th className="py-1.5 text-right font-bold">Next kg</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => {
          const change = l.today && l.last ? topSetChange(l.today, l.last) : null
          return (
            <tr key={l.exerciseId} className="border-t border-zinc-100 align-top dark:border-zinc-800">
              <td className={`py-2.5 pr-1 text-sm leading-tight ${l.status === 'skipped' ? 'text-zinc-400 dark:text-zinc-500' : ''}`}>
                {l.name}
                {l.record && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-px align-[1px] text-[10px] font-extrabold text-amber-800 dark:bg-amber-900 dark:text-amber-200">PR</span>}
              </td>
              <td className="py-2.5 pl-1 text-right whitespace-nowrap text-zinc-500 dark:text-zinc-400">{l.last ? topSetText(l.last, l.unilateral) : '–'}</td>
              <td className="py-2.5 pl-1 text-right whitespace-nowrap">
                {l.today ? <span className="font-bold">{topSetText(l.today, l.unilateral)}</span> : <Tag className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">SKIPPED</Tag>}
                {l.today && (change
                  ? <span className={`block text-[11.5px] ${tone[change.tone]}`}>{change.text}</span>
                  : <span className="block"><Tag className="bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">NEW</Tag></span>)}
              </td>
              <td className="py-2 pl-1 text-right">{l.status === 'skipped' ? <span className="text-zinc-400">–</span> : <NextPill line={l} unit={false} />}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Tag({ className, children }: { className: string; children: string }) {
  return <span className={`rounded px-1.5 py-px text-[10px] font-bold ${className}`}>{children}</span>
}

/** Same weight grey «= 45 kg»; increase orange «45 → 52 kg»; reduce blue «20 → 15 kg» (decision 19 October 2026). */
export function NextPill({ line, unit = true }: { line: ReportLine; unit?: boolean }) {
  const u = unit ? ' kg' : ''
  const base = 'inline-block shrink-0 rounded-md px-1.5 py-1 text-xs font-bold whitespace-nowrap tabular-nums'
  if (line.advice === 'hold') return <span className={`${base} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>= {kg(line.current)}{u}</span>
  const tone = line.advice === 'increase' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
  const text = line.next === null ? `${kg(line.current)}${u} ${line.advice === 'increase' ? '↑' : '↓'}` : `${kg(line.current)} → ${kg(line.next)}${u}`
  return <span className={`${base} ${tone}`}>{text}</span>
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

/** Duration, sets done of planned, records; no volume (decision 29 October 2026). */
function StrengthTiles({ t, p, lines }: { t: ReportTotals; p: ReportTotals | null; lines: ReportLine[] }) {
  const missing = t.planned - t.sets
  const records = lines.filter((l) => l.record)
  return (
    <>
      <Tile label="Duration" value={formatMinutes(t.durationS)} delta={p && t.durationS !== null && p.durationS !== null ? signedMinutes(t.durationS - p.durationS) : null} />
      <Tile label="Sets" value={`${t.sets} / ${t.planned}`} delta={missing <= 0 ? 'as planned' : `${missing} not done`} />
      <Tile label="Records" value={records.length ? `${records.length} PR` : '–'} delta={records.length === 1 ? records[0]!.name : records.length > 1 ? `${records.length} exercises` : 'none'} />
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
