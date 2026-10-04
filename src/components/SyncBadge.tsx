import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { db } from '../lib/db'
import { getSyncStatus, subscribeSyncStatus, syncNow } from '../lib/sync'

interface Props {
  onReauth: () => void
}

export default function SyncBadge({ onReauth }: Props) {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)

  let text: string
  let tone = 'text-neutral-500 dark:text-neutral-400'
  switch (status.phase) {
    case 'syncing':
      text = 'Synchronisiere …'
      break
    case 'offline':
      text = pending ? `Offline, ${pending} ausstehend` : 'Offline'
      break
    case 'signed_out':
      text = 'Anmeldung nötig'
      tone = 'text-amber-600 dark:text-amber-400'
      break
    case 'error':
      text = pending ? `Fehler, ${pending} ausstehend` : 'Fehler'
      tone = 'text-red-600 dark:text-red-400'
      break
    default:
      text = pending ? `${pending} ausstehend` : 'Synchronisiert'
  }

  const action = status.phase === 'signed_out' ? onReauth : () => void syncNow()
  return (
    <button
      onClick={action}
      title={status.error ?? (status.lastSuccess ? `Zuletzt synchronisiert: ${new Date(status.lastSuccess).toLocaleString('de-CH')}` : undefined)}
      className={`rounded-md px-2 py-1 text-sm ${tone}`}
    >
      {text}
    </button>
  )
}
