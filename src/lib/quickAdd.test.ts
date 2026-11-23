import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, type FoodEntry, type FoodItem, type FoodPhoto, type Recipe } from './db'
import { favourites, oneUnit, quickAdd, searchFood } from './quickAdd'
import { deleteFoodPhoto, recipeCovers, setCover, sortDishPhotos } from './foodPhotos'
import { saveRows } from './sync'

const sync = { user_id: 'u', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', deleted_at: null }
const item = (id: string, name: string, basis: FoodItem['basis'] = '100g', store: string | null = null): FoodItem =>
  ({ ...sync, id, name, store, basis, kcal: 100, protein_g: 10, piece_g: null, package_g: null, note: null })
const entry = (id: string, day: string, ids: string[], source: FoodEntry['source'] = 'app', category: FoodEntry['category'] = 'snack'): FoodEntry => ({
  ...sync, id, eaten_at: `${day}T11:00:00Z`, category, title: 't', detail: null, kcal: 1, protein_g: 1, portions_cooked: null, portions_eaten: null, source,
  items: ids.map((f) => ({ name: f, food_item_id: f, amount: '100 g', kcal: 1, protein_g: 1, source: 'staple' as const })),
})
const photo = (id: string, recipe: string, cover: boolean, created: string): FoodPhoto =>
  ({ ...sync, id, recipe_id: recipe, food_item_id: null, kind: 'dish', is_cover: cover, taken_on: null, mime: 'image/jpeg', width: 1, height: 1, bytes: 1, created_at: created })

const chicken = item('c', 'Chicken breast')
const skyr = item('s', 'Skyr Nature lactosefrei', '100g', 'Coop')
const shake = item('w', 'ESN shake, water', 'serving')
const egg = item('e', 'Egg', 'piece')

beforeEach(async () => {
  await Promise.all([db.food_entry.clear(), db.food_photo.clear(), db.inventory_item.clear(), db.outbox.clear()])
})

describe('favourites and search (decision 22 November 2026)', () => {
  it('one tap is 100 g or one piece or serving', () => {
    expect(oneUnit(chicken)).toBe(100)
    expect(oneUnit(shake)).toBe(1)
    expect(oneUnit(egg)).toBe(1)
  })

  it('counts staples per entry over 60 days, skips automatic and deleted entries, most used first', () => {
    const entries = [
      entry('1', '2026-11-20', ['c', 's']),
      entry('2', '2026-11-21', ['c', 'c']),
      entry('3', '2026-11-22', ['s', 'e']),
      entry('4', '2026-11-22', ['c']),
      entry('5', '2026-11-22', ['w'], 'auto'),
      { ...entry('6', '2026-11-22', ['e']), deleted_at: '2026-11-22T12:00:00Z' },
      entry('7', '2026-09-01', ['e', 'e']),
    ]
    expect(favourites(entries, [chicken, skyr, shake, egg], '2026-11-22').map((i) => i.id)).toEqual(['c', 's', 'e'])
    expect(favourites(entries, [chicken, skyr, shake, egg], '2026-11-22', 1).map((i) => i.id)).toEqual(['c'])
    expect(favourites(entries, [{ ...chicken, deleted_at: '2026-11-22T00:00:00Z' }, skyr], '2026-11-22').map((i) => i.id)).toEqual(['s'])
  })

  it('counts only snack-like entries: breakfast, snack, dessert; not meals, cheat or drinks (23 November 2026)', () => {
    const entries = [
      entry('1', '2026-11-22', ['c', 'r'], 'app', 'lunch'),
      entry('2', '2026-11-22', ['c', 'r'], 'app', 'dinner'),
      entry('3', '2026-11-22', ['c'], 'app', 'cheat'),
      entry('4', '2026-11-22', ['w'], 'app', 'breakfast'),
      entry('5', '2026-11-22', ['s', 'k'], 'app', 'snack'),
      entry('6', '2026-11-21', ['s'], 'app', 'dessert'),
      entry('7', '2026-11-21', ['r', 'r'], 'app', 'drinks'),
    ]
    const items = ['c', 'r', 'w', 's', 'k'].map((id) => ({ ...chicken, id, name: id }))
    expect(favourites(entries, items, '2026-11-22').map((i) => i.id)).toEqual(['s', 'k', 'w'])
  })

  it('search needs every word and also looks at the store; recipes by name', () => {
    const recipe = { ...sync, id: 'r', name: 'Skyr-Protein-Bowl' } as Recipe
    expect(searchFood('sky', [chicken, skyr], [recipe])).toEqual({ items: [skyr], recipes: [recipe] })
    expect(searchFood('skyr coop', [skyr], []).items).toEqual([skyr])
    expect(searchFood('skyr denner', [skyr], []).items).toEqual([])
    expect(searchFood('  ', [skyr], [recipe])).toEqual({ items: [], recipes: [] })
  })

  it('«+» logs one unit on the shown day and undo removes it', async () => {
    const undo = await quickAdd('u', chicken, '2026-11-22', new Date('2026-11-22T11:30:00Z'))
    const [row] = await db.food_entry.toArray()
    expect(row).toMatchObject({ title: 'Chicken breast', category: 'lunch', kcal: 100, protein_g: 10, deleted_at: null })
    expect(row!.items[0]).toMatchObject({ food_item_id: 'c', amount: '100 g' })
    await undo()
    expect((await db.food_entry.get(row!.id))!.deleted_at).not.toBeNull()
  })
})

describe('recipe photos (decision 22 November 2026)', () => {
  it('cover first, then newest; deleted photos drop out', () => {
    const list = sortDishPhotos([photo('a', 'r', false, '2026-11-01T00:00:00Z'), photo('b', 'r', true, '2026-10-01T00:00:00Z'), photo('c', 'r', false, '2026-11-05T00:00:00Z'), { ...photo('d', 'r', false, '2026-11-09T00:00:00Z'), deleted_at: '2026-11-10T00:00:00Z' }])
    expect(list.map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  it('make cover moves the flag; deleting the cover hands it to the newest photo, undo restores', async () => {
    await saveRows('food_photo', [photo('a', 'r', true, '2026-11-01T00:00:00Z'), photo('b', 'r', false, '2026-11-02T00:00:00Z'), photo('c', 'r', false, '2026-11-03T00:00:00Z')])
    await setCover((await db.food_photo.get('b'))!)
    expect((await recipeCovers()).get('r')!.id).toBe('b')
    const undo = await deleteFoodPhoto((await db.food_photo.get('b'))!)
    expect((await recipeCovers()).get('r')!.id).toBe('c')
    await undo()
    expect((await recipeCovers()).get('r')!.id).toBe('b')
    expect((await db.food_photo.get('c'))!.is_cover).toBe(false)
  })
})
