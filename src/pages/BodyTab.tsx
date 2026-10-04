import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type FormEvent } from 'react'
import { bodyWeightSeries, deleteBodyWeight, saveBodyWeight, todayLocal } from '../lib/body'
import { parseNumber } from '../lib/workout'

const dateFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export default function BodyTab({ userId }: { userId: string }) {
  const series = useLiveQuery(bodyWeightSeries, [])
  const [date, setDate] = useState(todayLocal())
  const [kg, setKg] = useState('')
  const [error, setError] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const n = parseNumber(kg)
    if (n === undefined || n === null || n < 20 || n > 300) {
      setError(true)
      return
    }
    await saveBodyWeight(userId, date, n)
    setKg('')
    setError(false)
  }

  const latest = series?.[0]
  const input = 'rounded-lg border bg-transparent px-3 py-2 text-base outline-none dark:border-neutral-700'

  return (
    <>
      {latest && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">Latest</div>
            <div className="text-2xl font-semibold tabular-nums">{latest.entry.weight_kg.toFixed(1)} kg</div>
          </div>
          <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-400">7-day average</div>
            <div className="text-2xl font-semibold tabular-nums">{latest.avg7.toFixed(1)} kg</div>
          </div>
        </div>
      )}

      <form onSubmit={(e) => void submit(e)} className="mb-4 flex gap-2">
        <input type="date" aria-label="Date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} className={`${input} border-neutral-300`} />
        <input
          aria-label="Body weight kg"
          inputMode="decimal"
          placeholder="kg"
          value={kg}
          onChange={(e) => {
            setKg(e.target.value)
            setError(false)
          }}
          className={`${input} w-24 min-w-0 flex-1 ${error ? 'border-red-500' : 'border-neutral-300'}`}
        />
        <button type="submit" className="rounded-lg bg-neutral-900 px-4 text-sm font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900">
          Save
        </button>
      </form>

      {series && series.length > 0 ? (
        <table className="w-full text-sm tabular-nums">
          <thead className="text-left text-xs text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="py-1 font-normal">Date</th>
              <th className="py-1 text-right font-normal">kg</th>
              <th className="py-1 text-right font-normal">7-day avg</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.entry.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="py-2">{dateFormat.format(new Date(`${p.entry.measured_on}T12:00:00`))}</td>
                <td className="py-2 text-right">{p.entry.weight_kg.toFixed(1)}</td>
                <td className="py-2 text-right text-neutral-500 dark:text-neutral-400">{p.avg7.toFixed(1)}</td>
                <td className="py-2 text-right">
                  <button aria-label="Delete entry" onClick={() => void deleteBodyWeight(p.entry)} className="px-2 text-neutral-400 hover:text-red-600">
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-neutral-500">No measurements yet.</p>
      )}
    </>
  )
}
