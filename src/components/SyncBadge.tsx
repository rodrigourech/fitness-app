import { useLiveQuery } from 'dexie-react-hooks'
import { useSyncExternalStore } from 'react'
import { db } from '../lib/db'
import { getSyncStatus, subscribeSyncStatus, syncNow } from '../lib/sync'
import Popover from './Popover'

interface Props {
  onReauth: () => void
}

export default function SyncBadge({ onReauth }: Props) {
  const status = useSyncExternalStore(subscribeSyncStatus, getSyncStatus)
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)

  let text: string
  let tone = 'text-zinc-500 dark:text-zinc-400'
  switch (status.phase) {
    case 'syncing':
      text = 'Syncing …'
      break
    case 'offline':
      text = pending ? `Offline (${pending})` : 'Offline'
      break
    case 'signed_out':
      text = 'Sign-in needed'
      tone = 'text-amber-600 dark:text-amber-400'
      break
    case 'error':
      text = pending ? `Error (${pending})` : 'Error'
      tone = 'text-red-600 dark:text-red-400'
      break
    default:
      text = pending ? `${pending} pending` : 'Synced'
  }

  const action = status.phase === 'signed_out' ? onReauth : () => void syncNow()

  if (status.phase === 'error') {
    // On phones there is no hover tooltip: show the error in a popover with a retry button
    return (
      <Popover label={text} ariaLabel="Sync error details" align="right" triggerClassName={`rounded-md px-2 py-1 text-sm whitespace-nowrap ${tone}`}>
        {(close) => (
          <span className="flex flex-col gap-2">
            <span className="font-semibold">Sync failed</span>
            <span className="text-xs break-words text-zinc-600 dark:text-zinc-300">{status.error ?? 'Unknown error'}</span>
            <button
              onClick={() => {
                close()
                void syncNow()
              }}
              className="rounded-md bg-accent py-1.5 text-sm font-semibold text-accent-fg"
            >
              Retry
            </button>
          </span>
        )}
      </Popover>
    )
  }

  return (
    <button
      onClick={action}
      title={status.lastSuccess ? `Last synced: ${new Date(status.lastSuccess).toLocaleString('en-GB')}` : undefined}
      className={`rounded-md px-2 py-1 text-sm whitespace-nowrap ${tone}`}
    >
      {text}
    </button>
  )
}
