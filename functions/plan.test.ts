import { describe, expect, it } from 'vitest'
import { applyWrites, archivePlan, callPlanTool, exercisePlan, templatePlan, writeStatement, type PlanData, type PlanToken } from './plan.ts'
import type { Sql } from './training.ts'
import type { Exercise, ExerciseLink, Template, TemplateExercise, TemplateSet, Workout } from '../src/lib/core/rows.ts'

const U = 'u1'
const T0 = '2026-10-01T00:00:00.000Z'
const NOW = new Date('2026-11-27T20:00:00Z')
const base = { user_id: U, created_at: T0, updated_at: T0, deleted_at: null }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function exercise(n: number, name: string, extra: Partial<Exercise> = {}): Exercise {
  return { ...base, id: id(n), parent_id: null, name, equipment: 'pin_loaded', muscles_primary: ['chest'], muscles_secondary: ['triceps'], tracking_type: 'weight_reps', is_unilateral: false,
    weight_step: 5, default_rest_s: 120, floor: 'unten', seat: null, foot_position: null, setup_note: null, source_id: null, focus_muscles: null, focus_cue: null,
    target_reps: 12, min_reps: 8, warm_up: null, top_set: false, alternative_id: null, instructions: null, ...extra }
}
const inherit = { equipment: null, muscles_primary: null, muscles_secondary: null, tracking_type: null, is_unilateral: null, weight_step: null, default_rest_s: null, floor: null,
  target_reps: null, min_reps: null, top_set: null } as const

const PRESS = exercise(1, 'Chest Press (Machine)')
const LAT = exercise(2, 'Lat Pulldown (Cable)', { muscles_primary: ['lats'], muscles_secondary: ['biceps'] })
const CLASSIC = exercise(3, 'Classic Grip', { parent_id: LAT.id, ...inherit })
const WIDE = exercise(4, 'Wide Grip', { parent_id: LAT.id, ...inherit })
const CURL = exercise(5, 'Cable Curl', { muscles_primary: ['biceps'], muscles_secondary: [], equipment: 'cable' })
const PUSH = exercise(6, 'Push-Up', { equipment: 'bodyweight', weight_step: null })
const PLANK = exercise(7, 'Plank', { tracking_type: 'duration', muscles_primary: ['abs'], muscles_secondary: [], equipment: 'bodyweight', weight_step: null })

const A: Template = { ...base, id: id(100), name: 'Full Body A', note: null, archived_at: null }
const BONUS: Template = { ...base, id: id(101), name: 'Calisthenics Bonus', note: null, archived_at: null }
const slot = (n: number, t: Template, ex: Exercise, position: number, extra: Partial<TemplateExercise> = {}): TemplateExercise =>
  ({ ...base, id: id(n), template_id: t.id, exercise_id: ex.id, position, rest_s: null, comment: null, ...extra })
const S1 = slot(201, A, CLASSIC, 1)
const S2 = slot(202, A, PRESS, 2, { rest_s: 150 })
const S3 = slot(203, A, CURL, 3)
const S4 = slot(204, BONUS, PUSH, 1)
const tset = (n: number, te: TemplateExercise, position: number, extra: Partial<TemplateSet> = {}): TemplateSet =>
  ({ ...base, id: id(n), template_exercise_id: te.id, position, set_type: 'working', target_reps_min: null, target_reps_max: null, target_weight: null,
    target_duration_s: null, target_distance_km: null, ...extra })
const TSETS = [tset(301, S1, 1), tset(302, S1, 2), tset(303, S1, 3), tset(304, S2, 1), tset(305, S2, 2), tset(306, S2, 3), tset(307, S3, 1), tset(308, S3, 2), tset(309, S4, 1)]
const LINK: ExerciseLink = { ...base, id: id(401), exercise_id: PRESS.id, url: 'https://www.youtube.com/watch?v=abc', title: 'Setup' }

function data(extra: Partial<PlanData> = {}): PlanData {
  return { exercises: [PRESS, LAT, CLASSIC, WIDE, CURL, PUSH, PLANK], templates: [A, BONUS], tes: [S1, S2, S3, S4], tsets: TSETS, workouts: [], wes: [], sets: [], weights: [],
    settings: new Map(), links: [LINK], ...extra }
}

