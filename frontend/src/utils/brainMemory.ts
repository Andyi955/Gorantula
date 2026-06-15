const API_BASE = 'http://localhost:8080/api/brain'

export type BrainGateway = 'entity-date' | 'source-domain' | 'relationship-tag' | string
export type BrainRelevance = 'strong-memory' | 'possible-bridge' | 'distant-echo' | 'background-noise' | string

export interface BrainSignalReason {
  gateway: BrainGateway
  value: string
  label: string
  detail: string
  currentNodeIds: string[]
  targetNodeIds: string[]
}

export interface BrainSignal {
  id: string
  investigationId: string
  investigationTitle: string
  targetInvestigationId: string
  targetTitle: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  gateways: BrainGateway[]
  reasons: BrainSignalReason[]
  suggestedAction: string
  createdAt: string
  updatedAt: string
  dismissed: boolean
  linked: boolean
  linkId?: string
  activationCount?: number
  lastFiredAt?: string
}

export interface MemoryLink {
  id: string
  signalId: string
  fromInvestigationId: string
  fromTitle: string
  toInvestigationId: string
  toTitle: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  gateways: BrainGateway[]
  reasons: BrainSignalReason[]
  suggestedAction: string
  createdAt: string
  updatedAt?: string
  lastFiredAt?: string
  activationCount?: number
  promotionType?: 'manual' | 'auto' | string
}

export interface MemoryClusterMember {
  investigationId: string
  title: string
  role: 'current' | 'memory' | string
}

export interface MemoryCluster {
  id: string
  label: string
  summary: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  status: 'active' | 'warm' | 'dormant' | string
  dominantGateway: BrainGateway
  gatewayCounts: Record<string, number>
  memberInvestigationIds: string[]
  members: MemoryClusterMember[]
  signalIds: string[]
  memoryLinkIds: string[]
  reasonSamples: BrainSignalReason[]
  pinned: boolean
  hidden: boolean
  createdAt: string
  updatedAt: string
  lastActivatedAt: string
}

export interface BrainSuggestion {
  id: string
  investigationId: string
  kind:
    | 'cluster-review'
    | 'source-review'
    | 'relationship-motif'
    | 'memory-link-compare'
    | 'gap-review'
    | string
  status: 'active' | 'dismissed' | 'reviewed' | string
  title: string
  summary: string
  suggestedAction: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  thinkingGateway?: string
  thinkingLabel?: string
  thinkingReason?: string
  actionMode?: 'compare' | 'verify' | 'fill-gap' | 'inspect' | 'launch-follow-up' | string
  priority: 'high' | 'medium' | 'low' | string
  reason: string
  reasonSamples?: BrainSignalReason[]
  missingEvidence?: string[]
  searchPrompt?: string
  reviewOutcome?: string
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  relatedClusterIds: string[]
  targetInvestigationIds: string[]
  createdAt: string
  updatedAt: string
  dismissedAt?: string
  reviewedAt?: string
  resolvedAt?: string
}

export interface PrepareBrainFollowUpRequest {
  investigationId: string
  sourceKind: 'suggestion' | string
  sourceId: string
}

export interface BrainFollowUpAction {
  id: string
  investigationId: string
  investigationTitle: string
  sourceKind: 'suggestion' | string
  sourceId: string
  status: 'prepared' | 'launched' | 'cancelled' | string
  title: string
  summary: string
  prompt: string
  descentMode: 'guided' | 'max' | string
  suggestedAction: string
  targetInvestigationIds: string[]
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  relatedClusterIds: string[]
  reasonSamples: BrainSignalReason[]
  createdAt: string
  updatedAt: string
  launchedAt?: string
  cancelledAt?: string
}

export interface BrainAttentionCounts {
  activeSignals: number
  linkedMemories: number
  memoryClusters: number
  activeNextMoves: number
  reviewedNextMoves: number
  reinforcedMemories: number
  dormantMemories: number
  autoLinkedMemories: number
  manualLinkedMemory: number
}

