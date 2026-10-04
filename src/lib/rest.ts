import { db, setMeta } from './db'

// Rest timer state lives in IndexedDB so it survives reloads and app switches.

export async function startRest(seconds: number): Promise<void> {
  await setMeta('rest_until', new Date(Date.now() + seconds * 1000).toISOString())
}

export async function stopRest(): Promise<void> {
  await db.meta.delete('rest_until')
}

export async function adjustRest(deltaSeconds: number): Promise<void> {
  const until = (await db.meta.get('rest_until'))?.value
  if (!until) return
  await setMeta('rest_until', new Date(Date.parse(until) + deltaSeconds * 1000).toISOString())
}
