import { useState } from 'react'

import { SectionTabs } from '../components/SectionTabs'
import type { Building, Item, ItemsSubTab } from '../data/types'

import { BuildingTile } from './items/components/BuildingTile'
import { ItemTile } from './items/components/ItemTile'

type ItemsTabProps = {
  items: Item[]
  buildings: Building[]
  itemLookup: Map<string, Item>
  buildingLookup: Map<string, Building>
}

const itemsTabs = [
  { id: 'items', label: 'Предметы' },
  { id: 'buildings', label: 'Строения' },
] as const

export function ItemsTab(props: ItemsTabProps) {
  const { items, buildings, itemLookup, buildingLookup } = props
  const [itemsSubTab, setItemsSubTab] = useState<ItemsSubTab>('items')

  return (
    <section className="panel">
      <SectionTabs value={itemsSubTab} onChange={(v) => setItemsSubTab(v as ItemsSubTab)} tabs={itemsTabs} />

      {itemsSubTab === 'items' && (
        <div className="tile-grid">
          {items.map((item) => (
            <ItemTile key={item.id} item={item} itemLookup={itemLookup} />
          ))}
        </div>
      )}

      {itemsSubTab === 'buildings' && (
        <div className="tile-grid">
          {buildings.map((building) => (
            <BuildingTile
              key={building.id}
              building={building}
              itemLookup={itemLookup}
              buildingLookup={buildingLookup}
            />
          ))}
        </div>
      )}
    </section>
  )
}