export interface BrainMemoryStrength {
  id: string
  kind: 'memory-link' | 'memory-cluster' | 'active-signal' | string
  title: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  state: 'reinforced' | 'hot' | 'warm' | 'fading' | 'dormant' | string
  targetInvestigationId?: string
  clusterId?: string
  signalId?: string
  linkId?: string
  gateway?: BrainGateway
  gateways: BrainGateway[]
  reasonSamples: BrainSignalReason[]
  activationCount: number
  signalCount: number
  memoryLinkCount: number
  clusterMemberCount: number
  lastActivatedAt?: string
  suggestedAction: string
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  memberInvestigationIds: string[]
}

export interface BrainAttentionItem {
  id: string
  kind: 'memory-reinforced' | 'cluster-active' | 'next-move-ready' | 'signal-firing' | string
  tone: string
  title: string
  detail: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  suggestedAction: string
  targetInvestigationId?: string
  clusterId?: string
  signalId?: string
  linkId?: string
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  relatedClusterIds: string[]
  memberInvestigationIds: string[]
  reasonSamples: BrainSignalReason[]
  updatedAt?: string
}

export interface BrainFocusNarrative {
  headline: string
  summary: string
  whyItMatters: string
  recommendedAction: string
  supportingFacts: string[]
  guidance: BrainGuidanceCard[]
  primaryKind?: string
  primaryTitle?: string
  primaryGateway?: BrainGateway
  relevance?: BrainRelevance
  relevanceLabel?: string
  relevanceReason?: string
  targetInvestigationId?: string
  clusterId?: string
  signalId?: string
  linkId?: string
}

export interface BrainGuidanceCard {
  kind: 'next-action' | 'evidence-trail' | 'caution' | 'gap' | 'freshness' | 'follow-up' | string
  tone: 'primary' | 'context' | 'caution' | 'steady' | 'neutral' | string
  title: string
  detail: string
  actionLabel: string
  targetInvestigationId?: string
  clusterId?: string
  signalId?: string
  linkId?: string
}

export interface BrainAttentionSummary {
  investigationId: string
  investigationTitle: string
  generatedAt: string
  overallScore: number
  dominantState: 'reinforced' | 'hot' | 'warm' | 'fading' | 'dormant' | string
  counts: BrainAttentionCounts
  memoryStrengths: BrainMemoryStrength[]
  items: BrainAttentionItem[]
  focus: BrainFocusNarrative
}

export interface BrainMapNode {
  id: string
  kind: 'current' | 'cluster' | 'memory' | 'signal' | string
  title: string
  subtitle: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  status: string
  gateway?: BrainGateway
  gatewayCounts?: Record<string, number>
  badges: string[]
  investigationId?: string
  targetInvestigationId?: string
  clusterId?: string
  signalId?: string
  linkId?: string
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  memberInvestigationIds: string[]
  reasonSamples: BrainSignalReason[]
  x: number
  y: number
}

export interface BrainMapEdge {
  id: string
  kind: 'cluster' | 'cluster-member' | 'link' | 'signal' | string
  from: string
  to: string
  label: string
  score: number
  gateway?: BrainGateway
  clusterId?: string
  signalId?: string
  linkId?: string
}

export interface BrainMapRegion {
  id: string
  clusterId: string
  label: string
  status: string
  score: number
  relevance?: BrainRelevance
  relevanceLabel?: string
  gateway: BrainGateway
  nodeIds: string[]
  memberInvestigationIds: string[]
  x: number
  y: number
}

export interface BrainMapDigestItem {
  id: string
  tone: 'hot' | 'warm' | 'cool' | 'weak' | 'high' | 'medium' | 'low' | string
  title: string
  detail: string
  relevance?: BrainRelevance
  relevanceLabel?: string
}

export interface BrainMapSummary {
  visibleNodeCount: number
  edgeCount: number
  clusterCount: number
  linkedMemoryCount: number
  activeSignalCount: number
  suggestionCount: number
  strongestScore: number
}

export interface BrainMapView {
  investigationId: string
  investigationTitle: string
  generatedAt: string
  nodes: BrainMapNode[]
  edges: BrainMapEdge[]
  regions: BrainMapRegion[]
  digest: BrainMapDigestItem[]
  summary: BrainMapSummary
}

