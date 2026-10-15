import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import PhotoImage from './PhotoImage'
import { bodyWeightSeries, weightOnDay, type BodyWeightPoint } from '../lib/body'
import type { BodyPhoto, PhotoPose } from '../lib/db'
import { allPhotos } from '../lib/photos'

// Gallery of progress photos (decision 15 October 2026): grid by month with date and weight,
// filter by pose, full-screen viewer with horizontal swipe, and a manual side-by-side compare.

type Filter = 'all' | PhotoPose
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back' },
]
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })
const shortDate = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
const longDate = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

const day = (d: string) => new Date(`${d}T12:00:00`)
const kg = (n: number | null) => (n === null ? null : `${n.toFixed(1)} kg`)

/** Headline weight for a photo: 7-day average, else nothing. */
function weightLabel(date: string, series: BodyWeightPoint[]): string | null {
  return kg(weightOnDay(date, series).avg7)
}

/** Decrypts a photo only once it scrolls into view, so large galleries stay fast. */
function LazyPhoto({ photo, className }: { photo: BodyPhoto; className: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visible])
  return (
    <span ref={ref} className="block h-full w-full">
      {visible ? <PhotoImage photo={photo} className={className} /> : null}
    </span>
  )
}

/** Full-screen black layer; swiping down closes it (touch events, because horizontal scrolling cancels pointer events). */
function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-black text-white"
      onTouchStart={(e) => {
        const t = e.touches[0]
        start.current = t ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchEnd={(e) => {
        const s = start.current
        const t = e.changedTouches[0]
        start.current = null
        if (!s || !t) return
        const dy = t.clientY - s.y
        if (dy >= 80 && Math.abs(t.clientX - s.x) < dy / 2) onClose()
      }}
    >
      {children}
    </div>
  )
}

