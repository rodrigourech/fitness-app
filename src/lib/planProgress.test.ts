import { describe, expect, it } from 'vitest'
import type { SetInfo } from './analytics'
import type { Exercise, WorkoutSet } from './db'
import { buildPlanProgress, progressStatus, splitName, type ProgressPointE1 } from './planProgress'

const base = { user_id: 'u', created_at: '', updated_at: '', deleted_at: null }

function exercise(id: string, name: string, patch: Partial<Exercise> = {}): Exercise {
  return {
    ...base, id, parent_id: null, name, equipment: null, muscles_primary: [], muscles_secondary: [], tracking_type: 'weight_reps',
    is_unilateral: false, weight_step: null, default_rest_s: null, floor: null, seat: null, foot_position: null, setup_note: null,
    source_id: null, focus_muscles: null, focus_cue: null, ...patch,
  }
}

let n = 0
function info(mainId: string, exerciseId: string, date: string, weight: number, reps: number, setType: 'working' | 'warmup' = 'working'): SetInfo {
  n++
  const set: WorkoutSet = {
    ...base, id: `s${n}`, workout_exercise_id: `we-${date}-${exerciseId}`, position: n, set_type: setType, weight, reps, reps_left: null,
    reps_right: null, rir: null, duration_s: null, distance_km: null, completed_at: date,
  }
  return { workoutId: `w-${date}`, date, exerciseId, mainId, trackingType: 'weight_reps', unilateral: false, primary: [], secondary: [], set }
}

const pt = (date: string, e1rm: number): ProgressPointE1 => ({ date, e1rm, top: { weight: e1rm, reps: 1, repsLeft: null, repsRight: null } })
const NOW = new Date('2026-11-01T12:00:00Z')

describe('planProgress', () => {
  it('splits the equipment from the name', () => {
    expect(splitName('Chest Press (Machine)')).toEqual({ title: 'Chest Press', detail: 'Machine' })
    expect(splitName('Leg Press')).toEqual({ title: 'Leg Press', detail: null })
  })

  it('status: new, flat, stalled, strong, good', () => {
    expect(progressStatus([pt('2026-10-01', 40)], NOW).status).toBe('new')
    expect(progressStatus([pt('2026-10-01', 40), pt('2026-10-05', 50)], NOW)).toEqual({ status: 'new', since: null, changePct: 25 })
    expect(progressStatus([pt('2026-09-28', 60), pt('2026-10-12', 57), pt('2026-10-27', 60)], NOW).status).toBe('flat')
    // Preacher Curl: best on 12 October, five workouts at the same top set since then
    const preacher = [pt('2026-09-28', 19), pt('2026-10-02', 20), pt('2026-10-12', 26.7), pt('2026-10-15', 26.7), pt('2026-10-19', 26.7),
      pt('2026-10-22', 26.7), pt('2026-10-27', 26.7)]
    // Change over the last 4 weeks: from 2 October (last workout before the window) to today
    expect(progressStatus(preacher, NOW)).toEqual({ status: 'stalled', since: '2026-10-12', changePct: 34 })
    // Three workouts without a new best are not yet stalled
    expect(progressStatus([pt('2026-10-01', 40), pt('2026-10-08', 53), pt('2026-10-15', 53), pt('2026-10-22', 52), pt('2026-10-29', 53)], NOW).status).toBe('strong')
    expect(progressStatus([pt('2026-10-01', 40), pt('2026-10-08', 41), pt('2026-10-15', 42)], NOW).status).toBe('good')
    expect(progressStatus([pt('2026-10-01', 40), pt('2026-10-08', 36), pt('2026-10-15', 35)], NOW).status).toBe('lower')
  })

  it('change covers the last 4 weeks only (decision 5 November 2026)', () => {
    // Big gains in September, little since: +4 % from the last workout before 4 October is good, not strong
    const points = [pt('2026-09-01', 30), pt('2026-09-20', 45), pt('2026-10-01', 50), pt('2026-10-15', 51), pt('2026-10-29', 52)]
    expect(progressStatus(points, NOW)).toEqual({ status: 'good', since: null, changePct: 4 })
    expect(progressStatus([pt('2026-10-01', 50), pt('2026-10-15', 50.5), pt('2026-10-29', 51)], NOW).status).toBe('flat')
  })

  it('one row per trained main exercise with variants, alternative and first and latest top set', () => {
    const exercises = [
      exercise('tri', 'Triceps Pushdown (Cable)'),
      exercise('tri-v', 'V-Grip', { parent_id: 'tri', tracking_type: null }),
      exercise('tri-s', 'Straight Bar', { parent_id: 'tri', tracking_type: null }),
      exercise('lrm', 'Lateral Raise (Machine)', { alternative_id: 'lrc' }),
      exercise('lrc', 'Lateral Raise (Cable)', { alternative_id: 'lrm' }),
      exercise('bike', 'Bicycle', { tracking_type: 'duration' }),
      exercise('fly', 'Butterfly (Machine)'),
    ]
    const sets = [
      info('lrm', 'lrm', '2026-10-30', 25, 12),
      info('fly', 'fly', '2026-11-04', 20, 8, 'warmup'),
      info('tri', 'tri-s', '2026-09-28', 27, 10), info('tri', 'tri-s', '2026-09-28', 27, 10),
      info('tri', 'tri-v', '2026-10-29', 41, 10), info('tri', 'tri-v', '2026-10-29', 36, 10), info('tri', 'tri-v', '2026-10-29', 20, 6, 'warmup'),
    ]
    // Butterfly has only a warm-up set and is left out until its first work set
    const rows = buildPlanProgress([{ exercise_id: 'bike' }, { exercise_id: 'tri-v' }, { exercise_id: 'lrm' }, { exercise_id: 'tri-s' }, { exercise_id: 'fly' }], exercises, sets, NOW)
    expect(rows.map((r) => [r.title, r.subtitle])).toEqual([['Triceps Pushdown', 'V-Grip'], ['Lateral Raise', 'Machine · alt. Cable']])
    expect(rows[0]!.first).toMatchObject({ weight: 27, reps: 10 })
    expect(rows[0]!.latest).toMatchObject({ weight: 41, reps: 10 })
    expect(rows[0]!.changePct).toBe(52)
    expect(rows[1]).toMatchObject({ status: 'new', changePct: null })
    expect(rows[1]!.latest).toMatchObject({ weight: 25, reps: 12 })
  })

  it('leaves out exercises without any work set', () => {
    const exercises = [exercise('fly', 'Butterfly (Machine)'), exercise('curl', 'Cable Curl')]
    expect(buildPlanProgress([{ exercise_id: 'fly' }, { exercise_id: 'curl' }], exercises, [], NOW)).toEqual([])
  })
})
