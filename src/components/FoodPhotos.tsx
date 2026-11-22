import { useEffect, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { FoodPhoto } from '../lib/db'
import { addFoodPhoto, deleteFoodPhoto, foodPhotoUrl, productPhotos, recipePhotos, setCover, type FoodPhotoTarget } from '../lib/foodPhotos'
import { offerUndo } from '../lib/undo'
import { localDay } from '../lib/food'
import Sheet from './Sheet'

// Photos of recipes and products (decision Rodrigo 22 November 2026). The file input lets iOS offer camera or library.

/** Loads one food photo (from this device or the bucket) and shows it; the object URL is released afterwards. */
export function FoodPhotoImg({ photo, alt, className }: { photo: FoodPhoto; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    foodPhotoUrl(photo).then(
      (u) => {
        made = u
        if (alive) setUrl(u)
        else URL.revokeObjectURL(u)
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [photo])
  if (!url)
    return <span role="img" aria-label={failed ? `${alt} not available yet` : alt} className={`block bg-zinc-200 dark:bg-zinc-800 ${failed ? '' : 'animate-pulse'} ${className ?? ''}`} />
  return <img src={url} alt={alt} className={`object-cover ${className ?? ''}`} />
}

/** Label that opens the camera or the photo library and stores the chosen image. */
export function AddPhotoButton({ userId, target, kind, className, children }: { userId: string; target: FoodPhotoTarget; kind: FoodPhoto['kind']; className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await addFoodPhoto(userId, target, kind, file, localDay(new Date()))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <label className={`cursor-pointer ${busy ? 'opacity-60' : ''} ${className ?? ''}`}>
        <input type="file" accept="image/*" className="sr-only" disabled={busy}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        {busy ? 'Saving…' : children}
      </label>
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </>
  )
}

/** Recipe detail: cover large, further photos as a strip, «+» to add; tap a photo for cover and delete. */
export function RecipePhotos({ userId, recipeId, name }: { userId: string; recipeId: string; name: string }) {
  const photos = useLiveQuery(() => recipePhotos(recipeId), [recipeId])
  const [open, setOpen] = useState<FoodPhoto | null>(null)
  if (photos === undefined) return null
  const target = { recipeId }
  if (photos.length === 0)
    return (
      <AddPhotoButton userId={userId} target={target} kind="dish"
        className="mb-4 flex h-28 w-full items-center justify-center rounded-2xl border border-dashed border-zinc-300 text-sm font-semibold text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        + Add photo
      </AddPhotoButton>
    )
  const [cover, ...rest] = photos
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(cover!)} className="block w-full overflow-hidden rounded-2xl" aria-label="Show cover photo">
        <FoodPhotoImg photo={cover!} alt={name} className="aspect-[4/3] w-full" />
      </button>
      <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
        {rest.map((p) => (
          <button key={p.id} onClick={() => setOpen(p)} className="shrink-0 overflow-hidden rounded-xl" aria-label={`Photo from ${p.taken_on ?? ''}`}>
            <FoodPhotoImg photo={p} alt={name} className="h-16 w-16" />
          </button>
        ))}
        <AddPhotoButton userId={userId} target={target} kind="dish"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-2xl text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          <span aria-label="Add photo">+</span>
        </AddPhotoButton>
      </div>
      {open && <PhotoSheet photo={open} alt={name} onClose={() => setOpen(null)} />}
    </div>
  )
}

const PRODUCT_KIND: Record<'pack' | 'label', string> = { pack: 'Package', label: 'Nutrition label' }

/** Product sheet: front of the package and the nutrition table, one slot each. */
export function ProductPhotos({ userId, foodItemId, name }: { userId: string; foodItemId: string; name: string }) {
  const photos = useLiveQuery(() => productPhotos(foodItemId), [foodItemId])
  const [open, setOpen] = useState<FoodPhoto | null>(null)
  if (photos === undefined) return null
  return (
    <div className="grid grid-cols-2 gap-2">
      {(['pack', 'label'] as const).map((kind) => {
        const p = photos.find((x) => x.kind === kind)
        return p ? (
          <button key={kind} onClick={() => setOpen(p)} className="overflow-hidden rounded-xl text-left" aria-label={`${PRODUCT_KIND[kind]} photo`}>
            <FoodPhotoImg photo={p} alt={`${name}, ${PRODUCT_KIND[kind].toLowerCase()}`} className="aspect-square w-full" />
          </button>
        ) : (
          <AddPhotoButton key={kind} userId={userId} target={{ foodItemId }} kind={kind}
            className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-300 text-sm font-semibold text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            <span className="text-xl">+</span>
            <span>{PRODUCT_KIND[kind]}</span>
          </AddPhotoButton>
        )
      })}
      {open && <PhotoSheet photo={open} alt={name} onClose={() => setOpen(null)} />}
    </div>
  )
}

function PhotoSheet({ photo, alt, onClose }: { photo: FoodPhoto; alt: string; onClose: () => void }) {
  const remove = async () => {
    onClose()
    const undo = await deleteFoodPhoto(photo)
    offerUndo('Photo deleted', photo.id, undo)
  }
  return (
    <Sheet title={photo.taken_on ? `Photo · ${photo.taken_on}` : 'Photo'} onClose={onClose}>
      <FoodPhotoImg photo={photo} alt={alt} className="w-full rounded-2xl" />
      <div className="mt-4 flex justify-between text-sm">
        {photo.kind === 'dish' && !photo.is_cover ? (
          <button onClick={() => { void setCover(photo); onClose() }} className="font-semibold text-accent">Make cover</button>
        ) : <span className="text-zinc-500 dark:text-zinc-400">{photo.is_cover ? 'Cover photo' : ''}</span>}
        <button onClick={() => void remove()} className="font-semibold text-red-600 dark:text-red-400">Delete</button>
      </div>
    </Sheet>
  )
}
