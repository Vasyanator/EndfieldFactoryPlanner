import { useMemo } from 'react'

import type { Building, Item } from '../../../data/types'
import { buildingImageSrc, itemImageSrc } from '../../../data/utils'

import { IngredientTile } from './IngredientTile'
import { SizeGrid } from './SizeGrid'

type BuildingTileProps = {
  building: Building
  itemLookup: Map<string, Item>
  buildingLookup: Map<string, Building>
}

export function BuildingTile(props: BuildingTileProps) {
  const { building, itemLookup, buildingLookup } = props
  const title = building.name || '(без названия)'
  const isFactory = Boolean(building.is_factory)
  const sizeW = Math.max(1, building.size_w ?? 1)
  const sizeH = Math.max(1, building.size_h ?? 1)

  const ingredients = useMemo(() => {
    const entries = Object.entries(building.ingredients ?? {})
    entries.sort(([a], [b]) => a.localeCompare(b, 'ru'))
    return entries.slice(0, 4).map(([id, qty]) => {
      const item = itemLookup.get(id)
      const otherBuilding = buildingLookup.get(id)
      if (item) {
        return { id, qty, name: item.name || item.id, imageSrc: itemImageSrc(item) }
      }
      if (otherBuilding) {
        return {
          id,
          qty,
          name: otherBuilding.name || otherBuilding.id,
          imageSrc: buildingImageSrc(otherBuilding),
        }
      }
      return { id, qty, name: id, imageSrc: null }
    })
  }, [building.ingredients, itemLookup, buildingLookup])

  const energyText = building.energy_use ?? '—'
  const sizeText = `${sizeW}×${sizeH}`

  return (
    <article className="tile">
      <div className="tile__header">
        <div className="tile__image" aria-hidden={!building.image}>
          {building.image ? (
            <img src={buildingImageSrc(building) ?? undefined} alt={title} loading="lazy" />
          ) : (
            <span className="tile__image-fallback">Нет картинки</span>
          )}
        </div>
        <h3 className="tile__title">{title}</h3>
      </div>

      {ingredients.length > 0 && (
        <div className="ingredients-row">
          {ingredients.map((ing) => (
            <IngredientTile key={ing.id} name={ing.name} imageSrc={ing.imageSrc} qty={ing.qty} />
          ))}
          <div className="ingredients-row__spacer" />
        </div>
      )}

      <div className="size-row">
        <span className="size-row__label">Размер:</span>
        <SizeGrid w={sizeW} h={sizeH} />
      </div>

      <div className="tile__info-grid">
        <div className="info-chip">
          <div className="info-chip__label">Является фабрикой</div>
          <div className="info-chip__value">{isFactory ? 'да' : 'нет'}</div>
        </div>
        {isFactory && (
          <div className="info-chip">
            <div className="info-chip__label">Потребление энергии</div>
            <div className="info-chip__value">{energyText}</div>
          </div>
        )}
        <div className="info-chip info-chip--full">
          <div className="info-chip__label">Размер</div>
          <div className="info-chip__value">{sizeText}</div>
        </div>
      </div>
    </article>
  )
}
