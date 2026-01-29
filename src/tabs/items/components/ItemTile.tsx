import { useMemo } from 'react'

import type { Item } from '../../../data/types'
import { craftPerSecond, formatCps, itemImageSrc } from '../../../data/utils'

import { IngredientTile } from './IngredientTile'

type ItemTileProps = {
  item: Item
  itemLookup: Map<string, Item>
}

export function ItemTile(props: ItemTileProps) {
  const { item, itemLookup } = props
  const title = item.name || '(без названия)'
  const isOre = Boolean(item.is_ore)
  const cps = craftPerSecond(item)
  const cpsText = formatCps(cps)

  const ingredients = useMemo(() => {
    const entries = Object.entries(item.ingredients ?? {})
    entries.sort(([a], [b]) => a.localeCompare(b, 'ru'))
    return entries.slice(0, 4).map(([id, qty]) => {
      const ing = itemLookup.get(id)
      const name = ing?.name || id
      const imageSrc = ing ? itemImageSrc(ing) : null
      return { id, qty, name, imageSrc }
    })
  }, [item.ingredients, itemLookup])

  return (
    <article className="tile">
      <div className="tile__header">
        <div className="tile__image" aria-hidden={!item.image}>
          {item.image ? (
            <img src={itemImageSrc(item) ?? undefined} alt={title} loading="lazy" />
          ) : (
            <span className="tile__image-fallback">Нет картинки</span>
          )}
        </div>
        <h3 className="tile__title">{title}</h3>
      </div>

      {!isOre && ingredients.length > 0 && (
        <div className="ingredients-row">
          {ingredients.map((ing) => (
            <IngredientTile key={ing.id} name={ing.name} imageSrc={ing.imageSrc} qty={ing.qty} />
          ))}
          <div className="ingredients-row__spacer" />
        </div>
      )}

      <div className="tile__info-grid">
        {!isOre && (
          <>
            <div className="info-chip">
              <div className="info-chip__label">Производитель</div>
              <div className="info-chip__value">{item.crafted_in ?? 'нет'}</div>
            </div>
            <div className="info-chip">
              <div className="info-chip__label">Количество изготовления</div>
              <div className="info-chip__value">{item.batch_size ?? 1}</div>
            </div>
            <div className="info-chip">
              <div className="info-chip__label">Время изготовления</div>
              <div className="info-chip__value">{item.craft_time ?? '—'} сек</div>
            </div>
            <div className="info-chip info-chip--accent">
              <div className="info-chip__label">Производство в секунду</div>
              <div className="info-chip__value">{cpsText}</div>
            </div>
          </>
        )}
        <div className={isOre ? 'info-chip info-chip--ore' : 'info-chip'}>
          <div className="info-chip__label">Это руда</div>
          <div className="info-chip__value">{isOre ? 'да' : 'нет'}</div>
        </div>
      </div>
    </article>
  )
}
