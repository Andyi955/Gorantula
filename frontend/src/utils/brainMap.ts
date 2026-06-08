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
  from: string
  to: string
  strength: Lowercase<BrainMapTier>
  gateway?: BrainGateway
  score: number
}

export interface BrainMapDigestItem {
  id: string
  tone: 'hot' | 'warm' | 'cool'
  title: string
  detail: string
}

export interface BrainMapModel {
  nodes: BrainMapNode[]
  edges: BrainMapEdge[]
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
    from: 'brain-map-current',
    to: node.id,
    strength: getBrainMapTier(node.score).toLowerCase() as Lowercase<BrainMapTier>,
    gateway: node.gateways[0],
    score: node.score,
  }))

  const allScores = [...links.map((link) => link.score), ...signals.map((signal) => signal.score)]
  const strongestScore = allScores.length > 0 ? Math.max(...allScores) : 0

  return {
    nodes,
    edges,
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

  return {
    nodes,
    edges: view.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      strength: getBrainMapTier(edge.score).toLowerCase() as Lowercase<BrainMapTier>,
      gateway: edge.gateway,
      score: normalizeScore(edge.score),
    })),
    digest: view.digest.map((item) => ({
      id: item.id,
      tone: normalizeDigestTone(item.tone),
      title: item.title,
      detail: item.detail,
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
      tier: getBrainMapTier(item.link.score),
      slot,
      badges,
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
    tier: getBrainMapTier(item.signal.score),
    slot,
    badges: [
      'Signal',
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
