import { describe, expect, it } from 'vitest'
import { handle, type FoodEnv } from './foodmcp.ts'
import { familyOf, loadTraining, normalizeRow, progressionStatus, setLabels, TRAINING_TOOLS, trainingTool, zurichWall, type Sql, type TrainingData, type TrainingTable } from './training.ts'
import type { BodyWeight, Exercise, Template, TemplateExercise, TemplateSet, Workout, WorkoutExercise, WorkoutSet } from '../src/lib/core/rows.ts'

const U = 'u1'
const T0 = '2026-10-01T00:00:00.000Z'
const NOW = new Date('2026-11-23T14:30:00Z')
const base = { user_id: U, created_at: T0, updated_at: T0, deleted_at: null }

function exercise(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  return { ...base, id, parent_id: null, name, equipment: 'pin_loaded', muscles_primary: ['lats'], muscles_secondary: ['biceps'], tracking_type: 'weight_reps', is_unilateral: false,
    weight_step: 6.8, default_rest_s: 120, floor: 'unten', seat: null, foot_position: null, setup_note: null, source_id: null, focus_muscles: null, focus_cue: null,
    target_reps: 12, min_reps: 8, warm_up: true, top_set: true, alternative_id: null, instructions: null, ...extra }
}

const LAT = exercise('00000000-0000-4000-8000-000000000001', 'Lat Pulldown (Cable)', { alternative_id: '00000000-0000-4000-8000-000000000003' })
const CLASSIC = exercise('00000000-0000-4000-8000-000000000002', 'Classic Grip', { parent_id: LAT.id, equipment: null, muscles_primary: null, muscles_secondary: null, tracking_type: null,
  is_unilateral: null, weight_step: null, default_rest_s: null, floor: null, target_reps: null, min_reps: null, warm_up: null, top_set: null })
const PULL = exercise('00000000-0000-4000-8000-000000000003', 'Pull Down (Machine)', { equipment: 'plate_loaded', weight_step: 10, alternative_id: LAT.id })
const CURL = exercise('00000000-0000-4000-8000-000000000004', 'Cable Curl', { muscles_primary: ['biceps'], muscles_secondary: [], weight_step: 4.5, top_set: false, warm_up: false })

const TEMPLATE: Template = { ...base, id: '00000000-0000-4000-8000-0000000000a0', name: 'Full Body A', note: null, archived_at: null }
const OLD: Template = { ...base, id: '00000000-0000-4000-8000-0000000000a9', name: 'Main Day A (until 26 Oct)', note: null, archived_at: '2026-10-27T08:54:00.000Z' }
const SLOT: TemplateExercise = { ...base, id: '00000000-0000-4000-8000-0000000000b1', template_id: TEMPLATE.id, exercise_id: CLASSIC.id, position: 1, rest_s: null, comment: null }
const SLOT2: TemplateExercise = { ...base, id: '00000000-0000-4000-8000-0000000000b2', template_id: TEMPLATE.id, exercise_id: CURL.id, position: 2, rest_s: 90, comment: 'Extra' }
const tset = (id: string, te: string, position: number, type: 'warmup' | 'working' = 'working'): TemplateSet =>
  ({ ...base, id, template_exercise_id: te, position, set_type: type, target_reps_min: null, target_reps_max: null, target_weight: null, target_duration_s: null, target_distance_km: null })
const TSETS = [tset('t1', SLOT.id, 1), tset('t2', SLOT.id, 2), tset('t3', SLOT.id, 3), tset('t4', SLOT2.id, 1), tset('t5', SLOT2.id, 2)]

function workout(id: string, started: string, minutes: number): Workout {
  return { ...base, id, template_id: TEMPLATE.id, template_name_snapshot: 'Full Body A', started_at: started, finished_at: new Date(Date.parse(started) + minutes * 60_000).toISOString(), note: null, crowd_level: 6 }
}
const W1 = workout('00000000-0000-4000-8000-0000000000c1', '2026-11-16T09:00:00.000Z', 55)
// Sunday 22 November 23:30 UTC is Monday 23 November 00:30 in Zurich
const W2 = workout('00000000-0000-4000-8000-0000000000c2', '2026-11-22T23:30:00.000Z', 62)
const we = (id: string, w: Workout, ex: Exercise, position: number): WorkoutExercise =>
  ({ ...base, id, workout_id: w.id, exercise_id: ex.id, position, rest_s: null, comment: null, skipped_at: null, target_reps: 12, min_reps: 8, warm_up: true, original_exercise_id: null })
