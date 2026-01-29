import type { Building, BuildingsPayload, Item, ItemsPayload } from './types'

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

export function normalizeItems(payload: ItemsPayload): Item[] {
  if (Array.isArray(payload)) return payload
  return payload.items ?? []
}

export function normalizeBuildings(payload: BuildingsPayload): Building[] {
  if (Array.isArray(payload)) return payload
  return payload.buildings ?? []
}

export function craftPerSecond(item: Item): number | null {
  if (item.is_ore) return null
  const batch = item.batch_size ?? 1
  const time = item.craft_time ?? 0
  if (!time || time <= 0) return null
  return batch / time
}

export function getItemRecipeVariants(item: Item): Record<string, number>[] {
  const base = item.ingredients ?? {}
  const alt = item.alt_recipes ?? []
  return [base, ...alt]
}

export function getItemRecipeIngredients(
  item: Item,
  recipeIndex?: number | null,
): Record<string, number> {
  const variants = getItemRecipeVariants(item)
  if (variants.length === 0) return {}
  const rawIndex = typeof recipeIndex === 'number' && Number.isFinite(recipeIndex) ? recipeIndex : 0
  const index = Math.min(Math.max(rawIndex, 0), variants.length - 1)
  return variants[index] ?? {}
}

export function formatCps(value: number | null): string {
  if (value == null) return '—'
  const rounded = value.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '')
  return `${rounded} шт/сек`
}

export function formatRate(value: number): string {
  const rounded = value.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '')
  return `${rounded}/сек`
}

export function itemImageSrc(item: Item): string | null {
  if (!item.image) return null
  return `./data/items/${item.image}`
}

export function buildingImageSrc(building: Building): string | null {
  if (!building.image) return null
  return `./data/buildings/${building.image}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
