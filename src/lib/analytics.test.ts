import { describe, expect, it } from 'vitest'
import {
  buildAnalytics,
  crowdGrid,
  dayKey,
  setsPerMuscle,
  sideComparison,
  progressOverview,
  progressSeries,
  weekStart,
  weeklyGoal,
  weeklyVolume,
  type WorkoutInfo,
} from './analytics'
import type { Exercise, Workout, WorkoutSet } from './db'

const base = { user_id: 'u', created_at: '', updated_at: '', deleted_at: null }

function exercise(id: string, patch: Partial<Exercise> = {}): Exercise {
  return {
    ...base,
    id,
    parent_id: null,
    name: id,
    equipment: null,
    muscles_primary: ['chest'],
    muscles_secondary: ['triceps'],
    tracking_type: 'weight_reps',
    is_unilateral: false,
    weight_step: null,
    default_rest_s: null,
    floor: null,
    seat: null,
    foot_position: null,
    setup_note: null,
    source_id: null,
    focus_muscles: null,
    focus_cue: null,
    ...patch,
  }
}

function workout(id: string, started: string, patch: Partial<Workout> = {}): Workout {
  return { ...base, id, template_id: null, template_name_snapshot: null, started_at: started, finished_at: started, note: null, ...patch }
}

let n = 0
function set(weId: string, patch: Partial<WorkoutSet> = {}): WorkoutSet {
  n++
  return {
    ...base,
    id: `s${n}`,
    workout_exercise_id: weId,
    position: n,
    set_type: 'working',
    weight: 50,
    reps: 10,
    reps_left: null,
    reps_right: null,
    rir: null,
    duration_s: null,
    distance_km: null,
    completed_at: '2026-10-01T10:00:00Z',
    ...patch,
  }
}

const exercises = [
  exercise('press'),
  exercise('press_low', { parent_id: 'press', muscles_primary: null, muscles_secondary: null, tracking_type: null, is_unilateral: null }),
  exercise('raise', { is_unilateral: true, muscles_primary: ['side_delts'], muscles_secondary: [] }),
  exercise('run', { tracking_type: 'distance_duration', muscles_primary: ['cardio'], muscles_secondary: [] }),
]

