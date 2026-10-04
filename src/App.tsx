import { useEffect, useState } from 'react'
import { getLocalUser, type LocalUser } from './lib/auth'
import { importSeedIfNeeded } from './lib/seed'
import Home from './pages/Home'
import Login from './pages/Login'

export default function App() {
  // undefined = still reading local state; null = nobody signed in on this device
  const [user, setUser] = useState<LocalUser | null | undefined>(undefined)

  useEffect(() => {
    getLocalUser().then(setUser, () => setUser(null))
  }, [])

  useEffect(() => {
    if (user) void importSeedIfNeeded(user.id)
  }, [user])

  if (user === undefined) return null
  if (user === null) return <Login onSignedIn={setUser} />
  return <Home user={user} onSignedOut={() => setUser(null)} />
}
