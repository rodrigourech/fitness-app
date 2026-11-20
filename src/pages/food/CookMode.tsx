import { useEffect, useRef, useState } from 'react'
import type { Recipe } from '../../lib/db'
import { itemAmount, stepParts } from '../../lib/recipe'

// Cooking mode (spec section 5): full screen with the chosen portions, Steps (one step per page in large type, the
// ingredients of the step with scaled amounts, optional timer that keeps running while paging) or List (all steps,
// tap the circle to tick off, in sync with Steps). The last chosen view is remembered on this device; the screen stays
// on (Wake Lock) while cooking. «Done» leads to logging or planning the portions.

const VIEW_KEY = 'cook-view'

function loadView(): 'steps' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'steps'
  } catch {
    return 'steps'
  }
}

function clock(s: number): string {
  const m = Math.floor(Math.max(0, s) / 60)
  return `${m}:${String(Math.max(0, s) % 60).padStart(2, '0')}`
}

interface Timer {
  step: number
  total: number
  /** Remaining seconds when paused, else null */
  paused: number | null
  endsAt: number
}

export default function CookMode({ recipe: r, portions, onClose, onDone }: { recipe: Recipe; portions: number; onClose: () => void; onDone: () => void }) {
  const factor = portions / (r.portions > 0 ? r.portions : 1)
  const [view, setView] = useState<'steps' | 'list'>(loadView)
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<Set<number>>(new Set())
  const [timer, setTimer] = useState<Timer | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const rang = useRef(false)
  const touch = useRef<number | null>(null)
  const total = r.steps.length
  const step = r.steps[index]

  // Keep the screen on while cooking
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    const take = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        lock = null
      }
    }
    void take()
    const again = () => { if (document.visibilityState === 'visible') void take() }
    document.addEventListener('visibilitychange', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      void lock?.release().catch(() => {})
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* private mode */
    }
  }, [view])

  // Timer tick, sound and vibration at zero
  useEffect(() => {
    if (!timer || timer.paused !== null) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [timer])
  const left = timer ? (timer.paused ?? Math.ceil((timer.endsAt - now) / 1000)) : 0
  useEffect(() => {
    if (!timer || timer.paused !== null || left > 0 || rang.current) return
    rang.current = true
    try {
      navigator.vibrate?.([300, 150, 300])
      const ctx = new AudioContext()
      const o = ctx.createOscillator()
      o.frequency.value = 880
      o.connect(ctx.destination)
      o.start()
      o.stop(ctx.currentTime + 0.6)
    } catch {
      /* no audio */
    }
  }, [timer, left])

  const startTimer = (n: number) => {
    const s = r.steps[n]?.timer_s
    if (!s) return
    rang.current = false
    setNow(Date.now())
    setTimer({ step: n, total: s, paused: null, endsAt: Date.now() + s * 1000 })
  }
  const toggleTimer = () => {
    if (!timer) return
    if (timer.paused !== null) setTimer({ ...timer, paused: null, endsAt: Date.now() + timer.paused * 1000 })
    else setTimer({ ...timer, paused: Math.max(0, left) })
  }
  const go = (n: number) => setIndex(Math.min(total - 1, Math.max(0, n)))
  const tick = (n: number) => {
    const next = new Set(done)
    if (next.has(n)) next.delete(n)
    else next.add(n)
    setDone(next)
  }
  const minutes = r.prep_min ? ` · ${r.prep_min} min` : ''

  return (
    <div role="dialog" aria-label={`Cooking ${r.name}`} className="fixed inset-0 z-40 flex flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),0.75rem)] dark:bg-zinc-950">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <button onClick={onClose} aria-label="Close cooking mode" className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-lg dark:bg-zinc-800">✕</button>
        <div role="tablist" aria-label="View" className="grid grid-cols-2 gap-1 rounded-xl bg-zinc-200/70 p-1 dark:bg-zinc-900">
          {(['steps', 'list'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={`rounded-md px-4 py-1 text-sm font-semibold ${view === v ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}>
              {v === 'steps' ? 'Steps' : 'List'}
            </button>
          ))}
        </div>
        <span className="w-9" />
      </header>
      <div className="px-4">
        <h2 className="text-lg font-semibold">{r.name}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{total} steps{minutes} · amounts for {portions}</p>
      </div>

      {view === 'steps' && step ? (
        <div className="flex min-h-0 flex-1 flex-col px-4"
          onTouchStart={(e) => { touch.current = e.touches[0]?.clientX ?? null }}
          onTouchEnd={(e) => {
            const start = touch.current
            const end = e.changedTouches[0]?.clientX
            touch.current = null
            if (start === null || end === undefined || Math.abs(end - start) < 60) return
            go(index + (end < start ? 1 : -1))
          }}>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
          </div>
          <p className="mt-3 text-sm font-semibold text-zinc-500 dark:text-zinc-400">Step {index + 1} of {total}</p>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="mt-2 text-2xl leading-snug font-medium">
              {stepParts(step, r.items, factor).map((p, k) => ('amount' in p ? <b key={k}>{p.amount}</b> : <span key={k}>{p.text}</span>))}
            </p>
            {step.items.length > 0 && (
              <ul className="mt-4 divide-y divide-zinc-200 rounded-2xl bg-zinc-100 px-3 dark:divide-zinc-800 dark:bg-zinc-900">
                {step.items.map((id) => r.items.find((i) => i.id === id)).filter((i) => i !== undefined).map((i) => {
                  const a = itemAmount(i, factor)
                  return (
                    <li key={i.id} className="flex items-baseline justify-between gap-3 py-2 text-base">
                      <span>{i.name}</span>
                      <span className="shrink-0 tabular-nums">{a.amount ? <>{a.hint && <span className="text-zinc-500">{a.hint} · </span>}<b>{a.amount}</b></> : <span className="text-zinc-500">nach Geschmack</span>}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            {step.timer_s && (
              <div className="mt-4 flex items-center justify-between rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
                <span className="text-3xl font-bold tabular-nums">{timer?.step === index ? clock(left) : clock(step.timer_s)}</span>
                {timer?.step === index ? (
                  <span className="flex gap-2">
                    <button onClick={toggleTimer} className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">{timer.paused !== null ? 'Resume' : left <= 0 ? 'Done' : 'Pause'}</button>
                    <button onClick={() => setTimer(null)} className="rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">Reset</button>
                  </span>
                ) : (
                  <button onClick={() => startTimer(index)} className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-fg">Start timer</button>
                )}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 pt-3">
            <button disabled={index === 0} onClick={() => go(index - 1)} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold disabled:opacity-30 dark:border-zinc-700">Back</button>
            {index < total - 1
              ? <button onClick={() => { tick(index); go(index + 1) }} className="rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">Next</button>
              : <button onClick={onDone} className="rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white">Done · Log or plan {portions}</button>}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col px-4">
          <ol className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {r.steps.map((s, n) => (
              <li key={n} className={`flex gap-3 rounded-xl p-2 ${n === index ? 'bg-accent-soft' : ''}`}>
                <button onClick={() => tick(n)} aria-label={`Step ${n + 1} done`} aria-pressed={done.has(n)}
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${done.has(n) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-zinc-300 text-zinc-500 dark:border-zinc-600'}`}>
                  {done.has(n) ? '✓' : n + 1}
                </button>
                <button onClick={() => setIndex(n)} className={`text-left text-base leading-snug ${done.has(n) ? 'text-zinc-400 line-through' : ''}`}>
                  {stepParts(s, r.items, factor).map((p, k) => ('amount' in p ? <b key={k}>{p.amount}</b> : <span key={k}>{p.text}</span>))}
                  {s.timer_s ? <span className="ml-1 text-sm text-zinc-500">({Math.round(s.timer_s / 60)} min)</span> : null}
                </button>
              </li>
            ))}
          </ol>
          <button onClick={onDone} className="mt-3 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white">Done · Log or plan {portions}</button>
        </div>
      )}
      {timer && timer.step !== index && view === 'steps' && (
        <button onClick={() => go(timer.step)} className="fixed right-4 bottom-24 rounded-full bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-white tabular-nums shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
          Step {timer.step + 1} · {clock(left)}
        </button>
      )}
    </div>
  )
}