const WE = [we('e1', W1, CLASSIC, 1), we('e2', W2, CLASSIC, 1), we('e3', W2, CURL, 2)]
let n = 0
const set = (weId: string, position: number, type: 'warmup' | 'working', weight: number | null, reps: number | null): WorkoutSet =>
  ({ ...base, id: `s${++n}`, workout_exercise_id: weId, position, set_type: type, weight, reps, reps_left: null, reps_right: null, rir: null, duration_s: null, distance_km: null, completed_at: T0 })
const SETS = [
  set('e1', 1, 'warmup', 18, 6), set('e1', 2, 'working', 32, 10), set('e1', 3, 'working', 25, 11), set('e1', 4, 'working', 25, 11),
  set('e2', 1, 'warmup', 18, 6), set('e2', 2, 'working', 32, 12), set('e2', 3, 'working', 25, 12), set('e2', 4, 'working', 25, 12),
  set('e3', 1, 'working', 18, 10), set('e3', 2, 'working', 18, 9),
]
const weigh = (day: string, kg: number): BodyWeight => ({ ...base, id: `bw-${day}`, measured_on: day, weight_kg: kg, condition: 'morning_fasted', note: null })
const WEIGHTS = ['2026-11-02', '2026-11-06', '2026-11-10', '2026-11-14', '2026-11-18', '2026-11-22'].map((d, i) => weigh(d, 88 - i * 0.3))

function data(): TrainingData {
  return { exercises: [LAT, CLASSIC, PULL, CURL], templates: [TEMPLATE, OLD], tes: [SLOT, SLOT2], tsets: TSETS, workouts: [W1, W2], wes: WE, sets: SETS, weights: WEIGHTS,
    settings: new Map<string, unknown>([['goal_weight', { kg: 82 }], ['training_shares', { warmUp: 50, backOff: 80 }], ['nutrition_targets', { needKcal: 2400, deficitKcal: 400, proteinG: 140, creatine: { doseG: 5, since: '2026-11-23' } }]]) }
}

/** Database that answers only the connector's read statements; anything else fails the test. */
function readOnlySql(d: TrainingData) {
  const queries: string[] = []
  const rows: Record<TrainingTable, unknown[]> = { exercise: d.exercises, template: d.templates, template_exercise: d.tes, template_set: d.tsets, workout: d.workouts,
    workout_exercise: d.wes, workout_set: d.sets, body_weight: d.weights, user_setting: [...d.settings].map(([key, value]) => ({ key, value })) }
  const sql: Sql = async (q, p = []) => {
    queries.push(q)
    const m = /^select to_jsonb\(t\) as r from public\.(\w+) t where t\.user_id = \$1 and t\.deleted_at is null$/.exec(q)
    if (!m || p[0] !== U) throw new Error(`unexpected ${q}`)
    // Postgres renders timestamptz in to_jsonb with an offset
    return (rows[m[1] as TrainingTable] ?? []).map((r) => ({ r: JSON.stringify(r).replace(/"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.000Z"/g, '"$1+00:00"') }))
  }
  return { sql, queries }
}

