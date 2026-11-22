import { useLiveQuery } from 'dexie-react-hooks'
import { useState, type ReactNode } from 'react'
import Sheet from '../../components/Sheet'
import { useSwipeX } from '../../hooks/useSwipeX'
import { db, type FoodCategory, type FoodItem, type ProteinType, type Recipe, type RecipeCategory, type RecipeItem } from '../../lib/db'
import { CATEGORY_LABEL, addDaysKey, categoryAt, localDay, stapleValues } from '../../lib/food'
import {
  PROTEIN_COLOR,
  PROTEIN_LABEL,
  PROTEIN_TYPES,
  RECIPE_CATEGORIES,
  RECIPE_CATEGORY_LABEL,
  defaultRecipePlan,
  deleteRecipe,
  filterRecipes,
  isFridge,
  itemAmount,
  logRecipe,
  newRecipe,
  perPortion,
  planRecipe,
  putInFridge,
  saveRecipe,
  stepParts,
  type PlanSlot,
} from '../../lib/recipe'
import { offerUndo } from '../../lib/undo'
import CookMode from './CookMode'
import { AddPhotoButton, FoodPhotoImg, RecipePhotos } from '../../components/FoodPhotos'
import { recipeCovers } from '../../lib/foodPhotos'
import type { FoodPhoto } from '../../lib/db'

// Recipes in the Food tab (decision Rodrigo 19 November 2026, spec «Feature Rezepte, Kochmodus und Kitchen», sections
// 3 to 6): list with tabs Meals, Desserts, Snacks and protein chips, detail with portion stepper where the amounts are
// the most important part (weight always at the far right in bold, grey hint before it), cooking mode, planning of the
// cooked portions with «Fridge» for portions without a day. Recipe contents are German, the interface English.

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PLAN_CATEGORIES: (FoodCategory | 'fridge')[] = ['breakfast', 'lunch', 'dinner', 'snack', 'fridge']

function num(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

function dayShort(day: string, today: string): string {
  if (day === today) return 'Today'
  if (day === addDaysKey(today, 1)) return 'Tomorrow'
  const d = new Date(`${day}T12:00:00`)
  return `${WEEKDAY[d.getDay()]} ${d.getDate()}`
}

export function ProteinDot({ type, size = 12 }: { type: ProteinType | null; size?: number }) {
  if (!type) return null
  return <span aria-hidden="true" className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: PROTEIN_COLOR[type] }} />
}

