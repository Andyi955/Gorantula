import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ExternalLink, Link2, RefreshCw, X } from 'lucide-react'
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

const formatGateway = (gateway: BrainGateway) =>
  gatewayLabels[gateway] || String(gateway).replace(/[-_]+/g, ' ')

const formatScore = (score: number) => `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`

const sortByScore = <T extends { score: number; createdAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  })

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
  const requestIdRef = useRef(0)

  const loadBrainMemory = useCallback(async (isManualRefresh = false) => {
    if (!currentInvestigationId) {
      setSignals([])
      setLinks([])
      setError(null)
      setIsLoading(false)
      setIsRefreshing(false)
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
  const rankedLinks = useMemo(() => sortByScore(links), [links])

  const handleDismiss = async (signalId: string) => {
    setBusyAction(`dismiss:${signalId}`)
    setError(null)
    try {
      await dismissBrainSignal(signalId)
      setSignals((current) => current.filter((signal) => signal.id !== signalId))
    } catch {
      setError('Brain signal dismiss failed')
    } finally {
      setBusyAction(null)
    }
  }

  const handlePromote = async (signalId: string) => {
    setBusyAction(`promote:${signalId}`)
    setError(null)
    try {
      const link = await promoteBrainSignal(signalId)
      setSignals((current) => current.filter((signal) => signal.id !== signalId))
      setLinks((current) => sortByScore([link, ...current.filter((candidate) => candidate.id !== link.id)]))
    } catch {
      setError('Brain memory link failed')
    } finally {
      setBusyAction(null)
    }
  }

  const activeTitle = currentInvestigationTitle || currentInvestigationId || 'No investigation selected'

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
            {rankedSignals.length} active / {rankedLinks.length} linked
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
          ) : rankedSignals.length === 0 ? (
            <div data-testid="brain-empty-state" className="forensic-brain-empty">
              No brain signals fired for this investigation.
            </div>
          ) : (
            <div className="forensic-brain-signal-list">
              {rankedSignals.map((signal) => (
                <article
                  key={signal.id}
                  data-testid="brain-signal-card"
                  data-signal-id={signal.id}
                  className="forensic-brain-signal-card"
                >
                  <div className="forensic-brain-card-topline">
                    <div>
                      <span className="forensic-brain-card-label">Older case fired</span>
                      <h4>{signal.targetTitle}</h4>
                    </div>
                    <strong>{formatScore(signal.score)}</strong>
                  </div>

                  <div className="forensic-brain-chip-row" aria-label="Signal reasons">
                    {signal.reasons.map((reason) => (
                      <span
                        key={`${signal.id}:${reason.gateway}:${reason.value}`}
                        className={`forensic-brain-chip ${gatewayClassNames[reason.gateway] || ''}`}
                        title={reason.detail}
                      >
                        {formatGateway(reason.gateway)}
                      </span>
                    ))}
                  </div>

                  <div className="forensic-brain-reason-stack">
                    {signal.reasons.slice(0, 3).map((reason) => (
                      <p key={`${signal.id}:detail:${reason.gateway}:${reason.value}`}>
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
                      onClick={() => void handleDismiss(signal.id)}
                      disabled={busyAction === `dismiss:${signal.id}`}
                      className="forensic-brain-action forensic-brain-action-secondary"
                    >
                      <X size={13} />
                      Dismiss
                    </button>
                    <button
                      type="button"
                      aria-label={`Promote signal for ${signal.targetTitle}`}
                      onClick={() => void handlePromote(signal.id)}
                      disabled={busyAction === `promote:${signal.id}`}
                      className="forensic-brain-action forensic-brain-action-primary"
                    >
                      <Link2 size={13} />
                      Promote Link
                    </button>
                  </div>
                </article>
              ))}
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
