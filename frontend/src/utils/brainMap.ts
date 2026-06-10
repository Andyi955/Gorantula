import type {
  BrainGateway,
  BrainSignal,
  BrainSignalReason,
  MemoryLink,
  BrainMapView as BackendBrainMapView,
} from './brainMemory'

export type BrainMapNodeKind = 'current' | 'cluster' | 'memory' | 'signal'
export type BrainMapSlot = 'center' | 'northwest' | 'northeast' | 'southwest' | 'southeast' | 'east'
export type BrainMapTier = 'Hot' | 'Warm' | 'Weak'

export interface BrainMapNode {
  id: string
  kind: BrainMapNodeKind
  title: string
  subtitle: string
  score: number
  scoreLabel: string
  relevance?: string
  relevanceLabel?: string
  tier: BrainMapTier
  slot: BrainMapSlot
  badges: string[]
  gateways: BrainGateway[]
  reasons: BrainSignalReason[]
  targetInvestigationId?: string
  clusterId?: string
  linkId?: string
  signalId?: string
  activationCount?: number
  relatedSignalIds?: string[]
  relatedMemoryLinkIds?: string[]
  memberInvestigationIds?: string[]
  x?: number
  y?: number
}

export interface BrainMapEdge {
  id: string
  kind?: string
  from: string
  to: string
  label?: string
  strength: Lowercase<BrainMapTier>
  gateway?: BrainGateway
  score: number
}

export interface BrainMapRegion {
  id: string
  clusterId: string
  label: string
  status: string
  score: number
  scoreLabel: string
  relevance?: string
  relevanceLabel?: string
  tier: BrainMapTier
  gateway?: BrainGateway
  nodeIds: string[]
  memberInvestigationIds: string[]
  x: number
  y: number
}

export interface BrainMapDigestItem {
  id: string
  tone: 'hot' | 'warm' | 'cool'
  title: string
  detail: string
  relevance?: string
  relevanceLabel?: string
}

export interface BrainMapModel {
  nodes: BrainMapNode[]
  edges: BrainMapEdge[]
  regions: BrainMapRegion[]
  digest: BrainMapDigestItem[]
  hiddenCount: number
  summary: {
    visibleCount: number
    strongestScore: string
    autoMemoryCount: number
    activeSignalCount: number
    linkedMemoryCount: number
  }
}

interface BrainMapModelInput {
  currentInvestigationId?: string
  currentInvestigationTitle?: string
  signals: BrainSignal[]
  links: MemoryLink[]
}

type RankedMapItem =
  | {
      type: 'link'
      link: MemoryLink
      score: number
      createdAt: string
    }
  | {
      type: 'signal'
      signal: BrainSignal
      score: number
      createdAt: string
    }

const VISIBLE_MEMORY_LIMIT = 5
const MAP_SLOTS: BrainMapSlot[] = ['northwest', 'northeast', 'southwest', 'southeast', 'east']
const MAP_CENTER = { x: 50, y: 50 }
const MAP_MIN = 12
const MAP_MAX = 88
const MAP_NODE_MIN_DISTANCE = 8.5
const MAP_GOLDEN_ANGLE = 137.508

const CHILD_OFFSETS = [
  { x: 0, y: -16 },
  { x: 17, y: -7 },
  { x: 17, y: 9 },
  { x: 0, y: 17 },
  { x: -17, y: 9 },
  { x: -17, y: -7 },
  { x: 9, y: -21 },
  { x: 22, y: 0 },
  { x: -9, y: 21 },
  { x: -22, y: 0 },
]

export const formatBrainMapScore = (score: number) => `${Math.round(normalizeScore(score) * 100)}%`

export const getBrainMapTier = (score: number): BrainMapTier => {
  const normalized = normalizeScore(score)

  if (normalized >= 0.75) {
    return 'Hot'
  }

  if (normalized >= 0.5) {
    return 'Warm'
  }

  return 'Weak'
}

