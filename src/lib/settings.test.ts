import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { db } from './db'
import { DEFAULT_WEEKLY_GOAL, getTemplateOrder, getWeeklyGoal, moveTemplate, parseWeeklyGoal, saveWeeklyGoal, sortByOrder } from './settings'

describe('weekly goal setting', () => {
  it('falls back to the default and clamps stored values', () => {
    expect(parseWeeklyGoal(null)).toEqual(DEFAULT_WEEKLY_GOAL)
    expect(parseWeeklyGoal({ strength: 9, run: -1 })).toEqual({ strength: 7, run: 0 })
    expect(parseWeeklyGoal({ strength: '3' })).toEqual(DEFAULT_WEEKLY_GOAL)
  })

  it('saves into one fixed row and queues it for sync', async () => {
    await saveWeeklyGoal('u1', { strength: 3, run: 1 })
    await saveWeeklyGoal('u1', { strength: 4, run: 0 })
    expect(await db.user_setting.count()).toBe(1)
    expect(await getWeeklyGoal()).toEqual({ strength: 4, run: 0 })
    expect(await db.outbox.where('table').equals('user_setting').count()).toBe(1)
  })
})

describe('workout order', () => {
  it('sorts by the stored order and moves workouts', async () => {
    await db.user_setting.clear()
    const items = [{ id: 'a', name: 'Run' }, { id: 'b', name: 'Main Day A' }, { id: 'c', name: 'Bonus Day' }]
    expect(sortByOrder(items, []).map((x) => x.id)).toEqual(['c', 'b', 'a'])
    await moveTemplate('u1', ['c', 'b', 'a'], 'b', -1)
    expect(await getTemplateOrder()).toEqual(['b', 'c', 'a'])
    expect(sortByOrder(items, await getTemplateOrder()).map((x) => x.name)).toEqual(['Main Day A', 'Bonus Day', 'Run'])
  })
})