export default function PhotoGallery({ onClose }: { onClose: () => void }) {
  const photos = useLiveQuery(allPhotos, [])
  const series = useLiveQuery(bodyWeightSeries, []) ?? []
  const [filter, setFilter] = useState<Filter>('all')
  const [viewer, setViewer] = useState<number | null>(null)
  const [comparing, setComparing] = useState(false)
  const [picked, setPicked] = useState<BodyPhoto[]>([])

  const shown = (photos ?? []).filter((p) => filter === 'all' || p.pose === filter)
  const groups: { month: string; items: BodyPhoto[] }[] = []
  for (const p of shown) {
    const month = monthFormat.format(day(p.measured_on))
    const last = groups.at(-1)
    if (last?.month === month) last.items.push(p)
    else groups.push({ month, items: [p] })
  }

  function tap(p: BodyPhoto) {
    if (!comparing) {
      setViewer(shown.indexOf(p))
      return
    }
    setPicked((cur) => (cur.some((x) => x.id === p.id) ? cur.filter((x) => x.id !== p.id) : cur.length < 2 ? [...cur, p] : cur))
  }

  if (comparing && picked.length === 2) {
    // Older photo on the left
    const [a, b] = [...picked].sort((x, y) => x.measured_on.localeCompare(y.measured_on))
    return <Compare a={a!} b={b!} series={series} onClose={() => setPicked([])} />
  }
  if (viewer !== null && shown.length)
    return <Viewer photos={shown} start={Math.min(viewer, shown.length - 1)} series={series} onClose={() => setViewer(null)} />

  return (
    <div className="fixed inset-0 z-30 overflow-y-auto bg-white pb-[max(env(safe-area-inset-bottom),1.5rem)] dark:bg-zinc-950">
      <header className="sticky top-0 z-10 bg-white/95 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3 backdrop-blur dark:bg-zinc-950/95">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Photos</h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setComparing((c) => !c)
                setPicked([])
              }}
              aria-pressed={comparing}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${comparing ? 'bg-accent text-accent-fg' : 'bg-zinc-100 dark:bg-zinc-800'}`}
            >
              Compare
            </button>
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-zinc-500 dark:text-zinc-400">
              Close
            </button>
          </div>
        </div>
        <div role="radiogroup" aria-label="Pose" className="mx-auto mt-3 grid max-w-xl grid-cols-4 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => {
                setFilter(f.value)
                setPicked([])
              }}
              className={`rounded-md py-1.5 text-xs font-semibold ${filter === f.value ? 'bg-white shadow-sm dark:bg-zinc-700' : 'text-zinc-500 dark:text-zinc-400'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {comparing && <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500 dark:text-zinc-400">Select two photos to compare ({picked.length}/2).</p>}
      </header>

      <div className="mx-auto max-w-xl px-4">
        {photos === undefined ? (
          <p className="text-zinc-500">Loading …</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No photos yet. Add photos with a weight entry in Body.</p>
        ) : (
          groups.map((g) => (
            <section key={g.month} className="mb-4">
              <h2 className="mb-2 text-sm font-semibold text-zinc-500 dark:text-zinc-400">{g.month}</h2>
              <div className="grid grid-cols-3 gap-1.5">
                {g.items.map((p) => {
                  const n = picked.findIndex((x) => x.id === p.id)
                  const w = weightLabel(p.measured_on, series)
                  return (
                    <button
                      key={p.id}
                      onClick={() => tap(p)}
                      className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800 ${n >= 0 ? 'ring-3 ring-accent' : ''}`}
                    >
                      <LazyPhoto photo={p} className="h-full w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1 text-left text-[11px] leading-tight text-white tabular-nums">
                        <span className="block font-semibold">{shortDate.format(day(p.measured_on))}</span>
                        {w && <span className="block">{w}</span>}
                      </span>
                      {n >= 0 && (
                        <span className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">{n + 1}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

function Caption({ photo, series }: { photo: BodyPhoto; series: BodyWeightPoint[] }) {
  const w = weightOnDay(photo.measured_on, series)
  return (
    <>
      <span className="block font-semibold">
        {longDate.format(day(photo.measured_on))}
        {photo.pose ? ` · ${photo.pose[0]!.toUpperCase()}${photo.pose.slice(1)}` : ''}
      </span>
      {w.avg7 !== null && (
        <span className="block text-sm">
          <span className="tabular-nums">{kg(w.avg7)}</span> <span className="opacity-70">(7 days)</span>
          {w.day !== null && <span className="opacity-70"> · <span className="tabular-nums">{kg(w.day)}</span> that day</span>}
        </span>
      )}
    </>
  )
}

/** Full-screen photos with horizontal swipe (scroll snap); only neighbours are decrypted. */
function Viewer({ photos, start, series, onClose }: { photos: BodyPhoto[]; start: number; series: BodyWeightPoint[]; onClose: () => void }) {
  const [index, setIndex] = useState(start)
  const [chrome, setChrome] = useState(true)
  const strip = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = strip.current
    if (el) el.scrollLeft = start * el.clientWidth
  }, [start])

  return (
    <Overlay onClose={onClose}>
      <div
        ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget
          setIndex(Math.round(el.scrollLeft / el.clientWidth))
        }}
        onClick={() => setChrome((c) => !c)}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {photos.map((p, i) => (
          <div key={p.id} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
            {Math.abs(i - index) <= 1 ? <PhotoImage photo={p} className="max-h-full max-w-full object-contain" /> : null}
          </div>
        ))}
      </div>
      {chrome && (
        <>
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-6">
            <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-lg">
              ✕
            </button>
            <span className="text-sm tabular-nums">
              {index + 1} / {photos.length}
            </span>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pt-10 pb-[max(env(safe-area-inset-bottom),1rem)]">
            {photos[index] && <Caption photo={photos[index]} series={series} />}
          </div>
        </>
      )}
    </Overlay>
  )
}

/** Two photos side by side, older on the left. */
function Compare({ a, b, series, onClose }: { a: BodyPhoto; b: BodyPhoto; series: BodyWeightPoint[]; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-lg">
          ✕
        </button>
        <span className="text-sm">Compare</span>
        <span className="w-8" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 items-center gap-1 px-1 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {[a, b].map((p) => (
          <figure key={p.id} className="flex max-h-full min-h-0 flex-col">
            <div className="flex min-h-0 items-center justify-center">
              <PhotoImage photo={p} className="max-h-full max-w-full object-contain" />
            </div>
            <figcaption className="px-1 pt-2 text-xs leading-snug">
              <Caption photo={p} series={series} />
            </figcaption>
          </figure>
        ))}
      </div>
    </Overlay>
  )
}
