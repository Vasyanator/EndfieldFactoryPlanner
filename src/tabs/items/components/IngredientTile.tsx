type IngredientTileProps = {
  name: string
  imageSrc: string | null
  qty: number
}

export function IngredientTile(props: IngredientTileProps) {
  const { name, imageSrc, qty } = props
  return (
    <div className="ingredient-tile">
      <div className="ingredient-tile__name" title={name}>
        {name}
      </div>
      <div className="ingredient-tile__image">
        {imageSrc ? <img src={imageSrc} alt={name} loading="lazy" /> : <span>—</span>}
      </div>
      <div className="ingredient-tile__qty">x{qty}</div>
    </div>
  )
}
