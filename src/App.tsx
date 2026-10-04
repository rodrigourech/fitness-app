import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { getLocalUser, signOut, type LocalUser } from './lib/auth'
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
    // All data comes from Neon on the first sync; the seed files are no longer shipped with the app
    return startBackgroundSync()
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
