import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronUp, ExternalLink, Link2, RefreshCw, Trash2, X } from 'lucide-react'
import brainRadarEmblem from '../assets/brain-radar-emblem.png'
import {
  dismissBrainSignal,
  fetchBrainLinks,
  fetchBrainSignals,
  forgetBrainLink,
  promoteBrainSignal,
  type BrainGateway,
  type BrainSignal,
  type MemoryLink,
} from '../utils/brainMemory'

interface BrainSignalsPanelProps {
  currentInvestigationId: string | null
  currentInvestigationTitle?: string | null
  onOpenInvestigation?: (investigationId: string) => void
}

const gatewayLabels: Record<string, string> = {
  'entity-date': 'Entity/Date',
  'source-domain': 'Source Domain',
  'relationship-tag': 'Relationship',
}

const gatewayClassNames: Record<string, string> = {
  'entity-date': 'forensic-brain-chip-entity',
  'source-domain': 'forensic-brain-chip-source',
  'relationship-tag': 'forensic-brain-chip-relationship',
}

const PRIORITY_SIGNAL_LIMIT = 10
const LOW_PRIORITY_SCORE_THRESHOLD = 0.5
const LINKED_MEMORY_PRIORITY_LIMIT = 5

interface BrainSignalGroup {
  key: string
  primary: BrainSignal
  signals: BrainSignal[]
  score: number
  reasons: BrainSignal['reasons']
  gateways: BrainGateway[]
}

const formatGateway = (gateway: BrainGateway) =>
  gatewayLabels[gateway] || String(gateway).replace(/[-_]+/g, ' ')

const formatScore = (score: number) => `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`

const formatActivationCount = (activationCount?: number) => {
  const count = Math.max(1, Math.round(activationCount || 1))
  return `${count} activation${count === 1 ? '' : 's'}`
}

const formatMemoryLinkType = (promotionType?: string) =>
  promotionType === 'auto' ? 'Auto Memory' : 'Manual Memory'

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) {
    return 'Not recorded'
  }
  const cleaned = timestamp.replace(/\.\d+Z$/, 'Z')
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (match) {
    return `${match[1]} ${match[2]} UTC`
  }
  return timestamp
}

const formatNodeIds = (ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  return uniqueIds.length > 0 ? uniqueIds.join(', ') : 'No matched nodes recorded'
}

const getScoreTier = (score: number) => {
  if (score >= 0.75) {
    return 'Hot'
  }
  if (score >= LOW_PRIORITY_SCORE_THRESHOLD) {
    return 'Warm'
  }
  return 'Weak'
}

const sortByScore = <T extends { score: number; createdAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  })

const normalizeSignalGroupTitle = (title: string) => title.trim().toLocaleLowerCase().replace(/\s+/g, ' ')

const getSignalGroupKey = (signal: BrainSignal) =>
  normalizeSignalGroupTitle(signal.targetTitle) || signal.targetInvestigationId

const uniqueReasons = (signals: BrainSignal[]) => {
  const seen = new Set<string>()
  const reasons: BrainSignal['reasons'] = []

  signals.forEach((signal) => {
    signal.reasons.forEach((reason) => {
      const key = `${reason.gateway}:${reason.value}:${reason.detail || reason.label}`
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      reasons.push(reason)
    })
  })

  return reasons
}

const uniqueGateways = (signals: BrainSignal[]) => {
  const seen = new Set<string>()
  const gateways: BrainGateway[] = []

  signals.forEach((signal) => {
    const signalGateways = signal.reasons.length > 0
      ? signal.reasons.map((reason) => reason.gateway)
      : signal.gateways

    signalGateways.forEach((gateway) => {
      if (seen.has(gateway)) {
        return
      }
      seen.add(gateway)
      gateways.push(gateway)
    })
  })

  return gateways
}

const groupSignalsByOlderCase = (signals: BrainSignal[]): BrainSignalGroup[] => {
  const grouped = new Map<string, BrainSignal[]>()

  sortByScore(signals).forEach((signal) => {
    const key = getSignalGroupKey(signal)
    grouped.set(key, [...(grouped.get(key) || []), signal])
  })

  return Array.from(grouped.entries())
    .map(([key, groupSignals]) => {
      const rankedGroupSignals = sortByScore(groupSignals)
      const primary = rankedGroupSignals[0]

      return {
        key,
        primary,
        signals: rankedGroupSignals,
        score: primary.score,
        reasons: uniqueReasons(rankedGroupSignals),
        gateways: uniqueGateways(rankedGroupSignals),
      }
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.primary.targetTitle.localeCompare(right.primary.targetTitle)
    })
}

