import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { getLocalUser, signOut, type LocalUser } from './lib/auth'
import { importSeedIfNeeded } from './lib/seed'
import { startBackgroundSync } from './lib/sync'
import { getActiveWorkout } from './lib/workout'
import Home from './pages/Home'
import Login from './pages/Login'
import WorkoutPage from './pages/WorkoutPage'

export default function App() {
  // undefined = still reading local state; null = nobody signed in on this device
  const [user, setUser] = useState<LocalUser | null | undefined>(undefined)
  const active = useLiveQuery(getActiveWorkout, [])

  useEffect(() => {
    getLocalUser().then(setUser, () => setUser(null))
  }, [])

  useEffect(() => {
    if (!user) return
    let stop: (() => void) | undefined
    let cancelled = false
    // Seed first, then sync, so the seed rows are pushed in the first cycle
    importSeedIfNeeded(user.id)
      .catch((err: unknown) => console.error('Seed import failed', err))
      .finally(() => {
        if (!cancelled) stop = startBackgroundSync()
      })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [user])

  async function reauth() {
    await signOut()
    setUser(null)
  }

  if (user === undefined) return null
  if (user === null) return <Login onSignedIn={setUser} />
  if (active) return <WorkoutPage workout={active} onReauth={() => void reauth()} />
  return <Home user={user} onSignedOut={() => setUser(null)} />
}