export default function RecipesView({ userId }: { userId: string }) {
  const recipes = useLiveQuery(() => db.recipe.toArray(), [])
  const staples = useLiveQuery(() => db.food_item.toArray(), [])
  const covers = useLiveQuery(() => recipeCovers(), [])
  const [category, setCategory] = useState<RecipeCategory>('meal')
  const [protein, setProtein] = useState<ProteinType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<Recipe | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Recipe | null>(null)
  if (recipes === undefined || staples === undefined) return null

  const live = recipes.filter((r) => r.deleted_at === null)
  const shown = filterRecipes(live, category, protein, query)
  const current = open ? live.find((r) => r.id === open) : undefined

  const remove = async (r: Recipe) => {
    setConfirmDelete(null)
    setOpen(null)
    const undo = await deleteRecipe(r)
    offerUndo(`Recipe deleted · ${r.name}`, r.id, undo)
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Recipe category" className="flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
        {RECIPE_CATEGORIES.map((c) => {
          const n = live.filter((r) => r.category === c).length
          return (
            <button key={c} role="tab" aria-selected={category === c} onClick={() => setCategory(c)}
              className={`-mb-px border-b-2 pb-2 text-sm font-semibold ${category === c ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100' : 'border-transparent text-zinc-500 dark:text-zinc-400'}`}>
              {RECIPE_CATEGORY_LABEL[c]} <span className="font-normal text-zinc-400">{n}</span>
            </button>
          )
        })}
      </div>

      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipes" aria-label="Search recipes"
        className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900" />

      {category === 'meal' && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Protein">
          {(['all', ...PROTEIN_TYPES.filter((p) => p !== 'mixed')] as const).map((p) => (
            <button key={p} onClick={() => setProtein(p)} aria-pressed={protein === p}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${protein === p ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'}`}>
              {p !== 'all' && <ProteinDot type={p} size={8} />}
              {p === 'all' ? 'All' : PROTEIN_LABEL[p]}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="card p-4 text-sm text-zinc-500 dark:text-zinc-400">{query || protein !== 'all' ? 'No recipe matches.' : 'No recipes yet.'}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => <RecipeCard key={r.id} recipe={r} cover={covers?.get(r.id)} onOpen={() => setOpen(r.id)} onDelete={() => setConfirmDelete(r)} />)}
        </ul>
      )}

      <button onClick={() => setEdit(newRecipe(userId, category))} className="rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold dark:border-zinc-700 dark:bg-zinc-900">+ New recipe</button>

      {current && <RecipeDetail userId={userId} recipe={current} onClose={() => setOpen(null)} onEdit={() => setEdit(current)} onDelete={() => setConfirmDelete(current)} />}
      {edit && <RecipeEditor recipe={edit} staples={staples.filter((s) => s.deleted_at === null)} onClose={() => setEdit(null)} />}
      {confirmDelete && (
        <Sheet title="Delete recipe?" onClose={() => setConfirmDelete(null)}>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">«{confirmDelete.name}» moves to the trash. Meals already logged stay as they are.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={() => setConfirmDelete(null)} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">Cancel</button>
            <button onClick={() => void remove(confirmDelete)} className="rounded-xl bg-red-600 py-3 text-sm font-semibold text-white">Delete</button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

function RecipeCard({ recipe: r, cover, onOpen, onDelete }: { recipe: Recipe; cover?: FoodPhoto; onOpen: () => void; onDelete: () => void }) {
  const swipe = useSwipeX((dir) => dir === 'left' && onDelete(), { left: true, right: false })
  const p = perPortion(r)
  return (
    <li className="relative touch-pan-y" {...swipe.handlers}>
      {swipe.dx !== 0 && <div aria-hidden="true" className="absolute inset-0 flex items-center justify-end rounded-2xl bg-red-600 px-5 text-sm font-semibold text-white">Delete</div>}
      <button onClick={onOpen} className="card relative flex w-full items-center gap-3 p-3 text-left"
        style={swipe.dx ? { transform: `translateX(${swipe.dx}px)` } : { transition: 'transform 150ms ease-out' }}>
        {/* Cover photo (decision 22 November 2026) with the protein colour as a dot; without photo only the dot */}
        {cover ? (
          <span className="relative shrink-0">
            <FoodPhotoImg photo={cover} alt="" className="h-12 w-12 rounded-xl" />
            {r.category === 'meal' && <span className="absolute -right-1 -bottom-1 rounded-full border-2 border-white dark:border-zinc-900"><ProteinDot type={r.protein_type} size={10} /></span>}
          </span>
        ) : r.category === 'meal' && <ProteinDot type={r.protein_type} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{r.name || 'Untitled'}</span>
          <span className="block text-sm text-zinc-500 dark:text-zinc-400">
            {r.meal_prep ? `Meal prep · ${r.portions} portions` : `${r.portions} ${r.portions === 1 ? 'portion' : 'portions'}`}{r.prep_min ? ` · ${r.prep_min} min` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right tabular-nums">
          <span className="block text-sm font-semibold">{num(p.kcal)} kcal</span>
          <span className="block text-sm text-zinc-500 dark:text-zinc-400">{Math.round(p.protein)} g protein</span>
        </span>
      </button>
    </li>
  )
}

export function Stepper({ value, onChange, min = 1, max = 12, label }: { value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  const btn = 'flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 text-lg font-semibold disabled:opacity-30 dark:border-zinc-700'
  return (
    <span className="flex items-center gap-3" role="group" aria-label={label}>
      <button aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)} className={btn}>−</button>
      <span className="min-w-6 text-center text-lg font-bold tabular-nums">{value}</span>
      <button aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)} className={btn}>+</button>
    </span>
  )
}

/** One ingredient: name left; at the far right the weight in bold, the grey hint before it. */
export function IngredientRow({ item, factor }: { item: RecipeItem; factor: number }) {
  const a = itemAmount(item, factor)
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className="min-w-0">{item.name}</span>
      <span className="shrink-0 text-right tabular-nums">
        {a.amount ? (
          <>
            {a.hint && <span className="text-zinc-500 dark:text-zinc-400">{a.hint} · </span>}
            <b>{a.amount}</b>
          </>
        ) : <span className="text-zinc-500 dark:text-zinc-400">nach Geschmack</span>}
      </span>
    </li>
  )
}

function Badge({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{children}</span>
}

function RecipeDetail({ userId, recipe: r, onClose, onEdit, onDelete }: { userId: string; recipe: Recipe; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const [portions, setPortions] = useState(Math.max(1, Math.round(r.portions)))
  const [steps, setSteps] = useState<'closed' | 'short' | 'all'>('closed')
  const [cooking, setCooking] = useState(false)
  const [plan, setPlan] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const factor = portions / (r.portions > 0 ? r.portions : 1)
  const per = perPortion(r)
  const visibleSteps = steps === 'all' ? r.steps : r.steps.slice(0, 3)

  const logOne = async () => {
    const now = new Date()
    await logRecipe(userId, r, [{ day: localDay(now), category: categoryAt(now) }], now)
    setDone(`Logged 1 portion as ${CATEGORY_LABEL[categoryAt(now)].toLowerCase()}.`)
  }
  const fridge = async () => {
    await putInFridge(userId, r, portions)
    setDone(`${portions} ${portions === 1 ? 'portion' : 'portions'} in the fridge.`)
  }

  const photoButton = (
    <AddPhotoButton userId={userId} target={{ recipeId: r.id }} kind="dish"
      className="flex items-center justify-center rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">
      Add a photo of the dish
    </AddPhotoButton>
  )
  if (cooking) return <CookMode recipe={r} portions={portions} photo={photoButton} onClose={() => setCooking(false)} onDone={() => { setCooking(false); setPlan(true) }} />
  if (plan) return <PlanSheet userId={userId} recipe={r} portions={portions} onClose={() => setPlan(false)} onSaved={(t) => { setPlan(false); setDone(t) }} />

  return (
    <Sheet title={r.name || 'Recipe'} onClose={onClose}>
      <RecipePhotos userId={userId} recipeId={r.id} name={r.name} />
      <div className="-mt-1 flex flex-wrap gap-1.5">
        <Badge>{RECIPE_CATEGORY_LABEL[r.category].replace(/s$/, '')}</Badge>
        {r.category === 'meal' && r.protein_type && <Badge><ProteinDot type={r.protein_type} size={8} />{PROTEIN_LABEL[r.protein_type]}</Badge>}
        {r.prep_min && <Badge>{r.prep_min} min</Badge>}
        {r.meal_prep && <Badge>Meal prep</Badge>}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm font-semibold">Portions</span>
        <Stepper value={portions} onChange={setPortions} label="Portions" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold text-zinc-500 uppercase dark:text-zinc-400">kcal / portion</div>
          <div className="text-xl font-bold tabular-nums">{num(per.kcal)}</div>
        </div>
        <div className="rounded-2xl bg-zinc-100 px-3 py-2 dark:bg-zinc-800/70">
          <div className="text-xs font-semibold text-zinc-500 uppercase dark:text-zinc-400">Protein / portion</div>
          <div className="text-xl font-bold tabular-nums">{Math.round(per.protein)} g</div>
        </div>
      </div>

      <h3 className="mt-5 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Ingredients for {portions}</h3>
      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">{r.items.map((i) => <IngredientRow key={i.id} item={i} factor={factor} />)}</ul>

      {r.steps.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <button onClick={() => setSteps(steps === 'closed' ? 'short' : 'closed')} aria-expanded={steps !== 'closed'} className="flex w-full items-center justify-between px-3 py-3 text-left font-semibold">
            <span>Instructions</span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{r.steps.length} {steps === 'closed' ? '▾' : '▴'}</span>
          </button>
          {steps !== 'closed' && (
            <ol className="flex flex-col gap-2 border-t border-zinc-100 px-3 py-3 text-sm dark:border-zinc-800">
              {visibleSteps.map((s, n) => (
                <li key={n} className="grid grid-cols-[1.25rem_1fr] gap-1">
                  <span className="font-semibold text-zinc-400 tabular-nums">{n + 1}</span>
                  <span>{stepParts(s, r.items, factor).map((p, k) => ('amount' in p ? <b key={k}>{p.amount}</b> : <span key={k}>{p.text}</span>))}</span>
                </li>
              ))}
              {steps === 'short' && r.steps.length > 3 && (
                <li><button onClick={() => setSteps('all')} className="text-sm font-semibold text-accent">Show all {r.steps.length}</button></li>
              )}
            </ol>
          )}
        </div>
      )}
      {r.notes && <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{r.notes}</p>}

      {done ? (
        <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">{done}</p>
      ) : (
        <div className="mt-5 flex flex-col gap-2">
          {r.steps.length > 0 && <button onClick={() => setCooking(true)} className="rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">Start cooking</button>}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => void logOne()} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">Log 1 now</button>
            <button onClick={() => setPlan(true)} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">Plan {portions}</button>
          </div>
          <button onClick={() => void fridge()} className="rounded-xl border border-zinc-200 py-3 text-sm font-semibold dark:border-zinc-700">Put {portions} in fridge</button>
        </div>
      )}
      <div className="mt-4 flex justify-between text-sm">
        <button onClick={onEdit} className="font-semibold text-accent">Edit</button>
        <button onClick={onDelete} className="font-semibold text-red-600 dark:text-red-400">Delete</button>
      </div>
    </Sheet>
  )
}

/** «Plan N portions» (spec section 6): per portion a day and a meal, or the fridge. */
export function PlanSheet({ userId, recipe, portions, onClose, onSaved }: { userId: string; recipe: Recipe; portions: number; onClose: () => void; onSaved: (text: string) => void }) {
  const [now] = useState(() => new Date())
  const today = localDay(now)
  const [plan, setPlan] = useState<PlanSlot[]>(() => defaultRecipePlan(today, categoryAt(now), portions))
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(today, i))
  const log = planRecipe(recipe, plan, now)
  const eat = plan.filter((s) => !isFridge(s)).length
  const fridge = plan.length - eat
  const set = (i: number, slot: PlanSlot) => setPlan(plan.map((s, k) => (k === i ? slot : s)))

  const save = async () => {
    await logRecipe(userId, recipe, plan, now)
    onSaved([eat ? `Logged ${eat} ${eat === 1 ? 'portion' : 'portions'}` : null, fridge ? `${fridge} in the fridge` : null].filter(Boolean).join(' · ') + '.')
  }

  return (
    <Sheet title={`Plan ${plan.length} ${plan.length === 1 ? 'portion' : 'portions'}`} onClose={onClose}>
      <p className="-mt-1 text-sm text-zinc-500 dark:text-zinc-400">{recipe.name} · {num(perPortion(recipe).kcal)} kcal per portion. Fridge portions count once you eat them.</p>
      <ol className="mt-3 flex flex-col gap-3">
        {plan.map((slot, i) => (
          <li key={i} className="rounded-2xl bg-zinc-100 p-2.5 dark:bg-zinc-800/70">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Portion {i + 1}</span>
              {!isFridge(slot) && (
                <select aria-label={`Day of portion ${i + 1}`} value={slot.day} onChange={(e) => set(i, { ...slot, day: e.target.value })}
                  className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                  {days.map((d) => <option key={d} value={d}>{dayShort(d, today)}</option>)}
                </select>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PLAN_CATEGORIES.map((c) => (
                <button key={c} aria-pressed={slot.category === c} onClick={() => set(i, c === 'fridge' ? { day: slot.day, category: 'fridge' } : { day: slot.day, category: c })}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${slot.category === c ? (c === 'fridge' ? 'bg-sky-600 text-white' : 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900') : 'bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'}`}>
                  {c === 'fridge' ? 'Fridge' : CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <button onClick={() => void save()} className="mt-4 w-full rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg">
        {[eat ? `Log ${eat}` : null, fridge ? `fridge ${fridge}` : null].filter(Boolean).join(' · ')}{log.drafts[0] ? ` · ${num(log.drafts[0].kcal)} kcal each` : ''}
      </button>
    </Sheet>
  )
}

// --- editor -------------------------------------------------------------------------------------------

type DraftItem = RecipeItem & { amountText: string }

function toDraft(i: RecipeItem): DraftItem {
  return { ...i, amountText: i.qty === null ? '' : String(i.qty) }
}

/** New or changed recipe: name, kind, portions, ingredients (staples are computed, others by hand), steps. */
function RecipeEditor({ recipe, staples, onClose }: { recipe: Recipe; staples: FoodItem[]; onClose: () => void }) {
  const [r, setR] = useState<Recipe>(recipe)
  const [items, setItems] = useState<DraftItem[]>(() => recipe.items.map(toDraft))
  const [stepsText, setStepsText] = useState(() => recipe.steps.map((s) => s.text).join('\n'))
  const [pick, setPick] = useState('')
  const field = 'h-10 w-full rounded-lg border border-zinc-200 bg-white px-2 text-base dark:border-zinc-700 dark:bg-zinc-900'

  const update = (k: number, patch: Partial<DraftItem>) => setItems(items.map((it, i) => {
    if (i !== k) return it
    const next = { ...it, ...patch }
    // Staples: values follow the amount
    const s = next.food_item_id ? staples.find((x) => x.id === next.food_item_id) : undefined
    const q = Number(next.amountText.replace(',', '.'))
    if (s && q > 0) {
      const v = stapleValues(s, q)
      return { ...next, qty: q, kcal: v.kcal, protein_g: v.protein }
    }
    return { ...next, qty: q > 0 ? q : null }
  }))
  const addStaple = (id: string) => {
    const s = staples.find((x) => x.id === id)
    if (!s) return
    const q = s.basis === '100g' ? 100 : 1
    const v = stapleValues(s, q)
    setItems([...items, { id: '', name: s.name, food_item_id: s.id, qty: q, unit: s.basis === '100g' ? 'g' : s.basis === 'piece' ? 'piece' : 'serving', hint: null, to_taste: false,
      kcal: v.kcal, protein_g: v.protein, source: 'staple', amountText: String(q) }])
    setPick('')
  }
  const addOther = () => setItems([...items, { id: '', name: '', food_item_id: null, qty: null, unit: 'g', hint: null, to_taste: false, kcal: 0, protein_g: 0, source: 'estimate', amountText: '' }])

  const save = async () => {
    // Ingredient ids stay stable (steps refer to them); new ones get the next free number
    const used = new Set(items.map((i) => i.id).filter(Boolean))
    let n = 1
    const next = () => { while (used.has(`i${n}`)) n++; used.add(`i${n}`); return `i${n}` }
    const finalItems: RecipeItem[] = items.filter((i) => i.name.trim()).map(({ amountText: _a, ...i }) => ({ ...i, id: i.id || next(), name: i.name.trim(), to_taste: i.qty === null, unit: i.qty === null ? null : i.unit ?? 'g' }))
    const lines = stepsText.split('\n').map((l) => l.trim()).filter(Boolean)
    const steps = lines.map((text, k) => {
      const old = recipe.steps[k]
      return { text, timer_s: old && old.text === text ? old.timer_s : timerOf(text), items: [...text.matchAll(/\{(i\d+)\}/g)].map((m) => m[1]!) }
    })
    await saveRecipe({ ...r, items: finalItems, steps })
    onClose()
  }

  return (
    <Sheet title={recipe.name ? 'Edit recipe' : 'New recipe'} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <input aria-label="Name" placeholder="Name (Deutsch)" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} className={field} />
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Category" value={r.category} onChange={(e) => setR({ ...r, category: e.target.value as RecipeCategory })} className={field}>
            {RECIPE_CATEGORIES.map((c) => <option key={c} value={c}>{RECIPE_CATEGORY_LABEL[c].replace(/s$/, '')}</option>)}
          </select>
          {r.category === 'meal' && (
            <select aria-label="Protein" value={r.protein_type ?? 'mixed'} onChange={(e) => setR({ ...r, protein_type: e.target.value as ProteinType })} className={field}>
              {PROTEIN_TYPES.map((p) => <option key={p} value={p}>{PROTEIN_LABEL[p]}</option>)}
            </select>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <label className="flex flex-col gap-1">Portions<input inputMode="decimal" value={r.portions} onChange={(e) => setR({ ...r, portions: Math.max(1, Number(e.target.value) || 1) })} className={field} /></label>
          <label className="flex flex-col gap-1">Minutes<input inputMode="numeric" value={r.prep_min ?? ''} onChange={(e) => setR({ ...r, prep_min: Number(e.target.value) > 0 ? Math.round(Number(e.target.value)) : null })} className={field} /></label>
          <label className="flex flex-col gap-1">Keeps days<input inputMode="numeric" value={r.keeps_days} onChange={(e) => setR({ ...r, keeps_days: Math.min(30, Math.max(1, Math.round(Number(e.target.value)) || 3)) })} className={field} /></label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.meal_prep} onChange={(e) => setR({ ...r, meal_prep: e.target.checked })} /> Meal prep</label>

        <h3 className="mt-1 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Ingredients for {r.portions}</h3>
        <ul className="flex flex-col gap-2">
          {items.map((it, k) => (
            <li key={k} className="rounded-xl bg-zinc-100 p-2 dark:bg-zinc-800/70">
              <div className="flex gap-2">
                <input aria-label="Ingredient" value={it.name} onChange={(e) => update(k, { name: e.target.value })} className={`${field} flex-1`} />
                <button aria-label="Remove ingredient" onClick={() => setItems(items.filter((_, i) => i !== k))} className="px-2 text-zinc-500">✕</button>
              </div>
              <div className="mt-2 grid grid-cols-[1fr_5rem] gap-2">
                <input aria-label="Amount" inputMode="decimal" placeholder="nach Geschmack" value={it.amountText} onChange={(e) => update(k, { amountText: e.target.value })} className={field} />
                <select aria-label="Unit" value={it.unit ?? 'g'} disabled={!!it.food_item_id} onChange={(e) => update(k, { unit: e.target.value as RecipeItem['unit'] })} className={field}>
                  <option value="g">g</option><option value="ml">ml</option><option value="piece">pcs</option><option value="serving">serv.</option>
                </select>
              </div>
              {it.food_item_id ? (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{num(it.kcal)} kcal · {it.protein_g} g protein (staple)</p>
              ) : (
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <label className="flex flex-col gap-1">kcal<input inputMode="decimal" value={it.kcal} onChange={(e) => update(k, { kcal: Number(e.target.value) || 0 })} className={field} /></label>
                  <label className="flex flex-col gap-1">Protein g<input inputMode="decimal" value={it.protein_g} onChange={(e) => update(k, { protein_g: Number(e.target.value) || 0 })} className={field} /></label>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select aria-label="Add staple" value={pick} onChange={(e) => addStaple(e.target.value)} className={field}>
            <option value="">+ Add staple</option>
            {staples.map((s) => <option key={s.id} value={s.id}>{s.name}{s.store ? ` (${s.store})` : ''}</option>)}
          </select>
          <button onClick={addOther} className="rounded-lg border border-zinc-200 px-3 text-sm font-semibold dark:border-zinc-700">+ Other</button>
        </div>

        <h3 className="mt-1 text-xs font-bold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Instructions, one step per line</h3>
        <textarea aria-label="Instructions" rows={5} value={stepsText} onChange={(e) => setStepsText(e.target.value)}
          className="w-full rounded-lg border border-zinc-200 bg-white p-2 text-base dark:border-zinc-700 dark:bg-zinc-900" />
        <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-400">Amounts in steps: {items.map((it, k) => `{${it.id || `i${k + 1}`}} ${it.name.split(',')[0]}`).filter((x) => !x.endsWith('} ')).slice(0, 4).join(' · ')}</p>

        <button disabled={!r.name.trim() || items.every((i) => !i.name.trim())} onClick={() => void save()} className="rounded-xl bg-accent py-3 text-sm font-semibold text-accent-fg disabled:opacity-40">Save recipe</button>
      </div>
    </Sheet>
  )
}

/** Timer from the step text: «6 min», «35 bis 40 min» (the first number). */
function timerOf(text: string): number | null {
  const m = /(\d+)(?:\s*bis\s*\d+)?\s*(min|Min)/.exec(text)
  return m ? Number(m[1]) * 60 : null
}
