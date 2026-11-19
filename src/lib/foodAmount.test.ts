import { describe, expect, it } from 'vitest'
import type { FoodEntryItem } from './db'
import { entryTotal, formatAmount, itemsLine, matchesItems, parseAmount, perUnitText, quantityTag, scaleItem, stepOf } from './foodAmount'

const item = (name: string, amount: string, kcal: number, protein_g: number): FoodEntryItem => ({ name, amount, kcal, protein_g, source: 'staple', food_item_id: null })

describe('food amounts', () => {
  it('reads quantity and unit from the amount text', () => {
    expect(parseAmount('250 g')).toEqual({ quantity: 250, unit: 'g' })
    expect(parseAmount('2 ×')).toEqual({ quantity: 2, unit: '×' })
    expect(parseAmount('2 servings')).toEqual({ quantity: 2, unit: 'serving' })
    expect(parseAmount('1,5 dl')).toEqual({ quantity: 1.5, unit: 'dl' })
    expect(parseAmount('a handful')).toBeNull()
    expect(parseAmount('0 g')).toBeNull()
    expect(formatAmount(1, 'serving')).toBe('1 serving')
    expect(formatAmount(3, 'piece')).toBe('3 pieces')
    expect(stepOf('g')).toBe(10)
    expect(stepOf('×')).toBe(1)
  })

  it('scales an item in proportion to its stored values', () => {
    const espresso = item('Espresso with milk', '2 ×', 37, 2)
    expect(scaleItem(espresso, 3)).toMatchObject({ amount: '3 ×', kcal: 55.5, protein_g: 3 })
    const chicken = item('Chicken breast', '180 g', 191, 42.3)
    expect(scaleItem(chicken, 200)).toMatchObject({ amount: '200 g', kcal: 212.2, protein_g: 47 })
  })

  it('totals items and portions', () => {
    const items = [item('Chicken breast', '200 g', 212, 47), item('Rice, raw', '90 g', 315, 6.3), item('Beans', '150 g', 138, 8.4), item('Sunflower oil', '1 tsp', 45, 0)]
    expect(entryTotal(items, null, null)).toEqual({ kcal: 710, protein: 61.7 })
    expect(entryTotal(items, 2, 1)).toEqual({ kcal: 355, protein: 30.9 })
    expect(matchesItems({ items, kcal: 710, protein_g: 61.7, portions_cooked: null, portions_eaten: null })).toBe(true)
    expect(matchesItems({ items, kcal: 650, protein_g: 61.7, portions_cooked: null, portions_eaten: null })).toBe(false)
    expect(itemsLine(items.slice(0, 2))).toBe('Chicken breast 200 g · Rice 90 g')
  })

  it('shows the quantity next to the name', () => {
    expect(quantityTag({ items: [item('Espresso with milk', '2 ×', 37, 2)], portions_cooked: null, portions_eaten: null })).toBe('2 ×')
    expect(quantityTag({ items: [item('A', '1 g', 1, 0), item('B', '1 g', 1, 0)], portions_cooked: 3, portions_eaten: 1 })).toBe('1 of 3 portions')
    expect(quantityTag({ items: [item('A', '1 g', 1, 0), item('B', '1 g', 1, 0)], portions_cooked: null, portions_eaten: null })).toBe('1 portion')
    expect(quantityTag({ items: [], portions_cooked: null, portions_eaten: null })).toBeNull()
    expect(perUnitText(item('Espresso with milk', '2 ×', 37, 2))).toBe('18.5 kcal · 1 g each')
    expect(perUnitText(item('Drink', '500 ml', 290, 40))).toBe('58 kcal · 8 g per 100 ml')
  })
})
