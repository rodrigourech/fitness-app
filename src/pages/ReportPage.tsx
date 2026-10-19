import { useLiveQuery } from 'dexie-react-hooks'
import AppBar from '../components/AppBar'
import { formatMinutes, formatVolume, percentChange, workoutReport, type ReportLine, type ReportTotals, type WorkoutReport } from '../lib/report'
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
        {report.kind === 'run' ? <RunTiles t={t} p={p} /> : <StrengthTiles t={t} p={p} />}
      </div>
      {report.lines.length > 0 && (
        <>
          <h2 className="mt-5 mb-1 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Next workout</h2>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {report.lines.map((l) => (
              <li key={l.exerciseId} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
                <span className="min-w-0 truncate">
                  {l.name}
                  {l.record && <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-px align-[1px] text-[10px] font-extrabold text-amber-800 dark:bg-amber-900 dark:text-amber-200">PR</span>}
                </span>
                <NextPill line={l} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/** Same weight grey «= 45 kg»; increase orange «45 → 52 kg»; reduce blue «20 → 15 kg» (decision 19 October 2026). */
export function NextPill({ line }: { line: ReportLine }) {
  const base = 'shrink-0 rounded-md px-2 py-1 text-xs font-bold whitespace-nowrap tabular-nums'
  if (line.advice === 'hold') return <span className={`${base} bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300`}>= {kg(line.current)} kg</span>
  const tone = line.advice === 'increase' ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200' : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200'
  const text = line.next === null ? `${kg(line.current)} kg ${line.advice === 'increase' ? '↑' : '↓'}` : `${kg(line.current)} → ${kg(line.next)} kg`
  return <span className={`${base} ${tone}`}>{text}</span>
}

function Tile({ label, value, delta, tone = 'neutral' }: { label: string; value: string; delta: string | null; tone?: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-zinc-500 dark:text-zinc-400'
  return (
    <div className="rounded-xl bg-zinc-100 p-2.5 dark:bg-zinc-800">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 text-lg leading-tight font-bold tabular-nums">{value}</div>
      <div className={`mt-0.5 min-h-4 text-xs tabular-nums ${color}`}>{delta ?? ''}</div>
    </div>
  )
}

function signedMinutes(diffS: number): string {
  const m = Math.round(diffS / 60)
  return m === 0 ? '± 0 min' : `${m > 0 ? '+' : '−'}${Math.abs(m)} min`
}

function StrengthTiles({ t, p }: { t: ReportTotals; p: ReportTotals | null }) {
  const vol = percentChange(t.volume, p?.volume)
  const missing = t.planned - t.sets
  return (
    <>
      <Tile label="Duration" value={formatMinutes(t.durationS)} delta={p && t.durationS !== null && p.durationS !== null ? signedMinutes(t.durationS - p.durationS) : null} />
      <Tile label="Volume" value={`${formatVolume(t.volume)} kg`} delta={vol === null ? null : `${vol > 0 ? '+' : vol < 0 ? '−' : '± '}${Math.abs(vol)} %`} tone={vol === null || vol === 0 ? 'neutral' : vol > 0 ? 'good' : 'bad'} />
      <Tile label="Sets" value={`${t.sets} / ${t.planned}`} delta={missing <= 0 ? 'as planned' : `${missing} not done`} />
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
