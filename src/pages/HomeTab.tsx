import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { ColumnChart, LineChart } from '../components/Charts'
import AppIcon from '../components/AppIcon'
import { loadAnalytics, weeklyGoal, weeklyVolume } from '../lib/analytics'
import { readyToIncrease } from '../lib/progression'
import { bodyWeightSeries } from '../lib/body'
import { finishedWorkouts } from '../lib/history'
import { getWeeklyGoal } from '../lib/settings'
import { formatDuration } from '../lib/workout'
import { suggestWorkout, type StartCard } from '../lib/home'

export type HomeTarget = 'templates' | 'exercises' | 'history' | 'stats' | 'body' | 'photos' | 'trash' | 'account' | 'info'
interface Props {
  cards: StartCard[] | undefined
  running: boolean
  onStart: (templateId: string) => void
  onResume?: () => void
  onOpen: (target: HomeTarget) => void
}
const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

async function loadSummary() {
  const [data, goal, workouts, weights] = await Promise.all([loadAnalytics(), getWeeklyGoal(), finishedWorkouts(), bodyWeightSeries()])
  const now = new Date()
  const goal12 = weeklyGoal(data.workouts, 12, now, goal)
  const from = Date.parse(`${goal12.weeks[0]!.start}T00:00:00`)
  return {
    now, workouts: workouts.map(w => w.workout),
    volume: weeklyVolume(data.sets, from, now),
    sessions: goal12.weeks.map(w => ({ start: w.start, value: w.strength + w.run })),
    weightSeries: weights.filter(w => Date.parse(w.entry.measured_on) >= now.getTime() - 90 * 86_400_000).reverse(),
    ready: await readyToIncrease(), goal, week: goal12.thisWeek, streak: goal12.streak,
    last: workouts[0] ?? null, weight: weights[0] ?? null,
    weightWeekAgo: weights.find(w => Date.parse(w.entry.measured_on) <= now.getTime() - 7 * 86_400_000) ?? null,
  }
}

