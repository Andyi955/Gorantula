import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronUp, ExternalLink, Eye, EyeOff, Link2, Pin, RefreshCw, Trash2, X } from 'lucide-react'
import brainRadarEmblem from '../assets/brain-radar-emblem.png'
import {
  BOARD_WORKSPACE_STATE_UPDATED_EVENT,
  type BoardWorkspaceStateUpdatedDetail,
} from '../utils/boardWorkspaceEvents'
import {
  dismissBrainSuggestion,
  dismissBrainSignal,
  fetchBrainClusters,
  fetchBrainLinks,
  fetchBrainSuggestions,
  fetchBrainSignals,
  forgetBrainLink,
  hideBrainCluster,
  promoteBrainSignal,
  reviewBrainSuggestion,
  toggleBrainClusterPin,
  unhideBrainCluster,
  type BrainSuggestion,
  type BrainSignal,
  type MemoryCluster,
  type MemoryLink,
} from '../utils/brainMemory'
import { buildBrainMapModel, type BrainMapNode } from '../utils/brainMap'
import {
  LOW_PRIORITY_SCORE_THRESHOLD,
  buildSignalSummary,
  clusterMatchesFilters,
  dominantGatewayLabel,
  formatActivationCount,
  formatClusterGatewayCount,
  formatClusterMemberCount,
  formatClusterStatus,
  formatCountLabel,
  formatGateway,
  formatGatewayCount,
  formatMemoryLinkType,
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
  matchesBrainFilters,
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
}

const PRIORITY_SIGNAL_LIMIT = 10
const LINKED_MEMORY_PRIORITY_LIMIT = 5
const NEXT_MOVES_PRIORITY_LIMIT = 7
const BOARD_MEMORY_REFRESH_DEBOUNCE_MS = 350
const BRAIN_MEMORY_FOLLOWUP_INTERVAL_MS = 1100
const BRAIN_MEMORY_FOLLOWUP_MAX_ATTEMPTS = 4

type BrainView = 'map' | 'moves' | 'signals' | 'links' | 'clusters'

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
  const priorityDelta = suggestionPriorityRank(left.priority) - suggestionPriorityRank(right.priority)
  if (priorityDelta !== 0) {
    return priorityDelta
  }
  if (left.score === right.score) {
    return left.title.localeCompare(right.title)
  }
  return right.score - left.score
})

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
    default:
      return kind.replace(/-/g, ' ')
  }
}

