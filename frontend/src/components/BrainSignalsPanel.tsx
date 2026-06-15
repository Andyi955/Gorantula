import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import {
  Bell,
  Brain,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Maximize2,
  Minimize2,
  Pin,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import brainRadarEmblem from '../assets/brain-radar-emblem.png'
import {
  BOARD_WORKSPACE_STATE_UPDATED_EVENT,
  type BoardWorkspaceStateUpdatedDetail,
} from '../utils/boardWorkspaceEvents'
import {
  dismissBrainSuggestion,
  dismissBrainSignal,
  cancelBrainFollowUp,
  fetchBrainAttention,
  fetchBrainAutonomy,
  fetchBrainClusters,
  fetchBrainFollowUps,
  fetchBrainLinks,
  fetchBrainMap,
  fetchBrainSuggestions,
  fetchBrainSignals,
  forgetBrainLink,
  hideBrainCluster,
  launchBrainFollowUp,
  markBrainSuggestionOutcome,
  prepareBrainFollowUp,
  promoteBrainSignal,
  reviewBrainSuggestion,
  toggleBrainClusterPin,
  unhideBrainCluster,
  updateBrainAutonomySettings,
  type BrainAttentionSummary,
  type BrainAutonomyMode,
  type BrainAutonomyQueueItem,
  type BrainAutonomySettings,
  type BrainAutonomyState,
  type BrainFollowUpAction,
  type BrainMemoryStrength,
  type BrainSuggestion,
  type BrainSignal,
  type BrainSignalReason,
  type BrainMapView,
  type MemoryCluster,
  type MemoryLink,
} from '../utils/brainMemory'
import {
  buildBrainMapModel,
  buildBrainMapModelFromView,
  type BrainMapEdge,
  type BrainMapNode,
  type BrainMapRegion,
  type BrainMapSlot,
} from '../utils/brainMap'
import {
  LOW_PRIORITY_SCORE_THRESHOLD,
  buildSignalSummary,
  clusterMatchesFilters,
  formatActivationCount,
  formatClusterGatewayCount,
  formatClusterMemberCount,
  formatClusterStatus,
  formatCountLabel,
  formatGateway,
  formatGatewayCount,
  formatMemoryLinkType,
  formatRelevance,
  formatNodeIds,
  formatScore,
  formatTimestamp,
  gatewayClassNames,
  getClusterLinkCount,
  getClusterSignalCount,
  getGatewayCounts,
  getRelatedFiringText,
  getRelatedMemoryText,
  getScoreTier,
  groupMemoryLinksByOlderCase,
  groupSignalsByOlderCase,
  isSpeculativeRelevance,
  matchesBrainFilters,
  normalizeRelevance,
  relevanceRank,
  relatedClustersForLinkGroup,
  relatedClustersForSignalGroup,
  sortByScore,
  sortClusters,
  type BrainSignalGroup,
  type GatewayFilter,
  type MemoryLinkGroup,
  type StrengthFilter,
} from '../utils/brainMemoryUtils'

interface BrainSignalsPanelProps {
  currentInvestigationId: string | null
  currentInvestigationTitle?: string | null
  onOpenInvestigation?: (investigationId: string) => void
  onLaunchFocusedRabbitHole?: (action: BrainFollowUpAction) => void
}

const PRIORITY_SIGNAL_LIMIT = 10
const LINKED_MEMORY_PRIORITY_LIMIT = 5
const NEXT_MOVES_PRIORITY_LIMIT = 7
const COMPACT_BRAIN_MAP_NODE_LIMIT = 8
const BRAIN_MAP_ZOOM_STEP = 0.12
const BRAIN_MAP_MIN_ZOOM = 0.82
const BRAIN_MAP_MAX_ZOOM = 1.54
const BRAIN_MAP_PAN_LIMIT = 44

const clampBrainMapValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const BOARD_MEMORY_REFRESH_DEBOUNCE_MS = 350
const BRAIN_MEMORY_FOLLOWUP_INTERVAL_MS = 1100
const BRAIN_MEMORY_FOLLOWUP_MAX_ATTEMPTS = 4

type BrainView = 'focus' | 'map' | 'moves' | 'signals' | 'links' | 'clusters' | 'autonomy'

type BrainCompareSelection =
  | { kind: 'signal'; id: string }
  | { kind: 'link'; id: string }
  | { kind: 'cluster'; id: string }
  | { kind: 'suggestion'; id: string }
  | { kind: 'map-node'; id: string }

interface BrainCompareContext {
  kindLabel: string
  title: string
  subtitle: string
  score: number
  currentTitle: string
  rememberedTitle: string
  suggestedAction: string
  reasons: BrainSignalReason[]
  gateways: string[]
  targetInvestigationId?: string
  relatedSummary: string[]
}

const gatewayFilterOptions: Array<{ value: GatewayFilter; label: string }> = [
  { value: 'all', label: 'All Gateways' },
  { value: 'entity-date', label: 'Entity/Date' },
  { value: 'source-domain', label: 'Source Domain' },
  { value: 'relationship-tag', label: 'Relationship' },
]

const strengthFilterOptions: Array<{ value: StrengthFilter; label: string }> = [
  { value: 'all', label: 'All Strengths' },
  { value: 'hot', label: 'Hot' },
  { value: 'warm', label: 'Warm' },
  { value: 'weak', label: 'Weak' },
]

const defaultAutonomySettings: BrainAutonomySettings = {
  mode: 'off',
  maxAutoPreparedPerInvestigation: 1,
  maxActivePrepared: 3,
}

const suggestionPriorityRank = (priority: string) => {
  switch (priority) {
    case 'high':
      return 0
    case 'medium':
      return 1
    default:
      return 2
  }
}

const suggestionStatusRank = (status: string) => (status === 'active' ? 0 : status === 'reviewed' ? 1 : 2)

const sortSuggestionsForView = (items: BrainSuggestion[]) => [...items].sort((left, right) => {
  const statusDelta = suggestionStatusRank(left.status) - suggestionStatusRank(right.status)
  if (statusDelta !== 0) {
    return statusDelta
  }
  const relevanceDelta = relevanceRank(left.relevance) - relevanceRank(right.relevance)
  if (relevanceDelta !== 0) {
    return relevanceDelta
  }
  const priorityDelta = suggestionPriorityRank(left.priority) - suggestionPriorityRank(right.priority)
  if (priorityDelta !== 0) {
    return priorityDelta
  }
  if (left.score === right.score) {
    return left.title.localeCompare(right.title)
  }
  return right.score - left.score
})

const brainMapNodeDisplayRank = (node: BrainMapNode) => {
  switch (node.kind) {
    case 'cluster':
      return 0
    case 'memory':
      return 1
    case 'signal':
      return 2
    default:
      return 3
  }
}

const compareBrainMapDisplayNodes = (left: BrainMapNode, right: BrainMapNode) => {
  const kindDelta = brainMapNodeDisplayRank(left) - brainMapNodeDisplayRank(right)

  if (kindDelta !== 0) {
    return kindDelta
  }

  const relevanceDelta = relevanceRank(left.relevance) - relevanceRank(right.relevance)
  if (relevanceDelta !== 0) {
    return relevanceDelta
  }

  const scoreDelta = right.score - left.score

  if (scoreDelta !== 0) {
    return scoreDelta
  }

  return left.title.localeCompare(right.title)
}

const formatSuggestionKind = (kind: string) => {
  switch (kind) {
    case 'cluster-review':
      return 'Cluster Review'
    case 'source-review':
      return 'Source Review'
    case 'relationship-motif':
      return 'Relationship Motif'
    case 'memory-link-compare':
      return 'Memory Link'
    case 'gap-review':
      return 'Gap Review'
    case 'contradiction-review':
      return 'Contradiction Review'
    default:
      return kind.replace(/-/g, ' ')
  }
}

const formatSuggestionActionNote = (suggestion: BrainSuggestion) => {
  switch (suggestion.actionMode) {
    case 'verify':
      return 'Verify before Rabbit Hole'
    case 'fill-gap':
      return 'Find bridge before Rabbit Hole'
    case 'inspect':
      return 'Inspect before Rabbit Hole'
    case 'compare':
      return 'Compare before Rabbit Hole'
    default:
      return 'Compare before Rabbit Hole'
  }
}

const formatSuggestionReviewOutcome = (outcome?: string) => {
  switch (outcome) {
    case 'verified-conflict':
      return 'Verified Conflict'
    case 'resolved':
      return 'Resolved'
    case 'false-alarm':
      return 'False Alarm'
    case 'needs-source':
      return 'Needs Source'
    case 'needs-date':
      return 'Needs Date'
    case 'needs-entity-bridge':
      return 'Needs Entity Bridge'
    case 'needs-relationship-bridge':
      return 'Needs Relationship Bridge'
    case 'needs-corroboration':
      return 'Needs Corroboration'
    default:
      return outcome ? outcome.replace(/-/g, ' ') : ''
  }
}

const formatMissingEvidence = (value: string) => {
  switch (value) {
    case 'source':
      return 'Source'
    case 'date':
      return 'Date'
    case 'entity-bridge':
      return 'Entity Bridge'
    case 'relationship-bridge':
      return 'Relationship Bridge'
    case 'corroborating-evidence':
      return 'Corroborating Evidence'
    default:
      return value.replace(/-/g, ' ')
  }
}

const missingEvidenceOutcome = (value: string) => {
  switch (value) {
    case 'source':
      return 'needs-source'
    case 'date':
      return 'needs-date'
    case 'entity-bridge':
      return 'needs-entity-bridge'
    case 'relationship-bridge':
      return 'needs-relationship-bridge'
    default:
      return 'needs-corroboration'
  }
}

const formatAutonomyDecision = (decision?: string) => {
  switch (decision) {
    case 'prepared':
      return 'Prepared'
    case 'would-prepare':
      return 'Would Prepare'
    case 'blocked':
      return 'Blocked'
    default:
      return decision ? decision.replace(/-/g, ' ') : 'Waiting'
  }
}

const formatAutonomyBlocker = (blocker: string) => {
  switch (blocker) {
    case 'unresolved-gap':
      return 'Unresolved Gap'
    case 'unresolved-contradiction':
      return 'Unresolved Contradiction'
    case 'duplicate-follow-up':
      return 'Duplicate Follow-Up'
    case 'investigation-budget':
      return 'Investigation Budget'
    case 'active-prepared-budget':
      return 'Active Prepared Budget'
    case 'unsafe-relevance':
      return 'Unsafe Relevance'
    default:
      return blocker.replace(/-/g, ' ')
  }
}

const formatAttentionState = (state: string) => {
  switch (state) {
    case 'reinforced':
      return 'Reinforced'
    case 'hot':
      return 'Hot'
    case 'warm':
      return 'Warm'
    case 'fading':
      return 'Fading'
    case 'dormant':
      return 'Dormant'
    default:
      return state ? state.replace(/-/g, ' ') : 'Dormant'
  }
}

const formatAttentionKind = (kind: string) => {
  switch (kind) {
    case 'memory-reinforced':
      return 'Memory reinforced'
    case 'cluster-active':
      return 'Cluster active'
    case 'next-move-ready':
      return 'Next move ready'
    case 'signal-firing':
      return 'Signal firing'
    default:
      return kind.replace(/-/g, ' ')
  }
}

const formatStrengthSummary = (strength?: BrainMemoryStrength) => {
  if (!strength) {
    return []
  }

  return [
    `Strength: ${formatAttentionState(strength.state)}`,
    `Memory score: ${formatScore(strength.score)}`,
    strength.activationCount > 0 ? formatActivationCount(strength.activationCount) : '',
  ].filter(Boolean)
}

const uniqueStrings = (items: Array<string | undefined>) => Array.from(new Set(
  items.filter((item): item is string => Boolean(item)),
))

const mergeCompareReasons = (...reasonGroups: Array<BrainSignalReason[] | undefined>) => {
  const seen = new Set<string>()
  const reasons: BrainSignalReason[] = []

  reasonGroups.flatMap((group) => group || []).forEach((reason) => {
    const key = `${reason.gateway}:${reason.value}:${reason.detail || reason.label}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    reasons.push(reason)
  })

  return reasons
}

export default function BrainSignalsPanel({
  currentInvestigationId,
  currentInvestigationTitle,
  onOpenInvestigation,
  onLaunchFocusedRabbitHole,
}: BrainSignalsPanelProps) {
  const [signals, setSignals] = useState<BrainSignal[]>([])
  const [links, setLinks] = useState<MemoryLink[]>([])
  const [clusters, setClusters] = useState<MemoryCluster[]>([])
  const [suggestions, setSuggestions] = useState<BrainSuggestion[]>([])
  const [followUps, setFollowUps] = useState<BrainFollowUpAction[]>([])
  const [brainMapView, setBrainMapView] = useState<BrainMapView | null>(null)
  const [autonomyState, setAutonomyState] = useState<BrainAutonomyState | null>(null)
  const [attentionSummary, setAttentionSummary] = useState<BrainAttentionSummary | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [showLowerPrioritySignals, setShowLowerPrioritySignals] = useState(false)
  const [showLowerPrioritySuggestions, setShowLowerPrioritySuggestions] = useState(false)
  const [showOlderMemoryLinks, setShowOlderMemoryLinks] = useState(false)
  const [showHiddenClusters, setShowHiddenClusters] = useState(false)
  const [selectedMemoryLinkId, setSelectedMemoryLinkId] = useState<string | null>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  const [selectedBrainMapNodeId, setSelectedBrainMapNodeId] = useState<string | null>(null)
  const [compareSelection, setCompareSelection] = useState<BrainCompareSelection | null>(null)
  const [pendingFollowUp, setPendingFollowUp] = useState<BrainFollowUpAction | null>(null)
  const [expandedPromptSuggestionId, setExpandedPromptSuggestionId] = useState<string | null>(null)
  const [activeBrainView, setActiveBrainView] = useState<BrainView>('focus')
  const [isAttentionOpen, setIsAttentionOpen] = useState(false)
  const [isBrainMapExpanded, setIsBrainMapExpanded] = useState(false)
  const [brainMapViewport, setBrainMapViewport] = useState({ scale: 1, x: 0, y: 0 })
  const [isBrainMapDragging, setIsBrainMapDragging] = useState(false)
  const [gatewayFilter, setGatewayFilter] = useState<GatewayFilter>('all')
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all')
  const [brainMemoryFollowupRunId, setBrainMemoryFollowupRunId] = useState(0)
  const brainMapDragStartRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    x: number
    y: number
  } | null>(null)
  const requestIdRef = useRef(0)
  const boardRefreshTimerRef = useRef<number | null>(null)
  const latestBoardRefreshSignatureRef = useRef<string | null>(null)

  const startBrainMemoryFollowup = useCallback(() => {
    setBrainMemoryFollowupRunId((current) => current + 1)
  }, [])

  const loadBrainMemory = useCallback(async (isManualRefresh = false, isBackgroundRefresh = false) => {
    if (!currentInvestigationId) {
      setSignals([])
      setLinks([])
      setClusters([])
      setSuggestions([])
      setFollowUps([])
      setBrainMapView(null)
      setAutonomyState(null)
      setAttentionSummary(null)
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
      setShowLowerPrioritySignals(false)
      setShowLowerPrioritySuggestions(false)
      setShowOlderMemoryLinks(false)
      setShowHiddenClusters(false)
      setSelectedMemoryLinkId(null)
      setSelectedClusterId(null)
      setSelectedBrainMapNodeId(null)
      setCompareSelection(null)
      setPendingFollowUp(null)
      setExpandedPromptSuggestionId(null)
      setIsAttentionOpen(false)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setError(null)
    if (isManualRefresh) {
      setIsRefreshing(true)
    } else if (!isBackgroundRefresh) {
      setIsLoading(true)
    }

    try {
      const nextSignals = await fetchBrainSignals(currentInvestigationId)
      const nextLinks = await fetchBrainLinks(currentInvestigationId)
      let nextBrainMap: BrainMapView | null = null
      try {
        nextBrainMap = await fetchBrainMap(currentInvestigationId)
      } catch {
        nextBrainMap = null
      }
      const nextClusters = await fetchBrainClusters(currentInvestigationId)
      const nextSuggestions = await fetchBrainSuggestions(currentInvestigationId)
      const nextFollowUps = await fetchBrainFollowUps(currentInvestigationId)
      let nextAutonomyState: BrainAutonomyState | null = null
      try {
        nextAutonomyState = await fetchBrainAutonomy(currentInvestigationId)
      } catch {
        nextAutonomyState = null
      }
      let nextAttention: BrainAttentionSummary | null = null
      try {
        nextAttention = await fetchBrainAttention(currentInvestigationId)
      } catch {
        nextAttention = null
      }

      if (requestIdRef.current !== requestId) {
        return
      }

      setSignals(sortByScore(nextSignals.filter((signal) => !signal.dismissed && !signal.linked)))
      setLinks(sortByScore(nextLinks))
      setClusters(sortClusters(nextClusters))
      setSuggestions(sortSuggestionsForView(nextSuggestions))
      setFollowUps(nextFollowUps)
      setBrainMapView(nextBrainMap && Array.isArray(nextBrainMap.nodes) ? nextBrainMap : null)
      setAutonomyState(nextAutonomyState)
      setAttentionSummary(nextAttention)
      setShowLowerPrioritySignals(false)
      setShowLowerPrioritySuggestions(false)
      setShowOlderMemoryLinks(false)
      setSelectedMemoryLinkId((current) =>
        current && nextLinks.some((link) => link.id === current) ? current : null,
      )
      setSelectedClusterId((current) =>
        current && nextClusters.some((cluster) => cluster.id === current) ? current : null,
      )
      setExpandedPromptSuggestionId((current) =>
        current && nextSuggestions.some((suggestion) => suggestion.id === current) ? current : null,
      )
      setPendingFollowUp((current) => current ? nextFollowUps.find((action) => action.id === current.id) || null : null)
    } catch {
      if (requestIdRef.current === requestId) {
        setError('Brain signals unavailable')
      }
    } finally {
      if (requestIdRef.current === requestId) {
        if (!isBackgroundRefresh) {
          setIsLoading(false)
        }
        setIsRefreshing(false)
      }
    }
  }, [currentInvestigationId])

  useEffect(() => {
    void loadBrainMemory()
    startBrainMemoryFollowup()
  }, [loadBrainMemory, startBrainMemoryFollowup])

  useEffect(() => {
    if (!currentInvestigationId || brainMemoryFollowupRunId === 0 || typeof window === 'undefined') {
      return undefined
    }

    let attempts = 0
    const intervalId = window.setInterval(() => {
      attempts += 1
      void loadBrainMemory(false, true)
      if (attempts >= BRAIN_MEMORY_FOLLOWUP_MAX_ATTEMPTS) {
        window.clearInterval(intervalId)
      }
    }, BRAIN_MEMORY_FOLLOWUP_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [brainMemoryFollowupRunId, currentInvestigationId, loadBrainMemory])

  useEffect(() => {
    if (!currentInvestigationId || typeof window === 'undefined') {
      return undefined
    }

    const clearScheduledRefresh = () => {
      if (boardRefreshTimerRef.current !== null) {
        window.clearTimeout(boardRefreshTimerRef.current)
        boardRefreshTimerRef.current = null
      }
    }

    const handleBoardWorkspaceUpdate = (event: Event) => {
      const detail = (event as CustomEvent<BoardWorkspaceStateUpdatedDetail>).detail
      if (!detail?.persisted || detail.source === 'memory-cache') {
        return
      }
      if (detail.investigationId && detail.investigationId !== currentInvestigationId) {
        return
      }

      const signature = detail.contentSignature || [
        detail.investigationId || currentInvestigationId,
        detail.nodeCount ?? 0,
        detail.edgeCount ?? 0,
        detail.source || 'persisted',
      ].join(':')
      if (latestBoardRefreshSignatureRef.current === signature) {
        return
      }
      latestBoardRefreshSignatureRef.current = signature

      clearScheduledRefresh()
      boardRefreshTimerRef.current = window.setTimeout(() => {
        boardRefreshTimerRef.current = null
        void loadBrainMemory(true)
        startBrainMemoryFollowup()
      }, BOARD_MEMORY_REFRESH_DEBOUNCE_MS)
    }

    window.addEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardWorkspaceUpdate)
    return () => {
      window.removeEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardWorkspaceUpdate)
      clearScheduledRefresh()
    }
  }, [currentInvestigationId, loadBrainMemory, startBrainMemoryFollowup])

  const rankedSignals = useMemo(() => sortByScore(signals), [signals])
  const allSignalGroups = useMemo(() => groupSignalsByOlderCase(rankedSignals), [rankedSignals])
  const filteredSignals = useMemo(
    () => rankedSignals.filter((signal) => matchesBrainFilters(signal, gatewayFilter, strengthFilter)),
    [rankedSignals, gatewayFilter, strengthFilter],
  )
  const signalGroups = useMemo(() => groupSignalsByOlderCase(filteredSignals), [filteredSignals])
  const { prioritySignalGroups, lowerPrioritySignalGroups } = useMemo(() => {
    const priority: BrainSignalGroup[] = []
    const lowerPriority: BrainSignalGroup[] = []

    signalGroups.forEach((group) => {
      if (!isSpeculativeRelevance(group.relevance) && group.score >= LOW_PRIORITY_SCORE_THRESHOLD && priority.length < PRIORITY_SIGNAL_LIMIT) {
        priority.push(group)
      } else {
        lowerPriority.push(group)
      }
    })

    return {
      prioritySignalGroups: priority,
      lowerPrioritySignalGroups: lowerPriority,
    }
  }, [signalGroups])
  const rankedLinks = useMemo(() => sortByScore(links), [links])
  const allLinkGroups = useMemo(() => groupMemoryLinksByOlderCase(rankedLinks), [rankedLinks])
  const filteredLinks = useMemo(
    () => rankedLinks.filter((link) => matchesBrainFilters(link, gatewayFilter, strengthFilter)),
    [rankedLinks, gatewayFilter, strengthFilter],
  )
  const linkGroups = useMemo(() => groupMemoryLinksByOlderCase(filteredLinks), [filteredLinks])
  const priorityLinkGroups = useMemo(() => linkGroups.slice(0, LINKED_MEMORY_PRIORITY_LIMIT), [linkGroups])
  const olderLinkGroups = useMemo(() => linkGroups.slice(LINKED_MEMORY_PRIORITY_LIMIT), [linkGroups])
  const rankedClusters = useMemo(() => sortClusters(clusters), [clusters])
  const filteredClusters = useMemo(
    () => rankedClusters.filter((cluster) => clusterMatchesFilters(cluster, gatewayFilter, strengthFilter)),
    [rankedClusters, gatewayFilter, strengthFilter],
  )
  const visibleClusters = useMemo(() => filteredClusters.filter((cluster) => !cluster.hidden), [filteredClusters])
  const hiddenClusters = useMemo(() => filteredClusters.filter((cluster) => cluster.hidden), [filteredClusters])
  const selectedCluster = useMemo(
    () => rankedClusters.find((cluster) => cluster.id === selectedClusterId) || null,
    [rankedClusters, selectedClusterId],
  )
  const rankedSuggestions = useMemo(() => sortSuggestionsForView(suggestions), [suggestions])
  const activeSuggestions = useMemo(
    () => rankedSuggestions.filter((suggestion) => suggestion.status === 'active'),
    [rankedSuggestions],
  )
  const { prioritySuggestions, lowerPrioritySuggestions } = useMemo(() => {
    const priority: BrainSuggestion[] = []
    const lowerPriority: BrainSuggestion[] = []

    activeSuggestions.forEach((suggestion) => {
      if (!isSpeculativeRelevance(suggestion.relevance) && priority.length < NEXT_MOVES_PRIORITY_LIMIT) {
        priority.push(suggestion)
      } else {
        lowerPriority.push(suggestion)
      }
    })

    return {
      prioritySuggestions: priority,
      lowerPrioritySuggestions: lowerPriority,
    }
  }, [activeSuggestions])
  const reviewedSuggestions = useMemo(
    () => rankedSuggestions.filter((suggestion) => suggestion.status === 'reviewed'),
    [rankedSuggestions],
  )
  const followUpsBySourceId = useMemo(() => {
    const bySource = new Map<string, BrainFollowUpAction>()
    followUps.forEach((action) => {
      if (action.sourceKind === 'suggestion' && action.sourceId) {
        bySource.set(action.sourceId, action)
      }
    })
    return bySource
  }, [followUps])
  const autonomySettings = autonomyState?.settings || defaultAutonomySettings
  const autonomyQueue = autonomyState?.queue || []
  const autonomyAudit = autonomyState?.audit || []
  const autonomyAutoPrepareEnabled = autonomySettings.mode === 'prepare-only' || autonomySettings.mode === 'ask-before-launch'
  const blockedAutonomyCount = useMemo(
    () => autonomyQueue.filter((item) => item.status === 'blocked' || item.decision === 'blocked').length,
    [autonomyQueue],
  )
  const activeTitle = currentInvestigationTitle || currentInvestigationId || 'No investigation selected'
  const localBrainMapModel = useMemo(
    () => buildBrainMapModel({
      currentInvestigationId: currentInvestigationId || undefined,
      currentInvestigationTitle: activeTitle,
      signals: rankedSignals,
      links: rankedLinks,
    }),
    [activeTitle, currentInvestigationId, rankedSignals, rankedLinks],
  )
  const backendBrainMapModel = useMemo(
    () => (brainMapView && Array.isArray(brainMapView.nodes) && brainMapView.nodes.length > 0
      ? buildBrainMapModelFromView(brainMapView)
      : null),
    [brainMapView],
  )
  const brainMapModel = backendBrainMapModel || localBrainMapModel
  const renderedBrainMapModel = useMemo(() => {
    if (isBrainMapExpanded || brainMapModel.nodes.length <= COMPACT_BRAIN_MAP_NODE_LIMIT) {
      return brainMapModel
    }

    const currentNode = brainMapModel.nodes.find((node) => node.kind === 'current')
    const visibleCandidates = brainMapModel.nodes
      .filter((node) => node.kind !== 'current')
      .sort(compareBrainMapDisplayNodes)
      .slice(0, COMPACT_BRAIN_MAP_NODE_LIMIT - (currentNode ? 1 : 0))
    const visibleNodes = currentNode ? [currentNode, ...visibleCandidates] : visibleCandidates
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
    const visibleClusterIds = new Set(
      visibleNodes.map((node) => node.clusterId).filter((clusterId): clusterId is string => Boolean(clusterId)),
    )
    const visibleRegions = brainMapModel.regions
      .filter((region) =>
        visibleClusterIds.has(region.clusterId) || region.nodeIds.some((nodeId) => visibleNodeIds.has(nodeId)),
      )
      .map((region) => {
        const visibleRegionNodes = visibleNodes.filter((node) =>
          node.clusterId === region.clusterId || region.nodeIds.includes(node.id),
        )

        if (visibleRegionNodes.length === 0) {
          return region
        }

        return {
          ...region,
          x: visibleRegionNodes.reduce((sum, node) => sum + (node.x || region.x), 0) / visibleRegionNodes.length,
          y: visibleRegionNodes.reduce((sum, node) => sum + (node.y || region.y), 0) / visibleRegionNodes.length,
        }
      })

    return {
      ...brainMapModel,
      nodes: visibleNodes,
      edges: brainMapModel.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)),
      regions: visibleRegions,
      hiddenCount: brainMapModel.hiddenCount + Math.max(0, brainMapModel.nodes.length - visibleNodes.length),
      summary: {
        ...brainMapModel.summary,
        visibleCount: Math.max(0, visibleNodes.length - (currentNode ? 1 : 0)),
      },
    }
  }, [brainMapModel, isBrainMapExpanded])
  const selectedBrainMapNode = useMemo(
    () =>
      renderedBrainMapModel.nodes.find((node) => node.id === selectedBrainMapNodeId) ||
      renderedBrainMapModel.nodes[0] ||
      null,
    [renderedBrainMapModel.nodes, selectedBrainMapNodeId],
  )
  const selectedMemoryLinkGroup = useMemo(
    () => allLinkGroups.find((group) => group.links.some((link) => link.id === selectedMemoryLinkId)) || null,
    [allLinkGroups, selectedMemoryLinkId],
  )
  const memoryStrengthByLinkId = useMemo(() => {
    const map = new Map<string, BrainMemoryStrength>()
    attentionSummary?.memoryStrengths.forEach((strength) => {
      if (strength.linkId) {
        map.set(strength.linkId, strength)
      }
    })
    return map
  }, [attentionSummary])
  const memoryStrengthBySignalId = useMemo(() => {
    const map = new Map<string, BrainMemoryStrength>()
    attentionSummary?.memoryStrengths.forEach((strength) => {
      if (strength.signalId) {
        map.set(strength.signalId, strength)
      }
    })
    return map
  }, [attentionSummary])
  const memoryStrengthByClusterId = useMemo(() => {
    const map = new Map<string, BrainMemoryStrength>()
    attentionSummary?.memoryStrengths.forEach((strength) => {
      if (strength.clusterId) {
        map.set(strength.clusterId, strength)
      }
    })
    return map
  }, [attentionSummary])
  const selectedCompareContext = useMemo<BrainCompareContext | null>(() => {
    if (!compareSelection) {
      return null
    }

    if (compareSelection.kind === 'signal') {
      const group = allSignalGroups.find((candidate) =>
        candidate.signals.some((signal) => signal.id === compareSelection.id),
      )
      if (!group) {
        return null
      }
      const signal = group.primary
      const strength = memoryStrengthBySignalId.get(signal.id)
      return {
        kindLabel: 'Active signal',
        title: signal.targetTitle,
        subtitle: 'Memory fired because this older case overlaps the current investigation.',
        score: group.score,
        currentTitle: signal.investigationTitle || activeTitle,
        rememberedTitle: signal.targetTitle,
        suggestedAction: signal.suggestedAction,
        reasons: group.reasons,
        gateways: uniqueStrings(group.gateways.map(formatGateway)),
        targetInvestigationId: signal.targetInvestigationId,
        relatedSummary: [
          ...formatStrengthSummary(strength),
          formatRelevance(signal),
          formatCountLabel(group.signals.length, 'signal'),
          ...relatedClustersForSignalGroup(group, rankedClusters).map((cluster) => `Cluster: ${cluster.label}`),
        ],
      }
    }

    if (compareSelection.kind === 'link') {
      const group = allLinkGroups.find((candidate) =>
        candidate.links.some((link) => link.id === compareSelection.id),
      )
      if (!group) {
        return null
      }
      const link = group.primary
      const currentIsFrom = link.fromInvestigationId === currentInvestigationId
      const strength = memoryStrengthByLinkId.get(link.id)
      return {
        kindLabel: 'Durable memory link',
        title: currentIsFrom ? link.toTitle : link.fromTitle,
        subtitle: 'This relationship has already been promoted into durable Brain memory.',
        score: group.score,
        currentTitle: currentIsFrom ? link.fromTitle : link.toTitle,
        rememberedTitle: currentIsFrom ? link.toTitle : link.fromTitle,
        suggestedAction: link.suggestedAction,
        reasons: group.reasons,
        gateways: uniqueStrings(group.gateways.map(formatGateway)),
        targetInvestigationId: currentIsFrom ? link.toInvestigationId : link.fromInvestigationId,
        relatedSummary: [
          ...formatStrengthSummary(strength),
          formatRelevance(link),
          formatMemoryLinkType(group.promotionType),
          formatActivationCount(group.activationCount),
          ...relatedClustersForLinkGroup(group, rankedClusters).map((cluster) => `Cluster: ${cluster.label}`),
        ],
      }
    }

    if (compareSelection.kind === 'cluster') {
      const cluster = rankedClusters.find((candidate) => candidate.id === compareSelection.id)
      if (!cluster) {
        return null
      }
      const targetMember = cluster.members.find((member) => member.investigationId !== currentInvestigationId)
      const strength = memoryStrengthByClusterId.get(cluster.id)
      return {
        kindLabel: 'Memory cluster',
        title: cluster.label,
        subtitle: cluster.summary,
        score: cluster.score,
        currentTitle: activeTitle,
        rememberedTitle: targetMember?.title || formatClusterMemberCount(cluster),
        suggestedAction: 'Inspect recurring memory cluster',
        reasons: cluster.reasonSamples,
        gateways: uniqueStrings([
          formatGateway(cluster.dominantGateway),
          ...Object.keys(cluster.gatewayCounts || {}).map(formatGateway),
        ]),
        targetInvestigationId: targetMember?.investigationId,
        relatedSummary: [
          ...formatStrengthSummary(strength),
          formatRelevance(cluster),
          formatClusterStatus(cluster.status),
          formatClusterMemberCount(cluster),
          formatCountLabel(getClusterSignalCount(cluster), 'signal'),
          formatCountLabel(getClusterLinkCount(cluster), 'memory link'),
        ],
      }
    }

    if (compareSelection.kind === 'suggestion') {
      const suggestion = rankedSuggestions.find((candidate) => candidate.id === compareSelection.id)
      if (!suggestion) {
        return null
      }
      const relatedSignals = rankedSignals.filter((signal) => suggestion.relatedSignalIds.includes(signal.id))
      const relatedLinks = rankedLinks.filter((link) => suggestion.relatedMemoryLinkIds.includes(link.id))
      const relatedClusters = rankedClusters.filter((cluster) => suggestion.relatedClusterIds.includes(cluster.id))
      const reasons = mergeCompareReasons(
        relatedSignals.flatMap((signal) => signal.reasons),
        relatedLinks.flatMap((link) => link.reasons),
        relatedClusters.flatMap((cluster) => cluster.reasonSamples),
      )
      const rememberedTitle =
        relatedClusters[0]?.label ||
        relatedLinks[0]?.toTitle ||
        relatedSignals[0]?.targetTitle ||
        suggestion.targetInvestigationIds[0] ||
        'Related memory context'
      const strength =
        (relatedLinks[0] ? memoryStrengthByLinkId.get(relatedLinks[0].id) : undefined) ||
        (relatedClusters[0] ? memoryStrengthByClusterId.get(relatedClusters[0].id) : undefined) ||
        (relatedSignals[0] ? memoryStrengthBySignalId.get(relatedSignals[0].id) : undefined)
      return {
        kindLabel: formatSuggestionKind(suggestion.kind),
        title: suggestion.title,
        subtitle: suggestion.summary,
        score: suggestion.score,
        currentTitle: activeTitle,
        rememberedTitle,
        suggestedAction: suggestion.suggestedAction,
        reasons,
        gateways: uniqueStrings([
          ...reasons.map((reason) => formatGateway(reason.gateway)),
          ...relatedClusters.map((cluster) => formatGateway(cluster.dominantGateway)),
        ]),
        targetInvestigationId:
          suggestion.targetInvestigationIds[0] ||
          relatedSignals[0]?.targetInvestigationId ||
          relatedLinks[0]?.toInvestigationId,
        relatedSummary: [
          ...formatStrengthSummary(strength),
          formatRelevance(suggestion),
          formatCountLabel(relatedClusters.length, 'cluster'),
          formatCountLabel(relatedSignals.length, 'signal'),
          formatCountLabel(relatedLinks.length, 'memory link'),
        ],
      }
    }

    const node = renderedBrainMapModel.nodes.find((candidate) => candidate.id === compareSelection.id)
    if (!node) {
      return null
    }
    const nodeStrength = node.linkId
      ? memoryStrengthByLinkId.get(node.linkId)
      : node.signalId
        ? memoryStrengthBySignalId.get(node.signalId)
        : node.clusterId
          ? memoryStrengthByClusterId.get(node.clusterId)
          : undefined

    return {
      kindLabel: node.kind === 'current'
        ? 'Map focus'
        : node.kind === 'memory'
          ? 'Linked memory'
          : node.kind === 'cluster'
            ? 'Memory cluster'
            : 'Active signal',
      title: node.kind === 'current' ? node.subtitle : node.title,
      subtitle: node.subtitle,
      score: node.score,
      currentTitle: activeTitle,
      rememberedTitle: node.kind === 'current' ? activeTitle : node.title,
      suggestedAction: node.kind === 'current' ? 'Review active memory movement' : 'Inspect selected memory object',
      reasons: node.reasons,
      gateways: uniqueStrings(node.gateways.map(formatGateway)),
      targetInvestigationId: node.targetInvestigationId,
      relatedSummary: [
        ...formatStrengthSummary(nodeStrength),
        node.relevanceLabel || formatRelevance(node),
        ...node.badges,
        formatCountLabel(node.relatedSignalIds?.length || 0, 'signal'),
        formatCountLabel(node.relatedMemoryLinkIds?.length || 0, 'memory link'),
      ],
    }
  }, [
    activeTitle,
    allLinkGroups,
    allSignalGroups,
    compareSelection,
    currentInvestigationId,
    memoryStrengthByClusterId,
    memoryStrengthByLinkId,
    memoryStrengthBySignalId,
    rankedClusters,
    rankedLinks,
    rankedSignals,
    rankedSuggestions,
    renderedBrainMapModel.nodes,
  ])
  const brainMapViewportStyle = useMemo(() => ({
    '--brain-map-scale': Number(brainMapViewport.scale.toFixed(2)).toString(),
    '--brain-map-pan-x': `${brainMapViewport.x}%`,
    '--brain-map-pan-y': `${brainMapViewport.y}%`,
  }) as CSSProperties, [brainMapViewport])
  const brainHealth = useMemo(() => {
    const scores = [
      ...allSignalGroups.map((group) => group.score),
      ...allLinkGroups.map((group) => group.score),
      ...rankedClusters.filter((cluster) => !cluster.hidden).map((cluster) => cluster.score),
    ]
    const strongestScore = scores.length > 0 ? Math.max(...scores) : 0
    const counts = attentionSummary?.counts
    const linkedMemoryCount = counts?.linkedMemories ?? allLinkGroups.length
    const activeSignalCount = counts?.activeSignals ?? allSignalGroups.length

    return {
      attentionState: formatAttentionState(attentionSummary?.dominantState || ''),
      attentionScore: formatScore(attentionSummary?.overallScore ?? strongestScore),
      firingCases: formatCountLabel(activeSignalCount, 'firing case'),
      memoryGroups: formatCountLabel(linkedMemoryCount, 'memory group'),
      memoryClusters: formatCountLabel(counts?.memoryClusters ?? rankedClusters.filter((cluster) => !cluster.hidden).length, 'memory cluster'),
      nextMoves: formatCountLabel(counts?.activeNextMoves ?? activeSuggestions.length, 'next move'),
    }
  }, [activeSuggestions.length, allSignalGroups, allLinkGroups, attentionSummary, rankedClusters])

  useEffect(() => {
    if (!selectedBrainMapNodeId) {
      return
    }

    if (!renderedBrainMapModel.nodes.some((node) => node.id === selectedBrainMapNodeId)) {
      setSelectedBrainMapNodeId(null)
    }
  }, [renderedBrainMapModel.nodes, selectedBrainMapNodeId])

  useEffect(() => {
    if (!selectedClusterId) {
      return
    }

    if (!rankedClusters.some((cluster) => cluster.id === selectedClusterId && !cluster.hidden)) {
      setSelectedClusterId(null)
    }
  }, [rankedClusters, selectedClusterId])

  useEffect(() => {
    if (compareSelection && !selectedCompareContext) {
      setCompareSelection(null)
    }
  }, [compareSelection, selectedCompareContext])

  const handleDismiss = async (group: BrainSignalGroup) => {
    const signalIds = group.signals.map((signal) => signal.id)
    setBusyAction(`dismiss:${group.key}`)
    setError(null)
    try {
      await Promise.all(signalIds.map((signalId) => dismissBrainSignal(signalId)))
      setSignals((current) => current.filter((signal) => !signalIds.includes(signal.id)))
    } catch {
      setError('Brain signal dismiss failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handlePromote = async (group: BrainSignalGroup) => {
    const signalIds = group.signals.map((signal) => signal.id)
    setBusyAction(`promote:${group.key}`)
    setError(null)
    try {
      const link = await promoteBrainSignal(group.primary.id)
      setSignals((current) => current.filter((signal) => !signalIds.includes(signal.id)))
      setLinks((current) => sortByScore([link, ...current.filter((candidate) => candidate.id !== link.id)]))
      setSelectedMemoryLinkId(link.id)
      setActiveBrainView('links')
    } catch {
      setError('Brain memory link failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleForgetLinkGroup = async (group: MemoryLinkGroup) => {
    const linkIds = group.links.map((link) => link.id)
    setBusyAction(`forget:${group.key}`)
    setError(null)
    try {
      await Promise.all(linkIds.map((linkId) => forgetBrainLink(linkId)))
      setLinks((current) => current.filter((candidate) => !linkIds.includes(candidate.id)))
      setSelectedMemoryLinkId((current) => (current && linkIds.includes(current) ? null : current))
    } catch {
      setError('Brain memory forget failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handlePromoteBrainMapSignal = async (node: BrainMapNode) => {
    if (!node.signalId) {
      return
    }

    setBusyAction(`promote-map:${node.signalId}`)
    setError(null)
    try {
      const link = await promoteBrainSignal(node.signalId)
      setSignals((current) => current.filter((signal) => signal.id !== node.signalId))
      setLinks((current) => sortByScore([link, ...current.filter((candidate) => candidate.id !== link.id)]))
      setSelectedMemoryLinkId(link.id)
      setSelectedBrainMapNodeId(`brain-map-link-${link.id}`)
      setActiveBrainView('links')
    } catch {
      setError('Brain memory link failed')
    } finally {
      setBusyAction(null)
    }
  }

  const updateCluster = (updatedCluster: MemoryCluster) => {
    setClusters((current) => sortClusters([
      updatedCluster,
      ...current.filter((cluster) => cluster.id !== updatedCluster.id),
    ]))
  }

  const handleToggleClusterPin = async (cluster: MemoryCluster) => {
    setBusyAction(`cluster-pin:${cluster.id}`)
    setError(null)
    try {
      updateCluster(await toggleBrainClusterPin(cluster.id))
    } catch {
      setError('Brain cluster pin failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleHideCluster = async (cluster: MemoryCluster) => {
    setBusyAction(`cluster-hide:${cluster.id}`)
    setError(null)
    try {
      const updatedCluster = await hideBrainCluster(cluster.id)
      updateCluster(updatedCluster)
      if (selectedClusterId === cluster.id) {
        setSelectedClusterId(null)
      }
    } catch {
      setError('Brain cluster hide failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleUnhideCluster = async (cluster: MemoryCluster) => {
    setBusyAction(`cluster-unhide:${cluster.id}`)
    setError(null)
    try {
      const updatedCluster = await unhideBrainCluster(cluster.id)
      updateCluster(updatedCluster)
      setSelectedClusterId(updatedCluster.id)
    } catch {
      setError('Brain cluster unhide failed')
    } finally {
      setBusyAction(null)
    }
  }

  const updateSuggestion = (updatedSuggestion: BrainSuggestion) => {
    setSuggestions((current) =>
      sortSuggestionsForView(current.map((candidate) => (candidate.id === updatedSuggestion.id ? updatedSuggestion : candidate))),
    )
  }

  const handleDismissSuggestion = async (suggestion: BrainSuggestion) => {
    setBusyAction(`suggestion-dismiss:${suggestion.id}`)
    setError(null)
    try {
      await dismissBrainSuggestion(suggestion.id)
      setSuggestions((current) => current.filter((candidate) => candidate.id !== suggestion.id))
    } catch {
      setError('Brain suggestion dismiss failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleReviewSuggestion = async (suggestion: BrainSuggestion) => {
    setBusyAction(`suggestion-review:${suggestion.id}`)
    setError(null)
    try {
      const reviewed = await reviewBrainSuggestion(suggestion.id)
      updateSuggestion(reviewed)
    } catch {
      setError('Brain suggestion review failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleSuggestionOutcome = async (suggestion: BrainSuggestion, outcome: string) => {
    setBusyAction(`suggestion-outcome:${suggestion.id}:${outcome}`)
    setError(null)
    try {
      const updated = await markBrainSuggestionOutcome(suggestion.id, outcome)
      updateSuggestion(updated)
    } catch {
      setError('Brain suggestion outcome failed')
    } finally {
      setBusyAction(null)
    }
  }

  const updateFollowUp = (updatedAction: BrainFollowUpAction) => {
    setFollowUps((current) => {
      const next = [
        updatedAction,
        ...current.filter((candidate) => candidate.id !== updatedAction.id),
      ]
      return next.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    })
    setPendingFollowUp((current) => (current?.id === updatedAction.id ? updatedAction : current))
  }

  const handlePrepareFollowUp = async (suggestion: BrainSuggestion) => {
    if (!currentInvestigationId) {
      return
    }

    setBusyAction(`followup-prepare:${suggestion.id}`)
    setError(null)
    try {
      const action = await prepareBrainFollowUp({
        investigationId: currentInvestigationId,
        sourceKind: 'suggestion',
        sourceId: suggestion.id,
      })
      updateFollowUp(action)
      setPendingFollowUp(action)
    } catch {
      setError('Focused follow-up preparation failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleLaunchFollowUp = async (action: BrainFollowUpAction) => {
    if (!onLaunchFocusedRabbitHole) {
      return
    }

    setBusyAction(`followup-launch:${action.id}`)
    setError(null)
    try {
      const launched = await launchBrainFollowUp(action.id)
      updateFollowUp(launched)
      setPendingFollowUp(null)
      onLaunchFocusedRabbitHole(launched)
    } catch {
      setError('Focused Rabbit Hole launch failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleCancelFollowUp = async (action: BrainFollowUpAction) => {
    setBusyAction(`followup-cancel:${action.id}`)
    setError(null)
    try {
      const cancelled = await cancelBrainFollowUp(action.id)
      updateFollowUp(cancelled)
      setPendingFollowUp(null)
    } catch {
      setError('Focused follow-up cancel failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleToggleAutonomyAutoPrepare = async () => {
    if (busyAction === 'autonomy-toggle') {
      return
    }
    const nextMode: BrainAutonomyMode = autonomyAutoPrepareEnabled ? 'off' : 'prepare-only'
    setBusyAction('autonomy-toggle')
    setError(null)
    try {
      const settings = await updateBrainAutonomySettings({
        ...autonomySettings,
        mode: nextMode,
      })
      setAutonomyState((current) => ({
        settings,
        queue: current?.queue || [],
        audit: current?.audit || [],
      }))
    } catch {
      setError('Brain autonomy settings update failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleViewSuggestionCluster = (suggestion: BrainSuggestion) => {
    const clusterId = suggestion.relatedClusterIds.find((id) =>
      rankedClusters.some((cluster) => cluster.id === id && !cluster.hidden),
    ) || suggestion.relatedClusterIds[0]
    if (!clusterId) {
      return
    }
    setGatewayFilter('all')
    setStrengthFilter('all')
    setSelectedClusterId(clusterId)
    setActiveBrainView('clusters')
  }

  const handleViewSuggestionLink = (suggestion: BrainSuggestion) => {
    const linkId = suggestion.relatedMemoryLinkIds.find((id) => rankedLinks.some((link) => link.id === id)) ||
      suggestion.relatedMemoryLinkIds[0]
    if (!linkId) {
      return
    }
    setGatewayFilter('all')
    setStrengthFilter('all')
    setSelectedMemoryLinkId(linkId)
    setActiveBrainView('links')
  }

  const handleViewSuggestionSignal = () => {
    setGatewayFilter('all')
    setStrengthFilter('all')
    setActiveBrainView('signals')
  }

  const focusCompareSelection = (): BrainCompareSelection | null => {
    const focus = attentionSummary?.focus
    if (!focus) {
      return null
    }
    if (focus.linkId && rankedLinks.some((link) => link.id === focus.linkId)) {
      return { kind: 'link', id: focus.linkId }
    }
    if (focus.clusterId && rankedClusters.some((cluster) => cluster.id === focus.clusterId)) {
      return { kind: 'cluster', id: focus.clusterId }
    }
    if (focus.signalId && rankedSignals.some((signal) => signal.id === focus.signalId)) {
      return { kind: 'signal', id: focus.signalId }
    }
    return null
  }

  const findSuggestionForFocus = () => {
    const focus = attentionSummary?.focus
    if (!focus) {
      return null
    }

    return rankedSuggestions.find((suggestion) =>
      (focus.clusterId && suggestion.relatedClusterIds.includes(focus.clusterId)) ||
      (focus.linkId && suggestion.relatedMemoryLinkIds.includes(focus.linkId)) ||
      (focus.signalId && suggestion.relatedSignalIds.includes(focus.signalId)) ||
      (focus.targetInvestigationId && suggestion.targetInvestigationIds.includes(focus.targetInvestigationId)),
    ) || null
  }

  const handleInspectFocus = () => {
    const focus = attentionSummary?.focus
    if (!focus) {
      return
    }
    setGatewayFilter('all')
    setStrengthFilter('all')
    if (focus.clusterId) {
      setSelectedClusterId(focus.clusterId)
      setActiveBrainView('clusters')
      return
    }
    if (focus.linkId) {
      setSelectedMemoryLinkId(focus.linkId)
      setActiveBrainView('links')
      return
    }
    if (focus.signalId) {
      setActiveBrainView('signals')
      return
    }
    setActiveBrainView('map')
  }

  const handleCompareFocus = () => {
    const selection = focusCompareSelection()
    if (selection) {
      setCompareSelection(selection)
    }
  }

  const resetBrainMapViewport = () => {
    setBrainMapViewport({ scale: 1, x: 0, y: 0 })
  }

  const handleToggleBrainMapExpanded = () => {
    if (isBrainMapExpanded) {
      resetBrainMapViewport()
    }

    setIsBrainMapExpanded((current) => !current)
  }

  const handleBrainMapWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!isBrainMapExpanded) {
      return
    }

    event.preventDefault()
    const zoomDelta = clampBrainMapValue(-event.deltaY / 650, -BRAIN_MAP_ZOOM_STEP * 1.5, BRAIN_MAP_ZOOM_STEP * 1.5)
    setBrainMapViewport((current) => ({
      ...current,
      scale: clampBrainMapValue(current.scale + zoomDelta, BRAIN_MAP_MIN_ZOOM, BRAIN_MAP_MAX_ZOOM),
    }))
  }

  const handleBrainMapPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isBrainMapExpanded || event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return
    }

    brainMapDragStartRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: brainMapViewport.x,
      y: brainMapViewport.y,
    }
    setIsBrainMapDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const handleBrainMapPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragStart = brainMapDragStartRef.current
    if (!dragStart || dragStart.pointerId !== event.pointerId) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const deltaX = ((event.clientX - dragStart.clientX) / Math.max(1, rect.width)) * 100
    const deltaY = ((event.clientY - dragStart.clientY) / Math.max(1, rect.height)) * 100

    setBrainMapViewport((current) => ({
      ...current,
      x: clampBrainMapValue(dragStart.x + deltaX, -BRAIN_MAP_PAN_LIMIT, BRAIN_MAP_PAN_LIMIT),
      y: clampBrainMapValue(dragStart.y + deltaY, -BRAIN_MAP_PAN_LIMIT, BRAIN_MAP_PAN_LIMIT),
    }))
  }

  const stopBrainMapDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    const pointerId = brainMapDragStartRef.current?.pointerId
    brainMapDragStartRef.current = null
    setIsBrainMapDragging(false)

    if (event && pointerId !== undefined && event.currentTarget.hasPointerCapture?.(pointerId)) {
      event.currentTarget.releasePointerCapture?.(pointerId)
    }
  }

  const handleBrainMapDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isBrainMapExpanded || (event.target as HTMLElement).closest('button')) {
      return
    }

    resetBrainMapViewport()
  }

  const findBrainMapNodeForSuggestion = (suggestion: BrainSuggestion) => {
    const clusterIds = suggestion.relatedClusterIds || []
    const linkIds = suggestion.relatedMemoryLinkIds || []
    const signalIds = suggestion.relatedSignalIds || []
    const targetInvestigationIds = suggestion.targetInvestigationIds || []

    return brainMapModel.nodes.find((node) =>
      (node.clusterId && clusterIds.includes(node.clusterId)) ||
      (node.linkId && linkIds.includes(node.linkId)) ||
      (node.signalId && signalIds.includes(node.signalId)) ||
      (node.targetInvestigationId && targetInvestigationIds.includes(node.targetInvestigationId)),
    )
  }

  const handleViewSuggestionMap = (suggestion: BrainSuggestion) => {
    const node = findBrainMapNodeForSuggestion(suggestion)

    if (!node) {
      return
    }

    setGatewayFilter('all')
    setStrengthFilter('all')
    setIsBrainMapExpanded(true)
    setSelectedBrainMapNodeId(node.id)
    setActiveBrainView('map')
  }

  const renderCompareWorkspace = (context: BrainCompareContext) => {
    const currentNodeIds = uniqueStrings(context.reasons.flatMap((reason) => reason.currentNodeIds))
    const rememberedNodeIds = uniqueStrings(context.reasons.flatMap((reason) => reason.targetNodeIds))
    const canOpenRememberedCase = !!context.targetInvestigationId && !!onOpenInvestigation
    const renderSourceActions = () => {
      if (!compareSelection) {
        return null
      }

      if (compareSelection.kind === 'signal') {
        const group = allSignalGroups.find((candidate) =>
          candidate.signals.some((signal) => signal.id === compareSelection.id),
        )

        if (!group) {
          return null
        }

        return (
          <>
            <button
              type="button"
              aria-label="Promote signal memory"
              className="forensic-brain-action forensic-brain-action-primary"
              disabled={busyAction === `promote:${group.key}`}
              onClick={() => {
                void handlePromote(group)
                setCompareSelection(null)
              }}
            >
              <Link2 size={13} />
              Promote Link
            </button>
            <button
              type="button"
              aria-label="Dismiss signal memory"
              className="forensic-brain-action forensic-brain-action-secondary"
              disabled={busyAction === `dismiss:${group.key}`}
              onClick={() => {
                void handleDismiss(group)
                setCompareSelection(null)
              }}
            >
              <X size={13} />
              Dismiss Signal
            </button>
          </>
        )
      }

      if (compareSelection.kind === 'suggestion') {
        const suggestion = rankedSuggestions.find((candidate) => candidate.id === compareSelection.id)

        if (!suggestion) {
          return null
        }

        return (
          <>
            <button
              type="button"
              aria-label="Mark move reviewed"
              className="forensic-brain-action forensic-brain-action-primary"
              disabled={suggestion.status === 'reviewed' || busyAction === `suggestion-review:${suggestion.id}`}
              onClick={() => {
                void handleReviewSuggestion(suggestion)
                setCompareSelection(null)
              }}
            >
              <Eye size={13} />
              Mark Reviewed
            </button>
            <button
              type="button"
              aria-label="Dismiss move"
              className="forensic-brain-action forensic-brain-action-secondary"
              disabled={busyAction === `suggestion-dismiss:${suggestion.id}`}
              onClick={() => {
                void handleDismissSuggestion(suggestion)
                setCompareSelection(null)
              }}
            >
              <X size={13} />
              Dismiss Move
            </button>
          </>
        )
      }

      if (compareSelection.kind === 'link') {
        const group = allLinkGroups.find((candidate) =>
          candidate.links.some((link) => link.id === compareSelection.id),
        )

        if (!group) {
          return null
        }

        return (
          <button
            type="button"
            aria-label="Forget compared memory link"
            className="forensic-brain-action forensic-brain-action-secondary"
            disabled={busyAction === `forget:${group.key}`}
            onClick={() => {
              void handleForgetLinkGroup(group)
              setCompareSelection(null)
            }}
          >
            <Trash2 size={13} />
            Forget Link
          </button>
        )
      }

      if (compareSelection.kind === 'cluster') {
        const cluster = rankedClusters.find((candidate) => candidate.id === compareSelection.id)

        if (!cluster) {
          return null
        }

        return (
          <>
            <button
              type="button"
              aria-label={`${cluster.pinned ? 'Unpin' : 'Pin'} compared cluster`}
              className="forensic-brain-action"
              disabled={busyAction === `cluster-pin:${cluster.id}`}
              onClick={() => void handleToggleClusterPin(cluster)}
            >
              <Pin size={13} />
              {cluster.pinned ? 'Unpin' : 'Pin'}
            </button>
            <button
              type="button"
              aria-label="Hide compared cluster"
              className="forensic-brain-action forensic-brain-action-secondary"
              disabled={busyAction === `cluster-hide:${cluster.id}`}
              onClick={() => {
                void handleHideCluster(cluster)
                setCompareSelection(null)
              }}
            >
              <EyeOff size={13} />
              Hide Cluster
            </button>
          </>
        )
      }

      return null
    }

    return (
      <section
        data-testid="brain-compare-workspace"
        role="dialog"
        aria-modal="true"
        aria-label={`Brain Compare for ${context.title}`}
        className="forensic-brain-compare-workspace"
      >
        <header className="forensic-brain-compare-header">
          <div>
            <span className="forensic-brain-panel-kicker">Brain Compare</span>
            <h3>{context.title}</h3>
            <p>{context.subtitle}</p>
          </div>
          <div className="forensic-brain-compare-header-actions">
            <strong>{formatScore(context.score)}</strong>
            <button
              type="button"
              aria-label="Close Brain Compare"
              className="forensic-brain-detail-close"
              onClick={() => setCompareSelection(null)}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="forensic-brain-compare-grid">
          <section className="forensic-brain-compare-case forensic-brain-compare-current">
            <span className="forensic-brain-card-label">Current investigation</span>
            <h4>{context.currentTitle}</h4>
            <p>Evidence currently firing the Brain memory system.</p>
            <dl>
              <div>
                <dt>Matched nodes</dt>
                <dd>{formatNodeIds(currentNodeIds)}</dd>
              </div>
            </dl>
          </section>

          <section className="forensic-brain-compare-reasons">
            <div className="forensic-brain-compare-reason-head">
              <span className="forensic-brain-card-label">{context.kindLabel}</span>
              <h4>Why this fired</h4>
            </div>
            <div className="forensic-brain-chip-row">
              {context.gateways.map((gateway) => (
                <span key={`compare:gateway:${gateway}`} className="forensic-brain-chip">
                  {gateway}
                </span>
              ))}
              {context.relatedSummary.map((item) => (
                <span key={`compare:summary:${item}`} className="forensic-brain-chip">
                  {item}
                </span>
              ))}
            </div>
            {context.reasons.length > 0 ? (
              <div className="forensic-brain-compare-reason-list">
                {context.reasons.slice(0, 8).map((reason, index) => (
                  <article key={`compare:reason:${reason.gateway}:${reason.value}:${index}`}>
                    <strong>{formatGateway(reason.gateway)}</strong>
                    <p>{reason.detail || reason.label}</p>
                    <dl>
                      <div>
                        <dt>Current</dt>
                        <dd>{formatNodeIds(reason.currentNodeIds)}</dd>
                      </div>
                      <div>
                        <dt>Remembered</dt>
                        <dd>{formatNodeIds(reason.targetNodeIds)}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <p className="forensic-brain-compare-empty">
                This object has no node-level reason trail yet, but it is still connected to the current Brain memory view.
              </p>
            )}
          </section>

          <section className="forensic-brain-compare-case forensic-brain-compare-memory">
            <span className="forensic-brain-card-label">Remembered context</span>
            <h4>{context.rememberedTitle}</h4>
            <p>Prior memory or cluster context being compared with the current investigation.</p>
            <dl>
              <div>
                <dt>Matched nodes</dt>
                <dd>{formatNodeIds(rememberedNodeIds)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <footer className="forensic-brain-compare-footer">
          <div>
            <span className="forensic-brain-card-label">Decision</span>
            <strong>{context.suggestedAction}</strong>
          </div>
          <div className="forensic-brain-compare-actions">
            {renderSourceActions()}
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-primary"
              disabled={!canOpenRememberedCase}
              onClick={() => {
                if (context.targetInvestigationId) {
                  onOpenInvestigation?.(context.targetInvestigationId)
                }
              }}
            >
              <ExternalLink size={13} />
              Open Remembered Case
            </button>
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-secondary"
              onClick={() => setCompareSelection(null)}
            >
              <X size={13} />
              Close
            </button>
          </div>
        </footer>
      </section>
    )
  }

  const renderSignalGroup = (group: BrainSignalGroup) => {
    const relatedFiringText = getRelatedFiringText(group.signals.length)
    const signal = group.primary
    const scoreTier = getScoreTier(group.score)
    const gatewayCounts = getGatewayCounts(group)
    const signalSummary = buildSignalSummary(group)
    const relatedClusters = relatedClustersForSignalGroup(group, rankedClusters)
    const relevance = normalizeRelevance(group.relevance)
    const relevanceLabel = group.relevanceLabel || formatRelevance(signal)

    return (
      <article
        key={group.key}
        data-testid="brain-signal-card"
        data-signal-id={signal.id}
        data-signal-group={group.key}
        className={`forensic-brain-signal-card forensic-brain-relevance-${relevance}`}
      >
        <div className="forensic-brain-card-rail" aria-hidden="true">
          <div className="forensic-brain-rail-scope">
            <img src={brainRadarEmblem} alt="" />
          </div>
          <div className="forensic-brain-rail-label">
            <span>Signal</span>
            <span>Strength</span>
          </div>
          <strong className={`forensic-brain-rail-score forensic-brain-score-${scoreTier.toLocaleLowerCase()}`}>
            <span>{formatScore(group.score)}</span>
            <em>{scoreTier}</em>
          </strong>
          <div className="forensic-brain-rail-bars">
            {Array.from({ length: 8 }, (_, index) => (
              <span
                key={`${group.key}:bar:${index}`}
                className={index < Math.max(1, Math.round(group.score * 8)) ? 'is-active' : ''}
              />
            ))}
          </div>
        </div>

        <div className="forensic-brain-card-main">
          <div className="forensic-brain-card-topline">
            <div className="forensic-brain-card-identity">
              <span className="forensic-brain-card-label">Older case fired</span>
              <h4>{signal.targetTitle}</h4>
              <span className={`forensic-brain-relevance-chip forensic-brain-relevance-chip-${relevance}`}>
                {relevanceLabel}
              </span>
              {relatedFiringText && (
                <span className="forensic-brain-card-group-count">{relatedFiringText}</span>
              )}
            </div>

            <div className="forensic-brain-card-gateways">
              <span>Firing gateways</span>
              <div className="forensic-brain-chip-row" aria-label="Signal gateways">
                {gatewayCounts.map(({ gateway, count }) => (
                  <span
                    key={`${group.key}:${gateway}`}
                    className={`forensic-brain-chip ${gatewayClassNames[gateway] || ''}`}
                  >
                    {formatGatewayCount({ gateway, count })}
                  </span>
                ))}
              </div>
              {relatedClusters.length > 0 && (
                <div className="forensic-brain-cluster-chip-row" aria-label="Related memory clusters">
                  {relatedClusters.map((cluster) => (
                    <span key={`${group.key}:cluster:${cluster.id}`} className="forensic-brain-cluster-chip">
                      Cluster: {cluster.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="forensic-brain-card-body">
            <div className="forensic-brain-evidence-panel">
              <div className="forensic-brain-signal-summary">
                <span>Why it fired</span>
                <strong>{signalSummary}</strong>
                {group.relevanceReason && (
                  <em>{group.relevanceReason}</em>
                )}
              </div>

              <div className="forensic-brain-reason-stack">
                {group.reasons.slice(0, 3).map((reason, index) => (
                  <p key={`${group.key}:detail:${reason.gateway}:${reason.value}:${index}`}>
                    <span>{formatGateway(reason.gateway)}</span>
                    {reason.detail || reason.label}
                  </p>
                ))}
              </div>
            </div>

            <aside className="forensic-brain-action-panel">
              <div className="forensic-brain-suggested-action">
                <span>Suggested action</span>
                <strong>{signal.suggestedAction}</strong>
              </div>

              <div className="forensic-brain-card-actions">
                <button
                  type="button"
                  aria-label={`Compare memory ${signal.targetTitle}`}
                  onClick={() => setCompareSelection({ kind: 'signal', id: signal.id })}
                  className="forensic-brain-action forensic-brain-action-primary"
                >
                  <Maximize2 size={13} />
                  Compare
                </button>
                <button
                  type="button"
                  aria-label={`Promote signal for ${signal.targetTitle}`}
                  onClick={() => void handlePromote(group)}
                  disabled={busyAction === `promote:${group.key}`}
                  className="forensic-brain-action forensic-brain-action-primary"
                >
                  <Link2 size={13} />
                  Promote Link
                </button>
                <button
                  type="button"
                  aria-label={`Open investigation ${signal.targetTitle}`}
                  onClick={() => onOpenInvestigation?.(signal.targetInvestigationId)}
                  className="forensic-brain-action"
                >
                  <ExternalLink size={13} />
                  Open
                </button>
                <button
                  type="button"
                  aria-label={`Dismiss signal for ${signal.targetTitle}`}
                  onClick={() => void handleDismiss(group)}
                  disabled={busyAction === `dismiss:${group.key}`}
                  className="forensic-brain-action forensic-brain-action-secondary"
                >
                  <X size={13} />
                  Dismiss
                </button>
              </div>
            </aside>
          </div>
        </div>
      </article>
    )
  }

  const renderMemoryLink = (group: MemoryLinkGroup) => {
    const link = group.primary
    const relatedMemoryText = getRelatedMemoryText(group.links.length)
    const relatedClusters = relatedClustersForLinkGroup(group, rankedClusters)
    const relevance = normalizeRelevance(link.relevance)

    return (
    <article key={group.key} data-testid="brain-link-card" className={`forensic-brain-link-card forensic-brain-relevance-${relevance}`}>
      <button
        type="button"
        className="forensic-brain-link-open"
        aria-label={`Inspect memory link ${link.toTitle}`}
        aria-expanded={selectedMemoryLinkGroup?.key === group.key}
        onClick={() => setSelectedMemoryLinkId(link.id)}
      >
        <span className="forensic-brain-link-header">
          <Link2 size={14} />
          <strong>{link.toTitle}</strong>
          <span>{formatScore(group.score)}</span>
        </span>
        <span className="forensic-brain-link-meta">
          <span className={group.promotionType === 'auto' ? 'forensic-brain-link-meta-auto' : ''}>
            {formatMemoryLinkType(group.promotionType)}
          </span>
          <span>{formatActivationCount(group.activationCount)}</span>
          <span>{formatRelevance(link)}</span>
          {relatedMemoryText && <span>{relatedMemoryText}</span>}
        </span>
        <span className="forensic-brain-link-preview">{group.reasons[0]?.detail || link.suggestedAction}</span>
      </button>
      <div className="forensic-brain-chip-row">
        {group.gateways.map((gateway) => (
          <span
            key={`${group.key}:${gateway}`}
            className={`forensic-brain-chip ${gatewayClassNames[gateway] || ''}`}
          >
            {formatGateway(gateway)}
          </span>
        ))}
      </div>
      {relatedClusters.length > 0 && (
        <div className="forensic-brain-cluster-chip-row" aria-label="Related memory clusters">
          {relatedClusters.map((cluster) => (
            <span key={`${group.key}:cluster:${cluster.id}`} className="forensic-brain-cluster-chip">
              Cluster: {cluster.label}
            </span>
          ))}
        </div>
      )}
      <div className="forensic-brain-link-card-actions">
        <button
          type="button"
          aria-label={`Compare memory link ${link.toTitle}`}
          className="forensic-brain-action forensic-brain-action-primary"
          onClick={() => setCompareSelection({ kind: 'link', id: link.id })}
        >
          <Maximize2 size={13} />
          Compare
        </button>
      </div>
    </article>
    )
  }

  const renderMemoryLinkDetail = (group: MemoryLinkGroup) => {
    const link = group.primary
    const relatedMemoryText = getRelatedMemoryText(group.links.length)
    const relevance = formatRelevance(link)

    return (
    <aside
      data-testid="brain-link-detail"
      role="dialog"
      aria-label={`Memory link detail for ${link.toTitle}`}
      className="forensic-brain-link-detail"
    >
      <header className="forensic-brain-link-detail-header">
        <div>
          <span className="forensic-brain-panel-kicker">Memory link detail</span>
          <h3>{link.toTitle}</h3>
        </div>
        <button
          type="button"
          aria-label="Close memory link detail"
          className="forensic-brain-detail-close"
          onClick={() => setSelectedMemoryLinkId(null)}
        >
          <X size={14} />
        </button>
      </header>

      <div className="forensic-brain-detail-metrics">
        <div>
          <span>Score</span>
          <strong>{formatScore(group.score)}</strong>
        </div>
        <div>
          <span>Memory Type</span>
          <strong>{formatMemoryLinkType(group.promotionType)}</strong>
        </div>
        <div>
          <span>Activation Count</span>
          <strong>{formatActivationCount(group.activationCount)}</strong>
        </div>
        <div>
          <span>Relevance</span>
          <strong>{relevance}</strong>
        </div>
      </div>

      <div className="forensic-brain-detail-section">
        <span>Connected Investigations</span>
        <p><strong>{link.fromTitle}</strong> connects to <strong>{link.toTitle}</strong>.</p>
        {relatedMemoryText && (
          <p className="forensic-brain-detail-compressed">{relatedMemoryText} compressed into this memory case.</p>
        )}
        <div className="forensic-brain-detail-actions">
          <button
            type="button"
            aria-label={`Compare memory link ${link.toTitle}`}
            className="forensic-brain-action forensic-brain-action-primary"
            onClick={() => setCompareSelection({ kind: 'link', id: link.id })}
          >
            <Maximize2 size={13} />
            Compare
          </button>
          <button
            type="button"
            aria-label={`Open memory link ${link.toTitle}`}
            className="forensic-brain-action"
            onClick={() => onOpenInvestigation?.(link.toInvestigationId)}
          >
            <ExternalLink size={13} />
            Open Older Case
          </button>
          <button
            type="button"
            aria-label={`Forget memory link ${link.toTitle}`}
            className="forensic-brain-action forensic-brain-action-secondary"
            disabled={busyAction === `forget:${group.key}`}
            onClick={() => void handleForgetLinkGroup(group)}
          >
            <Trash2 size={13} />
            Forget Link
          </button>
        </div>
      </div>

      <div className="forensic-brain-detail-timestamps">
        <div>
          <span>First fired</span>
          <strong>{formatTimestamp(link.createdAt)}</strong>
        </div>
        <div>
          <span>Last fired</span>
          <strong>{formatTimestamp(link.lastFiredAt || link.updatedAt || link.createdAt)}</strong>
        </div>
      </div>

      <div className="forensic-brain-detail-section">
        <span>Gateways</span>
        <div className="forensic-brain-chip-row">
          {group.gateways.map((gateway) => (
            <span
              key={`${group.key}:detail:${gateway}`}
              className={`forensic-brain-chip ${gatewayClassNames[gateway] || ''}`}
            >
              {formatGateway(gateway)}
            </span>
          ))}
        </div>
      </div>

      <div className="forensic-brain-detail-section">
        <span>Evidence Reasons</span>
        <div className="forensic-brain-detail-reasons">
          {group.reasons.map((reason, index) => (
            <article key={`${group.key}:reason:${reason.gateway}:${reason.value}:${index}`}>
              <strong>{formatGateway(reason.gateway)}</strong>
              <p>{reason.detail || reason.label}</p>
              <dl>
                <div>
                  <dt>Current nodes</dt>
                  <dd>{formatNodeIds(reason.currentNodeIds)}</dd>
                </div>
                <div>
                  <dt>Older nodes</dt>
                  <dd>{formatNodeIds(reason.targetNodeIds)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>
    </aside>
    )
  }

  const renderClusterCard = (cluster: MemoryCluster, isHidden = false) => {
    const statusLabel = formatClusterStatus(cluster.status)
    const signalCount = getClusterSignalCount(cluster)
    const linkCount = getClusterLinkCount(cluster)
    const relevance = normalizeRelevance(cluster.relevance)

    return (
      <article
        key={`${isHidden ? 'hidden' : 'visible'}:${cluster.id}`}
        data-testid={isHidden ? 'brain-hidden-cluster-card' : 'brain-cluster-card'}
        className={[
          'forensic-brain-cluster-card',
          `forensic-brain-relevance-${relevance}`,
          cluster.pinned ? 'is-pinned' : '',
          isHidden ? 'is-hidden' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="forensic-brain-cluster-card-main">
          <div className="forensic-brain-cluster-card-topline">
            <span className="forensic-brain-card-label">Memory cluster</span>
            <div className="forensic-brain-cluster-card-badges">
              {cluster.pinned && <span>Pinned</span>}
              <span>{statusLabel}</span>
              <span>{formatRelevance(cluster)}</span>
              <strong>{formatScore(cluster.score)}</strong>
            </div>
          </div>
          <h4>{cluster.label}</h4>
          <p>{cluster.summary}</p>
          <div className="forensic-brain-chip-row">
            <span className={`forensic-brain-chip ${gatewayClassNames[cluster.dominantGateway] || ''}`}>
              {formatClusterGatewayCount(cluster)}
            </span>
            <span className="forensic-brain-chip">{formatClusterMemberCount(cluster)}</span>
            <span className="forensic-brain-chip">{formatCountLabel(signalCount, 'signal')}</span>
            <span className="forensic-brain-chip">{formatCountLabel(linkCount, 'memory link')}</span>
          </div>
        </div>

        <div className="forensic-brain-cluster-actions">
          {!isHidden && (
            <button
              type="button"
              aria-label={`Compare cluster ${cluster.label}`}
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={() => setCompareSelection({ kind: 'cluster', id: cluster.id })}
            >
              <Maximize2 size={13} />
              Compare
            </button>
          )}
          {!isHidden && (
            <button
              type="button"
              aria-label={`Inspect cluster ${cluster.label}`}
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={() => setSelectedClusterId(cluster.id)}
            >
              <ExternalLink size={13} />
              Inspect
            </button>
          )}
          {!isHidden && (
            <button
              type="button"
              aria-label={`${cluster.pinned ? 'Unpin' : 'Pin'} cluster ${cluster.label}`}
              className="forensic-brain-action"
              disabled={busyAction === `cluster-pin:${cluster.id}`}
              onClick={() => void handleToggleClusterPin(cluster)}
            >
              <Pin size={13} />
              {cluster.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {isHidden ? (
            <button
              type="button"
              aria-label={`Unhide cluster ${cluster.label}`}
              className="forensic-brain-action"
              disabled={busyAction === `cluster-unhide:${cluster.id}`}
              onClick={() => void handleUnhideCluster(cluster)}
            >
              <Eye size={13} />
              Unhide
            </button>
          ) : (
            <button
              type="button"
              aria-label={`Hide cluster ${cluster.label}`}
              className="forensic-brain-action forensic-brain-action-secondary"
              disabled={busyAction === `cluster-hide:${cluster.id}`}
              onClick={() => void handleHideCluster(cluster)}
            >
              <EyeOff size={13} />
              Hide
            </button>
          )}
        </div>
      </article>
    )
  }

  const renderClusterDetail = (cluster: MemoryCluster) => (
    <aside
      data-testid="brain-cluster-detail"
      role="dialog"
      aria-label={`Memory cluster detail for ${cluster.label}`}
      className="forensic-brain-cluster-detail"
    >
      <header className="forensic-brain-link-detail-header">
        <div>
          <span className="forensic-brain-panel-kicker">Cluster detail</span>
          <h3>{cluster.label}</h3>
        </div>
        <button
          type="button"
          aria-label="Close memory cluster detail"
          className="forensic-brain-detail-close"
          onClick={() => setSelectedClusterId(null)}
        >
          <X size={14} />
        </button>
      </header>

      <div className="forensic-brain-detail-metrics">
        <div>
          <span>Strength</span>
          <strong>{formatScore(cluster.score)}</strong>
        </div>
        <div>
          <span>Relevance</span>
          <strong>{formatRelevance(cluster)}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{formatClusterStatus(cluster.status)}</strong>
        </div>
        <div>
          <span>Gateway</span>
          <strong>{formatGateway(cluster.dominantGateway)}</strong>
        </div>
      </div>

      {(cluster.summary || cluster.relevanceReason) && (
        <div className="forensic-brain-detail-section">
          <span>Calibration</span>
          {cluster.summary && <p>{cluster.summary}</p>}
          {cluster.relevanceReason && <p>{cluster.relevanceReason}</p>}
        </div>
      )}

      <div className="forensic-brain-detail-section">
        <span>Member Investigations</span>
        <div className="forensic-brain-cluster-member-list">
          {cluster.members.map((member) => (
            <div key={`${cluster.id}:member:${member.investigationId}`}>
              <strong>{member.title || member.investigationId}</strong>
              <span>{member.role === 'current' ? 'Current focus' : 'Memory case'}</span>
              {member.role !== 'current' && (
                <button
                  type="button"
                  aria-label={`Open cluster member ${member.title || member.investigationId}`}
                  className="forensic-brain-action"
                  onClick={() => onOpenInvestigation?.(member.investigationId)}
                >
                  <ExternalLink size={13} />
                  Open
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="forensic-brain-detail-section">
        <span>Reason Samples</span>
        <div className="forensic-brain-detail-reasons">
          {cluster.reasonSamples.map((reason, index) => (
            <article key={`${cluster.id}:reason:${reason.gateway}:${reason.value}:${index}`}>
              <strong>{formatGateway(reason.gateway)}</strong>
              <p>{reason.detail || reason.label}</p>
              <dl>
                <div>
                  <dt>Current nodes</dt>
                  <dd>{formatNodeIds(reason.currentNodeIds)}</dd>
                </div>
                <div>
                  <dt>Memory nodes</dt>
                  <dd>{formatNodeIds(reason.targetNodeIds)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </div>

      <div className="forensic-brain-detail-section">
        <span>Related Memory Objects</span>
        <div className="forensic-brain-chip-row">
          <span className="forensic-brain-chip">{formatCountLabel(getClusterSignalCount(cluster), 'signal')}</span>
          <span className="forensic-brain-chip">{formatCountLabel(getClusterLinkCount(cluster), 'memory link')}</span>
          {cluster.pinned && <span className="forensic-brain-chip">Pinned</span>}
        </div>
      </div>
    </aside>
  )

  const brainMapSlotPositions: Record<BrainMapSlot, { x: number; y: number }> = {
    center: { x: 50, y: 50 },
    northwest: { x: 23, y: 25 },
    northeast: { x: 76, y: 24 },
    southwest: { x: 26, y: 76 },
    southeast: { x: 76, y: 75 },
    east: { x: 86, y: 50 },
  }

  const getBrainMapNodePosition = (node: BrainMapNode) => {
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) {
      return { x: node.x as number, y: node.y as number }
    }

    return brainMapSlotPositions[node.slot] || brainMapSlotPositions.east
  }

  const getBrainMapPositionStyle = ({ x, y }: { x: number; y: number }): CSSProperties => ({
    '--brain-map-x': `${x}%`,
    '--brain-map-y': `${y}%`,
  }) as CSSProperties

  const getBrainMapNodeStyle = (node: BrainMapNode): CSSProperties => (
    getBrainMapPositionStyle(getBrainMapNodePosition(node))
  )

  const renderBrainMapEdge = (edge: BrainMapEdge) => {
    const from = renderedBrainMapModel.nodes.find((node) => node.id === edge.from)
    const to = renderedBrainMapModel.nodes.find((node) => node.id === edge.to)

    if (!from || !to) {
      return null
    }

    const fromPosition = getBrainMapNodePosition(from)
    const toPosition = getBrainMapNodePosition(to)
    const edgeKind = edge.kind || 'memory'

    return (
      <line
        key={edge.id}
        data-testid="brain-map-graph-edge"
        data-edge-kind={edgeKind}
        className={[
          'forensic-brain-map-edge',
          `forensic-brain-map-edge-${edgeKind}`,
          `forensic-brain-map-edge-${edge.strength}`,
        ].join(' ')}
        x1={`${fromPosition.x}%`}
        y1={`${fromPosition.y}%`}
        x2={`${toPosition.x}%`}
        y2={`${toPosition.y}%`}
      />
    )
  }

  const renderBrainMapRegion = (region: BrainMapRegion) => (
    <div
      key={region.id}
      data-testid="brain-map-graph-region"
      className={[
        'forensic-brain-map-region',
        `forensic-brain-map-region-${region.tier.toLocaleLowerCase()}`,
      ].join(' ')}
      style={getBrainMapPositionStyle({ x: region.x, y: region.y })}
    >
      <span>{region.label}</span>
      <strong>{region.scoreLabel}</strong>
    </div>
  )

  const renderBrainMapNode = (node: BrainMapNode) => {
    const isSelected = selectedBrainMapNode?.id === node.id
    const isSpatialMarker = node.kind !== 'current'
    const nodeTypeLabel = node.kind === 'current' ? 'focus' : node.kind
    const gatewayLabel = node.gateways[0] ? formatGateway(node.gateways[0]) : node.kind === 'current' ? 'Live focus' : 'Memory'

    return (
      <button
        key={node.id}
        type="button"
        data-testid="brain-map-node"
        aria-label={`Select ${nodeTypeLabel} ${node.kind === 'current' ? node.subtitle : node.title}`}
        aria-pressed={isSelected}
        data-node-kind={node.kind}
        data-map-density={isSpatialMarker ? 'marker' : 'card'}
        data-map-label={node.kind === 'current' ? node.subtitle : node.title}
        style={getBrainMapNodeStyle(node)}
        title={node.kind === 'current' ? node.subtitle : node.title}
        className={[
          'forensic-brain-map-node',
          'forensic-brain-map-node-positioned',
          isSpatialMarker ? 'forensic-brain-map-node-spatial' : '',
          `forensic-brain-map-node-${node.kind}`,
          `forensic-brain-map-slot-${node.slot}`,
          `forensic-brain-map-tier-${node.tier.toLocaleLowerCase()}`,
          isSelected ? 'is-selected' : '',
        ].filter(Boolean).join(' ')}
        onClick={() => setSelectedBrainMapNodeId(node.id)}
      >
        <span className="forensic-brain-map-node-orb" aria-hidden="true">
          <span />
        </span>
        <span className="forensic-brain-map-node-copy">
          <span>{node.kind === 'current' ? 'Current focus' : gatewayLabel}</span>
          <strong>{node.kind === 'current' ? node.subtitle : node.title}</strong>
          <em>{node.kind === 'current' ? 'Now scanning' : `${node.scoreLabel} ${node.tier}`}</em>
        </span>
        <span className="forensic-brain-map-node-badges" aria-hidden="true">
          {node.badges.slice(0, 2).map((badge) => (
            <span key={`${node.id}:${badge}`}>{badge}</span>
          ))}
        </span>
      </button>
    )
  }

  const renderBrainMapSelectedDetail = () => {
    if (!selectedBrainMapNode) {
      return null
    }

    const node = selectedBrainMapNode
    const targetInvestigationId = node.targetInvestigationId
    const linkId = node.linkId
    const signalId = node.signalId
    const clusterId = node.clusterId
    const selectedNodeTitle = node.kind === 'current' && node.title === 'Current investigation' ? node.subtitle : node.title
    const selectedNodeKindLabel = node.kind === 'current'
      ? 'Map focus'
      : node.kind === 'memory'
        ? 'Linked memory'
        : node.kind === 'cluster'
          ? 'Memory cluster'
          : 'Active signal'

    return (
      <section data-testid="brain-map-selected-node" className="forensic-brain-map-selected">
        <span>{selectedNodeKindLabel}</span>
        <h4>{selectedNodeTitle}</h4>
        {node.kind !== 'current' && (
          <div className="forensic-brain-map-selected-badges">
            {node.badges.map((badge) => (
              <span key={`${node.id}:${badge}`}>{badge}</span>
            ))}
            <span>{node.scoreLabel}</span>
          </div>
        )}

        {node.kind !== 'current' && (
          <div className="forensic-brain-map-selected-actions">
            <button
              type="button"
              aria-label={`Compare map memory ${node.title}`}
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={() => setCompareSelection({ kind: 'map-node', id: node.id })}
            >
              <Maximize2 size={13} />
              Compare
            </button>
            {targetInvestigationId && (
              <button
                type="button"
                aria-label={`Open radar memory ${node.title}`}
                className="forensic-brain-action"
                onClick={() => onOpenInvestigation?.(targetInvestigationId)}
              >
                <ExternalLink size={13} />
                Open Case
              </button>
            )}
            {linkId && (
              <button
                type="button"
                aria-label={`Inspect radar memory ${node.title}`}
                className="forensic-brain-action forensic-brain-action-primary"
                onClick={() => {
                  setSelectedMemoryLinkId(linkId)
                  setActiveBrainView('links')
                }}
              >
                <Link2 size={13} />
                Inspect Link
              </button>
            )}
            {signalId && (
              <button
                type="button"
                aria-label={`Promote radar signal ${node.title}`}
                className="forensic-brain-action forensic-brain-action-primary"
                disabled={busyAction === `promote-map:${signalId}`}
                onClick={() => void handlePromoteBrainMapSignal(node)}
              >
                <Link2 size={13} />
                Promote Link
              </button>
            )}
            {clusterId && (
              <button
                type="button"
                aria-label={`Inspect radar cluster ${node.title}`}
                className="forensic-brain-action forensic-brain-action-primary"
                onClick={() => {
                  setSelectedClusterId(clusterId)
                  setActiveBrainView('clusters')
                }}
              >
                <Brain size={13} />
                Inspect Cluster
              </button>
            )}
          </div>
        )}

        {node.reasons.length > 0 ? (
          <div className="forensic-brain-map-selected-reasons">
            {node.reasons.slice(0, 3).map((reason, index) => (
              <p key={`${node.id}:reason:${reason.gateway}:${reason.value}:${index}`}>
                <strong>{formatGateway(reason.gateway)}</strong>
                {reason.detail || reason.label}
              </p>
            ))}
          </div>
        ) : (
          <p className="forensic-brain-map-selected-empty">Signals and saved memories radiate from this case.</p>
        )}
      </section>
    )
  }

  const renderBrainMap = () => (
    <section
      data-testid="brain-map-radar"
      className={`forensic-brain-map-radar ${isBrainMapExpanded ? 'is-expanded' : ''}`}
      aria-label="Brain memory map"
    >
      <div className="forensic-brain-map-header">
        <div>
          <span className="forensic-brain-panel-kicker">Memory map</span>
          <h3>Living memory map</h3>
        </div>
        <div className="forensic-brain-map-tools">
          <div className="forensic-brain-map-summary">
            <span>{renderedBrainMapModel.summary.linkedMemoryCount} saved</span>
            <span>{renderedBrainMapModel.summary.activeSignalCount} firing</span>
            <span>{renderedBrainMapModel.summary.visibleCount} visible</span>
            {renderedBrainMapModel.hiddenCount > 0 && (
              <span title="Expand the map to see folded memories.">{renderedBrainMapModel.hiddenCount} folded / expand</span>
            )}
            <strong>{renderedBrainMapModel.summary.strongestScore}</strong>
          </div>
        </div>
      </div>

      <div className="forensic-brain-map-shell">
        <div
          data-testid="brain-map-canvas"
          className={`forensic-brain-map-canvas ${isBrainMapDragging ? 'is-dragging' : ''}`}
          aria-label="Current investigation and related memories"
          title={isBrainMapExpanded ? 'Drag to pan. Scroll to zoom. Double-click to reset.' : undefined}
          onWheel={handleBrainMapWheel}
          onPointerDown={handleBrainMapPointerDown}
          onPointerMove={handleBrainMapPointerMove}
          onPointerUp={stopBrainMapDrag}
          onPointerCancel={stopBrainMapDrag}
          onPointerLeave={stopBrainMapDrag}
          onDoubleClick={handleBrainMapDoubleClick}
        >
          <button
            type="button"
            className="forensic-brain-map-expand"
            aria-label={isBrainMapExpanded ? 'Collapse brain map' : 'Expand brain map'}
            aria-pressed={isBrainMapExpanded}
            title={isBrainMapExpanded ? 'Collapse brain map' : 'Expand brain map'}
            onClick={handleToggleBrainMapExpanded}
          >
            {isBrainMapExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <div className="forensic-brain-map-bus" aria-hidden="true">
            <span>Active Recall</span>
            <strong>{renderedBrainMapModel.summary.strongestScore}</strong>
          </div>
          <div
            data-testid="brain-map-viewport"
            className="forensic-brain-map-node-stack"
            style={brainMapViewportStyle}
          >
            <svg className="forensic-brain-map-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {renderedBrainMapModel.edges.map(renderBrainMapEdge)}
            </svg>
            <div className="forensic-brain-map-regions" aria-label="Brain map memory regions">
              {renderedBrainMapModel.regions.map(renderBrainMapRegion)}
            </div>
            {renderedBrainMapModel.nodes.map(renderBrainMapNode)}
          </div>
        </div>

        <aside className="forensic-brain-map-side">
          <div data-testid="brain-map-digest" className="forensic-brain-map-digest">
            <span className="forensic-brain-panel-kicker">What changed</span>
            {brainMapModel.digest.length > 0 ? (
              brainMapModel.digest.map((item) => (
                <article key={item.id} className={`forensic-brain-map-digest-item forensic-brain-map-digest-${item.tone}`}>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </article>
              ))
            ) : (
              <p>No new memory movement yet.</p>
            )}
          </div>

          {renderBrainMapSelectedDetail()}
        </aside>
      </div>
    </section>
  )

  const renderBrainFilters = () => (
    <div className="forensic-brain-filter-bar" aria-label="Brain memory filters">
      <div className="forensic-brain-filter-group" role="group" aria-label="Gateway filters">
        {gatewayFilterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={`${option.label} filter`}
            aria-pressed={gatewayFilter === option.value}
            className={gatewayFilter === option.value ? 'is-active' : ''}
            onClick={() => setGatewayFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="forensic-brain-filter-group" role="group" aria-label="Strength filters">
        {strengthFilterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={`${option.label} filter`}
            aria-pressed={strengthFilter === option.value}
            className={strengthFilter === option.value ? 'is-active' : ''}
            onClick={() => setStrengthFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )

  const renderFollowUpLauncher = () => {
    if (!pendingFollowUp) {
      return null
    }

    const isLaunchBusy = busyAction === `followup-launch:${pendingFollowUp.id}`
    const isCancelBusy = busyAction === `followup-cancel:${pendingFollowUp.id}`

    return (
      <section
        data-testid="brain-followup-launcher"
        className="forensic-brain-followup-launcher"
        aria-label="Prepared focused Rabbit Hole follow-up"
      >
        <div className="forensic-brain-followup-header">
          <div>
            <span className="forensic-brain-panel-kicker">Prepared follow-up</span>
            <h3>{pendingFollowUp.title}</h3>
            <p>{pendingFollowUp.summary}</p>
          </div>
          <strong>{pendingFollowUp.descentMode}</strong>
        </div>
        <div className="forensic-brain-followup-prompt" aria-label="Prepared Rabbit Hole prompt">
          <span>Rabbit Hole prompt</span>
          <pre>{pendingFollowUp.prompt}</pre>
        </div>
        {pendingFollowUp.reasonSamples.length > 0 && (
          <div className="forensic-brain-chip-row" aria-label="Follow-up reason samples">
            {pendingFollowUp.reasonSamples.slice(0, 4).map((reason) => (
              <span
                key={`followup:${pendingFollowUp.id}:${reason.gateway}:${reason.value}:${reason.label}`}
                className={`forensic-brain-chip ${gatewayClassNames[reason.gateway] || ''}`}
              >
                {reason.label || formatGateway(reason.gateway)}
              </span>
            ))}
          </div>
        )}
        <div className="forensic-brain-followup-actions">
          <button
            type="button"
            className="forensic-brain-action forensic-brain-action-primary"
            disabled={!onLaunchFocusedRabbitHole || isLaunchBusy || pendingFollowUp.status === 'launched'}
            onClick={() => void handleLaunchFollowUp(pendingFollowUp)}
          >
            <Rocket size={13} />
            Launch Guided Rabbit Hole
          </button>
          <button
            type="button"
            className="forensic-brain-action forensic-brain-action-secondary"
            disabled={isCancelBusy || pendingFollowUp.status === 'cancelled'}
            onClick={() => void handleCancelFollowUp(pendingFollowUp)}
          >
            <X size={13} />
            Cancel Follow-Up
          </button>
        </div>
      </section>
    )
  }

  const renderFocusView = () => {
    const focus = attentionSummary?.focus
    const compareSelection = focusCompareSelection()
    const focusFollowUpSuggestion = findSuggestionForFocus()
    const hasFollowUpGuidance = !!focus?.guidance.some((card) => card.kind === 'follow-up')
    const sourceLabel = focus?.clusterId
      ? 'View Cluster'
      : focus?.linkId
        ? 'View Link'
        : focus?.signalId
          ? 'View Signal'
          : 'View Map'
    const canOpenTarget = !!focus?.targetInvestigationId && !!onOpenInvestigation

    return (
      <div className="forensic-brain-view forensic-brain-view-focus">
        <section data-testid="brain-focus-view" className="forensic-brain-focus-panel" aria-label="Brain focus narrative">
          {!currentInvestigationId ? (
            <div className="forensic-brain-empty">
              Select an investigation to generate a Brain focus summary.
            </div>
          ) : isLoading ? (
            <div className="forensic-brain-empty">
              Reading Brain focus...
            </div>
          ) : !focus ? (
            <div className="forensic-brain-empty">
              No Brain focus yet. Run or refresh Brain after memory signals form.
            </div>
          ) : (
            <>
              {focus.supportingFacts.length > 0 && (
                <div className="forensic-brain-focus-facts" aria-label="Supporting Brain context">
                  {focus.supportingFacts.slice(0, 5).map((fact) => (
                    <span key={`focus:fact:${fact}`}>{fact}</span>
                  ))}
                </div>
              )}

              <div className="forensic-brain-focus-hero">
                <div>
                  <span className="forensic-brain-panel-kicker">Brain focus</span>
                  {focus.relevance && (
                    <span className={`forensic-brain-relevance-chip forensic-brain-relevance-chip-${normalizeRelevance(focus.relevance)}`}>
                      {focus.relevanceLabel || formatRelevance(focus)}
                    </span>
                  )}
                  <h3>{focus.headline}</h3>
                  <p>{focus.summary}</p>
                  {focus.relevanceReason && <p>{focus.relevanceReason}</p>}
                </div>
                <strong>{formatScore(attentionSummary?.overallScore ?? 0)}</strong>
              </div>

              {focus.guidance.length > 0 ? (
                <section className="forensic-brain-guidance" aria-label="Brain guidance">
                  <span className="forensic-brain-panel-kicker">Brain guidance</span>
                  <div className="forensic-brain-guidance-grid">
                    {focus.guidance.slice(0, 3).map((card) => (
                      <article
                        key={`focus:guidance:${card.kind}:${card.title}`}
                        className={`forensic-brain-guidance-card is-${card.tone || 'neutral'}`}
                      >
                        <div>
                          <span>{card.title}</span>
                          <p>{card.detail}</p>
                        </div>
                        {card.kind === 'follow-up' && focusFollowUpSuggestion ? (
                          <button
                            type="button"
                            className="forensic-brain-action forensic-brain-action-primary"
                            disabled={busyAction === `followup-prepare:${focusFollowUpSuggestion.id}`}
                            onClick={() => void handlePrepareFollowUp(focusFollowUpSuggestion)}
                          >
                            <Rocket size={13} />
                            {card.actionLabel || 'Prepare Rabbit Hole'}
                          </button>
                        ) : (
                          card.actionLabel && <strong>{card.actionLabel}</strong>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              ) : (
                <div className="forensic-brain-focus-grid">
                  <article>
                    <span>Why it matters</span>
                    <p>{focus.whyItMatters}</p>
                  </article>
                  <article>
                    <span>Best next move</span>
                    <p>{focus.recommendedAction}</p>
                  </article>
                </div>
              )}

              <div className="forensic-brain-focus-actions">
                {focusFollowUpSuggestion && !hasFollowUpGuidance && (
                  <button
                    type="button"
                    className="forensic-brain-action forensic-brain-action-primary"
                    disabled={busyAction === `followup-prepare:${focusFollowUpSuggestion.id}`}
                    onClick={() => void handlePrepareFollowUp(focusFollowUpSuggestion)}
                  >
                    <Rocket size={13} />
                    Prepare Rabbit Hole
                  </button>
                )}
                <button
                  type="button"
                  className="forensic-brain-action forensic-brain-action-primary"
                  disabled={!compareSelection}
                  onClick={handleCompareFocus}
                >
                  <Maximize2 size={13} />
                  Compare Focus
                </button>
                <button
                  type="button"
                  className="forensic-brain-action forensic-brain-action-primary"
                  onClick={handleInspectFocus}
                >
                  <ExternalLink size={13} />
                  {sourceLabel}
                </button>
                <button
                  type="button"
                  className="forensic-brain-action forensic-brain-action-secondary"
                  disabled={!canOpenTarget}
                  onClick={() => {
                    if (focus.targetInvestigationId) {
                      onOpenInvestigation?.(focus.targetInvestigationId)
                    }
                  }}
                >
                  <ExternalLink size={13} />
                  Open Remembered Case
                </button>
                <button
                  type="button"
                  className="forensic-brain-action forensic-brain-action-secondary"
                  onClick={() => setActiveBrainView('map')}
                >
                  <Brain size={13} />
                  View Map
                </button>
              </div>
              {renderFollowUpLauncher()}
            </>
          )}
        </section>
      </div>
    )
  }

  const renderBrainHealth = () => (
    <div data-testid="brain-health-summary" className="forensic-brain-health-strip" aria-label="Brain memory health">
      <div>
        <span>Firing Cases</span>
        <strong>{brainHealth.firingCases}</strong>
      </div>
      <div>
        <span>Memory Groups</span>
        <strong>{brainHealth.memoryGroups}</strong>
      </div>
      <div>
        <span>Memory Clusters</span>
        <strong>{brainHealth.memoryClusters}</strong>
      </div>
      <div>
        <span>Next Moves</span>
        <strong>{brainHealth.nextMoves}</strong>
      </div>
      <div>
        <span>Attention</span>
        <strong>{brainHealth.attentionState}</strong>
      </div>
      <div>
        <span>Top Strength</span>
        <strong>{brainHealth.attentionScore}</strong>
      </div>
    </div>
  )

  const renderBrainAttentionTrigger = () => {
    if (!attentionSummary || attentionSummary.items.length === 0) {
      return null
    }

    const topItem = attentionSummary.items[0]

    return (
      <button
        type="button"
        className={`forensic-brain-attention-trigger ${isAttentionOpen ? 'is-open' : ''}`}
        aria-label={`${isAttentionOpen ? 'Hide' : 'Show'} brain attention summary`}
        aria-expanded={isAttentionOpen}
        aria-controls="brain-attention-popover"
        onClick={() => setIsAttentionOpen((current) => !current)}
      >
        <Bell size={14} />
        <span>
          <strong>{formatAttentionState(attentionSummary.dominantState)}</strong>
          <small>{topItem.title}</small>
        </span>
        <b>{formatScore(attentionSummary.overallScore)}</b>
      </button>
    )
  }

  const renderBrainAttentionPanel = () => {
    if (!attentionSummary || attentionSummary.items.length === 0 || !isAttentionOpen) {
      return null
    }

    return (
      <div className="forensic-brain-attention-popover" id="brain-attention-popover">
        <section
          data-testid="brain-attention-summary"
          className="forensic-brain-attention-summary"
          aria-label="Brain attention summary"
        >
          <div className="forensic-brain-attention-head">
            <div>
              <span className="forensic-brain-panel-kicker">What matters now</span>
              <h3>{formatAttentionState(attentionSummary.dominantState)} memory attention</h3>
            </div>
            <div className="forensic-brain-attention-head-actions">
              <strong>{formatScore(attentionSummary.overallScore)}</strong>
              <button
                type="button"
                aria-label="Close brain attention summary"
                className="forensic-brain-attention-close"
                onClick={() => setIsAttentionOpen(false)}
              >
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="forensic-brain-attention-items">
            {attentionSummary.items.slice(0, 3).map((item) => (
              <article key={item.id} className={`forensic-brain-attention-item forensic-brain-attention-${item.tone}`}>
                <span>{formatAttentionKind(item.kind)}</span>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
                {item.suggestedAction && (
                  <small>{item.suggestedAction}</small>
                )}
              </article>
            ))}
          </div>
          {attentionSummary.memoryStrengths.length > 0 && (
            <div className="forensic-brain-strength-row" aria-label="Top memory strengths">
              {attentionSummary.memoryStrengths.slice(0, 3).map((strength) => (
                <span key={strength.id}>
                  <strong>{strength.title}</strong>
                  {formatAttentionState(strength.state)} / {formatScore(strength.score)}
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    )
  }

  const renderSuggestionOutcomeChip = (suggestion: BrainSuggestion) => {
    if (!suggestion.reviewOutcome) {
      return null
    }
    return (
      <span className="forensic-brain-action-outcome">
        Outcome: {formatSuggestionReviewOutcome(suggestion.reviewOutcome)}
      </span>
    )
  }

  const renderSuggestionOutcomeButton = (suggestion: BrainSuggestion, outcome: string, label: string) => (
    <button
      type="button"
      className="forensic-brain-action forensic-brain-action-secondary forensic-brain-action-compact"
      disabled={busyAction === `suggestion-outcome:${suggestion.id}:${outcome}` || suggestion.reviewOutcome === outcome}
      onClick={() => void handleSuggestionOutcome(suggestion, outcome)}
    >
      {label}
    </button>
  )

  const renderVerificationActionPanel = (suggestion: BrainSuggestion) => {
    const reasonSamples = (suggestion.reasonSamples || []).slice(0, 2)

    return (
      <section className="forensic-brain-thinking-action-panel" aria-label="Verification action">
        <div className="forensic-brain-thinking-action-header">
          <span>Verification Queue</span>
          {renderSuggestionOutcomeChip(suggestion)}
        </div>
        {reasonSamples.length > 0 ? (
          <div className="forensic-brain-verification-list">
            {reasonSamples.map((reason) => (
              <div key={`${reason.gateway}:${reason.value}:${reason.detail}`} className="forensic-brain-verification-item">
                <strong>{reason.label || reason.value || 'Verification clue'}</strong>
                <p>{reason.detail}</p>
                <div className="forensic-brain-evidence-pair">
                  <span>
                    Current evidence
                    <b>{formatNodeIds(reason.currentNodeIds)}</b>
                  </span>
                  <span>
                    Remembered evidence
                    <b>{formatNodeIds(reason.targetNodeIds)}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p>No matched evidence ids recorded for this verification cue.</p>
        )}
        <div className="forensic-brain-thinking-action-buttons">
          {renderSuggestionOutcomeButton(suggestion, 'verified-conflict', 'Mark Verified Conflict')}
          {renderSuggestionOutcomeButton(suggestion, 'resolved', 'Mark Resolved')}
          {renderSuggestionOutcomeButton(suggestion, 'false-alarm', 'Mark False Alarm')}
          {renderSuggestionOutcomeButton(suggestion, 'needs-source', 'Needs Source')}
        </div>
      </section>
    )
  }

  const renderGapActionPanel = (suggestion: BrainSuggestion) => {
    const missingEvidence = suggestion.missingEvidence || []
    const promptIsOpen = expandedPromptSuggestionId === suggestion.id

    return (
      <section className="forensic-brain-thinking-action-panel" aria-label="Gap action">
        <div className="forensic-brain-thinking-action-header">
          <span>Gap Checklist</span>
          {renderSuggestionOutcomeChip(suggestion)}
        </div>
        {missingEvidence.length > 0 ? (
          <div className="forensic-brain-gap-list">
            {missingEvidence.map((item) => (
              <span key={item}>{formatMissingEvidence(item)}</span>
            ))}
          </div>
        ) : (
          <p>No specific gap category was recorded.</p>
        )}
        <div className="forensic-brain-thinking-action-buttons">
          <button
            type="button"
            className="forensic-brain-action forensic-brain-action-secondary forensic-brain-action-compact"
            disabled={!suggestion.searchPrompt}
            onClick={() => setExpandedPromptSuggestionId((current) => (current === suggestion.id ? null : suggestion.id))}
          >
            Prepare Search Prompt
          </button>
          {missingEvidence.slice(0, 3).map((item) =>
            renderSuggestionOutcomeButton(suggestion, missingEvidenceOutcome(item), `Mark ${formatMissingEvidence(item)}`),
          )}
        </div>
        {promptIsOpen && suggestion.searchPrompt && (
          <p className="forensic-brain-search-prompt">{suggestion.searchPrompt}</p>
        )}
      </section>
    )
  }

  const renderSuggestionThinkingAction = (suggestion: BrainSuggestion) => {
    switch (suggestion.actionMode) {
      case 'verify':
        return renderVerificationActionPanel(suggestion)
      case 'fill-gap':
        return renderGapActionPanel(suggestion)
      default:
        return renderSuggestionOutcomeChip(suggestion)
    }
  }

  const renderSuggestionCard = (suggestion: BrainSuggestion) => {
    const canOpenTarget = suggestion.targetInvestigationIds.length > 0 && !!onOpenInvestigation
    const canViewCluster = suggestion.relatedClusterIds.length > 0
    const canViewLink = suggestion.relatedMemoryLinkIds.length > 0
    const canViewSignal = suggestion.relatedSignalIds.length > 0
    const canViewMap = !!findBrainMapNodeForSuggestion(suggestion)
    const isReviewed = suggestion.status === 'reviewed'
    const relevance = normalizeRelevance(suggestion.relevance)
    const canPrepareFollowUp = suggestion.actionMode === 'launch-follow-up' && !isSpeculativeRelevance(suggestion.relevance)
    const followUpAction = followUpsBySourceId.get(suggestion.id)
    const followUpLabel = followUpAction?.status === 'prepared'
      ? 'Review Rabbit Hole'
      : followUpAction?.status === 'launched'
        ? 'Rabbit Hole Launched'
        : 'Prepare Rabbit Hole'

    return (
      <article
        key={suggestion.id}
        data-testid="brain-suggestion-card"
        className={`forensic-brain-suggestion-card forensic-brain-suggestion-${suggestion.priority} forensic-brain-relevance-${relevance} ${isReviewed ? 'is-reviewed' : ''}`}
      >
        <div className="forensic-brain-suggestion-main">
          <div className="forensic-brain-suggestion-topline">
            <span>{formatSuggestionKind(suggestion.kind)}</span>
            <span className={`forensic-brain-relevance-chip forensic-brain-relevance-chip-${relevance}`}>
              {formatRelevance(suggestion)}
            </span>
            {suggestion.thinkingLabel && (
              <span className={`forensic-brain-thinking-chip forensic-brain-thinking-${suggestion.actionMode || 'compare'}`}>
                {suggestion.thinkingLabel}
              </span>
            )}
            <strong>{suggestion.priority}</strong>
          </div>
          <h4>{suggestion.title}</h4>
          <p>{suggestion.summary}</p>
          <div className="forensic-brain-suggestion-reason">
            <span>Why it matters</span>
            <strong>{suggestion.reason}</strong>
            {suggestion.thinkingReason && <em>{suggestion.thinkingReason}</em>}
            {suggestion.relevanceReason && <em>{suggestion.relevanceReason}</em>}
          </div>
          <div className="forensic-brain-chip-row" aria-label="Related memory objects">
            {suggestion.relatedClusterIds.length > 0 && (
              <span className="forensic-brain-chip forensic-brain-chip-entity">
                {suggestion.relatedClusterIds.length} cluster
              </span>
            )}
            {suggestion.relatedSignalIds.length > 0 && (
              <span className="forensic-brain-chip forensic-brain-chip-source">
                {suggestion.relatedSignalIds.length} signal
              </span>
            )}
            {suggestion.relatedMemoryLinkIds.length > 0 && (
              <span className="forensic-brain-chip forensic-brain-chip-relationship">
                {suggestion.relatedMemoryLinkIds.length} link
              </span>
            )}
            {isReviewed && (
              <span className="forensic-brain-chip">
                Reviewed
              </span>
            )}
          </div>
          {renderSuggestionThinkingAction(suggestion)}
        </div>

        <aside className="forensic-brain-suggestion-action">
          <span>{formatScore(suggestion.score)}</span>
          <strong>{suggestion.suggestedAction}</strong>
          {canPrepareFollowUp ? (
            <button
              type="button"
              aria-label={`Prepare focused Rabbit Hole ${suggestion.title}`}
              className="forensic-brain-action forensic-brain-action-primary"
              disabled={busyAction === `followup-prepare:${suggestion.id}` || followUpAction?.status === 'launched'}
              onClick={() => {
                if (followUpAction?.status === 'prepared') {
                  setPendingFollowUp(followUpAction)
                  return
                }
                void handlePrepareFollowUp(suggestion)
              }}
            >
              <Rocket size={13} />
              {followUpLabel}
            </button>
          ) : (
            <span className="forensic-brain-action-note">
              {formatSuggestionActionNote(suggestion)}
            </span>
          )}
          <button
            type="button"
            aria-label={`Compare next move ${suggestion.title}`}
            className="forensic-brain-action forensic-brain-action-primary"
            onClick={() => setCompareSelection({ kind: 'suggestion', id: suggestion.id })}
          >
            <Maximize2 size={13} />
            Compare
          </button>
          {canViewMap && (
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={() => handleViewSuggestionMap(suggestion)}
            >
              <Brain size={13} />
              View Map
            </button>
          )}
          {canViewCluster && (
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={() => handleViewSuggestionCluster(suggestion)}
            >
              <ExternalLink size={13} />
              View Cluster
            </button>
          )}
          {canViewLink && (
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={() => handleViewSuggestionLink(suggestion)}
            >
              <Link2 size={13} />
              View Link
            </button>
          )}
          {!canViewCluster && !canViewLink && canViewSignal && (
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-primary"
              onClick={handleViewSuggestionSignal}
            >
              <ExternalLink size={13} />
              View Signal
            </button>
          )}
          <button
            type="button"
            className="forensic-brain-action forensic-brain-action-secondary"
            disabled={isReviewed || busyAction === `suggestion-review:${suggestion.id}`}
            onClick={() => void handleReviewSuggestion(suggestion)}
          >
            <Eye size={13} />
            Mark Reviewed
          </button>
          <button
            type="button"
            className="forensic-brain-action forensic-brain-action-secondary"
            disabled={busyAction === `suggestion-dismiss:${suggestion.id}`}
            onClick={() => void handleDismissSuggestion(suggestion)}
          >
            <X size={13} />
            Dismiss
          </button>
          <button
            type="button"
            className="forensic-brain-action forensic-brain-action-secondary"
            disabled={!canOpenTarget}
            onClick={() => {
              const targetId = suggestion.targetInvestigationIds[0]
              if (targetId) {
                onOpenInvestigation?.(targetId)
              }
            }}
          >
            <ExternalLink size={13} />
            Open
          </button>
        </aside>
      </article>
    )
  }

  const renderAutonomyQueueItem = (item: BrainAutonomyQueueItem) => {
    const relevance = normalizeRelevance(item.relevance)
    const action = item.actionId ? followUps.find((candidate) => candidate.id === item.actionId) : null
    const suggestion = rankedSuggestions.find((candidate) => candidate.id === item.suggestionId) || null
    const canOpenTarget = item.targetInvestigationIds.length > 0 && !!onOpenInvestigation

    return (
      <article
        key={item.id}
        data-testid="brain-autonomy-card"
        className={`forensic-brain-autonomy-card forensic-brain-autonomy-card-reference forensic-brain-autonomy-card-compact forensic-brain-autonomy-${item.status} forensic-brain-relevance-${relevance}`}
      >
        <div data-testid="brain-autonomy-card-main" className="forensic-brain-autonomy-main">
          <div className="forensic-brain-suggestion-topline forensic-brain-autonomy-topline">
            <span className={`forensic-brain-autonomy-decision-chip forensic-brain-autonomy-decision-${item.decision}`}>
              {formatAutonomyDecision(item.decision)}
            </span>
            <span className={`forensic-brain-relevance-chip forensic-brain-relevance-chip-${relevance}`}>
              {formatRelevance(item)}
            </span>
            <strong className="forensic-brain-autonomy-score-chip">{formatScore(item.score)}</strong>
          </div>
          <h4>{item.title}</h4>
          <p>{item.summary}</p>
          <div className="forensic-brain-suggestion-reason forensic-brain-autonomy-decision-box">
            <span>Decision</span>
            <strong>{item.reason}</strong>
          </div>
          <div className="forensic-brain-chip-row forensic-brain-autonomy-blocker-row" aria-label="Autonomy blockers">
            {item.blockers.length > 0 ? (
              item.blockers.map((blocker) => (
                <span key={blocker} className="forensic-brain-chip forensic-brain-chip-relationship forensic-brain-autonomy-blocker-chip">
                  {formatAutonomyBlocker(blocker)}
                </span>
              ))
            ) : (
              <span className="forensic-brain-chip forensic-brain-chip-source forensic-brain-autonomy-clear-chip">
                Clear
              </span>
            )}
            {item.actionId && (
              <span className="forensic-brain-chip forensic-brain-chip-entity">
                Action Ready
              </span>
            )}
          </div>
        </div>
        <aside data-testid="brain-autonomy-card-rail" className="forensic-brain-suggestion-action forensic-brain-autonomy-rail">
          <div className="forensic-brain-autonomy-rail-meta">
            <span data-testid="brain-autonomy-timestamp" className="forensic-brain-autonomy-timestamp">
              <Clock3 size={15} />
              {formatTimestamp(item.updatedAt)}
            </span>
            <b className="forensic-brain-autonomy-status">{formatAutonomyDecision(item.status)}</b>
          </div>
          <div className="forensic-brain-autonomy-rail-actions">
            {action?.status === 'prepared' && (
              <button
                type="button"
                className="forensic-brain-action forensic-brain-action-primary"
                onClick={() => setPendingFollowUp(action)}
              >
                <Rocket size={13} />
                Review Rabbit Hole
              </button>
            )}
            {suggestion && (
              <button
                type="button"
                className="forensic-brain-action forensic-brain-action-primary"
                onClick={() => setCompareSelection({ kind: 'suggestion', id: suggestion.id })}
              >
                <Maximize2 size={13} />
                Compare
              </button>
            )}
            <button
              type="button"
              className="forensic-brain-action forensic-brain-action-secondary"
              disabled={!canOpenTarget}
              onClick={() => {
                const targetId = item.targetInvestigationIds[0]
                if (targetId) {
                  onOpenInvestigation?.(targetId)
                }
              }}
            >
              <ExternalLink size={13} />
              Open
            </button>
          </div>
        </aside>
      </article>
    )
  }

  const renderAutonomyView = () => {
    const latestAudit = autonomyAudit[0]

    return (
      <div className="forensic-brain-view forensic-brain-view-autonomy">
        <section data-testid="brain-autonomy-view" className="forensic-brain-panel forensic-brain-panel-autonomy forensic-brain-panel-autonomy-compact">
          <div className="forensic-brain-panel-header forensic-brain-autonomy-header">
            <div>
              <span className="forensic-brain-panel-kicker">Guarded preparation</span>
              <h3>Autonomy Queue</h3>
            </div>
            <div className="forensic-brain-cluster-summary">
              <span>Auto-prepare {autonomyAutoPrepareEnabled ? 'On' : 'Off'}</span>
              <span>{autonomyQueue.length} queued</span>
              <span>{blockedAutonomyCount} blocked</span>
            </div>
          </div>

          <div className="forensic-brain-autonomy-controls" aria-label="Brain autonomy mode">
            <button
              type="button"
              role="switch"
              aria-checked={autonomyAutoPrepareEnabled}
              aria-disabled={busyAction === 'autonomy-toggle'}
              aria-label="Auto-prepare Rabbit Holes"
              className="forensic-brain-autonomy-toggle"
              onClick={() => void handleToggleAutonomyAutoPrepare()}
            >
              <ShieldCheck size={13} />
              <span>Auto-prepare Rabbit Holes</span>
              <strong className={autonomyStateClass}>{autonomyAutoPrepareEnabled ? 'On' : 'Off'}</strong>
            </button>
          </div>

          <div className="forensic-brain-autonomy-budgets" aria-label="Brain autonomy budgets">
            <span>
              Per Case
              <strong>{autonomySettings.maxAutoPreparedPerInvestigation}</strong>
            </span>
            <span>
              Active Prepared
              <strong>{autonomySettings.maxActivePrepared}</strong>
            </span>
            {latestAudit && (
              <span>
                Last Decision
                <strong>{formatAutonomyDecision(latestAudit.decision)}</strong>
              </span>
            )}
          </div>

          {renderFollowUpLauncher()}

          {!currentInvestigationId ? (
            <div data-testid="brain-autonomy-empty-state" className="forensic-brain-empty">
              Select an investigation to inspect autonomy.
            </div>
          ) : isLoading ? (
            <div data-testid="brain-loading-state" className="forensic-brain-empty">
              Checking autonomy queue...
            </div>
          ) : autonomyQueue.length === 0 ? (
            <div data-testid="brain-autonomy-empty-state" className="forensic-brain-empty">
              No queued autonomy decisions yet.
            </div>
          ) : (
            <div className="forensic-brain-autonomy-list">
              {autonomyQueue.map(renderAutonomyQueueItem)}
            </div>
          )}
        </section>
      </div>
    )
  }

  const renderNextMovesView = () => {
    const emptyMessage = rankedSuggestions.length === 0
      ? 'No next moves yet. Run or refresh Brain after memory signals form.'
      : 'No active next moves need attention.'

    return (
      <div className="forensic-brain-view forensic-brain-view-moves">
        <section className="forensic-brain-panel forensic-brain-panel-moves">
          <div className="forensic-brain-panel-header">
            <div>
              <span className="forensic-brain-panel-kicker">Active thinking</span>
              <h3>Next Moves</h3>
            </div>
            <div className="forensic-brain-cluster-summary">
              <span>{activeSuggestions.length} active</span>
              <span>{reviewedSuggestions.length} reviewed</span>
            </div>
          </div>
          {renderFollowUpLauncher()}

          {!currentInvestigationId ? (
            <div data-testid="brain-suggestions-empty-state" className="forensic-brain-empty">
              Select an investigation to generate next moves.
            </div>
          ) : isLoading ? (
            <div data-testid="brain-loading-state" className="forensic-brain-empty">
              Checking grounded next moves...
            </div>
          ) : activeSuggestions.length === 0 && reviewedSuggestions.length === 0 ? (
            <div data-testid="brain-suggestions-empty-state" className="forensic-brain-empty">
              {emptyMessage}
            </div>
          ) : (
            <div className="forensic-brain-suggestion-list">
              {prioritySuggestions.map(renderSuggestionCard)}
              {lowerPrioritySuggestions.length > 0 && (
                <div data-testid="brain-lower-priority-moves-section" className="forensic-brain-lower-priority">
                  <button
                    type="button"
                    className="forensic-brain-lower-priority-toggle"
                    aria-expanded={showLowerPrioritySuggestions}
                    onClick={() => setShowLowerPrioritySuggestions((current) => !current)}
                  >
                    {showLowerPrioritySuggestions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showLowerPrioritySuggestions ? 'Hide' : 'Show'} lower-priority moves ({lowerPrioritySuggestions.length})
                  </button>
                  {showLowerPrioritySuggestions && (
                    <div className="forensic-brain-lower-priority-list">
                      {lowerPrioritySuggestions.map(renderSuggestionCard)}
                    </div>
                  )}
                </div>
              )}
              {reviewedSuggestions.length > 0 && (
                <div className="forensic-brain-reviewed-suggestions">
                  <span className="forensic-brain-panel-kicker">Reviewed context</span>
                  {reviewedSuggestions.map(renderSuggestionCard)}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    )
  }

  const renderSignalsView = () => {
    const emptyMessage = rankedSignals.length === 0
      ? 'No brain signals fired for this investigation.'
      : 'No active signals match these filters.'

    return (
      <div className="forensic-brain-view forensic-brain-view-signals">
        {renderBrainFilters()}
        <section className="forensic-brain-panel forensic-brain-panel-signals">
          <div className="forensic-brain-panel-header">
            <div>
              <span className="forensic-brain-panel-kicker">Firing gateways</span>
              <h3>Active Signals</h3>
            </div>
          </div>

          {!currentInvestigationId ? (
            <div data-testid="brain-empty-state" className="forensic-brain-empty">
              Select an investigation to scan memory gateways.
            </div>
          ) : isLoading ? (
            <div data-testid="brain-loading-state" className="forensic-brain-empty">
              Scanning memory gateways...
            </div>
          ) : signalGroups.length === 0 ? (
            <div data-testid="brain-empty-state" className="forensic-brain-empty">
              {emptyMessage}
            </div>
          ) : (
            <div className="forensic-brain-signal-list">
              {prioritySignalGroups.map(renderSignalGroup)}

              {lowerPrioritySignalGroups.length > 0 && (
                <div data-testid="brain-lower-priority-section" className="forensic-brain-lower-priority">
                  <button
                    type="button"
                    className="forensic-brain-lower-priority-toggle"
                    aria-expanded={showLowerPrioritySignals}
                    onClick={() => setShowLowerPrioritySignals((current) => !current)}
                  >
                    {showLowerPrioritySignals ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showLowerPrioritySignals ? 'Hide' : 'Show'} lower-priority signals ({lowerPrioritySignalGroups.length})
                  </button>

                  {showLowerPrioritySignals && (
                    <div className="forensic-brain-lower-priority-list">
                      {lowerPrioritySignalGroups.map(renderSignalGroup)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    )
  }

  const renderLinksView = () => {
    const emptyMessage = rankedLinks.length === 0
      ? 'No memory links promoted yet.'
      : 'No memory links match these filters.'

    return (
      <div className="forensic-brain-view forensic-brain-view-links">
        {renderBrainFilters()}
        <aside className="forensic-brain-panel forensic-brain-panel-links">
          <div className="forensic-brain-panel-header">
            <div>
              <span className="forensic-brain-panel-kicker">Saved memory archive</span>
              <h3>Durable Linked Memory</h3>
            </div>
          </div>

          {linkGroups.length === 0 ? (
            <div data-testid="brain-links-empty-state" className="forensic-brain-empty forensic-brain-empty-compact">
              {emptyMessage}
            </div>
          ) : (
            <div className="forensic-brain-link-list">
              {priorityLinkGroups.map(renderMemoryLink)}

              {olderLinkGroups.length > 0 && (
                <div data-testid="brain-older-links-section" className="forensic-brain-lower-priority">
                  <button
                    type="button"
                    className="forensic-brain-lower-priority-toggle"
                    aria-expanded={showOlderMemoryLinks}
                    onClick={() => setShowOlderMemoryLinks((current) => !current)}
                  >
                    {showOlderMemoryLinks ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showOlderMemoryLinks ? 'Hide' : 'Show'} older memory links ({olderLinkGroups.length})
                  </button>

                  {showOlderMemoryLinks && (
                    <div className="forensic-brain-lower-priority-list">
                      {olderLinkGroups.map(renderMemoryLink)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    )
  }

  const renderClustersView = () => {
    const emptyMessage = rankedClusters.length === 0
      ? 'No memory clusters yet.'
      : 'No memory clusters match these filters.'

    return (
      <div className="forensic-brain-view forensic-brain-view-clusters">
        {renderBrainFilters()}
        <section className="forensic-brain-panel forensic-brain-panel-clusters">
          <div className="forensic-brain-panel-header">
            <div>
              <span className="forensic-brain-panel-kicker">Recurring memory regions</span>
              <h3>Memory Clusters</h3>
            </div>
            <div className="forensic-brain-cluster-summary">
              <span>{visibleClusters.length} visible</span>
              <span>{hiddenClusters.length} hidden</span>
            </div>
          </div>

          {!currentInvestigationId ? (
            <div data-testid="brain-clusters-empty-state" className="forensic-brain-empty">
              Select an investigation to cluster memory.
            </div>
          ) : isLoading ? (
            <div data-testid="brain-loading-state" className="forensic-brain-empty">
              Grouping memory clusters...
            </div>
          ) : visibleClusters.length === 0 && hiddenClusters.length === 0 ? (
            <div data-testid="brain-clusters-empty-state" className="forensic-brain-empty">
              {emptyMessage}
            </div>
          ) : (
            <div className="forensic-brain-cluster-workspace">
              <div className="forensic-brain-cluster-list">
                {visibleClusters.map((cluster) => renderClusterCard(cluster))}

                {hiddenClusters.length > 0 && (
                  <div data-testid="brain-hidden-clusters-section" className="forensic-brain-lower-priority">
                    <button
                      type="button"
                      className="forensic-brain-lower-priority-toggle"
                      aria-expanded={showHiddenClusters}
                      onClick={() => setShowHiddenClusters((current) => !current)}
                    >
                      {showHiddenClusters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {showHiddenClusters ? 'Hide' : 'Show'} hidden clusters ({hiddenClusters.length})
                    </button>

                    {showHiddenClusters && (
                      <div className="forensic-brain-hidden-cluster-list">
                        {hiddenClusters.map((cluster) => renderClusterCard(cluster, true))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedCluster && !selectedCluster.hidden ? (
                renderClusterDetail(selectedCluster)
              ) : (
                <aside className="forensic-brain-cluster-detail forensic-brain-cluster-detail-empty">
                  <span className="forensic-brain-panel-kicker">Cluster detail</span>
                  <p>Select a memory cluster to inspect members, reasons, and related memory objects.</p>
                </aside>
              )}
            </div>
          )}
        </section>
      </div>
    )
  }

  const autonomyStateClass = autonomyAutoPrepareEnabled ? 'forensic-brain-state-on' : 'forensic-brain-state-off'
  const brainViewOptions: Array<{ view: BrainView; label: string; detail: string; detailClassName?: string }> = [
    { view: 'focus', label: 'Focus', detail: attentionSummary?.focus ? formatAttentionState(attentionSummary.dominantState) : 'summary' },
    { view: 'map', label: 'Memory Map', detail: `${brainMapModel.summary.visibleCount} visible` },
    { view: 'moves', label: 'Next Moves', detail: `${activeSuggestions.length} active` },
    { view: 'autonomy', label: 'Autonomy Queue', detail: autonomyAutoPrepareEnabled ? 'auto on' : 'auto off', detailClassName: autonomyStateClass },
    { view: 'signals', label: 'Active Signals', detail: `${allSignalGroups.length} firing` },
    { view: 'links', label: 'Memory Links', detail: `${allLinkGroups.length} saved` },
    { view: 'clusters', label: 'Memory Clusters', detail: `${visibleClusters.length} visible` },
  ]

  return (
    <section data-testid="brain-signals-panel" className="forensic-brain-root" aria-label="Brain memory signals">
      <div className="forensic-brain-grid-bg" aria-hidden="true" />
      <header className="forensic-brain-command">
        <div className="forensic-brain-title-block">
          <span className="forensic-brain-kicker">Memory activation</span>
          <h2>
            <Brain size={20} />
            Brain Signals
          </h2>
          <div className="forensic-brain-title-rule" />
          <p>{activeTitle}</p>
        </div>
        <div className="forensic-brain-command-actions">
          <span className="forensic-brain-status">
            {attentionSummary?.focus
              ? `Focus: ${formatAttentionState(attentionSummary.dominantState)} / ${formatScore(attentionSummary.overallScore)}`
              : 'Brain focus pending'}
          </span>
          {renderBrainAttentionTrigger()}
          <button
            type="button"
            aria-label="Refresh brain signals"
            onClick={() => {
              void loadBrainMemory(true)
              startBrainMemoryFollowup()
            }}
            disabled={!currentInvestigationId || isLoading || isRefreshing}
            className="forensic-brain-refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? 'forensic-brain-refresh-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <nav data-testid="brain-subnav" className="forensic-brain-subnav" aria-label="Brain sections">
        {brainViewOptions.map((option) => (
          <button
            key={option.view}
            type="button"
            aria-label={`${option.label} view`}
            aria-pressed={activeBrainView === option.view}
            className={activeBrainView === option.view ? 'is-active' : ''}
            onClick={() => setActiveBrainView(option.view)}
          >
            <span>{option.label}</span>
            <strong className={option.detailClassName}>{option.detail}</strong>
          </button>
        ))}
      </nav>

      {renderBrainAttentionPanel()}

      <div className="forensic-brain-active-view">
        {activeBrainView === 'focus' && renderFocusView()}
        {activeBrainView === 'map' && (
          <div className="forensic-brain-view forensic-brain-view-map">
            {renderBrainHealth()}
            {renderBrainMap()}
          </div>
        )}
        {activeBrainView === 'signals' && renderSignalsView()}
        {activeBrainView === 'moves' && renderNextMovesView()}
        {activeBrainView === 'autonomy' && renderAutonomyView()}
        {activeBrainView === 'links' && renderLinksView()}
        {activeBrainView === 'clusters' && renderClustersView()}
      </div>

      {activeBrainView === 'links' && selectedMemoryLinkGroup && renderMemoryLinkDetail(selectedMemoryLinkGroup)}

      {selectedCompareContext && renderCompareWorkspace(selectedCompareContext)}

      {error && (
        <div data-testid="brain-error-state" role="alert" className="forensic-brain-error">
          {error}
        </div>
      )}
    </section>
  )
}
