import { useState, useEffect } from 'react';
import { Network, ChevronRight, Hash, Clock, Database, ChevronLeft, ArrowRightToLine, ArrowLeft, CheckCircle } from 'lucide-react';

interface NodeContextPayload {
    vaultId: string;
    nodeId: string;
    summary: string;
}

export interface MergeCandidateNode {
    vaultId: string;
    nodeId: string;
}

interface SynthesisAlert {
    type: string;
    entity: string;
    currentVaultId: string;
    connectedCases: string[];
    nodes: NodeContextPayload[];
    analysis: string;
    timestamp: string;
    score?: number;
}

type AlertBuckets = Record<string, SynthesisAlert[]>;

const LEGACY_ALERTS_KEY = 'gorantula_synthesis_alerts';
const ALERT_BUCKETS_KEY = 'gorantula_synthesis_alerts_by_investigation';

const parseAlertBuckets = (raw: string | null): AlertBuckets => {
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }

        return Object.entries(parsed).reduce<AlertBuckets>((acc, [investigationId, alerts]) => {
            if (!Array.isArray(alerts)) {
                return acc;
            }

            acc[investigationId] = alerts.filter((alert): alert is SynthesisAlert => {
                return Boolean(
                    alert &&
                    typeof alert === 'object' &&
                    typeof (alert as SynthesisAlert).entity === 'string' &&
                    typeof (alert as SynthesisAlert).currentVaultId === 'string',
                );
            });
            return acc;
        }, {});
    } catch {
        return {};
    }
};

const migrateLegacyAlerts = (): AlertBuckets => {
    const migrated = parseAlertBuckets(localStorage.getItem(ALERT_BUCKETS_KEY));
    if (Object.keys(migrated).length > 0) {
        return migrated;
    }

    const legacyRaw = localStorage.getItem(LEGACY_ALERTS_KEY);
    if (!legacyRaw) {
        return {};
    }

    try {
        const parsed = JSON.parse(legacyRaw);
        if (!Array.isArray(parsed)) {
            localStorage.removeItem(LEGACY_ALERTS_KEY);
            return {};
        }

        const buckets = parsed.reduce<AlertBuckets>((acc, alert) => {
            if (
                alert &&
                typeof alert === 'object' &&
                typeof alert.currentVaultId === 'string'
            ) {
                const current = acc[alert.currentVaultId] || [];
                acc[alert.currentVaultId] = [...current, alert as SynthesisAlert].slice(0, 50);
            }
            return acc;
        }, {});

        localStorage.setItem(ALERT_BUCKETS_KEY, JSON.stringify(buckets));
        localStorage.removeItem(LEGACY_ALERTS_KEY);
        return buckets;
    } catch {
        localStorage.removeItem(LEGACY_ALERTS_KEY);
        return {};
    }
};

interface SynthesisPanelProps {
    sharedSocket: WebSocket | null;
    currentInvestigationId: string | null;
    onNavigateVault?: (id: string, nodeId?: string) => void;
    returnVaultId: string | null;
    investigations?: { id: string; topic: string; displayTopic?: string }[];
    onMergeInvestigations?: (entity: string, connectedCases: string[], relevantNodes: MergeCandidateNode[]) => void;
}

