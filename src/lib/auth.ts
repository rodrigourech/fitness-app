import { db, getMeta, setMeta } from './db'
import { neon } from './neon'

// Neon Auth only knows e-mail addresses; usernames are mapped to an internal address.
const INTERNAL_DOMAIN = 'fitness-app.local'

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${INTERNAL_DOMAIN}`
}

export interface LocalUser {
  id: string
  username: string
}

/** The user who signed in on this device. Available offline. */
export async function getLocalUser(): Promise<LocalUser | null> {
  const [id, username, signedIn] = await Promise.all([
    getMeta('user_id'),
    getMeta('username'),
    getMeta('signed_in'),
  ])
  return id && username && signedIn === '1' ? { id, username } : null
}

export class SignInError extends Error {}

/** Signs in against Neon Auth and remembers the user locally. */
export async function signIn(username: string, password: string): Promise<LocalUser> {
  if (!navigator.onLine) {
    throw new SignInError('No connection. The first sign-in needs internet.')
  }
  const { error } = await neon.auth.signIn.email({ email: usernameToEmail(username), password })
  if (error) {
    throw new SignInError(
      error.status === 401 ? 'Wrong username or password.' : `Sign-in failed: ${error.message ?? 'unknown error'}`,
    )
  }
  const { data } = await neon.auth.getSession()
  const id = data?.user.id
  if (!id) throw new SignInError('Sign-in failed: no session received.')

  // user_id is kept after sign-out and identifies the owner of the local data
  const previous = await getMeta('user_id')
  if (previous && previous !== id) {
    // Another account on this device: never mix local data of two users.
    await db.delete()
    await db.open()
  }
  await setMeta('user_id', id)
  await setMeta('username', username.trim().toLowerCase())
  await setMeta('signed_in', '1')
  return { id, username: username.trim().toLowerCase() }
}

/** Signs out remotely (if online). Local data and its owner id are kept. */
export async function signOut(): Promise<void> {
  try {
    if (navigator.onLine) await neon.auth.signOut()
  } finally {
    await db.meta.delete('signed_in')
  }
}
