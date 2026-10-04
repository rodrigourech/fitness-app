import { describe, expect, it } from 'vitest'
import { catalogDefaults, loadCatalog, searchCatalog } from './catalog'

describe('catalog', () => {
  it('loads all entries', async () => {
    const c = await loadCatalog()
    expect(c.length).toBeGreaterThan(800)
    expect(c.every((e) => e.id && e.name)).toBe(true)
  })

  it('finds exercises by words in any order, best match first', async () => {
    const c = await loadCatalog()
    const r = searchCatalog(c, 'pushdown triceps')
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((e) => /pushdown/i.test(e.name) && /tricep/i.test(e.name))).toBe(true)
    expect(searchCatalog(c, 'leg press')[0]!.name.toLowerCase().startsWith('leg press')).toBe(true)
    expect(searchCatalog(c, 'x')).toEqual([])
  })

  it('maps catalog muscles to keys and body map regions', async () => {
    const c = await loadCatalog()
    const e = c.find((x) => x.primary.includes('chest') && x.secondary.includes('triceps'))!
    const d = catalogDefaults(e)
    expect(d.musclesPrimary).toContain('chest')
    expect(d.focusMuscles).toEqual(expect.arrayContaining(['chest-upper', 'chest-lower']))
    expect(d.sourceId).toBe(e.id)
  })
})
