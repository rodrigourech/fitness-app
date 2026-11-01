import { describe, expect, it } from 'vitest'
import { buildPreview, handle, itemValues, previewEntries, previewText, signPreview, verifyPreview, zurichDayRange, type FoodEnv, type Sql } from './foodmcp.ts'

const KEY = 'k'.repeat(40)
const env: FoodEnv = { FOOD_MCP_KEY: KEY, FOOD_DATABASE_URL: 'postgresql://food:pw@ep-x.eu-central-1.aws.neon.tech/neondb', FOOD_USER_ID: 'u1' }
const MINCE = { id: '00000000-0000-4000-8000-000000000003', name: 'Beef mince bio 10 %', store: 'Coop', basis: '100g' as const, kcal: 170, protein_g: 20, piece_g: null, package_g: 250 }
const RICE = { id: '00000000-0000-4000-8000-000000000005', name: 'Rice, raw', store: null, basis: '100g' as const, kcal: 350, protein_g: 7, piece_g: null, package_g: null }
const OIL = { id: '00000000-0000-4000-8000-000000000009', name: 'Sunflower oil, 1 tsp', store: null, basis: 'piece' as const, kcal: 45, protein_g: 0, piece_g: 5, package_g: null }
const NOW = new Date('2026-11-01T18:20:00Z')

/** In-memory database answering the statements of the connector. */
function fakeSql() {
  const items = [MINCE, RICE, OIL].map((s) => ({ ...s, user_id: 'u1', deleted_at: null }))
  const entries: Record<string, unknown>[] = []
  const sql: Sql = async (q, p = []) => {
    if (q.startsWith('select id, name, store, basis')) return items.filter((i) => i.user_id === p[0])
    if (q.startsWith('select id, eaten_at')) return entries.filter((e) => e.deleted_at === null && String(e.eaten_at) >= String(p[1]) && String(e.eaten_at) < String(p[2]))
    if (q.startsWith('select id from public.food_entry')) return entries.filter((e) => e.eaten_at === p[1] && e.title === p[2] && e.kcal === p[3])
    if (q.startsWith('insert into public.food_entry')) {
      entries.push({ id: p[0], eaten_at: p[2], category: p[3], title: p[4], kcal: p[7], protein_g: p[8], source: p[11], deleted_at: null })
      return []
    }
    throw new Error(`unexpected ${q}`)
  }
  return { sql, entries }
}

async function call(body: unknown, sql: Sql, path = `/mcp/${KEY}`) {
  const res = await handle(new Request(`https://fn.example${path}`, { method: 'POST', body: JSON.stringify(body) }), env, () => sql, NOW)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (res.status === 200 ? await res.json() : null) as any }
}

