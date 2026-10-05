import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { formatShortDate, niceTicks } from '../lib/chart'

// Small hand-built SVG/HTML charts for the Stats tab. Colors come from the --viz-* tokens in
// index.css (light and dark). Marks: 2px lines, 8px dots with a 2px surface ring, columns
// at most 24px with a 4px rounded top, hairline solid gridlines.

/** Width of an element, updated on resize. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}


function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the box inside the chart: anchor left, centre or right depending on position
  const side = x < width * 0.3 ? 'left' : x > width * 0.7 ? 'right' : 'center'
  const style =
    side === 'left' ? { left: Math.max(0, x - 12) } : side === 'right' ? { right: Math.max(0, width - x - 12) } : { left: x, transform: 'translateX(-50%)' }
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-0 z-10 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs whitespace-nowrap shadow-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
      style={style}
    >
      {children}
    </div>
  )
}

// --- line chart -------------------------------------------------------------------

export interface LinePoint {
  /** Timestamp (ms) */
  x: number
  y: number
  tooltip: ReactNode
  /** Small label above the point (e.g. reps); shown where there is room */
  label?: string
}

interface LineProps {
  points: LinePoint[]
  formatY: (v: number) => string
  height?: number
  /** Accessible summary of the chart */
  label: string
  /** Draw as steps: the value holds until the next point (e.g. weight that only changes on increase) */
  step?: boolean
}

const LABEL_CHAR_PX = 6.2

/** Indexes of point labels that fit without overlapping, preferring the most recent ones. */
function visibleLabels(xs: number[], labels: (string | undefined)[]): Set<number> {
  const shown = new Set<number>()
  let leftEdge = Infinity
  for (let i = xs.length - 1; i >= 0; i--) {
    const text = labels[i]
    if (!text) continue
    const half = (text.length * LABEL_CHAR_PX) / 2
    if (xs[i]! + half + 4 <= leftEdge) {
      shown.add(i)
      leftEdge = xs[i]! - half
    }
  }
  return shown
}

export function LineChart({ points, formatY, height = 190, label, step = false }: LineProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const pad = { top: 28, right: 12, bottom: 22, left: 40 }
  const ys = points.map((p) => p.y)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const spread = hi - lo || hi * 0.1 || 1
  const ticks = niceTicks(Math.max(0, lo - spread * 0.15), hi + spread * 0.15)
  const y0 = ticks[0]!
  const y1 = ticks[ticks.length - 1]!
  const x0 = points[0]?.x ?? 0
  const x1 = points[points.length - 1]?.x ?? 1
  const iw = Math.max(1, width - pad.left - pad.right)
  const ih = height - pad.top - pad.bottom
  const sx = (x: number) => pad.left + (x1 === x0 ? iw / 2 : ((x - x0) / (x1 - x0)) * iw)
  const sy = (y: number) => pad.top + ih - ((y - y0) / (y1 - y0 || 1)) * ih

  const path = points
    .map((p, i) =>
      i === 0
        ? `M${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`
        : step
          ? `H${sx(p.x).toFixed(1)}V${sy(p.y).toFixed(1)}`
          : `L${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`,
    )
    .join('')
  const hasLabels = points.some((p) => p.label)
  const shownLabels = hasLabels ? visibleLabels(points.map((p) => sx(p.x)), points.map((p) => p.label)) : new Set<number>()
  const area = points.length > 1 ? `${path}L${sx(x1).toFixed(1)},${pad.top + ih}L${sx(x0).toFixed(1)},${pad.top + ih}Z` : ''

  function pick(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - r.left
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(sx(p.x) - mx) < Math.abs(sx(points[best]!.x) - mx)) best = i
    })
    setActive(best)
  }

  // Date ticks: first, last and (if room) the middle point
  const xTicks = points.length > 2 && width > 260 ? [points[0]!, points[Math.floor(points.length / 2)]!, points.at(-1)!] : points.length ? [points[0]!, points.at(-1)!] : []
  const last = points.at(-1)
  const act = active !== null ? points[active] : undefined

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="touch-pan-y select-none"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={sy(t)} y2={sy(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={pad.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)">
                {formatY(t)}
              </text>
            </g>
          ))}
          {xTicks.map((p, i) => (
            <text
              key={i}
              x={sx(p.x)}
              y={height - 6}
              fontSize={11}
              fill="var(--viz-muted)"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {formatShortDate(p.x)}
            </text>
          ))}
          {area && <path d={area} fill="var(--viz-s1-wash)" />}
          <path d={path} fill="none" stroke="var(--viz-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {act && <line x1={sx(act.x)} x2={sx(act.x)} y1={pad.top} y2={pad.top + ih} stroke="var(--viz-muted)" strokeWidth={1} />}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={i === active ? 5 : 4}
              fill="var(--viz-s1)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
            />
          ))}
          {points.map((p, i) =>
            shownLabels.has(i) ? (
              <text
                key={`l${i}`}
                x={Math.min(Math.max(sx(p.x), pad.left + 12), width - pad.right - 12)}
                y={sy(p.y) - 10}
                textAnchor="middle"
                fontSize={11}
                fill="var(--viz-muted)"
              >
                {p.label}
              </text>
            ) : null,
          )}
          {/* Direct label on the last point only (when points carry no labels) */}
          {last && active === null && !hasLabels && (
            <text x={sx(last.x)} y={sy(last.y) - 10} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--viz-text)">
              {formatY(last.y)}
            </text>
          )}
        </svg>
      )}
      {act && (
        <Tooltip x={sx(act.x)} width={width}>
          {act.tooltip}
        </Tooltip>
      )}
    </div>
  )
}

