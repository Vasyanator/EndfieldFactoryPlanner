import type { Item, NodeMetrics } from '../data/types'
import { craftPerSecond, getItemRecipeIngredients } from '../data/utils'

import type { PlanningEdge, PlanningNode } from './types'

export function buildOutgoingByNode(edges: PlanningEdge[]): Map<string, PlanningEdge[]> {
  const map = new Map<string, PlanningEdge[]>()
  for (const edge of edges) {
    const list = map.get(edge.fromId)
    if (list) list.push(edge)
    else map.set(edge.fromId, [edge])
  }
  return map
}

export function buildIncomingByNode(edges: PlanningEdge[]): Map<string, PlanningEdge[]> {
  const map = new Map<string, PlanningEdge[]>()
  for (const edge of edges) {
    const list = map.get(edge.toId)
    if (list) list.push(edge)
    else map.set(edge.toId, [edge])
  }
  return map
}

export function buildNodeProduction(
  nodes: PlanningNode[],
  itemLookup: Map<string, Item>,
  specialOutputsByNodeId?: Map<string, { itemId: string | null; cps: number }>,
): Map<string, { itemId: string | null; cps: number }> {
  const map = new Map<string, { itemId: string | null; cps: number }>()
  for (const node of nodes) {
    const special = specialOutputsByNodeId?.get(node.id)
    if (special) {
      map.set(node.id, { itemId: special.itemId, cps: special.cps })
      continue
    }
    const item = node.itemId ? itemLookup.get(node.itemId) ?? null : null
    const cps = item ? craftPerSecond(item) ?? 0 : 0
    map.set(node.id, { itemId: item?.id ?? null, cps })
  }
  return map
}

type NodeRequired = {
  producedItem: Item | null
  producedCps: number
  requiredByIngredient: Map<string, number>
}

export function buildNodeRequired(
  nodes: PlanningNode[],
  itemLookup: Map<string, Item>,
  nodeProduction: Map<string, { itemId: string | null; cps: number }>,
  ignoreIngredientsByNodeId?: Set<string>,
): Map<string, NodeRequired> {
  const map = new Map<string, NodeRequired>()

  for (const node of nodes) {
    const producedItem = node.itemId ? itemLookup.get(node.itemId) ?? null : null
    const producedCps = nodeProduction.get(node.id)?.cps ?? 0
    const requiredByIngredient = new Map<string, number>()
    const batchSize = Math.max(1, producedItem?.batch_size ?? 1)

    const ingredientEntries = ignoreIngredientsByNodeId?.has(node.id)
      ? []
      : Object.entries(producedItem ? getItemRecipeIngredients(producedItem, node.recipeIndex) : {})
    for (const [ingredientId, qty] of ingredientEntries) {
      const requiredPerSec = producedCps * (qty / batchSize)
      if (requiredPerSec > 0) {
        requiredByIngredient.set(ingredientId, requiredPerSec)
      }
    }

    map.set(node.id, { producedItem, producedCps, requiredByIngredient })
  }

  return map
}

export function buildEdgeSupplies(
  edges: PlanningEdge[],
  nodeProduction: Map<string, { itemId: string | null; cps: number }>,
  nodeRequired: Map<string, NodeRequired>,
  inputPortCapacity: number,
  specialInputNodeIds?: Set<string>,
): Map<string, number> {
  const outgoingByNode = buildOutgoingByNode(edges)

  const demandByEdgeId = new Map<string, number>()
  for (const edge of edges) {
    if (specialInputNodeIds?.has(edge.toId)) {
      demandByEdgeId.set(edge.id, inputPortCapacity)
      continue
    }
    const source = nodeProduction.get(edge.fromId)
    const ingredientId = source?.itemId ?? null
    if (!ingredientId) {
      demandByEdgeId.set(edge.id, 0)
      continue
    }
    const required = nodeRequired.get(edge.toId)?.requiredByIngredient.get(ingredientId) ?? 0
    demandByEdgeId.set(edge.id, Math.min(required, inputPortCapacity))
  }

  const supplyByEdgeId = new Map<string, number>()

  for (const [fromId, outgoing] of outgoingByNode.entries()) {
    const source = nodeProduction.get(fromId)
    const supplyTotal = source?.cps ?? 0
    if (!supplyTotal || supplyTotal <= 0) {
      for (const edge of outgoing) supplyByEdgeId.set(edge.id, 0)
      continue
    }

    let totalDemand = 0
    for (const edge of outgoing) totalDemand += demandByEdgeId.get(edge.id) ?? 0

    if (totalDemand <= 0) {
      for (const edge of outgoing) supplyByEdgeId.set(edge.id, 0)
      continue
    }

    if (supplyTotal >= totalDemand) {
      for (const edge of outgoing) {
        supplyByEdgeId.set(edge.id, demandByEdgeId.get(edge.id) ?? 0)
      }
      continue
    }

    const scale = supplyTotal / totalDemand
    for (const edge of outgoing) {
      const demand = demandByEdgeId.get(edge.id) ?? 0
      supplyByEdgeId.set(edge.id, demand * scale)
    }
  }

  return supplyByEdgeId
}

export function buildNodeMetrics(
  nodes: PlanningNode[],
  edges: PlanningEdge[],
  itemLookup: Map<string, Item>,
  nodeProduction: Map<string, { itemId: string | null; cps: number }>,
  inputPortCapacity: number,
  ignoreIngredientsByNodeId?: Set<string>,
  specialInputNodeIds?: Set<string>,
): Map<string, NodeMetrics> {
  const metrics = new Map<string, NodeMetrics>()
  const incomingByNode = buildIncomingByNode(edges)
  const nodeRequired = buildNodeRequired(nodes, itemLookup, nodeProduction, ignoreIngredientsByNodeId)
  const supplyByEdgeId = buildEdgeSupplies(
    edges,
    nodeProduction,
    nodeRequired,
    inputPortCapacity,
    specialInputNodeIds,
  )

  for (const node of nodes) {
    const required = nodeRequired.get(node.id)
    const producedItem = required?.producedItem ?? null
    const producedCps = required?.producedCps ?? 0
    const batchSize = Math.max(1, producedItem?.batch_size ?? 1)

    const ingredientEntries = ignoreIngredientsByNodeId?.has(node.id)
      ? []
      : Object.entries(producedItem ? getItemRecipeIngredients(producedItem, node.recipeIndex) : {})
    ingredientEntries.sort(([a], [b]) => a.localeCompare(b, 'ru'))

    const ingredients = ingredientEntries.slice(0, 4).map(([ingredientId, qty]) => {
      const requiredPerSec = producedCps * (qty / batchSize)
      const incoming = incomingByNode.get(node.id) ?? []
      let suppliedPerSec = 0
      let hasAnySupply = false
      for (const edge of incoming) {
        const source = nodeProduction.get(edge.fromId)
        if (!source) continue
        if (source.itemId !== ingredientId) continue
        const supply = supplyByEdgeId.get(edge.id) ?? 0
        if (supply > 1e-9) hasAnySupply = true
        suppliedPerSec += supply
      }

      const ingredientItem = itemLookup.get(ingredientId) ?? null
      const missing = requiredPerSec > 0 && !hasAnySupply
      const shortage = requiredPerSec > 0 && hasAnySupply && suppliedPerSec + 1e-6 < requiredPerSec

      return {
        id: ingredientId,
        item: ingredientItem,
        qty,
        requiredPerSec,
        suppliedPerSec,
        missing,
        shortage,
      }
    })

    metrics.set(node.id, {
      producedItem,
      producedCps,
      ingredients,
    })
  }

  return metrics
}
