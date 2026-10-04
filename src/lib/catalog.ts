import type { TrackingType } from './db'

// Free Exercise DB (https://github.com/yuhonas/free-exercise-db, Unlicense), shipped with the app.
// Reduced to the fields needed for suggestions; loaded lazily as its own chunk.

export interface CatalogEntry {
  id: string
  name: string
  category: string
  equipment: string | null
  primary: string[]
  secondary: string[]
  mechanic: string | null
}

let cache: Promise<CatalogEntry[]> | null = null

export function loadCatalog(): Promise<CatalogEntry[]> {
  cache ??= import('../data/catalog.json').then((m) => m.default as CatalogEntry[])
  return cache
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Entries containing all words of the query; name starts and word starts rank first. */
export function searchCatalog(entries: CatalogEntry[], query: string, limit = 8): CatalogEntry[] {
  const q = normalize(query)
  if (q.length < 2) return []
  const words = q.split(' ')
  const scored: { e: CatalogEntry; score: number }[] = []
  for (const e of entries) {
    const n = normalize(e.name)
    if (!words.every((w) => n.includes(w))) continue
    const score = n.startsWith(q) ? 0 : n.split(' ').some((part) => part.startsWith(words[0]!)) ? 1 : 2
    scored.push({ e, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.e.name.length - b.e.name.length).slice(0, limit).map((s) => s.e)
}

// Catalog muscle names -> muscle keys used for analytics (sets per muscle group)
const MUSCLE_KEY: Record<string, string> = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'upper_back',
  neck: 'neck',
  quadriceps: 'quads',
  shoulders: 'shoulders',
  traps: 'traps',
  triceps: 'triceps',
}

// Catalog muscle names -> regions of the body map (default focus)
const FOCUS_REGIONS: Record<string, string[]> = {
  abdominals: ['abs-upper', 'abs-lower'],
  abductors: ['gluteus-medius'],
  adductors: ['adductors'],
  biceps: ['biceps'],
  calves: ['calves-gastroc-medial', 'calves-gastroc-lateral'],
  chest: ['chest-upper', 'chest-lower'],
  forearms: ['forearm'],
  glutes: ['gluteus-maximus'],
  hamstrings: ['hamstrings-medial', 'hamstrings-lateral'],
  lats: ['lats-upper', 'lats-mid', 'lats-lower'],
  'lower back': ['lower-back-erectors'],
  'middle back': ['traps-mid', 'lats-mid'],
  neck: ['neck'],
  quadriceps: ['quads'],
  shoulders: ['shoulder-front', 'shoulder-side'],
  traps: ['traps-upper'],
  triceps: ['triceps-long', 'triceps-lateral'],
}

export interface CatalogDefaults {
  name: string
  trackingType: TrackingType
  equipment: string | null
  musclesPrimary: string[]
  musclesSecondary: string[]
  focusMuscles: string[]
  sourceId: string
}

export function catalogDefaults(e: CatalogEntry): CatalogDefaults {
  const keys = (list: string[]) => [...new Set(list.map((m) => MUSCLE_KEY[m] ?? m))]
  return {
    name: e.name,
    trackingType: e.category === 'cardio' || e.category === 'stretching' ? 'duration' : 'weight_reps',
    equipment: e.equipment,
    musclesPrimary: keys(e.primary),
    musclesSecondary: keys(e.secondary),
    focusMuscles: [...new Set(e.primary.flatMap((m) => FOCUS_REGIONS[m] ?? []))],
    sourceId: e.id,
  }
}

/** Short description, e.g. "cable · chest, triceps". */
export function describeEntry(e: CatalogEntry): string {
  return [e.equipment, [...e.primary].join(', ')].filter(Boolean).join(' · ')
}