const getRelatedFiringText = (count: number) => {
  const relatedCount = count - 1
  if (relatedCount <= 0) {
    return null
  }
  return `+${relatedCount} related firing${relatedCount === 1 ? '' : 's'}`
}

const getGatewayCounts = (group: BrainSignalGroup) =>
  group.gateways.map((gateway) => {
    const reasonCount = group.reasons.filter((reason) => reason.gateway === gateway).length
    const signalGatewayCount = group.signals.filter((signal) => signal.gateways.includes(gateway)).length

    return {
      gateway,
      count: Math.max(1, reasonCount || signalGatewayCount),
    }
  })

const formatGatewayCount = ({ gateway, count }: { gateway: BrainGateway; count: number }) =>
  count > 1 ? `${formatGateway(gateway)} x${count}` : formatGateway(gateway)

const buildSignalSummary = (group: BrainSignalGroup) => {
  const labels: string[] = []
  const seen = new Set<string>()

  group.reasons.forEach((reason) => {
    const label = (reason.label || reason.value || '').trim()
    if (!label) {
      return
    }
    const key = label.toLocaleLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    labels.push(label)
  })

  if (labels.length === 0) {
    return group.primary.suggestedAction
  }

  const visibleLabels = labels.slice(0, 3)
  const hiddenCount = labels.length - visibleLabels.length
  return `${visibleLabels.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount} more` : ''}`
}

export default function BrainSignalsPanel({
  currentInvestigationId,
  currentInvestigationTitle,
  onOpenInvestigation,
}: BrainSignalsPanelProps) {
  const [signals, setSignals] = useState<BrainSignal[]>([])
  const [links, setLinks] = useState<MemoryLink[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [showLowerPrioritySignals, setShowLowerPrioritySignals] = useState(false)
  const [showOlderMemoryLinks, setShowOlderMemoryLinks] = useState(false)
  const [selectedMemoryLinkId, setSelectedMemoryLinkId] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const loadBrainMemory = useCallback(async (isManualRefresh = false) => {
    if (!currentInvestigationId) {
      setSignals([])
      setLinks([])
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
      setShowLowerPrioritySignals(false)
      setShowOlderMemoryLinks(false)
      setSelectedMemoryLinkId(null)
      return
    }

    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setError(null)
    if (isManualRefresh) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }

    try {
      const [nextSignals, nextLinks] = await Promise.all([
        fetchBrainSignals(currentInvestigationId),
        fetchBrainLinks(currentInvestigationId),
      ])

      if (requestIdRef.current !== requestId) {
        return
      }

      setSignals(sortByScore(nextSignals.filter((signal) => !signal.dismissed && !signal.linked)))
      setLinks(sortByScore(nextLinks))
      setShowLowerPrioritySignals(false)
      setShowOlderMemoryLinks(false)
      setSelectedMemoryLinkId((current) =>
        current && nextLinks.some((link) => link.id === current) ? current : null,
      )
    } catch {
      if (requestIdRef.current === requestId) {
        setError('Brain signals unavailable')
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [currentInvestigationId])

  useEffect(() => {
    void loadBrainMemory()
  }, [loadBrainMemory])

  const rankedSignals = useMemo(() => sortByScore(signals), [signals])
  const signalGroups = useMemo(() => groupSignalsByOlderCase(rankedSignals), [rankedSignals])
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
  const priorityLinks = useMemo(() => rankedLinks.slice(0, LINKED_MEMORY_PRIORITY_LIMIT), [rankedLinks])
  const olderLinks = useMemo(() => rankedLinks.slice(LINKED_MEMORY_PRIORITY_LIMIT), [rankedLinks])
  const selectedMemoryLink = useMemo(
    () => rankedLinks.find((link) => link.id === selectedMemoryLinkId) || null,
    [rankedLinks, selectedMemoryLinkId],
  )

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
    } catch {
      setError('Brain memory link failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handleForgetLink = async (link: MemoryLink) => {
    setBusyAction(`forget:${link.id}`)
    setError(null)
    try {
      await forgetBrainLink(link.id)
      setLinks((current) => current.filter((candidate) => candidate.id !== link.id))
      setSelectedMemoryLinkId((current) => (current === link.id ? null : current))
    } catch {
      setError('Brain memory forget failed')
    } finally {
      setBusyAction(null)
    }
  }

  const activeTitle = currentInvestigationTitle || currentInvestigationId || 'No investigation selected'

  const renderSignalGroup = (group: BrainSignalGroup) => {
    const relatedFiringText = getRelatedFiringText(group.signals.length)
    const signal = group.primary
    const scoreTier = getScoreTier(group.score)
    const gatewayCounts = getGatewayCounts(group)
    const signalSummary = buildSignalSummary(group)

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

  const renderMemoryLink = (link: MemoryLink) => (
    <article key={link.id} data-testid="brain-link-card" className="forensic-brain-link-card">
      <button
        type="button"
        className="forensic-brain-link-open"
        aria-label={`Inspect memory link ${link.toTitle}`}
        aria-expanded={selectedMemoryLinkId === link.id}
        onClick={() => setSelectedMemoryLinkId(link.id)}
      >
        <span className="forensic-brain-link-header">
          <Link2 size={14} />
          <strong>{link.toTitle}</strong>
          <span>{formatScore(link.score)}</span>
        </span>
        <span className="forensic-brain-link-meta">
          <span className={link.promotionType === 'auto' ? 'forensic-brain-link-meta-auto' : ''}>
            {formatMemoryLinkType(link.promotionType)}
          </span>
          <span>{formatActivationCount(link.activationCount)}</span>
        </span>
        <span className="forensic-brain-link-preview">{link.reasons[0]?.detail || link.suggestedAction}</span>
      </button>
      <div className="forensic-brain-chip-row">
        {link.gateways.map((gateway) => (
          <span
            key={`${link.id}:${gateway}`}
            className={`forensic-brain-chip ${gatewayClassNames[gateway] || ''}`}
          >
            {formatGateway(gateway)}
          </span>
        ))}
      </div>
    </article>
  )

  const renderMemoryLinkDetail = (link: MemoryLink) => (
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
          <strong>{formatScore(link.score)}</strong>
        </div>
        <div>
          <span>Memory Type</span>
          <strong>{formatMemoryLinkType(link.promotionType)}</strong>
        </div>
        <div>
          <span>Activation Count</span>
          <strong>{formatActivationCount(link.activationCount)}</strong>
        </div>
      </div>

      <div className="forensic-brain-detail-section">
        <span>Connected Investigations</span>
        <p><strong>{link.fromTitle}</strong> connects to <strong>{link.toTitle}</strong>.</p>
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
            disabled={busyAction === `forget:${link.id}`}
            onClick={() => void handleForgetLink(link)}
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
          {link.gateways.map((gateway) => (
            <span
              key={`${link.id}:detail:${gateway}`}
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
          {link.reasons.map((reason, index) => (
            <article key={`${link.id}:reason:${reason.gateway}:${reason.value}:${index}`}>
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
            {signalGroups.length} active / {rankedLinks.length} linked
          </span>
          <button
            type="button"
            aria-label="Refresh brain signals"
            onClick={() => void loadBrainMemory(true)}
            disabled={!currentInvestigationId || isLoading || isRefreshing}
            className="forensic-brain-refresh"
          >
            <RefreshCw size={14} className={isRefreshing ? 'forensic-brain-refresh-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <div className="forensic-brain-workspace">
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
              No brain signals fired for this investigation.
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

        <aside className="forensic-brain-panel forensic-brain-panel-links">
          <div className="forensic-brain-panel-header">
            <div>
              <span className="forensic-brain-panel-kicker">Promoted memory</span>
              <h3>Linked Memory</h3>
            </div>
          </div>

          {rankedLinks.length === 0 ? (
            <div data-testid="brain-links-empty-state" className="forensic-brain-empty forensic-brain-empty-compact">
              No memory links promoted yet.
            </div>
          ) : (
            <div className="forensic-brain-link-list">
              {priorityLinks.map(renderMemoryLink)}

              {olderLinks.length > 0 && (
                <div data-testid="brain-older-links-section" className="forensic-brain-lower-priority">
                  <button
                    type="button"
                    className="forensic-brain-lower-priority-toggle"
                    aria-expanded={showOlderMemoryLinks}
                    onClick={() => setShowOlderMemoryLinks((current) => !current)}
                  >
                    {showOlderMemoryLinks ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {showOlderMemoryLinks ? 'Hide' : 'Show'} older memory links ({olderLinks.length})
                  </button>

                  {showOlderMemoryLinks && (
                    <div className="forensic-brain-lower-priority-list">
                      {olderLinks.map(renderMemoryLink)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {selectedMemoryLink && renderMemoryLinkDetail(selectedMemoryLink)}

      {error && (
        <div data-testid="brain-error-state" role="alert" className="forensic-brain-error">
          {error}
        </div>
      )}
    </section>
  )
}
