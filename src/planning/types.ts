export type PlanningNode = {
  id: string
  buildingId: string
  x: number
  y: number
  itemId: string | null
  recipeIndex: number
}

export type PlanningEdge = {
  id: string
  fromId: string
  toId: string
  toPortIndex: number
}

export type CanvasTransform = {
  x: number
  y: number
  scale: number
}
