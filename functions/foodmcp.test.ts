import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { buildPreview, buildRecipe, handle, recipePreviewText, itemValues, previewEntries, previewText, recipePreview, scaledAmount, signPreview, stockNeed, stockPreview, verifyPreview, zurichDayRange, type FoodEnv, type Sql } from './foodmcp.ts'

const KEY = 'k'.repeat(40)
const env: FoodEnv = { FOOD_MCP_KEY: KEY, FOOD_DATABASE_URL: 'postgresql://food:pw@ep-x.eu-central-1.aws.neon.tech/neondb', FOOD_USER_ID: 'u1' }
const MINCE = { id: '00000000-0000-4000-8000-000000000003', name: 'Beef mince bio 10 %', store: 'Coop', basis: '100g' as const, kcal: 170, protein_g: 20, piece_g: null, package_g: 250 }
const RICE = { id: '00000000-0000-4000-8000-000000000005', name: 'Rice, raw', store: null, basis: '100g' as const, kcal: 350, protein_g: 7, piece_g: null, package_g: null }
const OIL = { id: '00000000-0000-4000-8000-000000000009', name: 'Sunflower oil, 1 tsp', store: null, basis: 'piece' as const, kcal: 45, protein_g: 0, piece_g: 5, package_g: null }
const NOW = new Date('2026-11-01T18:20:00Z')
const RECIPE = { id: '00000000-0000-4000-8000-0000000000a1', name: 'Rindshack mit Reis', category: 'meal', protein_type: 'beef', portions: 2, prep_min: 15, meal_prep: true, keeps_days: 3, notes: null,
  items: [{ id: 'i1', name: 'Rindshack', food_item_id: MINCE.id, qty: 500, unit: 'g', hint: { n: 2, label: 'Packungen' }, to_taste: false, kcal: 850, protein_g: 100, source: 'staple' },
    { id: 'i2', name: 'Reis, roh', food_item_id: RICE.id, qty: 140, unit: 'g', hint: null, to_taste: false, kcal: 490, protein_g: 9.8, source: 'staple' },
    { id: 'i3', name: 'Salz', food_item_id: null, qty: null, unit: null, hint: null, to_taste: true, kcal: 0, protein_g: 0, source: 'estimate' }],
  steps: [{ text: 'Reis {i2} kochen.', timer_s: 900, items: ['i2'] }] }

