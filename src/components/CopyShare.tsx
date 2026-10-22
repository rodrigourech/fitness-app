import { useEffect, useState } from 'react'
import { copyText } from '../lib/clipboard'

// «Copy» and «Share» for a prepared text (decision 22 October 2026). The text is built before the tap,
// because iOS Safari only allows the clipboard write and the share sheet directly inside the tap.

const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

interface Props {
  /** Prepared text; undefined while it is being built */
  text: string | null | undefined
  /** Title for the share sheet */
  title: string
  copyLabel?: string
}

export default function CopyShare({ text, title, copyLabel = 'Copy as Markdown' }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(t)
  }, [state])

  const ready = typeof text === 'string'
  const button = 'flex-1 rounded-lg py-2.5 text-sm font-medium disabled:opacity-50'
  return (
    <div className="flex gap-2">
      <button
        disabled={!ready}
        onClick={() => {
          if (ready) void copyText(text).then((ok) => setState(ok ? 'copied' : 'failed'))
        }}
        className={`${button} bg-accent font-semibold text-accent-fg`}
      >
        {!ready ? 'Preparing …' : state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : copyLabel}
      </button>
      {canShare() && (
        <button
          disabled={!ready}
          onClick={() => {
            if (ready) navigator.share({ title, text }).catch(() => undefined)
          }}
          className={`${button} bg-zinc-100 dark:bg-zinc-800`}
        >
          Share
        </button>
      )}
    </div>
  )
}
