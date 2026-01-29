type SizeGridProps = { w: number; h: number }

export function SizeGrid(props: SizeGridProps) {
  const { w, h } = props
  const cells = Array.from({ length: w * h })
  return (
    <div
      className="size-grid"
      style={{ gridTemplateColumns: `repeat(${w}, var(--size-cell))` }}
      aria-label={`Размер ${w} на ${h}`}
    >
      {cells.map((_, idx) => (
        <div key={idx} className="size-grid__cell" />
      ))}
    </div>
  )
}