export const buildBrainMapModel = ({
  currentInvestigationId,
  currentInvestigationTitle,
  signals,
  links,
}: BrainMapModelInput): BrainMapModel => {
  const linkedItems = [...links].sort(compareByScoreAndDate).map<RankedMapItem>((link) => ({
    type: 'link',
    link,
    score: link.score,
    createdAt: link.lastFiredAt || link.updatedAt || link.createdAt,
  }))

  const signalItems = [...signals].sort(compareByScoreAndDate).map<RankedMapItem>((signal) => ({
    type: 'signal',
    signal,
    score: signal.score,
    createdAt: signal.lastFiredAt || signal.updatedAt || signal.createdAt,
  }))

  const visibleItems = [...linkedItems, ...signalItems].slice(0, VISIBLE_MEMORY_LIMIT)
  const nodes = [
    buildCurrentNode(currentInvestigationId, currentInvestigationTitle),
    ...visibleItems.map((item, index) => buildMemoryNode(item, MAP_SLOTS[index] || 'east')),
  ]

  const edges = nodes.slice(1).map((node) => ({
    id: `brain-map-edge-${node.id}`,
    kind: node.kind === 'memory' ? 'link' : node.kind,
    from: 'brain-map-current',
    to: node.id,
    label: node.kind === 'memory' ? 'Memory link' : 'Active signal',
    strength: getBrainMapTier(node.score).toLowerCase() as Lowercase<BrainMapTier>,
    gateway: node.gateways[0],
    score: node.score,
  }))

  const allScores = [...links.map((link) => link.score), ...signals.map((signal) => signal.score)]
  const strongestScore = allScores.length > 0 ? Math.max(...allScores) : 0

  return {
    nodes,
    edges,
    regions: [],
    digest: buildDigest(signals, links),
    hiddenCount: Math.max(0, links.length + signals.length - visibleItems.length),
    summary: {
      visibleCount: visibleItems.length,
      strongestScore: formatBrainMapScore(strongestScore),
      autoMemoryCount: links.filter((link) => link.promotionType === 'auto').length,
      activeSignalCount: signals.length,
      linkedMemoryCount: links.length,
    },
  }
}

export const buildBrainMapModelFromView = (view: BackendBrainMapView): BrainMapModel => {
  const nodes = view.nodes.map((node) => ({
    id: node.id,
    kind: normalizeNodeKind(node.kind),
    title: node.title,
    subtitle: node.subtitle,
    score: normalizeScore(node.score),
    scoreLabel: formatBrainMapScore(node.score),
    relevance: node.relevance,
    relevanceLabel: node.relevanceLabel,
    tier: getBrainMapTier(node.score),
    slot: node.kind === 'current' ? 'center' : slotFromMapPosition(node.x, node.y),
    badges: node.badges || [],
    gateways: node.gateway ? [node.gateway] : [],
    reasons: node.reasonSamples || [],
    targetInvestigationId: node.targetInvestigationId || node.investigationId,
    clusterId: node.clusterId,
    linkId: node.linkId,
    signalId: node.signalId,
    relatedSignalIds: node.relatedSignalIds || [],
    relatedMemoryLinkIds: node.relatedMemoryLinkIds || [],
    memberInvestigationIds: node.memberInvestigationIds || [],
    x: node.x,
    y: node.y,
  }))
  const regions = view.regions.map((region) => ({
    id: region.id,
    clusterId: region.clusterId,
    label: region.label,
    status: region.status,
    score: normalizeScore(region.score),
    scoreLabel: formatBrainMapScore(region.score),
    relevance: region.relevance,
    relevanceLabel: region.relevanceLabel,
    tier: getBrainMapTier(region.score),
    gateway: region.gateway,
    nodeIds: region.nodeIds || [],
    memberInvestigationIds: region.memberInvestigationIds || [],
    x: region.x,
    y: region.y,
  }))
  const layout = layoutBrainMap(nodes, regions)

  return {
    nodes: layout.nodes,
    edges: view.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      strength: getBrainMapTier(edge.score).toLowerCase() as Lowercase<BrainMapTier>,
      gateway: edge.gateway,
      score: normalizeScore(edge.score),
    })),
    regions: layout.regions,
    digest: view.digest.map((item) => ({
      id: item.id,
      tone: normalizeDigestTone(item.tone),
      title: item.title,
      detail: item.detail,
      relevance: item.relevance,
      relevanceLabel: item.relevanceLabel,
    })),
    hiddenCount: 0,
    summary: {
      visibleCount: view.summary.visibleNodeCount,
      strongestScore: formatBrainMapScore(view.summary.strongestScore),
      autoMemoryCount: 0,
      activeSignalCount: view.summary.activeSignalCount,
      linkedMemoryCount: view.summary.linkedMemoryCount,
    },
  }
}

