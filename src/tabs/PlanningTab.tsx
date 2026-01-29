import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { Building, Item } from '../data/types'
import {
  buildingImageSrc,
  clamp,
  craftPerSecond,
  formatCps,
  formatRate,
  getItemRecipeIngredients,
  getItemRecipeVariants,
  itemImageSrc,
} from '../data/utils'
import {
  INPUT_PORT_CAPACITY,
  MAX_SCALE,
  MIN_SCALE,
  NODE_HEIGHT,
  NODE_WIDTH,
  PORT_OFFSET_X,
  PORT_OFFSET_Y,
} from '../planning/constants'
import { buildEdgeSupplies, buildNodeMetrics, buildNodeProduction, buildNodeRequired } from '../planning/metrics'
import type { CanvasTransform, PlanningEdge, PlanningNode } from '../planning/types'

type PlanningTabProps = {
  items: Item[]
  buildings: Building[]
  itemLookup: Map<string, Item>
  buildingLookup: Map<string, Building>
  buildingItems: Map<string, Item[]>
  planningBuildings: Building[]
  isActive: boolean
}

const BUILDING_TYPE_TABS = [
  { id: 'Доступ к складу', label: 'Доступ к складу' },
  { id: 'Производство 1', label: 'Производство 1' },
  { id: 'Производство 2', label: 'Производство 2' },
  { id: 'Статистика строений', label: 'Статистика строений' },
] as const

const WAREHOUSE_OUTPUT_ID = '__warehouse_output__'
const WAREHOUSE_INPUT_ID = '__warehouse_input__'
const ALT_RECIPE_EXTRA_HEIGHT = 36

type BuildingTypeTab = (typeof BUILDING_TYPE_TABS)[number]['id']

function formatEnergy(value: number): string {
  const rounded = value.toFixed(3).replace(/0+$/g, '').replace(/\.$/, '')
  return rounded
}

