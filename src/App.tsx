import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { getLocalUser, signOut, type LocalUser } from './lib/auth'
import { uploadPendingPhotos } from './lib/photos'
import { startBackgroundSync } from './lib/sync'
import { getActiveWorkout } from './lib/workout'
import MiniWorkoutBar from './components/MiniWorkoutBar'
import Home from './pages/Home'
import Login from './pages/Login'
import WorkoutPage from './pages/WorkoutPage'

export default function App() {
  // undefined = still reading local state; null = nobody signed in on this device
  const [user, setUser] = useState<LocalUser | null | undefined>(undefined)
  const active = useLiveQuery(getActiveWorkout, [])
  // Minimised running workout: the app stays usable, a bar at the bottom leads back.
  // Stored per workout id, so a newly started workout always opens full screen.
  const [minimizedId, setMinimizedId] = useState<string | null>(null)
  const minimized = active !== undefined && minimizedId === active.id

  useEffect(() => {
    getLocalUser().then(setUser, () => setUser(null))
  }, [])

  useEffect(() => {
    if (!user) return
    // All data comes from Neon on the first sync; the seed files are no longer shipped with the app
    const stop = startBackgroundSync()
    // Photos taken offline are uploaded when the connection is back
    const onOnline = () => void uploadPendingPhotos()
    window.addEventListener('online', onOnline)
    onOnline()
    return () => {
      stop()
      window.removeEventListener('online', onOnline)
    }
  }, [user])

  async function reauth() {
    await signOut()
    setUser(null)
  }

  if (user === undefined) return null
  if (user === null) return <Login onSignedIn={setUser} />
  if (active && !minimized) return <WorkoutPage workout={active} onReauth={() => void reauth()} onMinimize={() => setMinimizedId(active.id)} />
  return (
    <>
      <Home user={user} onSignedOut={() => setUser(null)} running={active !== undefined} onResume={() => setMinimizedId(null)} />
      {active && (
        <>
          {/* Space so the bar does not cover the end of the page */}
          <div className="h-24" aria-hidden="true" />
          <MiniWorkoutBar workout={active} onExpand={() => setMinimizedId(null)} />
        </>
      )}
    </>
  )
}