const buildCurrentNode = (
  currentInvestigationId?: string,
  currentInvestigationTitle?: string,
): BrainMapNode => ({
  id: 'brain-map-current',
  kind: 'current',
  title: 'Current investigation',
  subtitle: currentInvestigationTitle || currentInvestigationId || 'No investigation selected',
  score: 1,
  scoreLabel: '100%',
  tier: 'Hot',
  slot: 'center',
  badges: ['Focus'],
  gateways: [],
  reasons: [],
  targetInvestigationId: currentInvestigationId,
})

const buildMemoryNode = (item: RankedMapItem, slot: BrainMapSlot): BrainMapNode => {
  if (item.type === 'link') {
    const activationCount = item.link.activationCount
    const badges = [
      item.link.promotionType === 'auto' ? 'Auto' : 'Manual',
      ...(activationCount && activationCount > 1 ? [`${activationCount} activations`] : []),
    ]

    return {
      id: `brain-map-link-${item.link.id}`,
      kind: 'memory',
      title: item.link.toTitle,
      subtitle: item.link.reasons[0]?.detail || item.link.suggestedAction,
      score: normalizeScore(item.link.score),
      scoreLabel: formatBrainMapScore(item.link.score),
      relevance: item.link.relevance,
      relevanceLabel: item.link.relevanceLabel,
      tier: getBrainMapTier(item.link.score),
      slot,
      badges: [...badges, ...(item.link.relevanceLabel ? [item.link.relevanceLabel] : [])],
      gateways: item.link.gateways,
      reasons: item.link.reasons,
      targetInvestigationId: item.link.toInvestigationId,
      linkId: item.link.id,
      activationCount,
    }
  }

  const activationCount = item.signal.activationCount

  return {
    id: `brain-map-signal-${item.signal.id}`,
    kind: 'signal',
    title: item.signal.targetTitle,
    subtitle: item.signal.reasons[0]?.detail || item.signal.suggestedAction,
    score: normalizeScore(item.signal.score),
    scoreLabel: formatBrainMapScore(item.signal.score),
    relevance: item.signal.relevance,
    relevanceLabel: item.signal.relevanceLabel,
    tier: getBrainMapTier(item.signal.score),
    slot,
    badges: [
      'Signal',
      ...(item.signal.relevanceLabel ? [item.signal.relevanceLabel] : []),
      ...(activationCount && activationCount > 1 ? [`${activationCount} firings`] : []),
    ],
    gateways: item.signal.gateways,
    reasons: item.signal.reasons,
    targetInvestigationId: item.signal.targetInvestigationId,
    signalId: item.signal.id,
    activationCount,
  }
}

const buildDigest = (signals: BrainSignal[], links: MemoryLink[]): BrainMapDigestItem[] => {
  const digest: BrainMapDigestItem[] = []
  const autoLink = [...links]
    .filter((link) => link.promotionType === 'auto')
    .sort(compareByScoreAndDate)[0]

  if (autoLink) {
    digest.push({
      id: `digest-auto-${autoLink.id}`,
      tone: 'hot',
      title: 'Auto memory created',
      detail: `${autoLink.toTitle} became a durable memory.`,
      relevance: autoLink.relevance,
      relevanceLabel: autoLink.relevanceLabel,
    })
  }

  const reinforcedLink = [...links]
    .filter((link) => (link.activationCount || 0) > 1 && link.id !== autoLink?.id)
    .sort((a, b) => (b.activationCount || 0) - (a.activationCount || 0) || compareByScoreAndDate(a, b))[0]

  if (reinforcedLink) {
    digest.push({
      id: `digest-reinforced-${reinforcedLink.id}`,
      tone: 'warm',
      title: 'Memory reinforced',
      detail: `${reinforcedLink.toTitle} reached ${reinforcedLink.activationCount} activations.`,
      relevance: reinforcedLink.relevance,
      relevanceLabel: reinforcedLink.relevanceLabel,
    })
  }

  const recentSignal = [...signals]
    .sort((a, b) => {
      const firedDelta = Date.parse(b.lastFiredAt || '') - Date.parse(a.lastFiredAt || '')

      if (Number.isFinite(firedDelta) && firedDelta !== 0) {
        return firedDelta
      }

      return compareByScoreAndDate(a, b)
    })[0]

  if (recentSignal) {
    digest.push({
      id: `digest-signal-${recentSignal.id}`,
      tone: 'cool',
      title: 'Signal fired',
      detail: `${recentSignal.targetTitle} fired through ${formatGatewayLabel(recentSignal.gateways[0])}.`,
      relevance: recentSignal.relevance,
      relevanceLabel: recentSignal.relevanceLabel,
    })
  }

  return digest.slice(0, 3)
}

