import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { addLink, linksFor, normalizeUrl, removeLink, updateExercise } from './exercise'
import { regionName, regionOf } from './muscles'
import { importSeedIfNeeded } from './seed'
import { effective } from './workout'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await importSeedIfNeeded('u1')
})

async function byKeyName(name: string) {
  return (await db.exercise.toArray()).find((e) => e.name === name)!
}

describe('focus', () => {
  it('seed contains the confirmed focus and variants keep their own', async () => {
    const all = await db.exercise.toArray()
    const byId = new Map(all.map((e) => [e.id, e]))
    const low = await byKeyName('Sitz tiefer')
    expect(effective(low, byId).focusMuscles).toEqual(['chest-upper'])
    const lateral = await byKeyName('Lateral Raise (Cable)')
    expect(effective(lateral, byId).focusMuscles).toEqual(['shoulder-side'])
  })

  it('a variant without own focus inherits from the parent', async () => {
    const parent = await byKeyName('Chest Press (Machine)')
    const variant = await byKeyName('Griffe Mitte Brust')
    await updateExercise(parent, { focus_muscles: ['chest-lower'], focus_cue: 'parent cue' })
    await updateExercise(variant, { focus_muscles: null, focus_cue: null })
    const all = await db.exercise.toArray()
    const byId = new Map(all.map((e) => [e.id, e]))
    const eff = effective(byId.get(variant.id)!, byId)
    expect(eff.focusMuscles).toEqual(['chest-lower'])
    expect(eff.focusCue).toBe('parent cue')
  })

  it('region helpers strip sides and give English names', () => {
    expect(regionOf('shoulder-side-left')).toBe('shoulder-side')
    expect(regionName('shoulder-side')).toBe('Shoulder (Side)')
  })
})

describe('links', () => {
  it('adds, inherits and removes links', async () => {
    const parent = await byKeyName('Chest Press (Machine)')
    const variant = await byKeyName('Sitz tiefer')
    await addLink(parent, 'https://example.com/parent', null)
    await addLink(variant, 'https://example.com/variant', 'Mein Video')
    let links = await linksFor(variant)
    expect(links.map((l) => [l.url, l.inherited])).toEqual([
      ['https://example.com/variant', false],
      ['https://example.com/parent', true],
    ])
    await removeLink(links[0]!)
    links = await linksFor(variant)
    expect(links).toHaveLength(1)
    expect(await db.outbox.where('table').equals('exercise_link').count()).toBeGreaterThan(0)
  })

  it('normalizes URLs', () => {
    expect(normalizeUrl('youtube.com/watch?v=abc')).toBe('https://youtube.com/watch?v=abc')
    expect(normalizeUrl('https://www.instagram.com/reel/x')).toBe('https://www.instagram.com/reel/x')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
  })
})