/** In-memory database answering the statements of the connector. */
function fakeSql() {
  const items = [MINCE, RICE, OIL].map((s) => ({ ...s, user_id: 'u1', deleted_at: null }))
  const entries: Record<string, unknown>[] = []
  const settings: { value: unknown }[] = []
  const stock: Record<string, unknown>[] = []
  const moves: Record<string, unknown>[] = []
  const fridge: Record<string, unknown>[] = []
  const recipes: Record<string, unknown>[] = [RECIPE]
  const sql: Sql = async (q, p = []) => {
    if (q.startsWith('update public.inventory_item set last_used_at')) return []
    if (q.startsWith('select id, name, qty_left from public.inventory_item')) return stock.filter((r) => r.food_item_id === p[1] && r.unit === p[2] && Number(r.qty_left) > 0)
    if (q.startsWith('update public.inventory_item set qty_left = $2, last_used_at')) { const r = stock.find((x) => x.id === p[0])!; r.qty_left = p[1]; return [] }
    if (q.startsWith('insert into public.inventory_move')) { moves.push({ item_id: p[2], delta: p[3], reason: p[4], food_entry_id: q.includes('food_entry_id') ? p[5] : null }); return [] }
    if (q.startsWith('select item_id, delta from public.inventory_move')) return moves.filter((m) => m.food_entry_id === p[1] && (m.reason === 'meal' || m.reason === 'recipe'))
    if (q.startsWith('update public.inventory_item set qty_left = qty_left + $2')) { const r = stock.find((x) => x.id === p[0])!; r.qty_left = Number(r.qty_left) + Number(p[1]); return [] }
    if (q.startsWith('select name from public.recipe')) return recipes.filter((r) => r.deleted_at == null && (r.items as { food_item_id: string | null }[]).some((i) => JSON.parse(String(p[1]))[0].food_item_id === i.food_item_id))
    if (q.startsWith('update public.food_item set deleted_at')) { const it = items.find((i) => i.id === p[0] && i.deleted_at === null); if (!it) return []; (it as { deleted_at: unknown }).deleted_at = p[2]; return [{ name: it.name }] }
    if (q.startsWith('insert into public.recipe')) { if (recipes.some((r) => r.id === p[0])) return []; recipes.push({ id: p[0], name: p[2], category: p[3], protein_type: p[4], portions: p[5], prep_min: p[6], meal_prep: p[7], keeps_days: p[8], notes: p[9], items: JSON.parse(String(p[10])), steps: JSON.parse(String(p[11])) }); return [{ id: p[0] }] }
    if (q.startsWith('update public.recipe set name')) { const r = recipes.find((x) => x.id === p[0]); if (!r) return []; Object.assign(r, { name: p[2], portions: p[5], items: JSON.parse(String(p[10])), steps: JSON.parse(String(p[11])) }); return [{ id: p[0] }] }
    if (q.startsWith('select id, eaten_at, kcal, protein_g from public.food_entry')) return entries.filter((e) => e.id === p[0] && e.deleted_at === null)
    if (q.startsWith('with old as')) {
      const old = entries.find((e) => e.id === p[13] && e.deleted_at === null)
      if (old) old.deleted_at = p[12]
      entries.push({ id: p[0], eaten_at: p[2], category: p[3], title: p[4], kcal: p[7], protein_g: p[8], source: p[11], deleted_at: null })
      return []
    }
    if (q.startsWith('select id from public.inventory_item')) return []
    if (q.startsWith('insert into public.inventory_item')) { stock.push({ id: p[0], food_item_id: p[2], name: p[3], unit: p[5], qty_left: p[6] }); return [] }
    if (q.startsWith('select id, name, category')) return recipes.filter((r) => r.id === p[0] && r.deleted_at == null)
    if (q.startsWith('select id from public.fridge_item')) return fridge.filter((f) => f.recipe_id === p[1] && f.cooked_at === p[2])
    if (q.startsWith('insert into public.fridge_item')) { fridge.push({ id: p[0], recipe_id: p[2], title: p[3], portions: p[4], kcal: p[5], protein_g: p[6], items: p[7], cooked_at: p[8], eat_by: p[9] }); return [] }
    if (q.startsWith('select id, title, portions, kcal, protein_g, items from public.fridge_item')) return fridge.filter((f) => f.id === p[0] && Number(f.portions) > 0)
    if (q.startsWith('update public.fridge_item set portions')) { const f = fridge.find((x) => x.id === p[0])!; f.portions = Number(f.portions) - 1; return [] }
    if (q.startsWith('select value from public.user_setting')) return settings
    if (q.startsWith('select id, name, store, basis')) return items.filter((i) => i.user_id === p[0])
    if (q.startsWith('select id, eaten_at')) return entries.filter((e) => e.deleted_at === null && String(e.eaten_at) >= String(p[1]) && String(e.eaten_at) < String(p[2]))
    if (q.startsWith('select id from public.food_entry')) return entries.filter((e) => e.eaten_at === p[1] && e.title === p[2] && e.kcal === p[3])
    if (q.startsWith('insert into public.food_entry')) {
      entries.push({ id: p[0], eaten_at: p[2], category: p[3], title: p[4], kcal: p[7], protein_g: p[8], source: p[11], deleted_at: null })
      return []
    }
    throw new Error(`unexpected ${q}`)
  }
  return { sql, entries, settings, stock, moves, fridge, recipes, items }
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
    // The preview token is valid for 24 h from the handler's time (NOW), so the check must run at NOW too
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => { vi.useRealTimers() })
    const { sql, entries } = fakeSql()
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'initialize' }, sql, '/mcp/wrong')).status).toBe(404)
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, sql)
    expect(init.json.result.serverInfo.name).toBe('fitness-food')
    expect(init.json.result.instructions).toContain('confirm_meal')
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, sql)).status).toBe(202)
    const tools = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, sql)
    expect(tools.json.result.tools.map((t: { name: string }) => t.name)).toEqual(['list_staples', 'add_staple', 'delete_staple', 'preview_meal', 'confirm_meal', 'get_day', 'delete_entry',
      'list_recipes', 'get_recipe', 'preview_recipe', 'confirm_recipe', 'delete_recipe', 'log_recipe', 'list_fridge', 'eat_from_fridge', 'discard_fridge_item', 'preview_stock_add', 'confirm_stock_add', 'list_stock', 'adjust_stock',
      'list_workouts', 'get_workout', 'exercise_history', 'list_templates', 'list_exercises', 'weekly_volume', 'body_weight', 'get_targets'])
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

  it('reads the protein minimum from the app targets, else 160 g (decision 15 November 2026)', async () => {
    const { sql, settings } = fakeSql()
    const day = async () => (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_day', arguments: {} } }, sql)).json.result.content[0].text as string
    expect(await day()).toContain('Ziel ≥ 160 g')
    settings.push({ value: { needKcal: 2400, deficitKcal: 400, proteinG: 170 } })
    expect(await day()).toContain('Ziel ≥ 170 g')
    settings[0] = { value: '{"proteinG":155}' }
    expect(await day()).toContain('Ziel ≥ 155 g')
  })

  it('recipes: scaled amounts, cooked portions on days or in the fridge (decision 19 November 2026)', () => {
    expect(scaledAmount({ qty: 140, unit: 'g', to_taste: false }, 1.5)).toBe('210 g')
    expect(scaledAmount({ qty: 1.5, unit: 'piece', to_taste: false }, 1)).toBe('1.5 Stück')
    expect(scaledAmount({ qty: null, unit: null, to_taste: true }, 2)).toBe('nach Geschmack')
    const r = { ...RECIPE, category: 'meal' as const } as Parameters<typeof recipePreview>[0]
    const p = recipePreview(r, { portions_cooked: 2, schedule: [{ eaten_at: '2026-11-01T19:20:00+01:00', category: 'dinner' }, { category: 'fridge' }] }, NOW)
    expect(p).toMatchObject({ cooked: 2, kcal: 670, protein: 54.9, stock: 'recipe', fridge: { portions: 1, eatBy: '2026-11-04' } })
    expect(previewEntries(p)).toHaveLength(1)
    expect(previewText(p, null)).toContain('Kühlschrank       1 Portion · essen bis 2026-11-04')
    expect(() => recipePreview(r, { portions_cooked: 2, schedule: [{ category: 'dinner' }] }, NOW)).toThrow(/one element per cooked portion/)
  })

  it('stock: units from amounts, purchase preview with pack size and usual shelf life', () => {
    expect(stockNeed('250 g')).toEqual({ qty: 250, unit: 'g' })
    expect(stockNeed('2 Stück')).toEqual({ qty: 2, unit: 'piece' })
    expect(stockNeed('1 Portion')).toBeNull()
    const p = stockPreview({ items: [{ staple_id: MINCE.id, quantity: 2, unit: 'pack' }, { name: 'Olivenöl', tracked: false, location: 'shelf' }] }, [MINCE], NOW)
    expect(p.rows[0]).toMatchObject({ name: MINCE.name, qty: 500, unit: 'g', best_before: '2026-11-03' })
    expect(p.rows[1]).toMatchObject({ tracked: false, qty: null, best_before: null })
  })

  it('MCP: cooking takes stock once, the fridge portion is eaten later without taking stock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => { vi.useRealTimers() })
    const { sql, entries, stock, moves, fridge } = fakeSql()
    const tool = async (name: string, args: unknown) => (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, sql)).json.result.content[0].text as string
    const token = (text: string) => /preview_token: (\S+)/.exec(text)![1]
    const add = await tool('preview_stock_add', { items: [{ staple_id: MINCE.id, quantity: 600, unit: 'g' }] })
    expect(add).toContain('Einbuchen?')
    expect(await tool('confirm_stock_add', { preview_token: token(add) })).toContain('Eingebucht')
    const log = await tool('log_recipe', { recipe_id: RECIPE.id, portions_cooked: 2, schedule: [{ category: 'dinner' }, { category: 'fridge' }] })
    const done = await tool('confirm_meal', { preview_token: token(log) })
    expect(done).toContain('In den Kühlschrank: 1 Portion')
    expect(done).toContain('Vorrat: Beef mince bio 10 %: 100 g übrig')
    expect(entries).toHaveLength(1)
    expect(fridge).toHaveLength(1)
    expect(stock[0]!.qty_left).toBe(100)
    await tool('confirm_meal', { preview_token: token(log) })
    expect(stock[0]!.qty_left).toBe(100)
    const eat = await tool('eat_from_fridge', { fridge_item_id: fridge[0]!.id, category: 'lunch', eaten_at: '2026-11-02T12:30:00+01:00' })
    expect(eat).toContain('Aus dem Kühlschrank')
    await tool('confirm_meal', { preview_token: token(eat) })
    expect(entries).toHaveLength(2)
    expect(fridge[0]!.portions).toBe(0)
    expect(moves.filter((m) => m.reason !== 'purchase')).toHaveLength(1)
  })

  it('recipes: preview, confirm once, change; values per portion from the server (decision 22 November 2026)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => { vi.useRealTimers() })
    const { sql, recipes } = fakeSql()
    const tool = async (name: string, args: unknown) => (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, sql)).json.result.content[0].text as string
    const token = (text: string) => /preview_token: (\S+)/.exec(text)![1]
    const args = { name: 'Reis mit Hack', category: 'meal', protein_type: 'beef', portions: 2, items: [
      { staple_id: MINCE.id, quantity: 1, unit: 'pack', unit_hint: '1 Packung' }, { staple_id: RICE.id, quantity: 150, unit: 'g' },
      { name: 'Tomaten', quantity: 200, unit: 'g', kcal: 36, protein_g: 1.8 }, { name: 'Salz, Pfeffer', to_taste: true }],
      steps: [{ text: 'Reis {i2} kochen.', timer_s: 900 }, 'Hack {i1} anbraten, Tomaten {i3} dazu.'] }
    const preview = await tool('preview_recipe', args)
    expect(recipes).toHaveLength(1)
    expect(preview).toContain('Rezept      Reis mit Hack')
    expect(preview).toContain('1 Packung · 250 g')
    expect(preview).toContain('Pro Portion       493 kcal · 31 g Protein')
    expect(preview).toContain('1. Reis 150 g kochen. (Timer 15 min)')
    expect(preview).toContain('Speichern? (ja / ändern)')
    expect(await tool('confirm_recipe', { preview_token: token(preview) })).toContain('Gespeichert: Reis mit Hack')
    expect(await tool('confirm_recipe', { preview_token: token(preview) })).toBe('Bereits gespeichert.')
    expect(recipes).toHaveLength(2)
    const saved = recipes[1]!
    expect((saved.items as { id: string; hint: unknown }[])[0]).toMatchObject({ id: 'i1', hint: { n: 1, label: 'Packung' } })
    const change = await tool('preview_recipe', { ...args, id: saved.id, portions: 3 })
    expect(change).toContain('(Änderung)')
    expect(await tool('confirm_recipe', { preview_token: token(change) })).toContain('Geändert')
    expect(recipes).toHaveLength(2)
    expect(saved.portions).toBe(3)
    // A recipe token is no meal token and the other way round
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'confirm_meal', arguments: { preview_token: token(change) } } }, sql)).json.result.isError).toBe(true)
    expect(() => buildRecipe({ ...args, steps: ['Alles {i9} mischen.'] }, [MINCE, RICE])).toThrow(/only 4 ingredients/)
    expect(recipePreviewText({ id: 'x', ...buildRecipe(args, [MINCE, RICE]) }, true)).toContain('Salz, Pfeffer')
  })

  it('log_recipe: portions eaten and scale as one entry, stock taken with the entry id', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => { vi.useRealTimers() })
    const { sql, entries, stock, moves } = fakeSql()
    const tool = async (name: string, args: unknown) => (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, sql)).json.result.content[0].text as string
    const token = (text: string) => /preview_token: (\S+)/.exec(text)![1]
    stock.push({ id: 's1', food_item_id: MINCE.id, name: MINCE.name, unit: 'g', qty_left: 500 })
    const log = await tool('log_recipe', { recipe_id: RECIPE.id, portions_eaten: 1, scale: 1.2, category: 'dinner' })
    expect(log).toContain('Rindshack')
    expect(log).toContain('300 g')
    expect(log).toContain('Ihre Portion       804 kcal · 66 g Protein')
    await tool('confirm_meal', { preview_token: token(log) })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ category: 'dinner', kcal: 804 })
    expect(stock[0]!.qty_left).toBe(200)
    expect(moves.at(-1)).toMatchObject({ reason: 'recipe', delta: -300, food_entry_id: entries[0]!.id })
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'log_recipe', arguments: { recipe_id: RECIPE.id, scale: 9 } } }, sql)).json.result.isError).toBe(true)
  })

  it('preview_meal with replaces_entry_id: today without the old entry, replaced atomically, stock given back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    onTestFinished(() => { vi.useRealTimers() })
    const { sql, entries, stock } = fakeSql()
    const tool = async (name: string, args: unknown) => (await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, sql)).json.result.content[0].text as string
    const token = (text: string) => /preview_token: (\S+)/.exec(text)![1]
    stock.push({ id: 's1', food_item_id: MINCE.id, name: MINCE.name, unit: 'g', qty_left: 500 })
    const first = await tool('preview_meal', { category: 'lunch', items: [{ staple_id: MINCE.id, quantity: 200, unit: 'g' }] })
    await tool('confirm_meal', { preview_token: token(first) })
    expect(stock[0]!.qty_left).toBe(300)
    const oldId = String(entries[0]!.id)
    const fix = await tool('preview_meal', { category: 'lunch', replaces_entry_id: oldId, items: [{ staple_id: MINCE.id, quantity: 150, unit: 'g' }] })
    expect(fix).toContain('Heute danach       255 kcal · 30 g Protein')
    const done = await tool('confirm_meal', { preview_token: token(fix) })
    expect(done).toContain('Ersetzt als Mittagessen: 255 kcal')
    expect(entries.filter((e) => e.deleted_at === null)).toHaveLength(1)
    expect(entries.find((e) => e.id === oldId)!.deleted_at).not.toBeNull()
    expect(stock[0]!.qty_left).toBe(350)
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'preview_meal', arguments: { category: 'lunch', replaces_entry_id: '00000000-0000-4000-8000-00000000dead', items: [{ staple_id: RICE.id, quantity: 50, unit: 'g' }] } } }, sql)).json.result.isError).toBe(true)
  })

  it('delete_staple: refused while a recipe uses it', async () => {
    const { sql, items } = fakeSql()
    const res = await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_staple', arguments: { id: RICE.id } } }, sql)
    expect(res.json.result.isError).toBe(true)
    expect(res.json.result.content[0].text).toContain('«Rindshack mit Reis»')
    const ok = await call({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'delete_staple', arguments: { id: OIL.id } } }, sql)
    expect(ok.json.result.content[0].text).toBe('Entfernt: Sunflower oil, 1 tsp')
    expect(items.find((i) => i.id === OIL.id)!.deleted_at).not.toBeNull()
  })
})