export default function SynthesisPanel({ sharedSocket, currentInvestigationId, onNavigateVault, returnVaultId, investigations = [], onMergeInvestigations }: SynthesisPanelProps) {
    const [alertsByInvestigation, setAlertsByInvestigation] = useState<AlertBuckets>({});
    const [isOpen, setIsOpen] = useState(false);
    const [unreadByInvestigation, setUnreadByInvestigation] = useState<Record<string, boolean>>({});
    const [pulledNodeId, setPulledNodeId] = useState<string | null>(null);
    const currentAlerts = currentInvestigationId ? (alertsByInvestigation[currentInvestigationId] || []) : [];
    const hasUnread = currentInvestigationId ? Boolean(unreadByInvestigation[currentInvestigationId]) : false;

    useEffect(() => {
        setAlertsByInvestigation(migrateLegacyAlerts());
    }, []);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'SYNTHESIS_ALERT') {
                    const newAlert = msg.payload as SynthesisAlert;
                    if (!newAlert.currentVaultId) {
                        return;
                    }
                    setAlertsByInvestigation(prev => {
                        const currentAlertsForVault = prev[newAlert.currentVaultId] || [];
                        const updatedBucket = [newAlert, ...currentAlertsForVault].slice(0, 50);
                        const updated = {
                            ...prev,
                            [newAlert.currentVaultId]: updatedBucket,
                        };
                        localStorage.setItem(ALERT_BUCKETS_KEY, JSON.stringify(updated));
                        return updated;
                    });
                    setUnreadByInvestigation(prev => ({
                        ...prev,
                        [newAlert.currentVaultId]: true,
                    }));
                    if (currentInvestigationId === newAlert.currentVaultId) {
                        setIsOpen(true);
                    }
                }
            } catch (err) { }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [currentInvestigationId, sharedSocket]);

    const togglePanel = () => {
        setIsOpen(!isOpen);
        if (!isOpen && currentInvestigationId) {
            setUnreadByInvestigation(prev => ({
                ...prev,
                [currentInvestigationId]: false,
            }));
        }
    };

    const clearAlerts = () => {
        if (!currentInvestigationId) {
            return;
        }

        setAlertsByInvestigation(prev => {
            const updated = { ...prev };
            delete updated[currentInvestigationId];
            localStorage.setItem(ALERT_BUCKETS_KEY, JSON.stringify(updated));
            return updated;
        });
        setUnreadByInvestigation(prev => ({
            ...prev,
            [currentInvestigationId]: false,
        }));
    };

    const handleJump = (vaultId: string, nodeId?: string) => {
        if (onNavigateVault) onNavigateVault(vaultId, nodeId);
    };

    const handleReturn = () => {
        if (returnVaultId && onNavigateVault) {
            onNavigateVault(returnVaultId);
        }
    };

    // The toggle button that floats on the right side if closed, or is hidden if empty
    if (!currentInvestigationId || currentAlerts.length === 0) return null;

    return (
        <>
            {/* Floating Toggle Button */}
            {!isOpen && (
                <button
                    onClick={togglePanel}
                    className="absolute right-0 top-24 bg-cyber-purple text-white p-3 rounded-l-lg shadow-[0_0_15px_rgba(188,19,254,0.5)] z-40 border border-cyber-purple hover:bg-white hover:text-black transition-all flex items-center gap-2"
                >
                    <ChevronLeft size={18} />
                    <Network size={20} className={hasUnread ? "animate-pulse text-cyber-cyan" : ""} />
                    {hasUnread && (
                        <span className="absolute -top-2 -left-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full">
                            !
                        </span>
                    )}
                </button>
            )}

            {/* Slide-out Panel */}
            <div
                className={`absolute top-0 right-0 bottom-0 w-96 bg-cyber-black/95 backdrop-blur-md border-l border-cyber-purple shadow-[-10px_0_30px_rgba(188,19,254,0.2)] z-50 transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                <div className="p-4 border-b border-cyber-purple/50 flex flex-col gap-2 bg-cyber-purple/10">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-cyber-purple font-black">
                            <Network size={20} />
                            <h2>GRAND UNIFIED THEORY</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={clearAlerts} className="text-gray-500 hover:text-red-500 text-xs font-bold">
                                CLEAR
                            </button>
                            <button onClick={togglePanel} className="text-gray-400 hover:text-white">
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                    {returnVaultId && (
                        <div className="bg-cyber-purple/20 border border-cyber-purple p-2 rounded flex justify-between items-center text-xs text-cyber-cyan animate-pulse">
                            <span>Viewing Portal Node</span>
                            <button onClick={handleReturn} className="flex items-center gap-1 font-bold hover:text-white bg-black/50 px-2 py-1 rounded">
                                <ArrowLeft size={12} /> RETURN
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {currentAlerts.map((alert, idx) => (
                        <div key={idx} className="bg-black border border-cyber-purple/30 p-4 rounded-sm relative group hover:border-cyber-purple transition-colors">
                            <div className="absolute top-0 right-0 p-2 opacity-10">
                                <Network size={40} />
                            </div>

                            <div className="flex items-center gap-2 mb-3">
                                <span className="bg-cyber-purple/20 text-cyber-purple px-2 py-0.5 text-[10px] font-bold uppercase rounded border border-cyber-purple/50">
                                    Overlap Detected
                                </span>
                                <span className="text-gray-500 text-[10px] flex items-center gap-1">
                                    <Clock size={10} /> {alert.timestamp}
                                </span>
                            </div>

                            <div className="mb-4">
                                <h3 className="text-white font-bold text-lg mb-1 flex items-center gap-2">
                                    <Hash size={16} className="text-cyber-cyan" />
                                    <span className="text-cyber-cyan">{alert.entity}</span>
                                </h3>
                                <p className="text-gray-300 text-xs leading-relaxed">
                                    {alert.analysis}
                                </p>
                                {alert.connectedCases.length >= 2 && onMergeInvestigations && (
                                    <button
                                        onClick={() => onMergeInvestigations(
                                            alert.entity,
                                            alert.connectedCases,
                                            alert.nodes.map((node) => ({ vaultId: node.vaultId, nodeId: node.nodeId })),
                                        )}
                                        className="mt-3 inline-flex items-center gap-2 rounded border border-cyber-cyan/40 bg-cyber-cyan/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyber-cyan transition-colors hover:border-cyber-cyan hover:bg-cyber-cyan hover:text-black"
                                    >
                                        <Network size={12} />
                                        Merge Investigation
                                    </button>
                                )}
                            </div>

                            <div className="mt-4 pt-3 border-t border-cyber-purple/20">
                                <div className="text-[10px] text-gray-500 mb-2 flex items-center justify-between uppercase">
                                    <div className="flex items-center gap-1"><Database size={10} /> Connected Vaults</div>
                                    {alert.score !== undefined && (
                                        <div className="text-cyber-green/50">Rarity: {alert.score.toFixed(2)}</div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-2">
                                    {alert.connectedCases.map((caseId, cIdx) => {
                                        const caseNodes = alert.nodes?.filter(n => n.vaultId === caseId) || [];
                                        return (
                                            <div key={cIdx} className="bg-cyber-gray/20 text-gray-300 p-2 text-xs rounded border border-cyber-gray/30 flex flex-col gap-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="font-mono text-[10px] text-cyber-cyan truncate max-w-[200px]" title={caseId}>
                                                        {investigations.find(inv => inv.id === caseId)?.displayTopic || investigations.find(inv => inv.id === caseId)?.topic || caseId}
                                                        {caseId === currentInvestigationId && ' (CURRENT)'}
                                                    </span>
                                                    {caseId !== currentInvestigationId && (
                                                        <button
                                                            onClick={() => handleJump(caseId, caseNodes[0]?.nodeId)}
                                                            className="text-[9px] bg-cyber-purple/30 text-white px-2 py-0.5 rounded hover:bg-cyber-purple transition-colors flex items-center gap-1 font-bold"
                                                        >
                                                            PORTAL JUMP <ArrowRightToLine size={10} />
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Hover context nodes */}
                                                <div className="flex flex-col gap-1">
                                                    {caseNodes.map((n, i) => (
                                                        <div key={i} className="group/node relative truncate max-w-full text-[10px] text-gray-400 cursor-help hover:text-white border-l-2 border-cyber-purple pl-2">
                                                            {n.summary}
                                                            {/* Tooltip on hover */}
                                                            <div className="absolute top-full left-0 mt-1 hidden group-hover/node:block z-50 bg-black border border-cyber-purple p-2 shadow-[0_5px_15px_rgba(0,0,0,0.8)] w-64 text-xs text-gray-300 whitespace-normal break-words rounded">
                                                                <div className="text-cyber-cyan font-bold mb-1 border-b border-cyber-purple/50 pb-1">Context Node ({n.nodeId})</div>
                                                                {n.summary}
                                                                
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const targetId = returnVaultId || currentInvestigationId;
                                                                        if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN && targetId) {
                                                                            sharedSocket.send(JSON.stringify({
                                                                                type: 'PULL_NODE',
                                                                                payload: {
                                                                                    sourceVaultId: n.vaultId,
                                                                                    sourceNodeId: n.nodeId,
                                                                                    targetVaultId: targetId
                                                                                }
                                                                            }));
                                                                            setPulledNodeId(n.nodeId);
                                                                            setTimeout(() => setPulledNodeId(null), 3000);
                                                                        }
                                                                    }}
                                                                    title="IMPORT NODE: Bring this context into your active investigation board"
                                                                    className={`mt-3 w-full py-1.5 px-3 rounded-sm font-black transition-all flex items-center justify-center gap-2 text-[9px] tracking-widest uppercase ${
                                                                        pulledNodeId === n.nodeId 
                                                                        ? 'bg-cyber-green text-black shadow-[0_0_10px_rgba(34,197,94,0.4)]' 
                                                                        : 'bg-white/10 text-cyber-green border border-cyber-green/30 hover:bg-cyber-green hover:text-black hover:border-transparent animate-pulse-glow'
                                                                    }`}
                                                                >
                                                                    {pulledNodeId === n.nodeId ? <CheckCircle size={12} /> : <ArrowRightToLine size={12} />}
                                                                    {pulledNodeId === n.nodeId ? 'IMPORT SUCCESS' : (returnVaultId ? 'IMPORT TO ACTIVE' : 'IMPORT TO BOARD')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
