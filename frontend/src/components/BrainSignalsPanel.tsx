import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, ChevronUp, ExternalLink, Link2, RefreshCw, X } from 'lucide-react'
import {
  dismissBrainSignal,
  fetchBrainLinks,
  fetchBrainSignals,
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
  const requestIdRef = useRef(0)

  const loadBrainMemory = useCallback(async (isManualRefresh = false) => {
    if (!currentInvestigationId) {
      setSignals([])
      setLinks([])
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
      setShowLowerPrioritySignals(false)
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
        <div className="forensic-brain-card-topline">
          <div>
            <span className="forensic-brain-card-label">Older case fired</span>
            <h4>{signal.targetTitle}</h4>
            {relatedFiringText && (
              <span className="forensic-brain-card-group-count">{relatedFiringText}</span>
            )}
          </div>
          <strong className={`forensic-brain-score forensic-brain-score-${scoreTier.toLocaleLowerCase()}`}>
            <span>{formatScore(group.score)}</span>
            <em>{scoreTier}</em>
          </strong>
        </div>

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

        <div className="forensic-brain-signal-summary">
          <span>Why it fired</span>
          <strong>{signalSummary}</strong>
        </div>

        <div className="forensic-brain-reason-stack">
          {group.reasons.slice(0, 3).map((reason, index) => (
            <p key={`${group.key}:detail:${reason.gateway}:${reason.value}:${index}`}>
              {reason.detail || reason.label}
            </p>
          ))}
        </div>

        <div className="forensic-brain-suggested-action">
          <span>Suggested action</span>
          <strong>{signal.suggestedAction}</strong>
        </div>

        <div className="forensic-brain-card-actions">
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
        </div>
      </article>
    )
  }

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
              {rankedLinks.map((link) => (
                <article key={link.id} data-testid="brain-link-card" className="forensic-brain-link-card">
                  <div className="forensic-brain-link-header">
                    <Link2 size={14} />
                    <strong>{link.toTitle}</strong>
                    <span>{formatScore(link.score)}</span>
                  </div>
                  <p>{link.reasons[0]?.detail || link.suggestedAction}</p>
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
              ))}
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div data-testid="brain-error-state" role="alert" className="forensic-brain-error">
          {error}
        </div>
      )}
    </section>
  )
}