export default function BrainSignalsPanel({
  currentInvestigationId,
  currentInvestigationTitle,
  onOpenInvestigation,
}: BrainSignalsPanelProps) {
  const [signals, setSignals] = useState<BrainSignal[]>([])
  const [links, setLinks] = useState<MemoryLink[]>([])
  const [clusters, setClusters] = useState<MemoryCluster[]>([])
  const [suggestions, setSuggestions] = useState<BrainSuggestion[]>([])
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
  const [activeBrainView, setActiveBrainView] = useState<BrainView>('map')
  const [gatewayFilter, setGatewayFilter] = useState<GatewayFilter>('all')
  const [strengthFilter, setStrengthFilter] = useState<StrengthFilter>('all')
  const [brainMemoryFollowupRunId, setBrainMemoryFollowupRunId] = useState(0)
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
      const nextClusters = await fetchBrainClusters(currentInvestigationId)
      const nextSuggestions = await fetchBrainSuggestions(currentInvestigationId)

      if (requestIdRef.current !== requestId) {
        return
      }

      setSignals(sortByScore(nextSignals.filter((signal) => !signal.dismissed && !signal.linked)))
      setLinks(sortByScore(nextLinks))
      setClusters(sortClusters(nextClusters))
      setSuggestions(sortSuggestionsForView(nextSuggestions))
      setShowLowerPrioritySignals(false)
      setShowLowerPrioritySuggestions(false)
      setShowOlderMemoryLinks(false)
      setSelectedMemoryLinkId((current) =>
        current && nextLinks.some((link) => link.id === current) ? current : null,
      )
      setSelectedClusterId((current) =>
        current && nextClusters.some((cluster) => cluster.id === current) ? current : null,
      )
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
      if (group.score >= LOW_PRIORITY_SCORE_THRESHOLD && priority.length < PRIORITY_SIGNAL_LIMIT) {
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
  const prioritySuggestions = useMemo(
    () => activeSuggestions.slice(0, NEXT_MOVES_PRIORITY_LIMIT),
    [activeSuggestions],
  )
  const lowerPrioritySuggestions = useMemo(
    () => activeSuggestions.slice(NEXT_MOVES_PRIORITY_LIMIT),
    [activeSuggestions],
  )
  const reviewedSuggestions = useMemo(
    () => rankedSuggestions.filter((suggestion) => suggestion.status === 'reviewed'),
    [rankedSuggestions],
  )
  const activeTitle = currentInvestigationTitle || currentInvestigationId || 'No investigation selected'
  const brainMapModel = useMemo(
    () => buildBrainMapModel({
      currentInvestigationId: currentInvestigationId || undefined,
      currentInvestigationTitle: activeTitle,
      signals: rankedSignals,
      links: rankedLinks,
    }),
    [activeTitle, currentInvestigationId, rankedSignals, rankedLinks],
  )
  const selectedBrainMapNode = useMemo(
    () =>
      brainMapModel.nodes.find((node) => node.id === selectedBrainMapNodeId) ||
      brainMapModel.nodes[0] ||
      null,
    [brainMapModel.nodes, selectedBrainMapNodeId],
  )
  const selectedMemoryLinkGroup = useMemo(
    () => allLinkGroups.find((group) => group.links.some((link) => link.id === selectedMemoryLinkId)) || null,
    [allLinkGroups, selectedMemoryLinkId],
  )
  const brainHealth = useMemo(() => {
    const scores = [
      ...allSignalGroups.map((group) => group.score),
      ...allLinkGroups.map((group) => group.score),
      ...rankedClusters.filter((cluster) => !cluster.hidden).map((cluster) => cluster.score),
    ]
    const strongestScore = scores.length > 0 ? Math.max(...scores) : 0
    const autoMemoryCount = rankedLinks.filter((link) => link.promotionType === 'auto').length

    return {
      firingCases: formatCountLabel(allSignalGroups.length, 'firing case'),
      memoryGroups: formatCountLabel(allLinkGroups.length, 'memory group'),
      memoryClusters: formatCountLabel(rankedClusters.filter((cluster) => !cluster.hidden).length, 'memory cluster'),
      nextMoves: formatCountLabel(activeSuggestions.length, 'next move'),
      autoMemory: `${autoMemoryCount} auto`,
      strongestScore: formatScore(strongestScore),
      dominantGateway: dominantGatewayLabel(allSignalGroups, allLinkGroups),
    }
  }, [activeSuggestions.length, allSignalGroups, allLinkGroups, rankedClusters, rankedLinks])

  useEffect(() => {
    if (!selectedBrainMapNodeId) {
      return
    }

    if (!brainMapModel.nodes.some((node) => node.id === selectedBrainMapNodeId)) {
      setSelectedBrainMapNodeId(null)
    }
  }, [brainMapModel.nodes, selectedBrainMapNodeId])

  useEffect(() => {
    if (!selectedClusterId) {
      return
    }

    if (!rankedClusters.some((cluster) => cluster.id === selectedClusterId && !cluster.hidden)) {
      setSelectedClusterId(null)
    }
  }, [rankedClusters, selectedClusterId])

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
      setSuggestions((current) =>
        sortSuggestionsForView(current.map((candidate) => (candidate.id === reviewed.id ? reviewed : candidate))),
      )
    } catch {
      setError('Brain suggestion review failed')
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

  const renderSignalGroup = (group: BrainSignalGroup) => {
    const relatedFiringText = getRelatedFiringText(group.signals.length)
    const signal = group.primary
    const scoreTier = getScoreTier(group.score)
    const gatewayCounts = getGatewayCounts(group)
    const signalSummary = buildSignalSummary(group)
    const relatedClusters = relatedClustersForSignalGroup(group, rankedClusters)

    return (
      <article
        key={group.key}
        data-testid="brain-signal-card"
        data-signal-id={signal.id}
        data-signal-group={group.key}
        className="forensic-brain-signal-card"
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

    return (
    <article key={group.key} data-testid="brain-link-card" className="forensic-brain-link-card">
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
    </article>
    )
  }

  const renderMemoryLinkDetail = (group: MemoryLinkGroup) => {
    const link = group.primary
    const relatedMemoryText = getRelatedMemoryText(group.links.length)

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

    return (
      <article
        key={`${isHidden ? 'hidden' : 'visible'}:${cluster.id}`}
        data-testid={isHidden ? 'brain-hidden-cluster-card' : 'brain-cluster-card'}
        className={[
          'forensic-brain-cluster-card',
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
          <span>Status</span>
          <strong>{formatClusterStatus(cluster.status)}</strong>
        </div>
        <div>
          <span>Gateway</span>
          <strong>{formatGateway(cluster.dominantGateway)}</strong>
        </div>
      </div>

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

  const renderBrainMapNode = (node: BrainMapNode) => {
    const isSelected = selectedBrainMapNode?.id === node.id
    const nodeTypeLabel = node.kind === 'current' ? 'focus' : node.kind
    const gatewayLabel = node.gateways[0] ? formatGateway(node.gateways[0]) : node.kind === 'current' ? 'Live focus' : 'Memory'

    return (
      <button
        key={node.id}
        type="button"
        data-testid="brain-map-node"
        aria-label={`Select ${nodeTypeLabel} ${node.kind === 'current' ? node.subtitle : node.title}`}
        aria-pressed={isSelected}
        className={[
          'forensic-brain-map-node',
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

    return (
      <section data-testid="brain-map-selected-node" className="forensic-brain-map-selected">
        <span>{node.kind === 'current' ? 'Current scan' : node.kind === 'memory' ? 'Linked memory' : 'Active signal'}</span>
        <h4>{node.kind === 'current' ? node.subtitle : node.title}</h4>
        <div className="forensic-brain-map-selected-badges">
          {node.badges.map((badge) => (
            <span key={`${node.id}:${badge}`}>{badge}</span>
          ))}
          {node.kind !== 'current' && <span>{node.scoreLabel}</span>}
        </div>

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
          <p className="forensic-brain-map-selected-empty">This investigation is the current memory focus.</p>
        )}

        {node.kind !== 'current' && (
          <div className="forensic-brain-map-selected-actions">
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
          </div>
        )}
      </section>
    )
  }

  const renderBrainMap = () => (
    <section data-testid="brain-map-radar" className="forensic-brain-map-radar" aria-label="Brain memory map">
      <div className="forensic-brain-map-header">
        <div>
          <span className="forensic-brain-panel-kicker">Memory map</span>
          <h3>Active recall deck</h3>
        </div>
        <div className="forensic-brain-map-summary">
          <span>{brainMapModel.summary.linkedMemoryCount} saved</span>
          <span>{brainMapModel.summary.activeSignalCount} firing</span>
          <span>{brainMapModel.summary.visibleCount} visible</span>
          {brainMapModel.hiddenCount > 0 && <span>{brainMapModel.hiddenCount} folded</span>}
          <strong>{brainMapModel.summary.strongestScore}</strong>
        </div>
      </div>

      <div className="forensic-brain-map-shell">
        <div className="forensic-brain-map-canvas" aria-label="Current investigation and related memories">
          <div className="forensic-brain-map-bus" aria-hidden="true">
            <span>Active Recall</span>
            <strong>{brainMapModel.summary.strongestScore}</strong>
          </div>
          <div className="forensic-brain-map-node-stack">
            {brainMapModel.nodes.map(renderBrainMapNode)}
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
        <span>Auto Memory</span>
        <strong>{brainHealth.autoMemory}</strong>
      </div>
      <div>
        <span>Strongest</span>
        <strong>{brainHealth.strongestScore}</strong>
      </div>
      <div>
        <span>Dominant Gateway</span>
        <strong>{brainHealth.dominantGateway}</strong>
      </div>
    </div>
  )

  const renderSuggestionCard = (suggestion: BrainSuggestion) => {
    const canOpenTarget = suggestion.targetInvestigationIds.length > 0 && !!onOpenInvestigation
    const canViewCluster = suggestion.relatedClusterIds.length > 0
    const canViewLink = suggestion.relatedMemoryLinkIds.length > 0
    const canViewSignal = suggestion.relatedSignalIds.length > 0
    const isReviewed = suggestion.status === 'reviewed'

    return (
      <article
        key={suggestion.id}
        data-testid="brain-suggestion-card"
        className={`forensic-brain-suggestion-card forensic-brain-suggestion-${suggestion.priority} ${isReviewed ? 'is-reviewed' : ''}`}
      >
        <div className="forensic-brain-suggestion-main">
          <div className="forensic-brain-suggestion-topline">
            <span>{formatSuggestionKind(suggestion.kind)}</span>
            <strong>{suggestion.priority}</strong>
          </div>
          <h4>{suggestion.title}</h4>
          <p>{suggestion.summary}</p>
          <div className="forensic-brain-suggestion-reason">
            <span>Why it matters</span>
            <strong>{suggestion.reason}</strong>
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
        </div>

        <aside className="forensic-brain-suggestion-action">
          <span>{formatScore(suggestion.score)}</span>
          <strong>{suggestion.suggestedAction}</strong>
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

  const brainViewOptions: Array<{ view: BrainView; label: string; detail: string }> = [
    { view: 'map', label: 'Memory Map', detail: `${brainMapModel.summary.visibleCount} visible` },
    { view: 'moves', label: 'Next Moves', detail: `${activeSuggestions.length} active` },
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
            {activeSuggestions.length} moves / {allSignalGroups.length} active / {allLinkGroups.length} linked / {visibleClusters.length} clusters
          </span>
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
            <strong>{option.detail}</strong>
          </button>
        ))}
      </nav>

      <div className="forensic-brain-active-view">
        {activeBrainView === 'map' && (
          <div className="forensic-brain-view forensic-brain-view-map">
            {renderBrainHealth()}
            {renderBrainMap()}
          </div>
        )}
        {activeBrainView === 'signals' && renderSignalsView()}
        {activeBrainView === 'moves' && renderNextMovesView()}
        {activeBrainView === 'links' && renderLinksView()}
        {activeBrainView === 'clusters' && renderClustersView()}
      </div>

      {activeBrainView === 'links' && selectedMemoryLinkGroup && renderMemoryLinkDetail(selectedMemoryLinkGroup)}

      {error && (
        <div data-testid="brain-error-state" role="alert" className="forensic-brain-error">
          {error}
        </div>
      )}
    </section>
  )
}
