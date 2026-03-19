import { useMemo, useState } from 'react'
import { Bug, ChevronLeft, ChevronRight, FlaskConical, Network, ShieldAlert } from 'lucide-react'

export interface RelationshipDebugCandidate {
  source: string
  target: string
  tag: string
  reasoning: string
  qualityScore?: number
  validationStatus?: string
  rejectionReason?: string
  supportingPersonas?: string[]
}

export interface RelationshipDebugRun {
  vaultId: string
  createdAt: string
  stage: string
  candidates: RelationshipDebugCandidate[]
  finalConnections: RelationshipDebugCandidate[]
  notes?: string[]
}

interface RelationshipDebugPanelProps {
  investigationId: string | null
  debugRun: RelationshipDebugRun | null
}

const scoreLabel = (value?: number) => `${Math.round((value || 0) * 100)}%`

export default function RelationshipDebugPanel({ investigationId, debugRun }: RelationshipDebugPanelProps) {
  const [isOpen, setIsOpen] = useState(false)

  const orderedCandidates = useMemo(() => {
    if (!debugRun) return []
    return [...debugRun.candidates].sort((left, right) => (right.qualityScore || 0) - (left.qualityScore || 0))
  }, [debugRun])

  if (!investigationId || !debugRun) {
    return null
  }

  return (
    <>
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Open relationship debug"
          className="absolute right-0 top-64 z-40 flex items-center gap-2 rounded-l-lg border border-cyber-cyan/50 bg-cyber-cyan/10 p-3 text-cyber-cyan shadow-[0_0_18px_rgba(0,243,255,0.18)] transition-all hover:bg-cyber-cyan hover:text-black"
        >
          <ChevronLeft size={18} />
          <Bug size={20} />
        </button>
      )}

      <div
        className={`absolute bottom-0 right-0 top-0 z-50 flex w-[28rem] transform flex-col border-l border-cyber-cyan/30 bg-[#07131a]/95 shadow-[-12px_0_32px_rgba(0,0,0,0.32)] backdrop-blur-md transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="border-b border-cyber-cyan/20 bg-cyber-cyan/10 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyber-cyan">
              <Bug size={18} />
              <h2 className="text-sm font-black uppercase tracking-[0.22em]">Relationship Debug</h2>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-cyber-cyan/70 hover:text-white"
              aria-label="Close relationship debug"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-cyber-cyan/75">
            Stage: <span className="font-bold uppercase">{debugRun.stage}</span>
          </p>
          {debugRun.notes && debugRun.notes.length > 0 && (
            <p className="mt-1 text-[11px] leading-relaxed text-gray-300">{debugRun.notes.join(' | ')}</p>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {orderedCandidates.map((candidate, index) => {
            const accepted = candidate.validationStatus === 'accepted'
            return (
              <div
                key={`${candidate.source}-${candidate.target}-${candidate.tag}-${index}`}
                className={`rounded border p-4 ${accepted ? 'border-cyber-green/30 bg-cyber-green/5' : 'border-red-400/25 bg-red-400/5'}`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                      <Network size={11} />
                      {candidate.source} → {candidate.target}
                    </div>
                    <h3 className="mt-1 text-sm font-black uppercase tracking-[0.16em] text-white">{candidate.tag}</h3>
                  </div>
                  <span className={`rounded border px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${accepted ? 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green' : 'border-red-400/40 bg-red-400/10 text-red-300'}`}>
                    {accepted ? scoreLabel(candidate.qualityScore) : (candidate.rejectionReason || 'rejected')}
                  </span>
                </div>

                <p className="text-xs leading-relaxed text-gray-200">{candidate.reasoning}</p>

                {candidate.supportingPersonas && candidate.supportingPersonas.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-2 flex items-center gap-1 text-[10px] font-black uppercase tracking-[0.18em] text-cyber-cyan">
                      <FlaskConical size={11} />
                      Supporting Personas
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {candidate.supportingPersonas.map((persona) => (
                        <span key={persona} className="rounded border border-cyber-cyan/30 bg-cyber-cyan/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-cyber-cyan">
                          {persona}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {!accepted && candidate.rejectionReason && (
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-red-200">
                    <ShieldAlert size={12} />
                    Rejected: {candidate.rejectionReason}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