describe('plan tools', () => {
  it('creates a new template with defaults and ranges', () => {
    const p = templatePlan(data(), { name: 'Home Workout', exercises: [{ exercise: 'Push-Up', sets: 3, reps_min: 8, reps_max: 15 }, { exercise: 'Plank', duration_s: 45 }] }, NOW)
    expect(p.args.new_id).toMatch(/^[0-9a-f-]{36}$/)
    const ins = p.writes.filter((w) => w.insert)
    expect(ins.map((w) => w.table)).toEqual(['template', 'template_exercise', 'template_set', 'template_set', 'template_set', 'template_exercise', 'template_set'])
    expect(p.text).toContain('Vorschau Vorlage «Home Workout» (neu)')
    expect(p.text).toContain('1. Push-Up · 3 × 8–15 · Pause 120 s (Standard)')
    expect(p.text).toContain('2. Plank · 1 × 45 s')
    expect(p.text).toContain('confirm_template')
    // The same args again (as in confirm, after storing) find the template and change nothing
    const after = applyWrites(data(), p.writes, NOW.toISOString())
    expect(templatePlan(after, p.args, NOW).writes).toHaveLength(0)
  })

  it('rejects duplicates, unknown exercises and wrong targets', () => {
    expect(() => templatePlan(data(), { name: 'Full Body A' }, NOW)).toThrow(/already called/)
    expect(() => templatePlan(data(), { name: 'X', exercises: [{ exercise: 'Push-Up' }, { exercise: 'push-up' }] }, NOW)).toThrow(/twice/)
    expect(() => templatePlan(data(), { name: 'X', exercises: [{ exercise: 'Bench' }] }, NOW)).toThrow(/No exercise/)
    expect(() => templatePlan(data(), { name: 'X', exercises: [{ exercise: 'Plank', reps_max: 10 }] }, NOW)).toThrow(/duration_s/)
    expect(() => templatePlan(data(), { name: 'X', exercises: [{ exercise: 'Push-Up', reps_min: 12, reps_max: 8 }] }, NOW)).toThrow(/at least reps_min/)
    expect(() => templatePlan(data(), { name: 'X', exercises: [{ exercise: 'Push-Up', sets: 11 }] }, NOW)).toThrow(/1 to 10/)
  })

  it('changes a template: order, sets, variant, removal, exercise setting', () => {
    const p = templatePlan(data(), { template: 'Full Body A', exercises: [
      { exercise: PRESS.id, sets: 4, reps_min: 6, reps_max: 10 },
      { exercise: 'Lat Pulldown (Cable) – Wide Grip' },
      { exercise: 'Push-Up', top_set: true },
    ] }, NOW)
    expect(p.args.template_id).toBe(A.id)
    const t = p.text
    expect(t).toContain('1. Chest Press (Machine) · 4 × 6–10 · Pause 150 s')
    expect(t).toContain('- Geändert: 1. Chest Press (Machine) · Position 2 → 1 · Sätze 3 × 8–12 → 4 × 6–10')
    expect(t).toContain('- Geändert: 2. Lat Pulldown (Cable) – Wide Grip · Übung Lat Pulldown (Cable) – Classic Grip → Lat Pulldown (Cable) – Wide Grip · Position 1 → 2')
    expect(t).toContain('- Neu: 3. Push-Up')
    expect(t).toContain('- Entfernt: Cable Curl (2 × 8–12)')
    expect(t).toContain('Übungseinstellungen')
    expect(t).toContain('- Push-Up: Top Set aus → ein (gilt in 2 Vorlagen)')
    // Variant switch keeps the slot and its three sets; Cable Curl and its sets go to the trash
    expect(p.writes.find((w) => w.id === S1.id)?.values).toEqual({ position: 2, exercise_id: WIDE.id })
    expect(p.writes.filter((w) => w.table === 'template_set' && w.values.deleted_at).map((w) => w.id).sort()).toEqual([id(307), id(308)])
    expect(p.writes.filter((w) => w.table === 'template_set' && w.insert)).toHaveLength(1 + 3)
    expect(p.writes.some((w) => w.table === 'template' )).toBe(false)
    expect(p.fp).toMatch(/^[0-9a-z]+$/)
    expect(templatePlan(data({ templates: [{ ...A, updated_at: NOW.toISOString() }, BONUS] }), { template_id: A.id, name: 'Full Body A2' }, NOW).fp).not.toBe(templatePlan(data(), { template_id: A.id, name: 'Full Body A2' }, NOW).fp)
  })

  it('writes location to the main exercise and warns about a running workout', () => {
    const run: Workout = { ...base, id: id(500), template_id: A.id, template_name_snapshot: 'Full Body A', started_at: '2026-11-27T19:30:00.000Z', finished_at: null, note: null }
    const p = templatePlan(data({ workouts: [run] }), { template_id: A.id, exercises: [{ exercise: CLASSIC.id, location: 'oben' }, { exercise: PRESS.id }, { exercise: CURL.id }] }, NOW)
    expect(p.writes).toEqual([{ table: 'exercise', id: LAT.id, insert: false, values: { floor: 'oben' } }])
    expect(p.text).toContain('Lat Pulldown (Cable): Ort unten → oben (gilt auch für die Varianten)')
    expect(p.text).toContain('Ein Training läuft seit 20:30 Uhr')
  })

  it('says when nothing changes', () => {
    const p = templatePlan(data(), { template_id: A.id, exercises: [{ exercise: CLASSIC.id }, { exercise: PRESS.id, rest_s: 150 }, { exercise: CURL.id, sets: 2 }] }, NOW)
    expect(p.writes).toHaveLength(0)
    expect(p.text).toContain('Keine Änderung')
  })

  it('archives and restores', () => {
    const p = archivePlan(data(), { template: 'Calisthenics Bonus' }, NOW)
    expect(p.writes).toEqual([{ table: 'template', id: BONUS.id, insert: false, values: { archived_at: NOW.toISOString() } }])
    expect(p.text).toContain('Vorschau Vorlage «Calisthenics Bonus» archivieren')
    const archived = applyWrites(data(), p.writes, NOW.toISOString())
    expect(archivePlan(archived, p.args, NOW).writes).toHaveLength(0)
    const r = archivePlan(archived, { template_id: BONUS.id, restore: true }, NOW)
    expect(r.writes[0]!.values).toEqual({ archived_at: null })
    expect(() => archivePlan(data(), { template: 'Nope' }, NOW)).toThrow(/not found/)
  })

  it('creates exercises and variants', () => {
    expect(() => exercisePlan(data(), { name: 'Flat Chest Press (Dumbbell)' }, NOW)).toThrow(/muscles_primary/)
    expect(() => exercisePlan(data(), { name: 'Chest Press (Machine)', muscles_primary: ['chest'] }, NOW)).toThrow(/already exists/)
    expect(() => exercisePlan(data(), { name: 'X', muscles_primary: ['pecs'] }, NOW)).toThrow(/Unknown muscle pecs/)
    const p = exercisePlan(data(), { name: 'Flat Chest Press (Dumbbell)', muscles_primary: ['chest'], muscles_secondary: ['triceps', 'shoulders'], equipment: 'dumbbell', weight_step: 2,
      alternative: 'Chest Press (Machine)', reps_min: 8, reps_max: 12 }, NOW)
    const w = p.writes[0]!
    expect(w).toMatchObject({ table: 'exercise', insert: true })
    expect(w.values).toMatchObject({ name: 'Flat Chest Press (Dumbbell)', tracking_type: 'weight_reps', is_unilateral: false, equipment: 'dumbbell', weight_step: 2, alternative_id: PRESS.id })
    expect(p.text).toContain('Vorschau Übung «Flat Chest Press (Dumbbell)» (neu)')
    expect(p.text).toContain('Alternative Chest Press (Machine)')
    expect(p.text).toContain('Noch in keiner Vorlage')
    const v = exercisePlan(data(), { name: 'Neutral Grip', parent: 'Lat Pulldown (Cable)', top_set: true }, NOW)
    expect(v.writes[0]!.values).toEqual({ parent_id: LAT.id, name: 'Neutral Grip', top_set: true })
    expect(() => exercisePlan(data(), { name: 'Y', parent: 'Lat Pulldown (Cable)', muscles_primary: ['lats'] }, NOW)).toThrow(/inherits/)
  })

  it('changes an exercise with videos', () => {
    const p = exercisePlan(data(), { exercise: 'Chest Press (Machine)', weight_step: 2.5, note: 'Sitz 3', videos_add: [{ url: 'https://youtu.be/new', title: 'Dehnen' }, { url: LINK.url, title: 'Einstellung' }],
      videos_remove: [] }, NOW)
    expect(p.text).toContain('- Chest Press (Machine): Gewichtsschritt 5 kg → 2,5 kg')
    expect(p.text).toContain('- Chest Press (Machine): Einstellung leer → «Sitz 3»')
    expect(p.text).toContain('- Chest Press (Machine): Video neu «Dehnen» https://youtu.be/new')
    expect(p.text).toContain('Videotitel «Setup» → «Einstellung»')
    expect(p.text).toContain('Betrifft die Vorlagen «Full Body A»')
    const r = exercisePlan(data(), { exercise_id: PRESS.id, videos_remove: [LINK.url] }, NOW)
    expect(r.writes).toEqual([{ table: 'exercise_link', id: LINK.id, insert: false, values: { deleted_at: NOW.toISOString() } }])
    expect(() => exercisePlan(data(), { exercise_id: PRESS.id, reps_min: 13 }, NOW)).toThrow(/Min reps/)
    expect(() => exercisePlan(data(), { exercise_id: PRESS.id, videos_add: [{ url: 'youtube' }] }, NOW)).toThrow(/Invalid video URL/)
  })

  it('builds one statement with typed parameters and only allowed columns', () => {
    const st = writeStatement([
      { table: 'template', id: id(900), insert: true, values: { name: 'Home Workout', note: null } },
      { table: 'exercise', id: PRESS.id, insert: false, values: { muscles_primary: ['chest'], top_set: true } },
      { table: 'exercise_link', id: id(901), insert: true, values: { exercise_id: PRESS.id, url: 'https://x', title: null }, order: 2 },
    ], U, NOW.toISOString())
    expect(st.query).toMatch(/^with w0 as \(insert into public\.template \(id, user_id, name, note, created_at, updated_at\)/)
    expect(st.query).toContain("updated_at = greatest($1::timestamptz, updated_at + interval '1 ms') where id = $")
    expect(st.query).toContain("($1::timestamptz + 2 * interval '1 ms')")
    expect(st.query).toContain('jsonb_array_elements_text')
    expect(st.params).toContain('["chest"]')
    expect(() => writeStatement([{ table: 'template', id: id(900), insert: false, values: { user_id: 'x' } }], U, NOW.toISOString())).toThrow(/may not be written/)
    expect(() => writeStatement([{ table: 'workout' as 'template', id: id(900), insert: false, values: {} }], U, NOW.toISOString())).toThrow()
  })

  it('preview and confirm with token, conflict and repeat', async () => {
    let d = data()
    const writes: string[] = []
    const sql: Sql = async (q, p = []) => {
      const m = /from public\.(\w+) t where/.exec(q)
      if (m) {
        const rows = { exercise: d.exercises, template: d.templates, template_exercise: d.tes, template_set: d.tsets, workout: d.workouts, workout_exercise: d.wes,
          workout_set: d.sets, body_weight: d.weights, user_setting: [], exercise_link: d.links }[m[1]!] ?? []
        return rows.map((r) => ({ r }))
      }
      expect(q).toMatch(/^with w0 as/)
      writes.push(q)
      void p
      return [{ writes: 1 }]
    }
    const tokens = new Map<string, PlanToken>()
    const ctx = { sql, user: U, now: NOW, sign: async (t: PlanToken) => { const k = `tok${tokens.size}`; tokens.set(k, JSON.parse(JSON.stringify(t))); return k },
      verify: async (k: string) => tokens.get(k) ?? null }
    const prev = await callPlanTool('preview_archive_template', { template: 'Calisthenics Bonus' }, ctx)
    const token = /preview_token: (\S+)/.exec(prev.text)![1]!
    await expect(callPlanTool('confirm_template', { preview_token: token }, ctx)).rejects.toThrow(/Invalid or expired/)
    // Changed in the app in between: refused
    d = data({ templates: [A, { ...BONUS, note: 'x', updated_at: '2026-11-27T19:59:00.000Z' }] })
    await expect(callPlanTool('confirm_archive_template', { preview_token: token }, ctx)).rejects.toThrow(/Changed in the app/)
    d = data()
    expect((await callPlanTool('confirm_archive_template', { preview_token: token }, ctx)).text).toContain('Gespeichert (Vorlage archiviert')
    expect(writes).toHaveLength(1)
    // After the sync the archive is in place: confirming again stores nothing
    d = data({ templates: [A, { ...BONUS, archived_at: NOW.toISOString(), updated_at: NOW.toISOString() }] })
    expect((await callPlanTool('confirm_archive_template', { preview_token: token }, ctx)).text).toBe('Bereits gespeichert.')
    expect(writes).toHaveLength(1)
  })
})