describe('food connector', () => {
  it('computes staples on the server and estimates only the rest', () => {
    expect(itemValues({ staple_id: MINCE.id, quantity: 1, unit: 'pack' }, [MINCE])).toMatchObject({ kcal: 425, protein_g: 50, amount: '250 g', source: 'staple' })
    expect(itemValues({ staple_id: OIL.id, quantity: 1, unit: 'piece' }, [OIL])).toMatchObject({ kcal: 45, amount: '1 Stück' })
    expect(() => itemValues({ staple_id: RICE.id, quantity: 1, unit: 'pack' }, [RICE])).toThrow(/Pack size/)
    expect(() => itemValues({ name: 'Onion', quantity: 100, unit: 'g' }, [])).toThrow(/needs name, kcal and protein_g/)
    expect(itemValues({ name: 'Onion', quantity: 100, unit: 'g', kcal: 40, protein_g: 1.2 }, [])).toMatchObject({ source: 'estimate', kcal: 40 })
  })

  it('splits portions and renders the fixed format', () => {
    const p = buildPreview({ category: 'dinner', items: [{ staple_id: MINCE.id, quantity: 1, unit: 'pack' }, { staple_id: RICE.id, quantity: 150, unit: 'g' },
      { staple_id: OIL.id, quantity: 1, unit: 'piece' }, { name: 'Onion', quantity: 100, unit: 'g', kcal: 40, protein_g: 1 }], portions_cooked: 2, portions_eaten: 1 }, [MINCE, RICE, OIL], NOW)
    expect(p).toMatchObject({ totalKcal: 1035, kcal: 518, cooked: 2, eaten: 1 })
    const text = previewText(p, { kcal: 833, protein: 114 })
    expect(text).toContain('Mahlzeit    Abendessen')
    expect(text).toContain('Ihre Portion       518 kcal · 31 g Protein')
    expect(text).toContain('Heute danach       1 351 kcal · 145 g Protein')
    expect(text).toContain('Eintragen? (ja / ändern)')
    expect(text).toContain('Schätzung')
  })

  it('meal prep: one entry per portion on its own day', () => {
    const p = buildPreview({ category: 'dinner', items: [{ staple_id: MINCE.id, quantity: 2, unit: 'pack' }, { staple_id: RICE.id, quantity: 225, unit: 'g' }],
      portions: [{ eaten_at: '2026-11-01T19:20:00+01:00' }, { eaten_at: '2026-11-02T12:30:00+01:00', category: 'lunch' }, { eaten_at: '2026-11-03T12:30:00+01:00', category: 'lunch' }] }, [MINCE, RICE], NOW)
    expect(p).toMatchObject({ totalKcal: 1638, kcal: 546, cooked: 3, eaten: 1, category: 'dinner' })
    const rows = previewEntries(p)
    expect(rows.map((r) => r.category)).toEqual(['dinner', 'lunch', 'lunch'])
    expect(rows[1]).toMatchObject({ eatenAt: '2026-11-02T11:30:00.000Z', cooked: 3, eaten: 1 })
    expect(rows[2]!.detail).toMatch(/^3\. von 3 Portionen/)
    const text = previewText(p, { kcal: 1000, protein: 100 })
    expect(text).toContain('Gekocht 3 Portionen')
    expect(text).toMatch(/Portion 2 +Mittagessen · Mo/)
    expect(text).toContain('Pro Portion        546 kcal')
    expect(text).toContain('Heute danach       1 546 kcal')
    expect(() => buildPreview({ category: 'drinks', items: [{ name: 'Beer', quantity: 1, unit: 'serving', kcal: 210, protein_g: 2.5 }], portions: [{ category: 'brunch' }, {}] }, [], NOW)).toThrow(/Portion 1/)
    expect(buildPreview({ category: 'drinks', items: [{ name: 'Beer', quantity: 3, unit: 'serving', kcal: 630, protein_g: 7.5 }] }, [], NOW)).toMatchObject({ category: 'drinks', schedule: null, kcal: 630 })
  })

  it('signs previews; a changed token is rejected', async () => {
    const p = buildPreview({ category: 'snack', items: [{ name: 'Skyr', quantity: 150, unit: 'g', kcal: 95, protein_g: 16 }] }, [], new Date())
    const token = await signPreview(KEY, p)
    expect((await verifyPreview(KEY, token))?.kcal).toBe(95)
    expect(await verifyPreview(KEY, token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBeNull()
    expect(await verifyPreview('x'.repeat(40), token)).toBeNull()
  })

  it('Zurich day range follows summer and winter time', () => {
    expect(zurichDayRange('2026-11-01')).toEqual(['2026-10-31T23:00:00.000Z', '2026-11-01T23:00:00.000Z'])
    expect(zurichDayRange('2026-07-01')[0]).toBe('2026-06-30T22:00:00.000Z')
  })

  it('MCP: wrong key 404, initialize, tools, preview then confirm', async () => {
    const { sql, entries } = fakeSql()
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize' }, sql, '/mcp/wrong')).status).toBe(404)
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, sql)
    expect(init.json.result.serverInfo.name).toBe('fitness-food')
    expect(init.json.result.instructions).toContain('confirm_meal')
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, sql)).status).toBe(202)
    const tools = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sql)
    expect(tools.json.result.tools.map((t: { name: string }) => t.name)).toEqual(['list_staples', 'add_staple', 'preview_meal', 'confirm_meal', 'get_day', 'delete_entry'])
    const preview = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'preview_meal', arguments: { category: 'lunch', items: [{ staple_id: RICE.id, quantity: 75, unit: 'g' }] } } }, sql)
    expect(entries).toHaveLength(0)
    const text: string = preview.json.result.content[0].text
    expect(text).toContain('Eintragen? (ja / ändern)')
    const token = /preview_token: (\S+)/.exec(text)![1]
    const confirm = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'confirm_meal', arguments: { preview_token: token } } }, sql)
    expect(confirm.json.result.content[0].text).toContain('Eingetragen als Mittagessen: 263 kcal')
    await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'confirm_meal', arguments: { preview_token: token } } }, sql)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ source: 'claude', kcal: 263 })
    const prep = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'preview_meal', arguments: { category: 'dinner', items: [{ staple_id: RICE.id, quantity: 300, unit: 'g' }],
      portions: [{ eaten_at: '2026-11-01T19:20:00+01:00' }, { eaten_at: '2026-11-02T12:30:00+01:00', category: 'lunch' }] } } }, sql)
    const prepToken = /preview_token: (\S+)/.exec(prep.json.result.content[0].text)![1]
    const saved = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'confirm_meal', arguments: { preview_token: prepToken } } }, sql)
    expect(saved.json.result.content[0].text).toContain('Eingetragen: 2 Portionen à 525 kcal')
    expect(entries).toHaveLength(3)
    expect(entries.slice(1).map((e) => e.category)).toEqual(['dinner', 'lunch'])
    await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'confirm_meal', arguments: { preview_token: prepToken } } }, sql)
    expect(entries).toHaveLength(3)
    const bad = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'confirm_meal', arguments: { preview_token: 'x.y' } } }, sql)
    expect(bad.json.result.isError).toBe(true)
  })
})