const normalizeNodeKind = (kind: string): BrainMapNodeKind => {
  if (kind === 'cluster' || kind === 'memory' || kind === 'signal') {
    return kind
  }
  return 'current'
}

const slotFromMapPosition = (x = 50, y = 50): BrainMapSlot => {
  if (x > 66) {
    return y < 50 ? 'northeast' : 'southeast'
  }
  if (x < 34) {
    return y < 50 ? 'northwest' : 'southwest'
  }
  return y < 50 ? 'northwest' : 'east'
}

const layoutBrainMap = (
  rawNodes: BrainMapNode[],
  rawRegions: BrainMapRegion[],
): { nodes: BrainMapNode[]; regions: BrainMapRegion[] } => {
  const nodes = rawNodes.map((node) => ({ ...node }))
  const regions = rawRegions.map((region) => ({ ...region }))
  const currentNode = nodes.find((node) => node.kind === 'current')

  if (currentNode) {
    placeMapItem(currentNode, MAP_CENTER)
  }

  const clusterNodes = nodes
    .filter((node) => node.kind === 'cluster')
    .sort(compareMapNodes)
  const clusterPositions = new Map<string, { x: number; y: number }>()

  clusterNodes.forEach((node, index) => {
    const position = getClusterOrbitPosition(index, clusterNodes.length)
    placeMapItem(node, position)

    if (node.clusterId) {
      clusterPositions.set(node.clusterId, position)
    }
  })

  const groupedChildren = new Map<string, BrainMapNode[]>()
  const looseNodes: BrainMapNode[] = []

  nodes
    .filter((node) => node.kind !== 'current' && node.kind !== 'cluster')
    .sort(compareMapNodes)
    .forEach((node) => {
      if (node.clusterId && clusterPositions.has(node.clusterId)) {
        groupedChildren.set(node.clusterId, [...(groupedChildren.get(node.clusterId) || []), node])
        return
      }

      looseNodes.push(node)
    })

  Array.from(groupedChildren.entries()).forEach(([clusterId, children]) => {
    const clusterPosition = clusterPositions.get(clusterId)

    if (!clusterPosition) {
      return
    }

    children.forEach((node, index) => {
      const offset = getChildOrbitOffset(index)
      placeMapItem(node, {
        x: clusterPosition.x + offset.x,
        y: clusterPosition.y + offset.y,
      })
    })
  })

  looseNodes.forEach((node, index) => {
    placeMapItem(node, getClusterOrbitPosition(index + clusterNodes.length, clusterNodes.length + looseNodes.length || 1))
  })

  repelMapNodes(nodes)

  for (const node of nodes) {
    node.slot = slotFromMapPosition(node.x, node.y)
  }

  for (const region of regions) {
    const clusterPosition = clusterPositions.get(region.clusterId)
    const memberPositions = region.nodeIds
      .map((nodeId) => nodes.find((node) => node.id === nodeId))
      .filter((node): node is BrainMapNode => Boolean(node && Number.isFinite(node.x) && Number.isFinite(node.y)))

    if (clusterPosition) {
      const averagePosition = memberPositions.length > 0
        ? {
            x: (clusterPosition.x + memberPositions.reduce((sum, node) => sum + (node.x || clusterPosition.x), 0)) /
              (memberPositions.length + 1),
            y: (clusterPosition.y + memberPositions.reduce((sum, node) => sum + (node.y || clusterPosition.y), 0)) /
              (memberPositions.length + 1),
          }
        : clusterPosition
      placeMapItem(region, averagePosition)
    }
  }

  return { nodes, regions }
}

const compareMapNodes = (left: BrainMapNode, right: BrainMapNode) => {
  const scoreDelta = right.score - left.score

  if (scoreDelta !== 0) {
    return scoreDelta
  }

  return left.title.localeCompare(right.title)
}

