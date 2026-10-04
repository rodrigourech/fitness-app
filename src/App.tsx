import { useEffect, useState } from 'react'
import { getLocalUser, type LocalUser } from './lib/auth'
import { importSeedIfNeeded } from './lib/seed'
import { startBackgroundSync } from './lib/sync'
import Home from './pages/Home'
import Login from './pages/Login'

export default function App() {
  // undefined = still reading local state; null = nobody signed in on this device
  const [user, setUser] = useState<LocalUser | null | undefined>(undefined)

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

  if (user === undefined) return null
  if (user === null) return <Login onSignedIn={setUser} />
  return <Home user={user} onSignedOut={() => setUser(null)} />
}