const requestJSON = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Brain memory request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

const asStringArray = (value: unknown): string[] => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
)

const normalizeBrainSuggestion = (suggestion: BrainSuggestion): BrainSuggestion => ({
  ...suggestion,
  reasonSamples: Array.isArray(suggestion.reasonSamples) ? suggestion.reasonSamples : [],
  missingEvidence: asStringArray(suggestion.missingEvidence),
  relatedSignalIds: asStringArray(suggestion.relatedSignalIds),
  relatedMemoryLinkIds: asStringArray(suggestion.relatedMemoryLinkIds),
  relatedClusterIds: asStringArray(suggestion.relatedClusterIds),
  targetInvestigationIds: asStringArray(suggestion.targetInvestigationIds),
})

const normalizeBrainFollowUpAction = (action: BrainFollowUpAction): BrainFollowUpAction => ({
  ...action,
  targetInvestigationIds: asStringArray(action.targetInvestigationIds),
  relatedSignalIds: asStringArray(action.relatedSignalIds),
  relatedMemoryLinkIds: asStringArray(action.relatedMemoryLinkIds),
  relatedClusterIds: asStringArray(action.relatedClusterIds),
  reasonSamples: Array.isArray(action.reasonSamples) ? action.reasonSamples : [],
  descentMode: action.descentMode || 'guided',
})

const normalizeAttentionSummary = (summary: BrainAttentionSummary): BrainAttentionSummary => ({
  ...summary,
  focus: {
    headline: summary.focus?.headline || 'No strong Brain focus yet',
    summary: summary.focus?.summary || 'Run or refresh Brain after this investigation creates memory signals.',
    whyItMatters: summary.focus?.whyItMatters || 'Gorantula will surface repeated evidence once enough memory context exists.',
    recommendedAction: summary.focus?.recommendedAction || 'Continue the investigation',
    supportingFacts: asStringArray(summary.focus?.supportingFacts),
    guidance: Array.isArray(summary.focus?.guidance)
      ? summary.focus.guidance.map((card) => ({
          ...card,
          kind: card.kind || 'guidance',
          tone: card.tone || 'neutral',
          title: card.title || 'Brain guidance',
          detail: card.detail || 'Review the current Brain focus before continuing.',
          actionLabel: card.actionLabel || 'Review',
        }))
      : [],
    primaryKind: summary.focus?.primaryKind,
    primaryTitle: summary.focus?.primaryTitle,
    primaryGateway: summary.focus?.primaryGateway,
    targetInvestigationId: summary.focus?.targetInvestigationId,
    clusterId: summary.focus?.clusterId,
    signalId: summary.focus?.signalId,
    linkId: summary.focus?.linkId,
  },
  memoryStrengths: Array.isArray(summary.memoryStrengths)
    ? summary.memoryStrengths.map((strength) => ({
        ...strength,
        gateways: asStringArray(strength.gateways),
        relatedSignalIds: asStringArray(strength.relatedSignalIds),
        relatedMemoryLinkIds: asStringArray(strength.relatedMemoryLinkIds),
        memberInvestigationIds: asStringArray(strength.memberInvestigationIds),
        reasonSamples: Array.isArray(strength.reasonSamples) ? strength.reasonSamples : [],
      }))
    : [],
  items: Array.isArray(summary.items)
    ? summary.items.map((item) => ({
        ...item,
        relatedSignalIds: asStringArray(item.relatedSignalIds),
        relatedMemoryLinkIds: asStringArray(item.relatedMemoryLinkIds),
        relatedClusterIds: asStringArray(item.relatedClusterIds),
        memberInvestigationIds: asStringArray(item.memberInvestigationIds),
        reasonSamples: Array.isArray(item.reasonSamples) ? item.reasonSamples : [],
      }))
    : [],
})

export const fetchBrainSignals = (investigationId: string) =>
  requestJSON<BrainSignal[]>(`${API_BASE}/signals?investigationId=${encodeURIComponent(investigationId)}`)

export const fetchBrainLinks = (investigationId: string) =>
  requestJSON<MemoryLink[]>(`${API_BASE}/links?investigationId=${encodeURIComponent(investigationId)}`)