export default function HomeTab({ cards, running, onStart, onResume, onOpen }: Props) {
  const s = useLiveQuery(loadSummary, [])
  const [picked, setPicked] = useState<string | null>(null)
  const [visitedAt] = useState(() => new Date())
  const suggestion = cards && s ? suggestWorkout(cards, s.workouts) : null
  const selected = cards?.find(c => c.id === picked) ?? suggestion?.card
  const ready = s?.ready ?? []
  return (
    <div className="home-dashboard">
      <header className="home-intro"><p className="home-muted">{dateFormat.format(s?.now ?? visitedAt)}</p><h1>Your next rep<br />starts here.</h1><p className="home-muted">Your training, at a glance.</p></header>
      <section className="home-hero">
        <p className="home-kicker">{running ? 'Workout in progress' : 'Start a workout'}</p>
        {running ? <>
          <div className="home-hero-title"><h2>Keep going.</h2><AppIcon name="workout" /></div>
          <p className="home-muted">Your sets and rest timer are waiting for you.</p>
          <button onClick={onResume} className="home-primary">Resume workout <AppIcon name="arrow" /></button>
        </> : cards === undefined || (cards.length > 0 && !s) ? <p className="home-muted" role="status">Loading your workouts …</p> : selected ? <>
          <div className="home-hero-title"><h2>{selected.name}</h2><AppIcon name="workout" /></div>
          <p className="home-muted">{selected.exerciseCount !== undefined && `${selected.exerciseCount} ${selected.exerciseCount === 1 ? 'exercise' : 'exercises'} · `}{selected.lastDone ? `last ${dayFormat.format(new Date(selected.lastDone))}` : 'Not trained yet'}</p>
          <button onClick={() => onStart(selected.id)} className="home-primary">Start workout <AppIcon name="arrow" /></button>
          <div className="home-workout-picker" aria-label="Choose a workout">{cards.map(c => <button key={c.id} aria-pressed={selected.id === c.id} onClick={() => setPicked(c.id)}>{c.name}</button>)}</div>
          {selected.id === suggestion?.card.id && suggestion.after && <p className="home-suggestion">Suggested after {suggestion.after}</p>}
        </> : <>
          <div className="home-hero-title"><h2>Your first workout.</h2><AppIcon name="workout" /></div>
          <p className="home-muted">Create or restore a workout to get started.</p>
          <button onClick={() => onOpen('templates')} className="home-primary">Open workouts <AppIcon name="arrow" /></button>
        </>}
      </section>
      {s && <div className="home-summary-grid">
        <button onClick={() => onOpen('stats')} className="home-summary home-week">
          <span className="home-summary-label">This week <AppIcon name="calendar" /></span>
          <span className="home-metric">{s.week.strength} / {s.goal.strength}<small>strength</small></span>
          <span className="home-muted home-small">{s.goal.run > 0 ? `${s.week.run}/${s.goal.run} runs` : s.week.run ? `${s.week.run} ${s.week.run === 1 ? 'run' : 'runs'}` : 'Running optional'} · {s.week.met ? 'Goal met' : `${s.streak}-week streak`}</span>
          <span className="home-track" role="progressbar" aria-label="Weekly strength goal" aria-valuenow={Math.min(s.week.strength, s.goal.strength)} aria-valuemin={0} aria-valuemax={s.goal.strength}><span style={{ width: `${Math.min(100, s.week.strength / s.goal.strength * 100)}%` }} /></span>
          <span className="home-days">{s.week.days.map((d, i) => <span key={d.date} className={d.strength || d.run ? 'home-day-done' : ''} aria-label={`${d.date}: ${d.strength ? 'strength' : ''} ${d.run ? 'run' : ''}`}>{['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</span>)}</span>
        </button>
        <button onClick={() => onOpen('body')} className="home-summary home-weight">
          <span className="home-summary-label">Body weight <AppIcon name="scale" /></span>
          {s.weight ? <><span className="home-metric">{s.weight.entry.weight_kg.toFixed(1)}<small>kg</small></span><span className="home-muted home-small">7-day avg {s.weight.avg7.toFixed(1)} kg</span><span className="home-weight-change">{s.weightWeekAgo ? `${signed(s.weight.avg7 - s.weightWeekAgo.avg7)} in 7 days` : dayFormat.format(new Date(`${s.weight.entry.measured_on}T12:00:00`))}</span><span className="home-small home-weight-link">Log weight <AppIcon name="arrow" /></span></> : <><span className="home-metric home-empty-metric">Log weight</span><span className="home-muted home-small">Track your first measurement</span></>}
        </button>
      </div>}
      {ready.length > 0 && <section className="home-progression"><AppIcon name="up" /><div><h2>Increase weight next time</h2><ul>{ready.map(r => <li key={`${r.templateId}/${r.exerciseId}`}>{r.name}<span className="home-muted home-small">{r.templateName}</span></li>)}</ul></div></section>}
      {s && <TrendCard s={s} />}
      {s?.last && <button onClick={() => onOpen('history')} className="home-panel home-last">
        <span className="home-panel-heading"><span className="home-kicker">Last workout</span><AppIcon name="chevron" /></span>
        <span className="home-last-title"><strong>{s.last.workout.template_name_snapshot ?? 'Workout'}</strong><span className="home-muted home-small">{dayFormat.format(new Date(s.last.workout.started_at))}</span></span>
        <span className="home-last-stats"><span><b>{s.last.durationS !== null ? formatDuration(s.last.durationS) : '–'}</b><small>Duration</small></span><span><b>{Math.round(s.last.volume).toLocaleString('en-GB')} kg</b><small>Volume</small></span><span><b>{s.last.sets} sets</b><small>{s.last.exercises} {s.last.exercises === 1 ? 'exercise' : 'exercises'}</small></span></span>
      </button>}
      <div className="home-quick-actions"><button onClick={() => onOpen('history')}><AppIcon name="history" />History</button><button onClick={() => onOpen('trash')}><AppIcon name="trash" />Trash</button><button onClick={() => onOpen('account')}><AppIcon name="body" />Account</button></div>
      <button onClick={() => onOpen('info')} className="home-panel home-shortcut"><AppIcon name="guide" /><span><strong>Training guide</strong><small>Rep ranges, warm-up hints &amp; how progression works</small></span><AppIcon name="chevron" /></button>
    </div>
  )
}

function signed(v: number): string {
  const r = Math.round(v * 10) / 10
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(1)} kg`
}
type Trend = 'weight' | 'training'
function TrendCard({ s }: { s: Awaited<ReturnType<typeof loadSummary>> }) {
  const [trend, setTrend] = useState<Trend>(() => { try { return localStorage.getItem('home-trend') === 'training' ? 'training' : 'weight' } catch { return 'weight' } })
  function pick(t: Trend) { setTrend(t); try { localStorage.setItem('home-trend', t) } catch { /* per-device convenience */ } }
  const weekLabel = (start: string) => dayFormat.format(new Date(`${start}T12:00:00`))
  return <section className="home-panel home-trend">
    <div className="home-panel-heading"><h2>Your progress</h2><span className="home-muted home-small">{trend === 'weight' ? 'Last 90 days' : 'Last 12 weeks'}</span></div>
    <div className="home-trend-switch" role="group" aria-label="Progress chart"><button aria-pressed={trend === 'weight'} onClick={() => pick('weight')}>Body weight</button><button aria-pressed={trend === 'training'} onClick={() => pick('training')}>Training</button></div>
    {trend === 'weight' ? s.weightSeries.length < 2 ? <p className="py-6 text-center text-sm text-zinc-500">Log your weight on a few days to see the trend.</p> : <LineChart
      label="7-day average body weight in kg, last 90 days" formatY={v => `${v.toFixed(1)}`} height={160}
      points={s.weightSeries.map(p => ({ x: Date.parse(`${p.entry.measured_on}T12:00:00`), y: Math.round(p.avg7 * 10) / 10, tooltip: `${dayFormat.format(new Date(`${p.entry.measured_on}T12:00:00`))}: ${p.entry.weight_kg.toFixed(1)} kg (avg ${p.avg7.toFixed(1)})` }))}
    /> : <ColumnChart
      label="Working-set volume in kg and counted training days per week, last 12 weeks" height={160} formatY={v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v))}
      columns={s.volume.map(w => { const n = s.sessions.find(x => x.start === w.start)?.value ?? 0; return { key: w.start, label: weekLabel(w.start), value: w.value, note: n ? `${n}×` : undefined, tooltip: `Week of ${weekLabel(w.start)}: ${Math.round(w.value).toLocaleString('en-GB')} kg · ${n} counted training days` } })}
    />}
    <p className="home-muted home-small">{trend === 'weight' ? '7-day average · kg' : 'Volume per week (kg) · strength/run days counted once per kind'}</p>
  </section>
}
