import { useEffect, useState } from 'react'
import type { BodyPhoto } from '../lib/db'
import { photoUrl } from '../lib/photos'

/** Decrypts and shows one photo; the object URL is released when the image disappears. */
export default function PhotoImage({ photo, className }: { photo: BodyPhoto; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    photoUrl(photo).then(
      (u) => {
        made = u
        if (alive) setUrl(u)
        else URL.revokeObjectURL(u)
      },
      (err: unknown) => alive && setFailed(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [photo])
  if (failed)
    return (
      <span title={failed} className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-zinc-500">
        {failed}
      </span>
    )
  if (!url) return <span className="flex h-full w-full items-center justify-center text-xs text-zinc-400">…</span>
  return <img src={url} alt={`Progress photo ${photo.pose ?? ''} ${photo.measured_on}`} className={className} />
}
