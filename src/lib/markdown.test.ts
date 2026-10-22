import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type WorkoutSet } from './db'
import { saveBodyWeight } from './body'
import { historyMarkdown, loadExportData, localDay, workoutMarkdown, workoutsInRange } from './markdown'
import { importSeedIfNeeded } from './seed'
import { finishWorkout, startWorkout, toggleSetDone, updateSet, updateWorkout } from './workout'

const USER = 'u1'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded(USER)
})

async function workingSets(workoutId: string, name: string): Promise<WorkoutSet[]> {
  const ex = (await db.exercise.toArray()).find((e) => e.name === name)!
  const we = (await db.workout_exercise.where('workout_id').equals(workoutId).toArray()).find((x) => x.exercise_id === ex.id)!
  return (await db.workout_set.where('workout_exercise_id').equals(we.id).toArray())
    .filter((s) => s.set_type === 'working')
    .sort((a, b) => a.position - b.position)
}

async function finishedDay2() {
  const day2 = (await db.template.toArray()).find((t) => t.name === 'DAY2')!
  const w = await startWorkout(day2.id, USER)
  for (const s of await workingSets(w.id, 'Lying Leg Curl (Machine)')) {
    await updateSet(s, { weight: 35, reps: 5 })
    await toggleSetDone((await db.workout_set.get(s.id))!)
  }
  await updateWorkout((await db.workout.get(w.id))!, { note: 'Knie | gut', crowd_level: 6 })
  await saveBodyWeight(USER, localDay(new Date()), 78.4, 'morning_fasted')
  await finishWorkout((await db.workout.get(w.id))!)
  return w
}

describe('markdown export', () => {
  it('exports one workout with context, comparison and previous sets', async () => {
    const w = await finishedDay2()
    const md = workoutMarkdown(await loadExportData(), w.id)!
    expect(md).toMatch(/^# DAY2 · /)
    expect(md).toContain('- Gym crowd 6/10')
    expect(md).toContain('- Body weight 78.4 kg (Morning, fasted)')
    expect(md).toContain('- Note: Knie | gut')
    expect(md).toMatch(/## Compared with last DAY2 \(/)
    expect(md).toContain('| Metric | This workout | Last | Change |')
    expect(md).toMatch(/## \d+\. Lying Leg Curl \(Machine\)/)
    expect(md).toMatch(/\| Set \| Type \| Result \| Previous \(DAY\d, /)
    // Reps under the minimum are marked; open sets of other exercises were discarded at the finish
    expect(md).toContain('35 kg × 5 (below min)')
    expect(md).toContain('> Notes for reading')
    expect(md).not.toMatch(/\n{3,}/)
  })

  it('returns null for an unknown workout', async () => {
    expect(workoutMarkdown(await loadExportData(), 'nope')).toBeNull()
  })

  it('exports the history of a period with summary, body weight, plan and workouts', async () => {
    const w = await finishedDay2()
    const data = await loadExportData()
    const now = new Date()
    expect(workoutsInRange(data, '7d', now).map((x) => x.id)).toEqual([w.id])
    expect(workoutsInRange(data, 'all', now).length).toBe(data.workouts.length)

    const week = historyMarkdown(data, '7d', now)
    expect(week).toMatch(/^# Training history · Last 7 days/)
    expect(week).toContain('## Summary')
    expect(week).toContain('- Workouts 1 (DAY2 1)')
    expect(week).toContain('### Per week (from Monday)')
    expect(week).toContain('### Top set per exercise')
    expect(week).toContain('## Body weight')
    expect(week).toContain('| Date | kg | Condition | Note |')
    expect(week).toContain('## Current plan')
    expect(week).toContain('| # | Exercise | Sets | Reps | Top set | Rest | Weight step |')
    expect(week).toContain('## Workouts (oldest first)')
    expect(week).toMatch(/### DAY2 · /)
    expect(week).toMatch(/#### Compared with last DAY2/)

    const all = historyMarkdown(data, 'all', now)
    expect(all.length).toBeGreaterThan(week.length)
    // Oldest first: the new workout is the last one
    const headings = [...all.matchAll(/^### (.+) · (.+)$/gm)]
    expect(headings.length).toBe(data.workouts.length)
    expect(headings.at(-1)![1]).toBe('DAY2')
  })

  it('handles a period without workouts', async () => {
    const data = await loadExportData()
    const md = historyMarkdown(data, '7d', new Date('2099-01-01T12:00:00Z'))
    expect(md).toContain('No workouts in this period.')
    expect(md).toContain('No entries in this period.')
    expect(md).not.toContain('## Summary')
  })
})
