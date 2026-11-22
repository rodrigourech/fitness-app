import { db, type FoodPhoto } from './db'
import { saveRows } from './sync'
import { requireLiveWrites } from './environment'
import { download, shrink, uploadPendingPhotos } from './photos'

// Photos of recipes and products (decision Rodrigo 22 November 2026, migration 0053).
// - Recipes: several dish photos, one of them the cover (first photo becomes the cover).
// - Products in the staples: front of the package (pack) and nutrition table (label).
// - Food photos are not sensitive: no passphrase, stored unencrypted in the same private bucket as the
//   progress photos (key <user_id>/<id>), uploaded through the auth proxy; shrunk first, which drops EXIF and GPS.
// - Delete moves the photo to the trash like everything else; the object is removed after 30 days (purgeExpired).

const DISH_EDGE = 1200
const PRODUCT_EDGE = 800
const MIME = 'image/jpeg'

export type FoodPhotoTarget = { recipeId: string } | { foodItemId: string }

function owned(target: FoodPhotoTarget): Pick<FoodPhoto, 'recipe_id' | 'food_item_id'> {
  return 'recipeId' in target ? { recipe_id: target.recipeId, food_item_id: null } : { recipe_id: null, food_item_id: target.foodItemId }
}

/** Live photos of a recipe: cover first, then newest first. */
export function sortDishPhotos(photos: FoodPhoto[]): FoodPhoto[] {
  return photos
    .filter((p) => p.deleted_at === null)
    .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || b.created_at.localeCompare(a.created_at))
}

export async function recipePhotos(recipeId: string): Promise<FoodPhoto[]> {
  return sortDishPhotos(await db.food_photo.where('recipe_id').equals(recipeId).toArray())
}

export async function productPhotos(foodItemId: string): Promise<FoodPhoto[]> {
  const rows = await db.food_photo.where('food_item_id').equals(foodItemId).toArray()
  return rows.filter((p) => p.deleted_at === null).sort((a, b) => a.kind.localeCompare(b.kind) || b.created_at.localeCompare(a.created_at))
}

/** Cover photo per recipe id (recipes without photos are missing). */
export async function recipeCovers(): Promise<Map<string, FoodPhoto>> {
  const map = new Map<string, FoodPhoto>()
  for (const p of sortDishPhotos((await db.food_photo.toArray()).filter((p) => p.recipe_id !== null))) {
    if (!map.has(p.recipe_id!)) map.set(p.recipe_id!, p)
  }
  return map
}

/** Shrinks and stores a photo; uploads now or as soon as the device is online. */
export async function addFoodPhoto(userId: string, target: FoodPhotoTarget, kind: FoodPhoto['kind'], file: Blob, today: string): Promise<FoodPhoto> {
  requireLiveWrites()
  const { blob, width, height } = await shrink(file, kind === 'dish' ? DISH_EDGE : PRODUCT_EDGE)
  const data = await blob.arrayBuffer()
  const id = crypto.randomUUID()
  const ts = new Date().toISOString()
  const isCover = kind === 'dish' && 'recipeId' in target && (await recipePhotos(target.recipeId)).length === 0
  const row: FoodPhoto = {
    id,
    user_id: userId,
    ...owned(target),
    kind,
    is_cover: isCover,
    taken_on: today,
    mime: MIME,
    width,
    height,
    bytes: data.byteLength,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
  }
  await db.photo_blob.put({ id, data, uploaded: 0 })
  await saveRows('food_photo', [row])
  void uploadPendingPhotos()
  return row
}

/** Makes one dish photo the cover of its recipe. */
export async function setCover(photo: FoodPhoto): Promise<void> {
  if (!photo.recipe_id) return
  const ts = new Date().toISOString()
  const changed = (await recipePhotos(photo.recipe_id))
    .filter((p) => p.is_cover !== (p.id === photo.id))
    .map((p) => ({ ...p, is_cover: p.id === photo.id, updated_at: ts }))
  if (changed.length) await saveRows('food_photo', changed)
}

/** Moves a photo to the trash; a deleted cover passes to the newest remaining photo. Returns undo. */
export async function deleteFoodPhoto(photo: FoodPhoto): Promise<() => Promise<void>> {
  const ts = new Date().toISOString()
  const rows: FoodPhoto[] = [{ ...photo, deleted_at: ts, updated_at: ts }]
  let heir: FoodPhoto | null = null
  if (photo.is_cover && photo.recipe_id) {
    heir = (await recipePhotos(photo.recipe_id)).find((p) => p.id !== photo.id) ?? null
    if (heir) rows.push({ ...heir, is_cover: true, updated_at: ts })
  }
  await saveRows('food_photo', rows)
  return async () => {
    const back = new Date().toISOString()
    const restore: FoodPhoto[] = [{ ...photo, deleted_at: null, updated_at: back }]
    if (heir) restore.push({ ...heir, is_cover: false, updated_at: back })
    await saveRows('food_photo', restore)
  }
}

/** Image bytes from this device or downloaded (and kept) from the bucket. */
export async function foodPhotoBytes(photo: FoodPhoto): Promise<ArrayBuffer> {
  let data = (await db.photo_blob.get(photo.id))?.data
  if (!data) {
    data = await download(photo.id)
    await db.photo_blob.put({ id: photo.id, data, uploaded: 1 })
  }
  return data
}

/** Photo as an object URL (revoke it when no longer shown). */
export async function foodPhotoUrl(photo: FoodPhoto): Promise<string> {
  return URL.createObjectURL(new Blob([await foodPhotoBytes(photo)], { type: photo.mime }))
}