export const fetchBrainMap = (investigationId: string) =>
  requestJSON<BrainMapView>(`${API_BASE}/map?investigationId=${encodeURIComponent(investigationId)}`)

export const fetchBrainClusters = (investigationId: string) =>
  requestJSON<MemoryCluster[]>(`${API_BASE}/clusters?investigationId=${encodeURIComponent(investigationId)}`)

export const fetchBrainSuggestions = async (investigationId: string) => {
  const suggestions = await requestJSON<BrainSuggestion[]>(
    `${API_BASE}/suggestions?investigationId=${encodeURIComponent(investigationId)}`,
  )
  return suggestions.map(normalizeBrainSuggestion)
}

export const fetchBrainFollowUps = async (investigationId: string) => {
  const actions = await requestJSON<BrainFollowUpAction[]>(
    `${API_BASE}/followups?investigationId=${encodeURIComponent(investigationId)}`,
  )
  return actions.map(normalizeBrainFollowUpAction)
}

export const fetchBrainAttention = async (investigationId: string) => (
  normalizeAttentionSummary(await requestJSON<BrainAttentionSummary>(
    `${API_BASE}/attention?investigationId=${encodeURIComponent(investigationId)}`,
  ))
)

export const dismissBrainSignal = (signalId: string) =>
  requestJSON<BrainSignal>(`${API_BASE}/signals/${encodeURIComponent(signalId)}/dismiss`, {
    method: 'PUT',
  })

export const promoteBrainSignal = (signalId: string) =>
  requestJSON<MemoryLink>(`${API_BASE}/signals/${encodeURIComponent(signalId)}/link`, {
    method: 'PUT',
  })

export const forgetBrainLink = (linkId: string) =>
  requestJSON<MemoryLink>(`${API_BASE}/links/${encodeURIComponent(linkId)}/forget`, {
    method: 'PUT',
  })

export const toggleBrainClusterPin = (clusterId: string) =>
  requestJSON<MemoryCluster>(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/pin`, {
    method: 'PUT',
  })

export const hideBrainCluster = (clusterId: string) =>
  requestJSON<MemoryCluster>(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/hide`, {
    method: 'PUT',
  })

export const unhideBrainCluster = (clusterId: string) =>
  requestJSON<MemoryCluster>(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/unhide`, {
    method: 'PUT',
  })

export const dismissBrainSuggestion = (suggestionId: string) =>
  requestJSON<BrainSuggestion>(`${API_BASE}/suggestions/${encodeURIComponent(suggestionId)}/dismiss`, {
    method: 'PUT',
  }).then(normalizeBrainSuggestion)

export const reviewBrainSuggestion = (suggestionId: string) =>
  requestJSON<BrainSuggestion>(`${API_BASE}/suggestions/${encodeURIComponent(suggestionId)}/review`, {
    method: 'PUT',
  }).then(normalizeBrainSuggestion)

export const markBrainSuggestionOutcome = (suggestionId: string, outcome: string) =>
  requestJSON<BrainSuggestion>(`${API_BASE}/suggestions/${encodeURIComponent(suggestionId)}/outcome`, {
    method: 'PUT',
    body: JSON.stringify({ outcome }),
  }).then(normalizeBrainSuggestion)

export const prepareBrainFollowUp = (request: PrepareBrainFollowUpRequest) =>
  requestJSON<BrainFollowUpAction>(`${API_BASE}/followups/prepare`, {
    method: 'PUT',
    body: JSON.stringify(request),
  }).then(normalizeBrainFollowUpAction)

export const launchBrainFollowUp = (actionId: string) =>
  requestJSON<BrainFollowUpAction>(`${API_BASE}/followups/${encodeURIComponent(actionId)}/launch`, {
    method: 'PUT',
  }).then(normalizeBrainFollowUpAction)

export const cancelBrainFollowUp = (actionId: string) =>
  requestJSON<BrainFollowUpAction>(`${API_BASE}/followups/${encodeURIComponent(actionId)}/cancel`, {
    method: 'PUT',
  }).then(normalizeBrainFollowUpAction)
