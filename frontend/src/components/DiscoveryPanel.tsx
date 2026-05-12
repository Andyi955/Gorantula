import { useMemo, useState } from 'react'
import { Lightbulb, ChevronRight, ChevronLeft, Sparkles, Target, ShieldAlert } from 'lucide-react'
import type { DiscoveryRecord } from '../App'

interface DiscoveryPanelProps {
  currentInvestigationId: string | null
  discoveries: DiscoveryRecord[]
  hasUnread: boolean
  onOpenDiscovery: (nodeId?: string) => void
  onClear: () => void
  onMarkRead: () => void
}

const formatConfidence = (value: number) => `${Math.round((value || 0) * 100)}%`

export default function DiscoveryPanel({
  currentInvestigationId,
  discoveries,
  hasUnread,
  onOpenDiscovery,
  onClear,
  onMarkRead,
}: DiscoveryPanelProps) {
  const [isOpen, setIsOpen] = useState(false)

  const orderedDiscoveries = useMemo(
    () => [...discoveries].sort((left, right) => right.confidence - left.confidence),
    [discoveries],
  )

  if (!currentInvestigationId) {
    return null
  }

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => {
            setIsOpen(true)
            onMarkRead()
          }}
          aria-label="Open discoveries"
          className="forensic-overlay-handle absolute right-0 top-44 z-40 flex items-center gap-2 rounded-l-xl p-3 text-[var(--forensic-warning)] transition-all hover:bg-[var(--forensic-warning)] hover:text-black"
        >
          <ChevronLeft size={18} />
          <Lightbulb size={20} className={hasUnread ? 'animate-pulse' : ''} />
          {hasUnread && (
            <span className="absolute -left-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">
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
            <div className="forensic-board-section rounded-2xl p-4 text-xs leading-relaxed text-[var(--forensic-text-muted)]">
              No approved discoveries yet for this investigation. Run <span className="font-black uppercase tracking-[0.14em] text-[var(--forensic-warning)]">Reconnect The Dots</span>, then check the discovery log in <span className="font-mono text-[var(--forensic-accent-strong)]">abdomen_vault/discovery_logs</span> to see the full candidate and review trail.
            </div>
          ) : (
            orderedDiscoveries.map((discovery) => (
              <div key={discovery.id} className="forensic-board-section rounded-[1.35rem] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black uppercase tracking-[0.16em] text-[var(--forensic-warning)]">{discovery.title}</h3>
                  <span className="forensic-badge forensic-badge-warning rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em]">
                    {formatConfidence(discovery.confidence)}
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
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-[var(--forensic-warning)]">
                      Supporting Evidence
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {discovery.sourceNodeIDs.map((nodeId) => (
                        <button
                          key={nodeId}
                          onClick={() => onOpenDiscovery(nodeId)}
                          className="forensic-badge rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.15em] transition-colors hover:bg-[var(--forensic-accent)] hover:text-black"
                        >
                          <Target size={10} className="mr-1 inline-block" />
                          {nodeId}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
