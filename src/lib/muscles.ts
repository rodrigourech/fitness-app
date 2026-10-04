import { MUSCLE_MAP } from 'body-muscles'

// Focus muscles are stored side-agnostic (e.g. "chest-upper"); the map has left/right regions.
const SIDE = /-(left|right)$/

export function regionOf(muscleId: string): string {
  return muscleId.replace(SIDE, '')
}

/** English display name of a region, e.g. "Shoulder (Side)". */
export function regionName(region: string): string {
  const def = MUSCLE_MAP.find((m) => regionOf(m.id) === region)
  return def ? def.name.replace(/^(Left|Right) /, '') : region
}