describe('training tools (read only)', () => {
  it('loads only the owner\'s rows that are not deleted and normalizes timestamps', async () => {
    const { sql, queries } = readOnlySql(data())
    const d = await loadTraining(sql, U)
    expect(queries).toHaveLength(9)
    expect(queries.every((q) => q.startsWith('select'))).toBe(true)
    expect(d.workouts[0]!.started_at).toBe('2026-11-16T09:00:00.000Z')
    expect(d.settings.get('goal_weight')).toEqual({ kg: 82 })
    expect(normalizeRow<{ finished_at: string }>({ finished_at: '2026-11-23T10:05:00.5+01:00' }).finished_at).toBe('2026-11-23T09:05:00.500Z')
  })

  it('lists workouts in Zurich time with duration, volume and sets', () => {
    const text = trainingTool('list_workouts', {}, data(), NOW)
    expect(text).toContain('Mo 23.11.2026 00:30 · Full Body A · 1 h 02 · 1 326 kg Volumen · 5 Arbeitssätze (+1 W) · 2 Übungen · Gym 6/10')
    expect(text.indexOf('23.11.2026')).toBeLessThan(text.indexOf('16.11.2026'))
  })

  it('shows a workout with W, Top and Back-off', () => {
    expect(setLabels(SETS.filter((s) => s.workout_exercise_id === 'e2'), true)).toEqual(['W', 'Top', 'Back-off', 'Back-off'])
    const text = trainingTool('get_workout', { date: '2026-11-23' }, data(), NOW)
    expect(text).toContain('1. Lat Pulldown (Cable) – Classic Grip (Bereich 8–12)\n   W 18×6 · Top 32×12 · Back-off 25×12 · Back-off 25×12')
    expect(text).toContain('2. Cable Curl (Bereich 8–12)\n   1 18×10 · 2 18×9')
  })

  it('finds the family with variants and alternatives', () => {
    expect(familyOf(data(), CLASSIC)).toEqual([
      { id: LAT.id, role: 'Hauptübung' }, { id: CLASSIC.id, role: 'Variante' }, { id: PULL.id, role: 'Alternative' },
    ])
  })

  it('computes progression and the recommended weight as in the app', () => {
    const p = progressionStatus(data(), CLASSIC.id)!
    // Top set reached 12 reps: increase; the 15 lb stack gives 32 → 39 kg, back-off 80 % in whole steps
    expect(p).toMatchObject({ advice: 'increase', current: 32, next: 39, target: 12, minimum: 8, plannedCount: 3 })
    expect(p.backOff).toBe(32)
    const curl = progressionStatus(data(), CURL.id)!
    expect(curl).toMatchObject({ advice: 'hold', current: 18, next: 18, repsToGo: 3, backOff: null })
    const text = trainingTool('exercise_history', { exercise: 'lat pulldown' }, data(), NOW)
    expect(text).toContain('Lat Pulldown (Cable) – Classic Grip (Variante')
    expect(text).toContain('2 Trainings seit 16.11.2026 · bestes Top Set 32×12')
    expect(text).toContain('Empfehlung nächstes Training: Top Set 39 kg, Back-off 32 kg')
    expect(() => trainingTool('exercise_history', { exercise: 'squat' }, data(), NOW)).toThrow(/No exercise matches/)
  })

  it('counts sets per muscle per Zurich week', () => {
    const text = trainingTool('weekly_volume', { weeks: 2 }, data(), NOW)
    // W2 (Sunday 23:30 UTC) belongs to the week from Monday 23 November in Zurich
    expect(text).toContain('Woche 23.11.2026 bis 29.11.2026 (laufend): 1 Krafttraining · 5 Arbeitssätze · 1 326 kg\n   Biceps 3.5, Lats 3')
    expect(text).toContain('Woche 16.11.2026 bis 22.11.2026: 1 Krafttraining · 3 Arbeitssätze · 870 kg\n   Lats 3, Biceps 1.5')
  })

  it('reports body weight with 7-day average, trend and forecast', () => {
    const text = trainingTool('body_weight', { from: '2026-11-01' }, data(), NOW)
    expect(text).toContain('Letzter Eintrag 22.11.2026 86.5 kg')
    expect(text).toMatch(/Trend \(letzte 28 Tage, 6 Messungen.*\): -0\.53 kg pro Woche/)
    expect(text).toContain('Prognose Zielgewicht um')
    expect(text).toContain('Zielgewicht 82 kg')
  })

  it('reads the targets', () => {
    const text = trainingTool('get_targets', {}, data(), NOW)
    expect(text).toContain('Tagesziel 2 000 kcal')
    expect(text).toContain('Kreatin: 5 g täglich seit 23.11.2026')
    expect(text).toContain('Back-off 80 %')
  })

  it('is part of the MCP server and only reads', async () => {
    const env: FoodEnv = { FOOD_MCP_KEY: 'k'.repeat(40), FOOD_DATABASE_URL: 'postgresql://food:pw@ep-x.eu-central-1.aws.neon.tech/neondb', FOOD_USER_ID: U }
    const { sql, queries } = readOnlySql(data())
    const post = async (body: unknown) => (await handle(new Request(`https://fn.example/mcp/${env.FOOD_MCP_KEY}`, { method: 'POST', body: JSON.stringify(body) }), env, () => sql, NOW)).json() as Promise<{ result: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean } }>
    const list = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(list.result.tools!.map((t) => t.name)).toEqual(expect.arrayContaining(TRAINING_TOOLS.map((t) => t.name)))
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_workouts', arguments: { from: '2026-11-16' } } })
    expect(res.result.isError).toBeUndefined()
    expect(res.result.content![0]!.text).toContain('Full Body A')
    expect(queries.every((q) => q.startsWith('select'))).toBe(true)
    expect(zurichWall('2026-06-30T22:30:00Z')).toBe('2026-07-01T00:30:00')
  })
})
