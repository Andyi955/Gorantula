import { useEffect, useMemo, useRef, useState } from 'react'
import { Lightbulb, ChevronRight, ChevronLeft, ChevronDown, Sparkles, FileText, ShieldAlert } from 'lucide-react'
import type { DiscoveryRecord } from '../App'
import { BOARD_TOGGLE_DISCOVERY_PANEL_EVENT } from '../utils/boardWorkspaceEvents'

interface DiscoveryEvidenceRecord {
  id: string
  title: string
  summary: string
  sourceURL?: string
}

interface DiscoveryPanelProps {
  currentInvestigationId: string | null
  discoveries: DiscoveryRecord[]
  evidenceByNodeId: Record<string, DiscoveryEvidenceRecord>
  hasCompletedReview?: boolean
  hasUnread: boolean
  showHandle?: boolean
  onOpenDiscovery: (nodeId?: string) => void
  onClear: () => void
  onMarkRead: () => void
}

const formatConfidence = (value: number) => `${Math.round((value || 0) * 100)}%`
const confidencePercent = (value: number) => Math.round((value || 0) * 100)
const DISCOVERY_CONFIDENCE_COUNT_UP_STEPS = 24
const DISCOVERY_CONFIDENCE_COUNT_UP_INTERVAL_MS = 60
const DISCOVERY_REVEAL_DURATION_MS = 1900

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function DiscoveryPanel({
  currentInvestigationId,
  discoveries,
  evidenceByNodeId,
  hasCompletedReview = false,
  hasUnread,
  showHandle = true,
  onOpenDiscovery,
  onClear,
  onMarkRead,
}: DiscoveryPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedEvidenceByDiscoveryId, setExpandedEvidenceByDiscoveryId] = useState<Record<string, boolean>>({})
  const [revealingDiscoveryIds, setRevealingDiscoveryIds] = useState<Set<string>>(() => new Set())
  const [displayConfidenceByDiscoveryId, setDisplayConfidenceByDiscoveryId] = useState<Record<string, number>>({})
  const knownDiscoveryIdsRef = useRef<Set<string>>(new Set(discoveries.map((discovery) => discovery.id)))
  const confidenceTimersRef = useRef<Map<string, number>>(new Map())
  const revealTimersRef = useRef<Map<string, number>>(new Map())

  const orderedDiscoveries = useMemo(
    () => [...discoveries].sort((left, right) => right.confidence - left.confidence),
    [discoveries],
  )

  useEffect(() => {
    knownDiscoveryIdsRef.current = new Set(discoveries.map((discovery) => discovery.id))
    setRevealingDiscoveryIds(new Set())
    setDisplayConfidenceByDiscoveryId({})
    confidenceTimersRef.current.forEach((timerId) => window.clearInterval(timerId))
    confidenceTimersRef.current.clear()
    revealTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
    revealTimersRef.current.clear()
  }, [currentInvestigationId])

  useEffect(() => {
    const knownDiscoveryIds = knownDiscoveryIdsRef.current
    const newDiscoveries = discoveries.filter((discovery) => !knownDiscoveryIds.has(discovery.id))
    discoveries.forEach((discovery) => knownDiscoveryIds.add(discovery.id))

    if (newDiscoveries.length === 0) {
      return
    }

    if (prefersReducedMotion()) {
      setDisplayConfidenceByDiscoveryId((current) => {
        const next = { ...current }
        newDiscoveries.forEach((discovery) => {
          next[discovery.id] = confidencePercent(discovery.confidence)
        })
        return next
      })
      return
    }

    setRevealingDiscoveryIds((current) => {
      const next = new Set(current)
      newDiscoveries.forEach((discovery) => next.add(discovery.id))
      return next
    })
    setDisplayConfidenceByDiscoveryId((current) => {
      const next = { ...current }
      newDiscoveries.forEach((discovery) => {
        next[discovery.id] = 0
      })
      return next
    })
  }, [discoveries])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    orderedDiscoveries.forEach((discovery) => {
      if (!revealingDiscoveryIds.has(discovery.id) || confidenceTimersRef.current.has(discovery.id)) {
        return
      }

      const finalPercent = confidencePercent(discovery.confidence)
      if (prefersReducedMotion()) {
        setDisplayConfidenceByDiscoveryId((current) => ({
          ...current,
          [discovery.id]: finalPercent,
        }))
        return
      }

      let step = 0
      const timerId = window.setInterval(() => {
        step += 1
        const nextPercent = Math.round(finalPercent * Math.min(step / DISCOVERY_CONFIDENCE_COUNT_UP_STEPS, 1))
        setDisplayConfidenceByDiscoveryId((current) => ({
          ...current,
          [discovery.id]: nextPercent,
        }))
        if (step >= DISCOVERY_CONFIDENCE_COUNT_UP_STEPS) {
          window.clearInterval(timerId)
          confidenceTimersRef.current.delete(discovery.id)
        }
      }, DISCOVERY_CONFIDENCE_COUNT_UP_INTERVAL_MS)
      confidenceTimersRef.current.set(discovery.id, timerId)

      const revealTimerId = window.setTimeout(() => {
        revealTimersRef.current.delete(discovery.id)
        setRevealingDiscoveryIds((current) => {
          const next = new Set(current)
          next.delete(discovery.id)
          return next
        })
      }, DISCOVERY_REVEAL_DURATION_MS)
      revealTimersRef.current.set(discovery.id, revealTimerId)
    })
  }, [isOpen, orderedDiscoveries, revealingDiscoveryIds])

  useEffect(() => () => {
    confidenceTimersRef.current.forEach((timerId) => window.clearInterval(timerId))
    revealTimersRef.current.forEach((timerId) => window.clearTimeout(timerId))
  }, [])

  useEffect(() => {
    const handlePanelToggle = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean }>).detail
      const next = typeof detail?.open === 'boolean' ? detail.open : !isOpen
      setIsOpen(next)
      if (next) {
        onMarkRead()
      }
    }

    window.addEventListener(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT, handlePanelToggle)
    return () => window.removeEventListener(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT, handlePanelToggle)
  }, [isOpen, onMarkRead])

  if (!currentInvestigationId) {
    return null
  }

  const toggleEvidence = (discoveryId: string) => {
    setExpandedEvidenceByDiscoveryId((current) => ({
      ...current,
      [discoveryId]: !current[discoveryId],
    }))
  }
  const isCompletedEmptyReview = hasCompletedReview && orderedDiscoveries.length === 0
  const emptyStateClassName = [
    'forensic-board-section forensic-discovery-empty-state rounded-2xl p-4 text-xs leading-relaxed text-[var(--forensic-text-muted)]',
    isCompletedEmptyReview ? 'forensic-discovery-empty-complete' : '',
    isCompletedEmptyReview && !prefersReducedMotion() ? 'forensic-discovery-empty-complete-sweep' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      {showHandle && !isOpen && (
        <button
          onClick={() => {
            setIsOpen(true)
            onMarkRead()
          }}
          aria-label="Open discoveries"
          className="forensic-overlay-handle absolute right-0 top-44 z-40 flex items-center gap-2 rounded-l-xl p-3 text-[var(--forensic-warning)] transition-all hover:bg-[var(--forensic-warning)] hover:text-black"
        >
          <ChevronLeft size={18} />
          <Lightbulb size={20} className={hasUnread ? 'forensic-discovery-handle-icon-unread' : ''} />
          {hasUnread && (
            <span className="forensic-discovery-handle-badge absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">
              !
            </span>
          )}
        </button>
      )}

      <div
        className={`forensic-overlay-panel absolute bottom-0 right-0 top-0 z-50 flex w-96 transform flex-col transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="border-b border-[rgba(246,200,121,0.14)] bg-[linear-gradient(180deg,rgba(246,200,121,0.08),rgba(246,200,121,0.03))] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[var(--forensic-warning)]">
              <Sparkles size={18} />
              <h2 className="text-sm font-black uppercase tracking-[0.22em]">Breakthroughs</h2>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onClear} className="text-xs font-bold text-[var(--forensic-text-faint)] hover:text-[var(--forensic-danger)]">
                CLEAR
              </button>
              <button
                onClick={() => {
                  setIsOpen(false)
                }}
                className="text-[var(--forensic-text-faint)] hover:text-white"
                aria-label="Close discoveries"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--forensic-text-muted)]">
            Only the strongest, evidence-backed discoveries appear here.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {orderedDiscoveries.length === 0 ? (
            <div data-testid="discovery-empty-state" className={emptyStateClassName}>
              {hasCompletedReview ? (
                <>
                  Discovery review finished with no approved discoveries. Check the discovery log in <span className="font-mono text-[var(--forensic-accent-strong)]">abdomen_vault/discovery_logs</span> to see the full candidate and review trail.
                </>
              ) : (
                <>
                  No approved discoveries yet for this investigation. Run <span className="font-black uppercase tracking-[0.14em] text-[var(--forensic-warning)]">Reconnect The Dots</span>, then check the discovery log in <span className="font-mono text-[var(--forensic-accent-strong)]">abdomen_vault/discovery_logs</span> to see the full candidate and review trail.
                </>
              )}
            </div>
          ) : (
            orderedDiscoveries.map((discovery) => {
              const isRevealing = revealingDiscoveryIds.has(discovery.id)
              const expanded = Boolean(expandedEvidenceByDiscoveryId[discovery.id])
              const displayConfidence = displayConfidenceByDiscoveryId[discovery.id] ?? confidencePercent(discovery.confidence)

              return (
              <div
                key={discovery.id}
                data-testid={`discovery-card-${discovery.id}`}
                className={`forensic-board-section forensic-discovery-card rounded-[1.35rem] p-4 ${isRevealing ? 'forensic-discovery-card-reveal' : ''}`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black uppercase tracking-[0.16em] text-[var(--forensic-warning)]">{discovery.title}</h3>
                  <span
                    data-testid={`discovery-confidence-${discovery.id}`}
                    className="forensic-badge forensic-badge-warning rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em]"
                  >
                    {formatConfidence(displayConfidence / 100)}
                  </span>
                </div>

                <div className="space-y-3 text-xs leading-relaxed text-[var(--forensic-text)]">
                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--forensic-warning)]">
                      <Lightbulb size={11} />
                      Claim
                    </div>
                    <p>{discovery.claim}</p>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--forensic-warning)]">
                      <ShieldAlert size={11} />
                      Why It Matters
                    </div>
                    <p>{discovery.impact}</p>
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => toggleEvidence(discovery.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} ${discovery.sourceNodeIDs.length} supporting evidence nodes`}
                      className="flex w-full items-center justify-between border-t border-[rgba(246,200,121,0.14)] pt-3 text-left text-[10px] font-black uppercase tracking-[0.18em] text-[var(--forensic-warning)] transition-colors hover:text-[var(--forensic-accent)]"
                    >
                      <span>Supporting evidence: {discovery.sourceNodeIDs.length} node{discovery.sourceNodeIDs.length === 1 ? '' : 's'}</span>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div
                      data-testid={`discovery-evidence-panel-${discovery.id}`}
                      aria-hidden={!expanded}
                      className={`forensic-discovery-evidence-panel ${expanded ? 'forensic-discovery-evidence-panel-open' : 'forensic-discovery-evidence-panel-closed'}`}
                    >
                      <div className="mt-3 divide-y divide-[rgba(116,148,171,0.16)] border-y border-[rgba(116,148,171,0.16)]">
                        {discovery.sourceNodeIDs.map((nodeId) => {
                          const evidence = evidenceByNodeId[nodeId]
                          const title = evidence?.title || 'Evidence node'
                          const summary = evidence?.summary || 'No summary available for this evidence node.'

                          return (
                            <button
                              key={nodeId}
                              type="button"
                              onClick={() => onOpenDiscovery(nodeId)}
                              aria-label={`Open evidence ${title}`}
                              className="block w-full py-3 text-left transition-colors hover:text-[var(--forensic-accent)]"
                            >
                              <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-[var(--forensic-text)]">
                                <FileText size={12} className="text-[var(--forensic-warning)]" />
                                {title}
                              </span>
                              <span className="mt-1 block text-[11px] leading-relaxed text-[var(--forensic-text-muted)]">
                                {summary}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              )
            })
          )}
        </div>
      </div>
    </>
  )
}
