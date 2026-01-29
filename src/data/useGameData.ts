import { useEffect, useMemo, useState } from 'react'

import type { Building, BuildingsPayload, Item, ItemsPayload } from './types'
import { fetchJson, normalizeBuildings, normalizeItems } from './utils'

export type GameData = {
  items: Item[]
  buildings: Building[]
  itemLookup: Map<string, Item>
  buildingLookup: Map<string, Building>
  buildingItems: Map<string, Item[]>
  planningBuildings: Building[]
  loading: boolean
  error: string | null
}

export function useGameData(): GameData {
  const [items, setItems] = useState<Item[]>([])
  const [buildings, setBuildings] = useState<Building[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const [itemsPayload, buildingsPayload] = await Promise.all([
          fetchJson<ItemsPayload>('./data/items/data.json'),
          fetchJson<BuildingsPayload>('./data/buildings/data.json'),
        ])

        if (cancelled) return

        const normalizedItems = normalizeItems(itemsPayload).slice()
        normalizedItems.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ru'))

        const normalizedBuildings = normalizeBuildings(buildingsPayload).slice()
        normalizedBuildings.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ru'))

        setItems(normalizedItems)
        setBuildings(normalizedBuildings)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const itemLookup = useMemo(() => {
    const map = new Map<string, Item>()
    for (const item of items) map.set(item.id, item)
    return map
  }, [items])

  const buildingLookup = useMemo(() => {
    const map = new Map<string, Building>()
    for (const building of buildings) map.set(building.id, building)
    return map
  }, [buildings])

  const buildingByName = useMemo(() => {
    const map = new Map<string, Building>()
    for (const building of buildings) {
      if (building.name) map.set(building.name, building)
    }
    return map
  }, [buildings])

  const buildingItems = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const building of buildings) map.set(building.id, [])

    for (const item of items) {
      const buildingName = item.crafted_in ?? null
      if (!buildingName) continue
      const building = buildingByName.get(buildingName)
      if (!building) continue
      const list = map.get(building.id)
      if (!list) continue
      list.push(item)
    }

    for (const list of map.values()) {
      list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ru'))
    }

    return map
  }, [buildings, items, buildingByName])

  const planningBuildings = useMemo(() => buildings.filter((b) => b.is_factory), [buildings])

  return {
    items,
    buildings,
    itemLookup,
    buildingLookup,
    buildingItems,
    planningBuildings,
    loading,
    error,
  }
}