export function PlanningTab(props: PlanningTabProps) {
  const { items, buildings, itemLookup, buildingLookup, buildingItems, planningBuildings, isActive } = props

  const [nodes, setNodes] = useState<PlanningNode[]>([])
  const [edges, setEdges] = useState<PlanningEdge[]>([])
  const [transform, setTransform] = useState<CanvasTransform>({ x: 0, y: 0, scale: 1 })
  const [draftLink, setDraftLink] = useState<{
    fromId: string
    pointerId: number
    start: { x: number; y: number }
    current: { x: number; y: number }
  } | null>(null)
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null)
  const [placingNodeId, setPlacingNodeId] = useState<string | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [panelTab, setPanelTab] = useState<BuildingTypeTab>(BUILDING_TYPE_TABS[0].id)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false)
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [selectionBox, setSelectionBox] = useState<{
    pointerId: number
    start: { x: number; y: number }
    current: { x: number; y: number }
  } | null>(null)

  const nextNodeIdRef = useRef(1)
  const nextEdgeIdRef = useRef(1)
  const warehouseOutputIdRef = useRef(1)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const cursorWorldRef = useRef<{ x: number; y: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const worldRef = useRef<HTMLDivElement | null>(null)

  const panRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const dragRef = useRef<{
    pointerId: number
    nodeIds: string[]
    startWorldX: number
    startWorldY: number
    origins: Map<string, { x: number; y: number }>
  } | null>(null)

  useEffect(() => {
    if (!isActive) return
    const viewport = viewportRef.current
    if (!viewport) return
    if (transform.x !== 0 || transform.y !== 0) return
    const rect = viewport.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    setTransform((prev) => {
      if (prev.x !== 0 || prev.y !== 0) return prev
      return { ...prev, x: rect.width / 2, y: rect.height / 2 }
    })
  }, [isActive, transform.x, transform.y])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    function handleWheelEvent(e: WheelEvent) {
      e.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      const zoomDirection = e.deltaY > 0 ? -1 : 1
      const zoomFactor = zoomDirection > 0 ? 1.1 : 0.92

      setTransform((prev) => {
        const nextScale = clamp(prev.scale * zoomFactor, MIN_SCALE, MAX_SCALE)
        const worldX = (sx - prev.x) / prev.scale
        const worldY = (sy - prev.y) / prev.scale
        return {
          x: sx - worldX * nextScale,
          y: sy - worldY * nextScale,
          scale: nextScale,
        }
      })
    }

    viewport.addEventListener('wheel', handleWheelEvent, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheelEvent)
  }, [])

  useEffect(() => {
    if (nodes.length > 0) return
    const firstFactory = buildings.find((b) => b.is_factory)
    if (!firstFactory) return
    setNodes([
      {
        id: `node-${nextNodeIdRef.current++}`,
        buildingId: firstFactory.id,
        x: -NODE_WIDTH / 2,
        y: -NODE_HEIGHT / 2,
        itemId: null,
        recipeIndex: 0,
      },
    ])
  }, [nodes.length, buildings])

  const nodeLookup = useMemo(() => {
    const map = new Map<string, PlanningNode>()
    for (const node of nodes) map.set(node.id, node)
    return map
  }, [nodes])

  const buildingByName = useMemo(() => {
    const map = new Map<string, Building>()
    for (const building of buildings) {
      if (building.name) map.set(building.name, building)
    }
    return map
  }, [buildings])

  const warehouseOutputs = useMemo(() => {
    const map = new Map<string, { itemId: string | null; cps: number }>()
    for (const node of nodes) {
      if (node.buildingId !== WAREHOUSE_OUTPUT_ID) continue
      map.set(node.id, { itemId: node.itemId ?? null, cps: node.itemId ? 0.5 : 0 })
    }
    return map
  }, [nodes])

  const warehouseOutputNodes = useMemo(() => {
    const set = new Set<string>()
    for (const node of nodes) {
      if (node.buildingId === WAREHOUSE_OUTPUT_ID) {
        set.add(node.id)
      }
    }
    return set
  }, [nodes])

  const warehouseInputNodes = useMemo(() => {
    const set = new Set<string>()
    for (const node of nodes) {
      if (node.buildingId === WAREHOUSE_INPUT_ID) {
        set.add(node.id)
      }
    }
    return set
  }, [nodes])

  const nodeProduction = useMemo(
    () => buildNodeProduction(nodes, itemLookup, warehouseOutputs),
    [nodes, itemLookup, warehouseOutputs],
  )

  const nodeMetrics = useMemo(
    () =>
      buildNodeMetrics(
        nodes,
        edges,
        itemLookup,
        nodeProduction,
        INPUT_PORT_CAPACITY,
        new Set([...warehouseOutputNodes, ...warehouseInputNodes]),
        warehouseInputNodes,
      ),
    [nodes, edges, itemLookup, nodeProduction, warehouseOutputNodes, warehouseInputNodes],
  )

  const inputSlotCountByNode = useMemo(() => {
    const map = new Map<string, number>()

    for (const node of nodes) {
      if (node.buildingId === WAREHOUSE_INPUT_ID) {
        map.set(node.id, 1)
        continue
      }
      const metrics = nodeMetrics.get(node.id)
      const producedItem = metrics?.producedItem ?? null
      const producedCps = metrics?.producedCps ?? 0
      const ingredients = Object.entries(
        producedItem ? getItemRecipeIngredients(producedItem, node.recipeIndex) : {},
      )
      const batchSize = Math.max(1, producedItem?.batch_size ?? 1)

      let slots = 0
      for (const [, qty] of ingredients) {
        const requiredPerSec = producedCps * (qty / batchSize)
        if (requiredPerSec <= 0) continue
        slots += Math.ceil(requiredPerSec / INPUT_PORT_CAPACITY)
      }

      map.set(node.id, Math.max(1, slots))
    }

    return map
  }, [nodes, nodeMetrics])

  const occupiedInputSlotsByNode = useMemo(() => {
    const map = new Map<string, Set<number>>()
    for (const edge of edges) {
      if (warehouseInputNodes.has(edge.toId)) continue
      let set = map.get(edge.toId)
      if (!set) {
        set = new Set<number>()
        map.set(edge.toId, set)
      }
      set.add(edge.toPortIndex)
    }
    return map
  }, [edges])

  useEffect(() => {
    setEdges((prev) => {
      const next = prev.filter((edge) => {
        const slotCount = inputSlotCountByNode.get(edge.toId) ?? 1
        return edge.toPortIndex >= 0 && edge.toPortIndex < slotCount
      })
      return next.length === prev.length ? prev : next
    })
  }, [inputSlotCountByNode])

  const factoriesByType = useMemo(() => {
    const map = new Map<BuildingTypeTab, Building[]>()
    for (const tab of BUILDING_TYPE_TABS) {
      map.set(tab.id, [])
    }

    for (const building of planningBuildings) {
      const type = building.type
      if (!type) continue
      if (!map.has(type as BuildingTypeTab)) continue
      map.get(type as BuildingTypeTab)!.push(building)
    }

    for (const list of map.values()) {
      list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ru'))
    }

    return map
  }, [planningBuildings])

  const isStatsTab = panelTab === 'Статистика строений'
  const panelBuildings = isStatsTab ? [] : (factoriesByType.get(panelTab) ?? [])
  const warehouseTile =
    !isStatsTab && panelTab === 'Доступ к складу'
      ? { id: WAREHOUSE_OUTPUT_ID, name: 'Выгрузка со склада', image: null as string | null }
      : null

  const warehouseInputTile =
    !isStatsTab && panelTab === 'Доступ к складу'
      ? { id: WAREHOUSE_INPUT_ID, name: 'Загрузка на склад', image: null as string | null }
      : null

  const buildingUsage = useMemo(() => {
    const countById = new Map<string, number>()
    for (const node of nodes) {
      const building = buildingLookup.get(node.buildingId)
      if (!building) continue
      countById.set(building.id, (countById.get(building.id) ?? 0) + 1)
    }
    const list = planningBuildings
      .slice()
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ru'))
      .map((building) => ({
        building,
        count: countById.get(building.id) ?? 0,
      }))
    const totalEnergy = list.reduce(
      (sum, entry) => sum + (entry.building.energy_use ?? 0) * entry.count,
      0,
    )
    return { list, totalEnergy }
  }, [nodes, buildingLookup])

  const itemsByName = useMemo(() => {
    const list = items.slice()
    list.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'ru'))
    return list
  }, [items])

  const nodeHeightById = useMemo(() => {
    const map = new Map<string, number>()
    for (const node of nodes) {
      const item = node.itemId ? itemLookup.get(node.itemId) ?? null : null
      const hasAltRecipe = item ? getItemRecipeVariants(item).length > 1 : false
      map.set(node.id, NODE_HEIGHT + (hasAltRecipe ? ALT_RECIPE_EXTRA_HEIGHT : 0))
    }
    return map
  }, [nodes, itemLookup])

  const warehouseOutputPool = useMemo(() => {
    const pool = new Map<string, number>()
    for (const { itemId, cps } of warehouseOutputs.values()) {
      if (!itemId || cps <= 0) continue
      pool.set(itemId, (pool.get(itemId) ?? 0) + cps)
    }
    return pool
  }, [warehouseOutputs])

  const edgeSupplies = useMemo(() => {
    const nodeRequired = buildNodeRequired(
      nodes,
      itemLookup,
      nodeProduction,
      new Set([...warehouseOutputNodes, ...warehouseInputNodes]),
    )
    return buildEdgeSupplies(
      edges,
      nodeProduction,
      nodeRequired,
      INPUT_PORT_CAPACITY,
      warehouseInputNodes,
    )
  }, [nodes, edges, itemLookup, nodeProduction, warehouseOutputNodes, warehouseInputNodes])

  const warehouseInputPool = useMemo(() => {
    const pool = new Map<string, number>()
    for (const edge of edges) {
      if (!warehouseInputNodes.has(edge.toId)) continue
      const source = nodeProduction.get(edge.fromId)
      const itemId = source?.itemId ?? null
      if (!itemId) continue
      const supply = edgeSupplies.get(edge.id) ?? 0
      if (supply <= 0) continue
      pool.set(itemId, (pool.get(itemId) ?? 0) + supply)
    }
    return pool
  }, [edges, nodeProduction, warehouseInputNodes, edgeSupplies])

  const netConsumptionPool = useMemo(() => {
    const pool = new Map<string, number>()
    const itemIds = new Set([...warehouseOutputPool.keys(), ...warehouseInputPool.keys()])
    for (const itemId of itemIds) {
      const value = (warehouseOutputPool.get(itemId) ?? 0) - (warehouseInputPool.get(itemId) ?? 0)
      if (value > 1e-6) pool.set(itemId, value)
    }
    return pool
  }, [warehouseOutputPool, warehouseInputPool])

  const netProductionPool = useMemo(() => {
    const pool = new Map<string, number>()
    const itemIds = new Set([...warehouseOutputPool.keys(), ...warehouseInputPool.keys()])
    for (const itemId of itemIds) {
      const value = (warehouseInputPool.get(itemId) ?? 0) - (warehouseOutputPool.get(itemId) ?? 0)
      if (value > 1e-6) pool.set(itemId, value)
    }
    return pool
  }, [warehouseOutputPool, warehouseInputPool])

  const netConsumptionList = useMemo(() => {
    const list: { id: string; item: Item | null; rate: number }[] = []
    for (const [id, rate] of netConsumptionPool.entries()) {
      list.push({ id, item: itemLookup.get(id) ?? null, rate })
    }
    list.sort((a, b) => {
      const nameA = a.item?.name || a.id
      const nameB = b.item?.name || b.id
      return nameA.localeCompare(nameB, 'ru')
    })
    return list
  }, [netConsumptionPool, itemLookup])

  const netProductionList = useMemo(() => {
    const list: { id: string; item: Item | null; rate: number }[] = []
    for (const [id, rate] of netProductionPool.entries()) {
      list.push({ id, item: itemLookup.get(id) ?? null, rate })
    }
    list.sort((a, b) => {
      const nameA = a.item?.name || a.id
      const nameB = b.item?.name || b.id
      return nameA.localeCompare(nameB, 'ru')
    })
    return list
  }, [netProductionPool, itemLookup])

  const menuData = useMemo(() => {
    if (!menuNodeId) return null
    const node = nodeLookup.get(menuNodeId)
    if (!node) return null
    const isWarehouseOutput = node.buildingId === WAREHOUSE_OUTPUT_ID
    const isWarehouseInput = node.buildingId === WAREHOUSE_INPUT_ID
    if (isWarehouseInput) return null
    const building =
      isWarehouseOutput
        ? null
        : node.buildingId === WAREHOUSE_OUTPUT_ID
          ? null
          : buildingLookup.get(node.buildingId) ?? null
    const recipes = building ? buildingItems.get(building.id) ?? [] : []
    const items = isWarehouseOutput ? itemsByName : recipes
    if (items.length === 0) return null
    return { node, items, isWarehouseOutput }
  }, [menuNodeId, nodeLookup, buildingLookup, buildingItems, itemsByName])

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } | null {
    const viewport = viewportRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    return {
      x: (sx - transform.x) / transform.scale,
      y: (sy - transform.y) / transform.scale,
    }
  }

  function nodeInputPort(
    node: PlanningNode,
    slotIndex: number,
    slotCount: number,
  ): { x: number; y: number } {
    const height = nodeHeightById.get(node.id) ?? NODE_HEIGHT
    const step = height / (slotCount + 1)
    return {
      x: node.x - PORT_OFFSET_X,
      y: node.y + step * (slotIndex + 1),
    }
  }

  function nodeOutputPort(node: PlanningNode): { x: number; y: number } {
    const height = nodeHeightById.get(node.id) ?? NODE_HEIGHT
    return { x: node.x + NODE_WIDTH + PORT_OFFSET_X, y: node.y + height / 2 }
  }

  function addNode(buildingId: string) {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const centerScreenX = rect.width / 2
    const centerScreenY = rect.height / 2
    const fallbackWorldX = (centerScreenX - transform.x) / transform.scale
    const fallbackWorldY = (centerScreenY - transform.y) / transform.scale
    const spawnWorld = cursorWorldRef.current ?? { x: fallbackWorldX, y: fallbackWorldY }

    if (buildingId === WAREHOUSE_OUTPUT_ID || buildingId === WAREHOUSE_INPUT_ID) {
      const worldX = spawnWorld.x - NODE_WIDTH / 2
      const worldY = spawnWorld.y - NODE_HEIGHT / 2

      const nextNode: PlanningNode = {
        id: `${buildingId === WAREHOUSE_OUTPUT_ID ? 'warehouse-out' : 'warehouse-in'}-${warehouseOutputIdRef.current++}`,
        buildingId,
        x: worldX,
        y: worldY,
        itemId: null,
        recipeIndex: 0,
      }

      setNodes((prev) => [...prev, nextNode])
      setPlacingNodeId(nextNode.id)
      setMenuNodeId(null)
      return
    }

    const building = buildingLookup.get(buildingId)
    if (!viewport || !building) return
    const worldX = spawnWorld.x - NODE_WIDTH / 2
    const worldY = spawnWorld.y - NODE_HEIGHT / 2

    const nextNode: PlanningNode = {
      id: `node-${nextNodeIdRef.current++}`,
      buildingId,
      x: worldX,
      y: worldY,
      itemId: null,
      recipeIndex: 0,
    }

    setNodes((prev) => [...prev, nextNode])
    setPlacingNodeId(nextNode.id)
    setMenuNodeId(null)
  }

  function setNodeItem(nodeId: string, itemId: string | null) {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node
        return { ...node, itemId, recipeIndex: 0 }
      }),
    )
  }

  function cycleNodeRecipe(nodeId: string) {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node
        if (!node.itemId) return node
        const item = itemLookup.get(node.itemId)
        if (!item) return node
        const variants = getItemRecipeVariants(item)
        if (variants.length <= 1) return node
        const nextIndex = (node.recipeIndex + 1) % variants.length
        return { ...node, recipeIndex: nextIndex }
      }),
    )
  }

  function autoBuildIngredientChain(targetNodeId: string, ingredientId: string, missingRate: number) {
    if (!targetNodeId || !ingredientId || missingRate <= 0) return
    const targetNode = nodeLookup.get(targetNodeId)
    if (!targetNode) return

    const item = itemLookup.get(ingredientId) ?? null
    if (!item) return

    const slotCount = inputSlotCountByNode.get(targetNodeId) ?? 1
    const occupied = occupiedInputSlotsByNode.get(targetNodeId) ?? new Set<number>()
    const freeSlots: number[] = []
    for (let i = 0; i < slotCount; i += 1) {
      if (!occupied.has(i)) freeSlots.push(i)
    }
    if (freeSlots.length === 0) return

    let cps = 0
    let buildingId = ''
    let producerHeight = NODE_HEIGHT
    let recipeVariants: Record<string, number>[] = []

    if (item.is_ore) {
      cps = 0.5
      buildingId = WAREHOUSE_OUTPUT_ID
    } else {
      cps = craftPerSecond(item) ?? 0
      if (cps <= 0) return
      const buildingName = item.crafted_in ?? null
      if (!buildingName) return
      const building = buildingByName.get(buildingName) ?? buildingLookup.get(buildingName) ?? null
      if (!building || !building.is_factory) return
      buildingId = building.id
      recipeVariants = getItemRecipeVariants(item)
      const hasRecipe = recipeVariants.some((recipe) => Object.keys(recipe).length > 0)
      if (!hasRecipe) return
      if (recipeVariants.length > 1) {
        producerHeight = NODE_HEIGHT + ALT_RECIPE_EXTRA_HEIGHT
      }
    }

    const nodesNeeded = Math.min(Math.ceil(missingRate / cps), freeSlots.length)
    if (nodesNeeded <= 0) return

    const spacing = producerHeight + 24
    const targetHeight = nodeHeightById.get(targetNodeId) ?? NODE_HEIGHT
    const totalHeight = nodesNeeded * producerHeight + (nodesNeeded - 1) * 24
    const startY = targetNode.y + targetHeight / 2 - totalHeight / 2
    const startX = targetNode.x - NODE_WIDTH - 140

    const newNodes: PlanningNode[] = []
    const newEdges: PlanningEdge[] = []

    for (let i = 0; i < nodesNeeded; i += 1) {
      const nodeId =
        buildingId === WAREHOUSE_OUTPUT_ID
          ? `warehouse-out-${warehouseOutputIdRef.current++}`
          : `node-${nextNodeIdRef.current++}`
      newNodes.push({
        id: nodeId,
        buildingId,
        x: startX,
        y: startY + i * spacing,
        itemId: item.id,
        recipeIndex: 0,
      })
      const slotIndex = freeSlots[i]
      if (slotIndex != null) {
        newEdges.push({
          id: `edge-${nextEdgeIdRef.current++}`,
          fromId: nodeId,
          toId: targetNodeId,
          toPortIndex: slotIndex,
        })
      }
    }

    if (newNodes.length > 0) {
      setNodes((prev) => [...prev, ...newNodes])
    }
    if (newEdges.length > 0) {
      setEdges((prev) => [...prev, ...newEdges])
    }

    setPlacingNodeId(null)
    setMenuNodeId(null)
  }

  function deleteNode(nodeId: string) {
    setNodes((prev) => prev.filter((node) => node.id !== nodeId))
    setEdges((prev) => prev.filter((edge) => edge.fromId !== nodeId && edge.toId !== nodeId))
    setMenuNodeId((prev) => (prev === nodeId ? null : prev))
    if (draftLink?.fromId === nodeId) {
      setDraftLink(null)
    }
  }

  function resetCanvas() {
    setNodes([])
    setEdges([])
    setTransform({ x: 0, y: 0, scale: 1 })
    setMenuNodeId(null)
    setDraftLink(null)
    setPlacingNodeId(null)
    setSelectedNodeIds(new Set())
    setSelectionBox(null)
    nextNodeIdRef.current = 1
    nextEdgeIdRef.current = 1
    warehouseOutputIdRef.current = 1
  }

  function exportCanvas() {
    const rawName = window.prompt('Название файла', 'endfield-planner')
    if (!rawName) return
    const safeName = rawName.trim().replace(/[\\/:*?"<>|]+/g, '-')
    if (!safeName) return
    const fileName = safeName.toLowerCase().endsWith('.json') ? safeName : `${safeName}.json`

    const payload = {
      version: 1,
      nodes,
      edges,
      transform,
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  function exportCanvasImage() {
    const rawName = window.prompt('Название файла', 'endfield-planner')
    if (!rawName) return
    const safeName = rawName.trim().replace(/[\\/:*?"<>|]+/g, '-')
    if (!safeName) return
    const fileName = safeName.toLowerCase().endsWith('.png') ? safeName : `${safeName}.png`

    if (nodes.length === 0) return

    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY

    for (const node of nodes) {
      const height = nodeHeightById.get(node.id) ?? NODE_HEIGHT
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
      maxX = Math.max(maxX, node.x + NODE_WIDTH)
      maxY = Math.max(maxY, node.y + height)
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return

    const padding = 80
    minX -= padding
    minY -= padding
    maxX += padding
    maxY += padding

    const width = Math.max(1, Math.ceil(maxX - minX))
    const height = Math.max(1, Math.ceil(maxY - minY))

    const roundRect = (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      r: number,
    ) => {
      const radius = Math.min(r, w / 2, h / 2)
      ctx.beginPath()
      ctx.moveTo(x + radius, y)
      ctx.lineTo(x + w - radius, y)
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
      ctx.lineTo(x + w, y + h - radius)
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
      ctx.lineTo(x + radius, y + h)
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
      ctx.lineTo(x, y + radius)
      ctx.quadraticCurveTo(x, y, x + radius, y)
      ctx.closePath()
    }

    const collectImageSources = () => {
      const sources = new Set<string>()
      for (const node of nodes) {
        const building =
          node.buildingId === WAREHOUSE_OUTPUT_ID
            ? null
            : node.buildingId === WAREHOUSE_INPUT_ID
              ? null
              : buildingLookup.get(node.buildingId) ?? null
        if (building) {
          const src = buildingImageSrc(building)
          if (src) sources.add(src)
        }
        const item = node.itemId ? itemLookup.get(node.itemId) ?? null : null
        if (item) {
          const src = itemImageSrc(item)
          if (src) sources.add(src)
        }
      }
      return sources
    }

    const loadImages = async () => {
      const map = new Map<string, HTMLImageElement>()
      const sources = collectImageSources()
      await Promise.all(
        Array.from(sources).map(async (src) => {
          try {
            const response = await fetch(src)
            const blob = await response.blob()
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(String(reader.result ?? ''))
              reader.onerror = () => reject(reader.error)
              reader.readAsDataURL(blob)
            })
            const image = new Image()
            image.src = dataUrl
            await image.decode()
            map.set(src, image)
          } catch {
            // ignore
          }
        }),
      )
      return map
    }

    void (async () => {
      const images = await loadImages()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.fillStyle = '#0b0f14'
      ctx.fillRect(0, 0, width, height)

      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 4.5
      for (const edge of edgeRenders) {
        const fromX = edge.from.x - minX
        const fromY = edge.from.y - minY
        const toX = edge.to.x - minX
        const toY = edge.to.y - minY
        const dx = Math.max(60, Math.abs(toX - fromX) * 0.45)
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        ctx.bezierCurveTo(fromX + dx, fromY, toX - dx, toY, toX, toY)
        ctx.stroke()
      }

      for (const node of nodes) {
        const height = nodeHeightById.get(node.id) ?? NODE_HEIGHT
        const x = node.x - minX
        const y = node.y - minY
        const building =
          node.buildingId === WAREHOUSE_OUTPUT_ID
            ? { id: WAREHOUSE_OUTPUT_ID, name: 'Выгрузка со склада', image: undefined }
            : node.buildingId === WAREHOUSE_INPUT_ID
              ? { id: WAREHOUSE_INPUT_ID, name: 'Загрузка на склад', image: undefined }
              : buildingLookup.get(node.buildingId)
        if (!building) continue

        roundRect(ctx, x, y, NODE_WIDTH, height, 16)
        ctx.fillStyle = 'rgba(15, 20, 28, 0.98)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(31, 41, 55, 1)'
        ctx.lineWidth = 1
        ctx.stroke()

        const buildingTitle = building.name || building.id
        ctx.fillStyle = '#e5e7eb'
        ctx.font = '700 14px Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
        ctx.fillText(buildingTitle, x + 16, y + 24)

        const item = node.itemId ? itemLookup.get(node.itemId) ?? null : null
        const producedName =
          node.buildingId === WAREHOUSE_INPUT_ID
            ? 'Любой предмет'
            : item?.name || 'Выбрать предмет'
        ctx.fillStyle = '#94a3b8'
        ctx.font = '600 12px Inter, system-ui, -apple-system, "Segoe UI", sans-serif'
        ctx.fillText(producedName, x + 60, y + 52)

        const itemSrc = item ? itemImageSrc(item) : null
        if (itemSrc && images.has(itemSrc)) {
          const img = images.get(itemSrc)
          if (img) {
            ctx.drawImage(img, x + 16, y + 36, 36, 36)
          }
        } else {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)'
          ctx.strokeRect(x + 16, y + 36, 36, 36)
        }
      }

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return
        const pngUrl = URL.createObjectURL(pngBlob)
        const link = document.createElement('a')
        link.href = pngUrl
        link.download = fileName
        link.click()
        URL.revokeObjectURL(pngUrl)
      }, 'image/png')
    })()
  }

  function handleImportFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const raw = typeof reader.result === 'string' ? reader.result : ''
        const data = JSON.parse(raw) as {
          version?: number
          nodes?: PlanningNode[]
          edges?: PlanningEdge[]
          transform?: CanvasTransform
        }

        const loadedNodes = Array.isArray(data.nodes) ? data.nodes : []
        const loadedEdges = Array.isArray(data.edges) ? data.edges : []
        const loadedTransform = data.transform ?? { x: 0, y: 0, scale: 1 }

        setNodes(loadedNodes)
        setEdges(loadedEdges)
        setTransform(loadedTransform)
        setMenuNodeId(null)
        setDraftLink(null)
        setPlacingNodeId(null)
        setSelectedNodeIds(new Set())
        setSelectionBox(null)

        let maxNode = 0
        for (const node of loadedNodes) {
          const match = /-(\d+)$/.exec(node.id)
          if (match) {
            const value = Number.parseInt(match[1] ?? '0', 10)
            if (Number.isFinite(value)) maxNode = Math.max(maxNode, value)
          }
        }
        let maxEdge = 0
        for (const edge of loadedEdges) {
          const match = /-(\d+)$/.exec(edge.id)
          if (match) {
            const value = Number.parseInt(match[1] ?? '0', 10)
            if (Number.isFinite(value)) maxEdge = Math.max(maxEdge, value)
          }
        }
        nextNodeIdRef.current = Math.max(nextNodeIdRef.current, maxNode + 1)
        nextEdgeIdRef.current = Math.max(nextEdgeIdRef.current, maxEdge + 1)
      } catch (err) {
        console.error('Failed to import planning JSON', err)
      }
    }
    reader.readAsText(file)
  }

  function triggerImport() {
    fileInputRef.current?.click()
  }

  function handleViewportPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (placingNodeId && e.button === 0) {
      const world = screenToWorld(e.clientX, e.clientY)
      if (world) {
        const height = nodeHeightById.get(placingNodeId) ?? NODE_HEIGHT
        setNodes((prev) =>
          prev.map((node) =>
            node.id === placingNodeId
              ? { ...node, x: world.x - NODE_WIDTH / 2, y: world.y - height / 2 }
              : node,
          ),
        )
      }
      setPlacingNodeId(null)
      return
    }
    if (e.button !== 0) return
    const viewport = viewportRef.current
    if (!viewport) return
    if (e.shiftKey) {
      const world = screenToWorld(e.clientX, e.clientY)
      if (!world) return
      viewport.setPointerCapture(e.pointerId)
      setSelectionBox({ pointerId: e.pointerId, start: world, current: world })
      setMenuNodeId(null)
      setDraftLink(null)
      return
    }
    const target = e.target as HTMLElement | null
    if (target?.closest('.planning-node, .planning-edge-delete, .planning-port, .product-button, .product-menu')) {
      return
    }
    viewport.setPointerCapture(e.pointerId)
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.x,
      originY: transform.y,
    }
    setMenuNodeId(null)
    setSelectedNodeIds(new Set())
  }

  function handleViewportPointerDownCapture(e: ReactPointerEvent<HTMLDivElement>) {
    if (!placingNodeId || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const world = screenToWorld(e.clientX, e.clientY)
    if (world) {
      const height = nodeHeightById.get(placingNodeId) ?? NODE_HEIGHT
      setNodes((prev) =>
        prev.map((node) =>
          node.id === placingNodeId
            ? { ...node, x: world.x - NODE_WIDTH / 2, y: world.y - height / 2 }
            : node,
        ),
      )
    }
    setPlacingNodeId(null)
  }

  function handleViewportPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const world = screenToWorld(e.clientX, e.clientY)
    if (world) {
      cursorWorldRef.current = world
      if (placingNodeId) {
        const height = nodeHeightById.get(placingNodeId) ?? NODE_HEIGHT
        setNodes((prev) =>
          prev.map((node) =>
            node.id === placingNodeId
              ? { ...node, x: world.x - NODE_WIDTH / 2, y: world.y - height / 2 }
              : node,
          ),
        )
      }
    }

    if (selectionBox?.pointerId === e.pointerId && world) {
      setSelectionBox((prev) => (prev ? { ...prev, current: world } : prev))
    }

    if (draftLink) {
      if (world) {
        setDraftLink((prev) => (prev ? { ...prev, current: world } : prev))
      }
    }

    const pan = panRef.current
    if (pan && pan.pointerId === e.pointerId) {
      const dx = e.clientX - pan.startX
      const dy = e.clientY - pan.startY
      setTransform((prev) => ({ ...prev, x: pan.originX + dx, y: pan.originY + dy }))
    }

    const drag = dragRef.current
    if (drag && drag.pointerId === e.pointerId) {
      const world = screenToWorld(e.clientX, e.clientY)
      if (!world) return
      const dx = world.x - drag.startWorldX
      const dy = world.y - drag.startWorldY
      setNodes((prev) =>
        prev.map((node) => {
          if (!drag.origins.has(node.id)) return node
          const origin = drag.origins.get(node.id)
          if (!origin) return node
          return { ...node, x: origin.x + dx, y: origin.y + dy }
        }),
      )
    }
  }

  function handleViewportPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current
    if (viewport && viewport.hasPointerCapture(e.pointerId)) {
      viewport.releasePointerCapture(e.pointerId)
    }

    if (selectionBox?.pointerId === e.pointerId) {
      const minX = Math.min(selectionBox.start.x, selectionBox.current.x)
      const maxX = Math.max(selectionBox.start.x, selectionBox.current.x)
      const minY = Math.min(selectionBox.start.y, selectionBox.current.y)
      const maxY = Math.max(selectionBox.start.y, selectionBox.current.y)
      const nextSelected: string[] = []
      for (const node of nodes) {
        const height = nodeHeightById.get(node.id) ?? NODE_HEIGHT
        const left = node.x
        const right = node.x + NODE_WIDTH
        const top = node.y
        const bottom = node.y + height
        const overlaps = left < maxX && right > minX && top < maxY && bottom > minY
        if (overlaps) nextSelected.push(node.id)
      }
      setSelectedNodeIds(new Set(nextSelected))
      setSelectionBox(null)
      return
    }

    if (draftLink?.pointerId === e.pointerId) {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const port = el?.closest<HTMLElement>('[data-port-in][data-port-index]')
      const targetNodeId = port?.dataset.portIn
      const targetPortIndexRaw = port?.dataset.portIndex
      const targetPortIndex =
        targetPortIndexRaw != null ? Number.parseInt(targetPortIndexRaw, 10) : null
      if (targetNodeId) {
        const preferredPortIndex =
          typeof targetPortIndex === 'number' && Number.isFinite(targetPortIndex)
            ? targetPortIndex
            : undefined
        finishLink(targetNodeId, preferredPortIndex)
      } else {
        setDraftLink(null)
      }
      return
    }

    if (panRef.current?.pointerId === e.pointerId) {
      panRef.current = null
    }

    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null
    }
  }

  function handleNodePointerDown(nodeId: string, e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    if (e.shiftKey) return
    if (placingNodeId === nodeId) {
      e.stopPropagation()
      setPlacingNodeId(null)
      return
    }
    e.stopPropagation()
    const viewport = viewportRef.current
    if (!viewport) return
    const world = screenToWorld(e.clientX, e.clientY)
    const node = nodeLookup.get(nodeId)
    if (!world || !node) return

    viewport.setPointerCapture(e.pointerId)
    const isSelected = selectedNodeIds.has(nodeId)
    const dragNodeIds = isSelected ? Array.from(selectedNodeIds) : [nodeId]
    if (!isSelected) {
      setSelectedNodeIds(new Set([nodeId]))
    }
    const origins = new Map<string, { x: number; y: number }>()
    for (const id of dragNodeIds) {
      const entry = nodeLookup.get(id)
      if (entry) origins.set(id, { x: entry.x, y: entry.y })
    }
    dragRef.current = {
      pointerId: e.pointerId,
      nodeIds: dragNodeIds,
      startWorldX: world.x,
      startWorldY: world.y,
      origins,
    }
    setMenuNodeId(null)
  }

  function startLink(nodeId: string, pointerId: number) {
    const node = nodeLookup.get(nodeId)
    if (!node) return
    const start = nodeOutputPort(node)
    const viewport = viewportRef.current
    if (viewport) {
      viewport.setPointerCapture(pointerId)
    }
    dragRef.current = null
    panRef.current = null
    setDraftLink({ fromId: nodeId, pointerId, start, current: start })
    setMenuNodeId(null)
  }

  function finishLink(targetNodeId: string, preferredPortIndex?: number) {
    const draft = draftLink
    if (!draft) return
    if (draft.fromId === targetNodeId) {
      setDraftLink(null)
      return
    }

    const isWarehouseInput = warehouseInputNodes.has(targetNodeId)
    if (isWarehouseInput) {
      const alreadyExists = edges.some(
        (edge) =>
          edge.fromId === draft.fromId &&
          edge.toId === targetNodeId &&
          edge.toPortIndex === 0,
      )
      if (alreadyExists) {
        setDraftLink(null)
        return
      }

      const nextEdge: PlanningEdge = {
        id: `edge-${nextEdgeIdRef.current++}`,
        fromId: draft.fromId,
        toId: targetNodeId,
        toPortIndex: 0,
      }

      setEdges((prev) => [...prev, nextEdge])
      setDraftLink(null)
      return
    }

    const slotCount = inputSlotCountByNode.get(targetNodeId) ?? 1
    const occupied = occupiedInputSlotsByNode.get(targetNodeId) ?? new Set<number>()

    const preferredIsFree =
      preferredPortIndex != null &&
      preferredPortIndex >= 0 &&
      preferredPortIndex < slotCount &&
      !occupied.has(preferredPortIndex)

    const targetPortIndex = preferredIsFree
      ? preferredPortIndex
      : (() => {
          for (let i = 0; i < slotCount; i += 1) {
            if (!occupied.has(i)) return i
          }
          return null
        })()

    if (targetPortIndex == null) {
      setDraftLink(null)
      return
    }

    const alreadyExists = edges.some(
      (edge) =>
        edge.fromId === draft.fromId &&
        edge.toId === targetNodeId &&
        edge.toPortIndex === targetPortIndex,
    )
    if (alreadyExists) {
      setDraftLink(null)
      return
    }

    const nextEdge: PlanningEdge = {
      id: `edge-${nextEdgeIdRef.current++}`,
      fromId: draft.fromId,
      toId: targetNodeId,
      toPortIndex: targetPortIndex,
    }

    setEdges((prev) => [...prev, nextEdge])
    setDraftLink(null)
  }

  function cancelLink() {
    setDraftLink(null)
  }

  function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const dx = Math.max(60, Math.abs(to.x - from.x) * 0.45)
    const c1x = from.x + dx
    const c1y = from.y
    const c2x = to.x - dx
    const c2y = to.y
    return `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`
  }

  const edgeRenders = useMemo(() => {
    const renders: {
      id: string
      from: { x: number; y: number }
      to: { x: number; y: number }
      path: string
      mid: { x: number; y: number }
    }[] = []

    for (const edge of edges) {
      const fromNode = nodeLookup.get(edge.fromId)
      const toNode = nodeLookup.get(edge.toId)
      if (!fromNode || !toNode) continue
      const from = nodeOutputPort(fromNode)
      const slotCount = inputSlotCountByNode.get(toNode.id) ?? 1
      const to = nodeInputPort(toNode, edge.toPortIndex, slotCount)
      renders.push({
        id: edge.id,
        from,
        to,
        path: edgePath(from, to),
        mid: {
          x: (from.x + to.x) / 2,
          y: (from.y + to.y) / 2,
        },
      })
    }

    return renders
  }, [edges, nodeLookup, inputSlotCountByNode])

  function deleteEdge(edgeId: string) {
    setEdges((prev) => prev.filter((edge) => edge.id !== edgeId))
  }

  const selectionRect = selectionBox
    ? {
        left: Math.min(selectionBox.start.x, selectionBox.current.x),
        top: Math.min(selectionBox.start.y, selectionBox.current.y),
        width: Math.abs(selectionBox.current.x - selectionBox.start.x),
        height: Math.abs(selectionBox.current.y - selectionBox.start.y),
      }
    : null

  return (
    <section className="panel panel--canvas planning-panel">
      <div
        ref={viewportRef}
        className={draftLink ? 'planning-viewport planning-viewport--linking' : 'planning-viewport'}
        onPointerDownCapture={handleViewportPointerDownCapture}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onPointerCancel={handleViewportPointerUp}
        onDoubleClick={cancelLink}
      >
        <div
          ref={worldRef}
          className="planning-world"
          style={{
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          }}
        >
          <div className="planning-grid" />
          {selectionRect && (
            <div
              className="planning-selection"
              style={{
                left: selectionRect.left,
                top: selectionRect.top,
                width: selectionRect.width,
                height: selectionRect.height,
              }}
            />
          )}

          <svg
            className="planning-edges"
            width="4000"
            height="4000"
            viewBox="0 0 4000 4000"
            aria-hidden
          >
            {edgeRenders.map((edge) => (
              <path key={edge.id} d={edge.path} className="planning-edge" />
            ))}

            {draftLink && (
              <path
                d={edgePath(draftLink.start, draftLink.current)}
                className="planning-edge planning-edge--draft"
              />
            )}
          </svg>

          {edgeRenders.map((edge) => (
            <button
              key={edge.id}
              type="button"
              className="planning-edge-delete"
              style={{ left: edge.mid.x, top: edge.mid.y }}
              onPointerDown={(e) => {
                e.stopPropagation()
              }}
              onClick={(e) => {
                e.stopPropagation()
                deleteEdge(edge.id)
              }}
              aria-label="Удалить связь"
              title="Удалить связь"
            >
              ×
            </button>
          ))}

          {nodes.map((node) => {
            const building =
              node.buildingId === WAREHOUSE_OUTPUT_ID
                ? { id: WAREHOUSE_OUTPUT_ID, name: 'Выгрузка со склада', image: undefined }
                : node.buildingId === WAREHOUSE_INPUT_ID
                  ? { id: WAREHOUSE_INPUT_ID, name: 'Загрузка на склад', image: undefined }
                  : buildingLookup.get(node.buildingId)
            if (!building) return null
            const recipes = buildingItems.get(building.id) ?? []
            const isWarehouseOutput = node.buildingId === WAREHOUSE_OUTPUT_ID
            const isWarehouseInput = node.buildingId === WAREHOUSE_INPUT_ID
            const metrics = nodeMetrics.get(node.id)
            const inputSlotCount = inputSlotCountByNode.get(node.id) ?? 1
            const occupiedSlots = occupiedInputSlotsByNode.get(node.id) ?? new Set<number>()
            const producedItem = metrics?.producedItem ?? null
            const producedImage = producedItem ? itemImageSrc(producedItem) : null
            const producedName = isWarehouseInput
              ? 'Любой предмет'
              : producedItem?.name || 'Выбрать предмет'
            const cpsText = isWarehouseInput
              ? '0.5 шт/сек'
              : metrics
                ? formatCps(metrics.producedCps)
                : '—'
            const hasMissingRecipe =
              !producedItem &&
              !isWarehouseInput &&
              (isWarehouseOutput ? itemsByName.length > 0 : recipes.length > 0)
            const hasUnsatisfied =
              hasMissingRecipe ||
              Boolean(metrics?.ingredients.some((ing) => ing.missing || ing.shortage))
            const recipeVariants = producedItem ? getItemRecipeVariants(producedItem) : []
            const hasAltRecipe = recipeVariants.length > 1
            const recipeTitle = hasAltRecipe
              ? `Рецепт ${Math.min(node.recipeIndex + 1, recipeVariants.length)} из ${recipeVariants.length}`
              : 'Рецепт'
            const nodeHeight = nodeHeightById.get(node.id) ?? NODE_HEIGHT

            const outputPort = nodeOutputPort(node)

            const isSelected = selectedNodeIds.has(node.id)

            return (
              <div
                key={node.id}
                className={
                  hasUnsatisfied
                    ? isSelected
                      ? 'planning-node planning-node--unsatisfied planning-node--selected'
                      : 'planning-node planning-node--unsatisfied'
                    : isSelected
                      ? 'planning-node planning-node--selected'
                      : 'planning-node'
                }
                style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: nodeHeight }}
                onPointerDown={(e) => handleNodePointerDown(node.id, e)}
              >
                <button
                  type="button"
                  className="planning-node__delete"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteNode(node.id)
                  }}
                  aria-label="Удалить узел"
                  title="Удалить узел"
                >
                  ×
                </button>
                <div className="planning-node__title">{building.name || building.id}</div>

                <div className="planning-node__product">
                  <button
                    type="button"
                    className={
                      hasMissingRecipe
                        ? menuNodeId === node.id
                          ? 'product-button product-button--missing product-button--open'
                          : 'product-button product-button--missing'
                        : menuNodeId === node.id
                          ? 'product-button product-button--open'
                          : 'product-button'
                    }
                    onPointerDown={(e) => {
                      e.stopPropagation()
                    }}
                    onClick={(e) => {
                      if (isWarehouseInput) return
                      e.stopPropagation()
                      setMenuNodeId((prev) => (prev === node.id ? null : node.id))
                    }}
                  >
                    <div className="product-button__image" aria-hidden={!producedImage}>
                      {producedImage ? (
                        <img src={producedImage} alt={producedName} loading="lazy" />
                      ) : (
                        <span>?</span>
                      )}
                    </div>
                    <div className="product-button__name" title={producedName}>
                      {producedName}
                    </div>
                    <div className="product-button__cps">{cpsText}</div>
                  </button>

                  {hasAltRecipe && (
                    <button
                      type="button"
                      className="planning-node__alt-recipe"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        cycleNodeRecipe(node.id)
                      }}
                      title={recipeTitle}
                    >
                      Альт. рецепт
                    </button>
                  )}
                </div>

                {!isWarehouseOutput && !isWarehouseInput && (
                  <div className="planning-node__ingredients">
                    {(metrics?.ingredients ?? []).map((ing) => {
                      const imageSrc = ing.item ? itemImageSrc(ing.item) : null
                      const name = ing.item?.name || ing.id
                      const canAutoBuild = ing.missing || ing.shortage
                      const className = ing.missing
                        ? 'planning-ingredient planning-ingredient--missing'
                        : ing.shortage
                          ? 'planning-ingredient planning-ingredient--shortage'
                          : 'planning-ingredient'
                      return (
                        <div
                          key={ing.id}
                          className={
                            canAutoBuild ? `${className} planning-ingredient--action` : className
                          }
                          title={`${name}: нужно ${formatRate(ing.requiredPerSec)}, есть ${formatRate(
                            ing.suppliedPerSec,
                          )}`}
                          role={canAutoBuild ? 'button' : undefined}
                          tabIndex={canAutoBuild ? 0 : undefined}
                          onPointerDown={(e) => {
                            if (!canAutoBuild) return
                            e.stopPropagation()
                          }}
                          onClick={(e) => {
                            if (!canAutoBuild) return
                            e.stopPropagation()
                            const missingRate = Math.max(ing.requiredPerSec - ing.suppliedPerSec, 0)
                            autoBuildIngredientChain(node.id, ing.id, missingRate)
                          }}
                        >
                          <div className="planning-ingredient__image" aria-hidden={!imageSrc}>
                            {imageSrc ? (
                              <img src={imageSrc} alt={name} loading="lazy" />
                            ) : (
                              <span>—</span>
                            )}
                          </div>
                          <div className="planning-ingredient__qty">{formatRate(ing.requiredPerSec)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {!isWarehouseInput && (
                  <button
                    type="button"
                    className={
                      draftLink?.fromId === node.id
                        ? 'planning-port planning-port--out planning-port--active'
                        : 'planning-port planning-port--out'
                    }
                    style={{ left: outputPort.x - node.x, top: outputPort.y - node.y }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      startLink(node.id, e.pointerId)
                    }}
                    aria-label="Точка выхода"
                  >
                    <span className="planning-port__arrow planning-port__arrow--out" />
                  </button>
                )}

                {!isWarehouseOutput && !isWarehouseInput &&
                  Array.from({ length: inputSlotCount }).map((_, slotIndex) => {
                    const inputPort = nodeInputPort(node, slotIndex, inputSlotCount)
                    const isOccupied = occupiedSlots.has(slotIndex)
                    const isReady = Boolean(draftLink) && !isOccupied
                    const className = isReady
                      ? 'planning-port planning-port--in planning-port--ready'
                      : isOccupied
                        ? 'planning-port planning-port--in planning-port--occupied'
                        : 'planning-port planning-port--in'

                    return (
                      <button
                        key={`${node.id}-in-${slotIndex}`}
                        type="button"
                        className={className}
                        style={{ left: inputPort.x - node.x, top: inputPort.y - node.y }}
                        data-port-in={node.id}
                        data-port-index={slotIndex}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                        }}
                        onPointerUp={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          finishLink(node.id, slotIndex)
                        }}
                        aria-label={`Точка входа ${slotIndex + 1}`}
                        aria-disabled={isOccupied}
                        title={isOccupied ? 'Вход занят' : `Вход ${slotIndex + 1}`}
                      >
                        <span className="planning-port__arrow planning-port__arrow--in" />
                      </button>
                    )
                  })}
                {isWarehouseInput && (
                  <button
                    type="button"
                    className={
                      draftLink
                        ? 'planning-port planning-port--in planning-port--ready'
                        : 'planning-port planning-port--in'
                    }
                    style={{ left: -PORT_OFFSET_X, top: nodeHeight / 2 }}
                    data-port-in={node.id}
                    data-port-index={0}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      finishLink(node.id, 0)
                    }}
                    aria-label="Точка входа"
                  >
                    <span className="planning-port__arrow planning-port__arrow--in" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {menuData && (
          <div
            className="product-popup"
            onPointerDown={(e) => {
              e.stopPropagation()
              setMenuNodeId(null)
            }}
          >
            <div
              className="product-popup__panel"
              role="dialog"
              aria-label="Выбор предмета"
              onPointerDown={(e) => {
                e.stopPropagation()
              }}
              onWheel={(e) => {
                e.stopPropagation()
              }}
            >
              <div className="product-popup__header">
                <div className="product-popup__title">Выбор предмета</div>
                <button
                  type="button"
                  className="product-popup__close"
                  onClick={() => setMenuNodeId(null)}
                  aria-label="Закрыть"
                >
                  ×
                </button>
              </div>
              <div className="product-popup__grid">
                {menuData.items.map((item) => {
                  const selected = item.id === menuData.node.itemId
                  const imageSrc = itemImageSrc(item)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        selected
                          ? 'product-popup__tile product-popup__tile--active'
                          : 'product-popup__tile'
                      }
                      onClick={() => {
                        setNodeItem(menuData.node.id, item.id)
                        setMenuNodeId(null)
                      }}
                    >
                      <div className="product-popup__tile-image" aria-hidden={!imageSrc}>
                        {imageSrc ? <img src={imageSrc} alt={item.name || item.id} /> : <span>—</span>}
                      </div>
                      <div className="product-popup__tile-name">{item.name || item.id}</div>
                      <div className="product-popup__tile-rate">
                        {menuData.isWarehouseOutput ? '0.5 шт/сек' : formatCps(craftPerSecond(item))}
                      </div>
                    </button>
                  )
          })}
        </div>

      </div>
          </div>
        )}
      </div>

      <section
        className={
          leftPanelCollapsed
            ? 'planning-side-panel planning-side-panel--left planning-side-panel--collapsed'
            : 'planning-side-panel planning-side-panel--left'
        }
        aria-label="Пул потребления"
      >
        <button
          type="button"
          className="planning-side-panel__tab"
          onClick={() => setLeftPanelCollapsed((prev) => !prev)}
          aria-expanded={!leftPanelCollapsed}
        >
          Потребление
        </button>
        <div className="planning-side-panel__header">
          <div className="planning-side-panel__title">Потребление</div>
          <button
            type="button"
            className="planning-side-panel__toggle"
            onClick={() => setLeftPanelCollapsed((prev) => !prev)}
            aria-expanded={!leftPanelCollapsed}
            aria-label={leftPanelCollapsed ? 'Развернуть панель потребления' : 'Свернуть панель потребления'}
            title={leftPanelCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            {leftPanelCollapsed ? '▶' : '◀'}
          </button>
        </div>
        <div className="planning-side-panel__list">
          {netConsumptionList.map((entry) => {
            const title = entry.item?.name || entry.id
            const imageSrc = entry.item ? itemImageSrc(entry.item) : null
            return (
              <div key={entry.id} className="planning-side-panel__row" title={title}>
                <div className="planning-side-panel__image" aria-hidden={!imageSrc}>
                  {imageSrc ? <img src={imageSrc} alt={title} loading="lazy" /> : <span>—</span>}
                </div>
                <div className="planning-side-panel__label">{title}</div>
                <div className="planning-side-panel__rate">{formatRate(entry.rate)}</div>
              </div>
            )
          })}
          {netConsumptionList.length === 0 && (
            <div className="planning-side-panel__empty">Нет данных.</div>
          )}
        </div>
      </section>

      <section
        className={
          rightPanelCollapsed
            ? 'planning-side-panel planning-side-panel--right planning-side-panel--collapsed'
            : 'planning-side-panel planning-side-panel--right'
        }
        aria-label="Пул производства"
      >
        <button
          type="button"
          className="planning-side-panel__tab"
          onClick={() => setRightPanelCollapsed((prev) => !prev)}
          aria-expanded={!rightPanelCollapsed}
        >
          Производство
        </button>
        <div className="planning-side-panel__header">
          <div className="planning-side-panel__title">Производство</div>
          <button
            type="button"
            className="planning-side-panel__toggle"
            onClick={() => setRightPanelCollapsed((prev) => !prev)}
            aria-expanded={!rightPanelCollapsed}
            aria-label={rightPanelCollapsed ? 'Развернуть панель производства' : 'Свернуть панель производства'}
            title={rightPanelCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            {rightPanelCollapsed ? '◀' : '▶'}
          </button>
        </div>
        <div className="planning-side-panel__list">
          {netProductionList.map((entry) => {
            const title = entry.item?.name || entry.id
            const imageSrc = entry.item ? itemImageSrc(entry.item) : null
            return (
              <div key={entry.id} className="planning-side-panel__row" title={title}>
                <div className="planning-side-panel__image" aria-hidden={!imageSrc}>
                  {imageSrc ? <img src={imageSrc} alt={title} loading="lazy" /> : <span>—</span>}
                </div>
                <div className="planning-side-panel__label">{title}</div>
                <div className="planning-side-panel__rate">{formatRate(entry.rate)}</div>
              </div>
            )
          })}
          {netProductionList.length === 0 && (
            <div className="planning-side-panel__empty">Нет данных.</div>
          )}
        </div>
      </section>

      <section
        className={panelCollapsed ? 'planning-bottom-panel planning-bottom-panel--collapsed' : 'planning-bottom-panel'}
        aria-label="Панель строений"
      >
        <div className="planning-bottom-panel__header">
          <div className="planning-bottom-panel__title">Строения</div>
          <div className="planning-bottom-panel__tabs" role="tablist">
            {BUILDING_TYPE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={panelTab === tab.id}
                className={
                  panelTab === tab.id
                    ? 'planning-bottom-panel__tab planning-bottom-panel__tab--active'
                    : 'planning-bottom-panel__tab'
                }
                onClick={() => setPanelTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="planning-bottom-panel__actions">
            <button
              type="button"
              className="planning-bottom-panel__action"
              onClick={resetCanvas}
              title="Сбросить холст"
            >
              Сбросить
            </button>
            <button
              type="button"
              className="planning-bottom-panel__action"
              onClick={exportCanvas}
              title="Сохранить холст"
            >
              Сохранить
            </button>
            <button
              type="button"
              className="planning-bottom-panel__action"
              onClick={exportCanvasImage}
              title="Экспортировать картинку"
            >
              Экспорт PNG
            </button>
            <button
              type="button"
              className="planning-bottom-panel__action"
              onClick={triggerImport}
              title="Загрузить холст"
            >
              Загрузить
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImportFile(file)
                e.currentTarget.value = ''
              }}
              style={{ display: 'none' }}
            />
          </div>
          <button
            type="button"
            className="planning-bottom-panel__toggle"
            onClick={() => setPanelCollapsed((prev) => !prev)}
            aria-expanded={!panelCollapsed}
            aria-label={panelCollapsed ? 'Развернуть панель строений' : 'Свернуть панель строений'}
            title={panelCollapsed ? 'Развернуть' : 'Свернуть'}
          >
            {panelCollapsed ? '▲' : '▼'}
          </button>
        </div>

        {!panelCollapsed && !isStatsTab && (
          <div className="planning-bottom-panel__grid">
            {warehouseTile && (
              <button
                key={warehouseTile.id}
                type="button"
                className="planning-bottom-panel__tile"
                onClick={() => addNode(warehouseTile.id)}
                title={warehouseTile.name}
              >
                <div className="planning-bottom-panel__tile-image">
                  <span>⇩</span>
                </div>
                <div className="planning-bottom-panel__tile-title">{warehouseTile.name}</div>
              </button>
            )}
            {warehouseInputTile && (
              <button
                key={warehouseInputTile.id}
                type="button"
                className="planning-bottom-panel__tile"
                onClick={() => addNode(warehouseInputTile.id)}
                title={warehouseInputTile.name}
              >
                <div className="planning-bottom-panel__tile-image">
                  <span>⇧</span>
                </div>
                <div className="planning-bottom-panel__tile-title">{warehouseInputTile.name}</div>
              </button>
            )}
            {panelBuildings.map((building) => {
              const imageSrc = buildingImageSrc(building)
              const title = building.name || building.id
              return (
                <button
                  key={building.id}
                  type="button"
                  className="planning-bottom-panel__tile"
                  onClick={() => addNode(building.id)}
                  title={title}
                >
                  <div className="planning-bottom-panel__tile-image" aria-hidden={!imageSrc}>
                    {imageSrc ? (
                      <img src={imageSrc} alt={title} loading="lazy" />
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                  <div className="planning-bottom-panel__tile-title">{title}</div>
                </button>
              )
            })}
            {panelBuildings.length === 0 && (
              <div className="planning-bottom-panel__empty">Нет подходящих фабрик этого типа.</div>
            )}
          </div>
        )}

        {!panelCollapsed && isStatsTab && (
          <div className="planning-bottom-panel__stats">
            <div className="planning-bottom-panel__stat-summary">
              <span>Общее энергопотребление</span>
              <strong>{formatEnergy(buildingUsage.totalEnergy)}</strong>
            </div>
            <div className="planning-bottom-panel__stat-grid">
              {buildingUsage.list.map((entry) => {
                const title = entry.building.name || entry.building.id
                const imageSrc = buildingImageSrc(entry.building)
                return (
                  <div key={entry.building.id} className="planning-bottom-panel__stat-card">
                    <div className="planning-bottom-panel__stat-image" aria-hidden={!imageSrc}>
                      {imageSrc ? <img src={imageSrc} alt={title} loading="lazy" /> : <span>—</span>}
                    </div>
                    <div className="planning-bottom-panel__stat-title">{title}</div>
                    <div className="planning-bottom-panel__stat-count">× {entry.count}</div>
                  </div>
                )
              })}
              {buildingUsage.list.length === 0 && (
                <div className="planning-bottom-panel__empty">Нет данных.</div>
              )}
            </div>
          </div>
        )}
      </section>
    </section>
  )
}
