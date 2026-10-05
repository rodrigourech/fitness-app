import { BodyChart, MUSCLE_MAP, ViewSide, type BodyState } from 'body-muscles'
import { regionOf } from '../lib/muscles'
import { useEffect, useRef } from 'react'

function stateFor(regions: string[]): BodyState {
  const wanted = new Set(regions)
  const state: BodyState = {}
  for (const m of MUSCLE_MAP) {
    if (wanted.has(regionOf(m.id))) state[m.id] = { intensity: 9, selected: true }
  }
  return state
}

interface Props {
  regions: string[]
  onToggle?: (region: string) => void
}

function View({ view, regions, onToggle }: Props & { view: ViewSide }) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<BodyChart | null>(null)
  const toggle = useRef(onToggle)
  useEffect(() => {
    toggle.current = onToggle
  }, [onToggle])

  useEffect(() => {
    if (!ref.current) return
    chart.current = new BodyChart(ref.current, {
      view,
      bodyState: {},
      enableTransitions: false,
      ariaLabel: view === ViewSide.FRONT ? 'Body front' : 'Body back',
      onMuscleClick: (id) => toggle.current?.(regionOf(id)),
    })
    return () => {
      chart.current?.destroy()
      chart.current = null
    }
  }, [view])

  useEffect(() => {
    chart.current?.update({ bodyState: stateFor(regions) })
  }, [regions])

  return <div ref={ref} className="w-full [&_svg]:h-auto [&_svg]:w-full" />
}

/** Front and back body map with the focus regions highlighted. Tapping a muscle toggles it if editable. */
export default function BodyMap({ regions, onToggle }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <figure>
        <View view={ViewSide.FRONT} regions={regions} onToggle={onToggle} />
        <figcaption className="text-center text-xs text-zinc-500 dark:text-zinc-400">Front</figcaption>
      </figure>
      <figure>
        <View view={ViewSide.BACK} regions={regions} onToggle={onToggle} />
        <figcaption className="text-center text-xs text-zinc-500 dark:text-zinc-400">Back</figcaption>
      </figure>
    </div>
  )
}
