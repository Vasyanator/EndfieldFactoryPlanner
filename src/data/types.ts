export type Item = {
  id: string
  name?: string
  image?: string
  crafted_in?: string | null
  ingredients?: Record<string, number>
  alt_recipes?: Record<string, number>[]
  batch_size?: number
  craft_time?: number
  is_ore?: boolean
}

export type Building = {
  id: string
  name?: string
  image?: string
  type?: string | null
  ingredients?: Record<string, number>
  is_factory?: boolean
  energy_use?: number
  size_w?: number
  size_h?: number
}

export type ItemsPayload = { items: Item[] } | Item[]
export type BuildingsPayload = { buildings: Building[] } | Building[]

export type TopTab = 'items' | 'planning' | 'construction'
export type ItemsSubTab = 'items' | 'buildings'

export type NodeIngredientMetrics = {
  id: string
  item: Item | null
  qty: number
  requiredPerSec: number
  suppliedPerSec: number
  missing: boolean
  shortage: boolean
}

export type NodeMetrics = {
  producedItem: Item | null
  producedCps: number
  ingredients: NodeIngredientMetrics[]
}