const getClusterOrbitPosition = (index: number, total: number) => {
  const normalizedTotal = Math.max(1, total)
  const ring = Math.floor(index / 10)
  const ringIndex = index % 10
  const itemsOnRing = Math.min(10, normalizedTotal - ring * 10 || 10)
  const angle = ((itemsOnRing <= 2 ? -90 + (360 / itemsOnRing) * ringIndex : -90 + MAP_GOLDEN_ANGLE * index) * Math.PI) / 180
  const radius = ring % 2 === 0 ? 32 : 23

  return {
    x: MAP_CENTER.x + Math.cos(angle) * radius,
    y: MAP_CENTER.y + Math.sin(angle) * radius,
  }
}

const getChildOrbitOffset = (index: number) => {
  if (index < CHILD_OFFSETS.length) {
    return CHILD_OFFSETS[index]
  }

  const angle = ((index * MAP_GOLDEN_ANGLE - 90) * Math.PI) / 180
  const radius = 18 + (index % 3) * 4

  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  }
}

const repelMapNodes = (nodes: BrainMapNode[]) => {
  const movableNodes = nodes.filter((node) => node.kind !== 'current')

  for (let iteration = 0; iteration < 8; iteration += 1) {
    for (let leftIndex = 0; leftIndex < movableNodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < movableNodes.length; rightIndex += 1) {
        const left = movableNodes[leftIndex]
        const right = movableNodes[rightIndex]
        const leftPosition = { x: left.x || MAP_CENTER.x, y: left.y || MAP_CENTER.y }
        const rightPosition = { x: right.x || MAP_CENTER.x, y: right.y || MAP_CENTER.y }
        let deltaX = rightPosition.x - leftPosition.x
        let deltaY = rightPosition.y - leftPosition.y
        let distance = Math.hypot(deltaX, deltaY)

        if (distance < 0.001) {
          const angle = ((leftIndex + rightIndex + 1) * MAP_GOLDEN_ANGLE * Math.PI) / 180
          deltaX = Math.cos(angle)
          deltaY = Math.sin(angle)
          distance = 1
        }

        if (distance >= MAP_NODE_MIN_DISTANCE) {
          continue
        }

        const shift = (MAP_NODE_MIN_DISTANCE - distance) / 2
        const unitX = deltaX / distance
        const unitY = deltaY / distance

        placeMapItem(left, {
          x: leftPosition.x - unitX * shift,
          y: leftPosition.y - unitY * shift,
        })
        placeMapItem(right, {
          x: rightPosition.x + unitX * shift,
          y: rightPosition.y + unitY * shift,
        })
      }
    }
  }
}

const placeMapItem = <T extends { x?: number; y?: number }>(item: T, position: { x: number; y: number }) => {
  item.x = clampMapPosition(position.x)
  item.y = clampMapPosition(position.y)
}

const clampMapPosition = (value: number) => Math.min(MAP_MAX, Math.max(MAP_MIN, value))

const normalizeDigestTone = (tone: string): BrainMapDigestItem['tone'] => {
  switch (tone) {
    case 'hot':
    case 'high':
      return 'hot'
    case 'warm':
    case 'medium':
      return 'warm'
    default:
      return 'cool'
  }
}

const compareByScoreAndDate = (
  a: Pick<BrainSignal | MemoryLink, 'score' | 'createdAt' | 'updatedAt' | 'lastFiredAt'>,
  b: Pick<BrainSignal | MemoryLink, 'score' | 'createdAt' | 'updatedAt' | 'lastFiredAt'>,
) => {
  const scoreDelta = normalizeScore(b.score) - normalizeScore(a.score)

  if (scoreDelta !== 0) {
    return scoreDelta
  }

  return getTime(b.lastFiredAt || b.updatedAt || b.createdAt) - getTime(a.lastFiredAt || a.updatedAt || a.createdAt)
}

const getTime = (value?: string) => {
  const time = Date.parse(value || '')

  return Number.isFinite(time) ? time : 0
}

const normalizeScore = (score: number) => {
  if (!Number.isFinite(score)) {
    return 0
  }

  return Math.min(1, Math.max(0, score))
}

const formatGatewayLabel = (gateway?: BrainGateway) => {
  if (!gateway) {
    return 'memory overlap'
  }

  return gateway
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('/')
}