describe('analytics', () => {
  it('weeks start on Monday in local time', () => {
    expect(dayKey(weekStart(new Date(2026, 9, 5, 12)))).toBe('2026-10-05') // Monday
    expect(dayKey(weekStart(new Date(2026, 9, 11, 23)))).toBe('2026-10-05') // Sunday
  })

  it('builds sets with inherited variant settings and classifies workouts', () => {
    const data = buildAnalytics(
      [workout('w1', '2026-10-01T08:00:00Z'), workout('w2', '2026-10-02T08:00:00Z'), workout('open', '2026-10-03T08:00:00Z', { finished_at: null })],
      [
        { id: 'we1', workout_id: 'w1', exercise_id: 'press_low', deleted_at: null },
        { id: 'we2', workout_id: 'w2', exercise_id: 'run', deleted_at: null },
        { id: 'we3', workout_id: 'open', exercise_id: 'press', deleted_at: null },
      ],
      [set('we1'), set('we1', { completed_at: null }), set('we2', { weight: null, reps: null, distance_km: 5 }), set('we3')],
      exercises,
    )
    // Sets of unfinished workouts are ignored; a missing completed_at (Strong import) is not
    expect(data.sets).toHaveLength(3)
    expect(data.sets[0]).toMatchObject({ mainId: 'press', primary: ['chest'], trackingType: 'weight_reps' })
    expect(data.workouts.find((w) => w.id === 'w1')).toMatchObject({ strength: true, run: false })
    expect(data.workouts.find((w) => w.id === 'w2')).toMatchObject({ strength: false, run: true })
    expect(data.exercises).toEqual([{ mainId: 'press', name: 'press', variants: [{ id: 'press_low', name: 'press_low' }] }])
  })

  it('takes the best e1RM per workout, optionally for one variant', () => {
    const data = buildAnalytics(
      [workout('w1', '2026-09-01T08:00:00Z'), workout('w2', '2026-09-08T08:00:00Z')],
      [
        { id: 'a', workout_id: 'w1', exercise_id: 'press', deleted_at: null },
        { id: 'b', workout_id: 'w2', exercise_id: 'press_low', deleted_at: null },
      ],
      [set('a', { weight: 60, reps: 10 }), set('a', { weight: 70, reps: 3 }), set('a', { set_type: 'warmup', weight: 100 }), set('b', { weight: 65, reps: 8 })],
      exercises,
    )
    const all = progressSeries(data.sets, 'press', null, 0, 'e1rm')
    expect(all.map((p) => Math.round(p.value * 10) / 10)).toEqual([80, 82.3])
    expect(all[0]).toMatchObject({ weight: 60, reps: 10 })
    expect(progressSeries(data.sets, 'press', 'press_low', 0, 'e1rm')).toHaveLength(1)
    // Weight: the heaviest working set, warm-ups excluded
    const weight = progressSeries(data.sets, 'press', null, 0, 'weight')
    // Reps of all working sets at the top weight
    expect(weight.map((p) => p.repsList)).toEqual([[3], [8]])
    expect(weight.map((p) => [p.value, p.reps])).toEqual([
      [70, 3],
      [65, 8],
    ])
    expect(progressOverview(data, 0, 'weight')).toEqual([
      expect.objectContaining({ mainId: 'press', latest: 65, change: -5 }),
    ])
  })

  it('sums weekly volume including both sides of one-sided sets', () => {
    const data = buildAnalytics(
      [workout('w1', '2026-09-29T08:00:00'), workout('w2', '2026-10-06T08:00:00')],
      [
        { id: 'a', workout_id: 'w1', exercise_id: 'press', deleted_at: null },
        { id: 'b', workout_id: 'w2', exercise_id: 'raise', deleted_at: null },
      ],
      [set('a', { weight: 50, reps: 10 }), set('b', { weight: 5, reps: null, reps_left: 10, reps_right: 12 })],
      exercises,
    )
    const weeks = weeklyVolume(data.sets, new Date(2026, 8, 22).getTime(), new Date(2026, 9, 7))
    expect(weeks).toEqual([
      { start: '2026-09-21', value: 0 },
      { start: '2026-09-28', value: 500 },
      { start: '2026-10-05', value: 110 },
    ])
  })

  it('counts sets per muscle: primary 1, secondary 0.5, no cardio', () => {
    const data = buildAnalytics(
      [workout('w1', '2026-10-06T08:00:00')],
      [
        { id: 'a', workout_id: 'w1', exercise_id: 'press', deleted_at: null },
        { id: 'b', workout_id: 'w1', exercise_id: 'run', deleted_at: null },
      ],
      [set('a'), set('a'), set('a', { set_type: 'warmup' }), set('b', { distance_km: 5 })],
      exercises,
    )
    expect(setsPerMuscle(data.sets, '2026-10-05')).toEqual([
      { muscle: 'chest', sets: 2 },
      { muscle: 'triceps', sets: 1 },
    ])
  })

  it('compares sides of one-sided sets', () => {
    const data = buildAnalytics(
      [workout('w1', '2026-10-06T08:00:00')],
      [{ id: 'a', workout_id: 'w1', exercise_id: 'raise', deleted_at: null }],
      [set('a', { reps: null, reps_left: 12, reps_right: 10 }), set('a', { reps: null, reps_left: 8, reps_right: 8 })],
      exercises,
    )
    expect(sideComparison(data.sets, 0)).toEqual([{ exerciseId: 'raise', left: 20, right: 18, sets: 2, diff: -0.1 }])
  })

  it('counts the weekly goal per day and the streak', () => {
    const w = (d: string, strength: boolean, run: boolean): WorkoutInfo => ({
      id: d,
      startedAt: `${d}T08:00:00`,
      finishedAt: `${d}T09:00:00`,
      crowd: null,
      strength,
      run,
    })
    const workouts = [
      // week of 21 Sep: met
      w('2026-09-21', true, false),
      w('2026-09-23', true, false),
      w('2026-09-25', false, true),
      // week of 28 Sep: met (two strength workouts on one day count once, so a third day is needed)
      w('2026-09-28', true, false),
      w('2026-09-28', true, false),
      w('2026-09-30', true, false),
      w('2026-10-02', false, true),
      // current week (5 Oct): not yet met
      w('2026-10-05', true, false),
    ]
    const g = weeklyGoal(workouts, 4, new Date(2026, 9, 6, 12), { strength: 2, run: 1 })
    expect(g.weeks.map((x) => [x.start, x.strength, x.run, x.met])).toEqual([
      ['2026-09-14', 0, 0, false],
      ['2026-09-21', 2, 1, true],
      ['2026-09-28', 2, 1, true],
      ['2026-10-05', 1, 0, false],
    ])
    expect(g.streak).toBe(2)
    expect(g.thisWeek.days[2]!.future).toBe(true)
    // Running optional (0): the week of 14 Sep still fails, the others only need two strength days
    const optional = weeklyGoal(workouts, 4, new Date(2026, 9, 6, 12), { strength: 2, run: 0 })
    expect(optional.weeks.map((x) => x.met)).toEqual([false, true, true, false])
  })

  it('averages crowd ratings by weekday and time of leaving', () => {
    const w = (finished: string, crowd: number | null): WorkoutInfo => ({
      id: finished,
      startedAt: finished,
      finishedAt: finished,
      crowd,
      strength: true,
      run: false,
    })
    const g = crowdGrid(
      [w('2026-10-05T09:30:00', 2), w('2026-10-12T09:10:00', 1), w('2026-10-06T18:30:00', 5), w('2026-10-07T07:00:00', 1), w('2026-10-08T10:00:00', null)],
      0,
    )
    expect(g.ratings).toBe(4)
    expect(g.cells[0]![1]).toMatchObject({ avg: 1.5, count: 2 }) // Monday 8–10
    expect(g.cells[1]![6]).toMatchObject({ avg: 5, count: 1 }) // Tuesday 18–20
    // A single rating of 1 does not beat an average of 1.5 over two ratings
    expect(g.best).toMatchObject({ weekday: 0, slot: 1 })
  })
})