// --- column chart -----------------------------------------------------------------

export interface Column {
  key: string
  /** Axis label (shown selectively) */
  label: string
  value: number
  tooltip: ReactNode
}

interface ColumnProps {
  columns: Column[]
  formatY: (v: number) => string
  height?: number
  label: string
}

export function ColumnChart({ columns, formatY, height = 170, label }: ColumnProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const pad = { top: 28, right: 8, bottom: 22, left: 40 }
  const ticks = niceTicks(0, Math.max(...columns.map((c) => c.value), 0))
  const top = ticks[ticks.length - 1]!
  const iw = Math.max(1, width - pad.left - pad.right)
  const ih = height - pad.top - pad.bottom
  const band = iw / Math.max(1, columns.length)
  const bw = Math.min(24, Math.max(2, band - 2)) // 2px surface gap between touching columns
  const sy = (v: number) => pad.top + ih - (v / (top || 1)) * ih
  const labelEvery = Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(iw / 44))))

  function pick(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - r.left - pad.left) / band)
    setActive(i >= 0 && i < columns.length ? i : null)
  }

  const act = active !== null ? columns[active] : undefined

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="touch-pan-y select-none"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={sy(t)} y2={sy(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={pad.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)">
                {formatY(t)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const cx = pad.left + band * i + band / 2
            const h = Math.max(0, pad.top + ih - sy(c.value))
            const r = Math.min(4, bw / 2, h)
            const x = cx - bw / 2
            const yTop = pad.top + ih - h
            // Rounded data end, square at the baseline
            const d = h > 0 ? `M${x},${pad.top + ih}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + bw - r}Q${x + bw},${yTop} ${x + bw},${yTop + r}V${pad.top + ih}Z` : ''
            return (
              <g key={c.key}>
                {d && <path d={d} fill="var(--viz-s1)" opacity={active === null || active === i ? 1 : 0.55} />}
                {i % labelEvery === 0 && (
                  <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                    {c.label}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {act && (
        <Tooltip x={pad.left + band * active! + band / 2} width={width}>
          {act.tooltip}
        </Tooltip>
      )}
    </div>
  )
}

// --- horizontal bars --------------------------------------------------------------

export interface HBar {
  key: string
  label: string
  value: number
  valueLabel: string
}

export function HBarChart({ bars }: { bars: HBar[] }) {
  const max = Math.max(...bars.map((b) => b.value), 1)
  return (
    <ul className="flex flex-col gap-1.5">
      {bars.map((b) => (
        <li key={b.key} className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-2 text-sm">
          <span className="truncate text-zinc-700 dark:text-zinc-300">{b.label}</span>
          <span className="h-3">
            <span
              className="block h-3 rounded-r-[4px]"
              style={{ width: `${(b.value / max) * 100}%`, minWidth: 2, background: 'var(--viz-s1)' }}
            />
          </span>
          <span className="text-right tabular-nums">{b.valueLabel}</span>
        </li>
      ))}
    </ul>
  )
}

// --- side comparison (butterfly) ---------------------------------------------------

export interface SidePair {
  key: string
  label: string
  left: number
  right: number
  note: string
}

export function SideChart({ pairs }: { pairs: SidePair[] }) {
  const max = Math.max(...pairs.flatMap((p) => [p.left, p.right]), 1)
  return (
    <div>
      <div className="mb-2 flex items-center justify-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-s1)' }} /> Left
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-s2)' }} /> Right
        </span>
      </div>
      <ul className="flex flex-col gap-3">
        {pairs.map((p) => (
          <li key={p.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{p.label}</span>
              <span className="shrink-0 text-xs text-zinc-500 tabular-nums dark:text-zinc-400">{p.note}</span>
            </div>
            <div className="grid grid-cols-[2.5rem_1fr_1fr_2.5rem] items-center gap-0.5 text-xs tabular-nums">
              <span className="text-zinc-600 dark:text-zinc-300">{p.left}</span>
              <span className="flex h-3 justify-end">
                <span className="block h-3 rounded-l-[4px]" style={{ width: `${(p.left / max) * 100}%`, background: 'var(--viz-s1)' }} />
              </span>
              <span className="h-3">
                <span className="block h-3 rounded-r-[4px]" style={{ width: `${(p.right / max) * 100}%`, background: 'var(--viz-s2)' }} />
              </span>
              <span className="text-right text-zinc-600 dark:text-zinc-300">{p.right}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// --- heatmap ------------------------------------------------------------------------

export interface HeatCell {
  key: string
  /** 1..5 bucket for the color, null = no data */
  level: number | null
  text: string
  tooltip: string
}

interface HeatProps {
  rows: string[]
  cols: string[]
  /** cells[row][col] */
  cells: HeatCell[][]
  legend: [string, string]
}

export function Heatmap({ rows, cols, cells, legend }: HeatProps) {
  const [active, setActive] = useState<string | null>(null)
  const act = cells.flat().find((c) => c.key === active)
  return (
    <div>
      <div className="grid gap-[2px] text-[11px]" style={{ gridTemplateColumns: `2.25rem repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span />
        {cols.map((c) => (
          <span key={c} className="text-center text-zinc-500 dark:text-zinc-400">
            {c}
          </span>
        ))}
        {rows.map((r, ri) => (
          <div key={r} className="contents">
            <span className="self-center text-zinc-500 dark:text-zinc-400">{r}</span>
            {cells[ri]!.map((c) => (
              <button
                key={c.key}
                type="button"
                aria-label={c.tooltip}
                onClick={() => setActive(active === c.key ? null : c.key)}
                className={`flex h-8 items-center justify-center rounded-[4px] font-semibold tabular-nums ${active === c.key ? 'ring-2 ring-zinc-900 dark:ring-zinc-100' : ''}`}
                style={{
                  background: c.level === null ? 'var(--viz-empty)' : `var(--viz-seq-${c.level})`,
                  color: c.level === null ? 'var(--viz-muted)' : `var(--viz-seq-ink-${c.level})`,
                }}
              >
                {c.text}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{legend[0]}</span>
        {[1, 2, 3, 4, 5].map((l) => (
          <span key={l} className="inline-block h-3 w-5 rounded-[3px]" style={{ background: `var(--viz-seq-${l})` }} />
        ))}
        <span>{legend[1]}</span>
      </div>
      <p className="mt-1 min-h-5 text-xs text-zinc-600 tabular-nums dark:text-zinc-300">{act ? act.tooltip : 'Tap a cell for details.'}</p>
    </div>
  )
}

// --- sparkline ----------------------------------------------------------------------

/** Tiny trend line without axes; the end dot marks the latest value. */
export function Sparkline({ values, width = 88, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const pad = 4
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const sx = (i: number) => (values.length < 2 ? width / 2 : pad + (i / (values.length - 1)) * (width - 2 * pad))
  const sy = (v: number) => (hi === lo ? height / 2 : pad + (1 - (v - lo) / (hi - lo)) * (height - 2 * pad))
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('')
  const last = values.length - 1
  return (
    <svg width={width} height={height} aria-hidden="true" className="shrink-0">
      {values.length > 1 && <path d={d} fill="none" stroke="var(--viz-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      <circle cx={sx(last)} cy={sy(values[last]!)} r={3} fill="var(--viz-s1)" stroke="var(--viz-surface)" strokeWidth={1.5} />
    </svg>
  )
}

// --- weekly goal columns ------------------------------------------------------------

export interface GoalColumn {
  key: string
  /** Axis label (shown selectively) */
  label: string
  /** Bottom segment (strength workouts) */
  a: number
  /** Top segment (runs) */
  b: number
  met: boolean
  tooltip: ReactNode
}

interface GoalColumnsProps {
  columns: GoalColumn[]
  /** Height of the goal line (strength workouts per week) */
  goal: number
  legend: [string, string]
  height?: number
  label: string
}

/** Stacked columns per week with a goal line and a check mark under weeks that met the goal. */
export function GoalColumns({ columns, goal, legend, height = 180, label }: GoalColumnsProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const pad = { top: 16, right: 34, bottom: 36, left: 24 }
  const maxV = Math.max(goal, ...columns.map((c) => c.a + c.b), 1)
  const stepV = maxV <= 6 ? 1 : 2
  const top = Math.ceil(maxV / stepV) * stepV
  const ticks: number[] = []
  for (let v = 0; v <= top; v += stepV) ticks.push(v)
  const iw = Math.max(1, width - pad.left - pad.right)
  const ih = height - pad.top - pad.bottom
  const band = iw / Math.max(1, columns.length)
  const bw = Math.min(24, Math.max(4, band - 4))
  const sy = (v: number) => pad.top + ih - (v / top) * ih
  const labelEvery = Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(iw / 48))))

  // Bar path with rounded top corners (radius r), square at the bottom
  const bar = (x: number, y0: number, y1: number, rounded: boolean) => {
    const h = y0 - y1
    if (h <= 0) return ''
    const r = rounded ? Math.min(4, bw / 2, h) : 0
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + bw - r}Q${x + bw},${y1} ${x + bw},${y1 + r}V${y0}Z`
  }

  function pick(e: PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - r.left - pad.left) / band)
    setActive(i >= 0 && i < columns.length ? i : null)
  }

  const act = active !== null ? columns[active] : undefined

  return (
    <div>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={label}
            className="touch-pan-y select-none"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={sy(t)} y2={sy(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={pad.left - 6} y={sy(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)">
                  {t}
                </text>
              </g>
            ))}
            {columns.map((c, i) => {
              const x = pad.left + band * i + (band - bw) / 2
              const base = sy(0)
              const ya = sy(c.a)
              // 2px surface gap between the two segments
              const yb = sy(c.a + c.b)
              const dim = active !== null && active !== i ? 0.55 : 1
              return (
                <g key={c.key} opacity={dim}>
                  {c.a > 0 && <path d={bar(x, base, ya, c.b === 0)} fill="var(--viz-s1)" />}
                  {c.b > 0 && <path d={bar(x, c.a > 0 ? ya - 2 : base, yb, true)} fill="var(--viz-s2)" />}
                  {c.met && (
                    <text x={x + bw / 2} y={height - 22} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--viz-text)">
                      ✓
                    </text>
                  )}
                  {i % labelEvery === 0 && (
                    <text x={x + bw / 2} y={height - 5} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                      {c.label}
                    </text>
                  )}
                </g>
              )
            })}
            {/* Goal line */}
            <line x1={pad.left} x2={width - pad.right} y1={sy(goal)} y2={sy(goal)} stroke="var(--viz-text)" strokeWidth={1.5} opacity={0.7} />
            <text x={width - pad.right + 4} y={sy(goal)} dy="0.32em" fontSize={11} fontWeight={600} fill="var(--viz-text)">
              Goal
            </text>
          </svg>
        )}
        {act && (
          <Tooltip x={pad.left + band * active! + band / 2} width={width}>
            {act.tooltip}
          </Tooltip>
        )}
      </div>
      <div className="mt-1 flex gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-s1)' }} /> {legend[0]}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-s2)' }} /> {legend[1]}
        </span>
        <span>✓ goal met</span>
      </div>
    </div>
  )
}
