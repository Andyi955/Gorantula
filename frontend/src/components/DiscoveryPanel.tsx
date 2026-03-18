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
          className="absolute right-0 top-44 z-40 flex items-center gap-2 rounded-l-lg border border-amber-400 bg-amber-500/15 p-3 text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.16)] transition-all hover:bg-amber-300 hover:text-black"
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
        className={`absolute bottom-0 right-0 top-0 z-50 flex w-96 transform flex-col border-l border-amber-400/35 bg-[#140f06]/95 shadow-[-12px_0_32px_rgba(0,0,0,0.32)] backdrop-blur-md transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="border-b border-amber-400/25 bg-amber-500/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-200">
              <Sparkles size={18} />
              <h2 className="text-sm font-black uppercase tracking-[0.22em]">Breakthroughs</h2>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onClear} className="text-xs font-bold text-amber-100/70 hover:text-red-300">
                CLEAR
              </button>
              <button
                onClick={() => {
                  setIsOpen(false)
                }}
                className="text-amber-100/70 hover:text-white"
                aria-label="Close discoveries"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-100/70">
            Only the strongest, evidence-backed discoveries appear here.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {orderedDiscoveries.length === 0 ? (
            <div className="rounded border border-amber-400/20 bg-black/35 p-4 text-xs leading-relaxed text-amber-50/75">
              No approved discoveries yet for this investigation. Run <span className="font-black uppercase tracking-[0.14em] text-amber-200">Reconnect The Dots</span>, then check the discovery log in <span className="font-mono text-amber-100">abdomen_vault/discovery_logs</span> to see the full candidate and review trail.
            </div>
          ) : (
            orderedDiscoveries.map((discovery) => (
              <div key={discovery.id} className="rounded border border-amber-400/20 bg-black/35 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-black uppercase tracking-[0.16em] text-amber-200">{discovery.title}</h3>
                  <span className="rounded border border-amber-300/35 bg-amber-300/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-100">
                    {formatConfidence(discovery.confidence)}
                  </span>
                </div>

                <div className="space-y-3 text-xs leading-relaxed text-gray-200">
                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                      <Lightbulb size={11} />
                      Claim
                    </div>
                    <p>{discovery.claim}</p>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                      <ShieldAlert size={11} />
                      Why It Matters
                    </div>
                    <p>{discovery.impact}</p>
                  </div>

                  <div>
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                      Supporting Evidence
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {discovery.sourceNodeIDs.map((nodeId) => (
                        <button
                          key={nodeId}
                          onClick={() => onOpenDiscovery(nodeId)}
                          className="rounded border border-cyber-cyan/35 bg-cyber-cyan/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-cyber-cyan transition-colors hover:bg-cyber-cyan hover:text-black"
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
