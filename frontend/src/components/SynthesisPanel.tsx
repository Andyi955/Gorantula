import { useState, useEffect } from 'react';
import { Network, ChevronRight, Hash, Clock, Database, ChevronLeft, ArrowRightToLine, ArrowLeft, CheckCircle } from 'lucide-react';
import { type PersistedSynthesisAlert } from '../utils/hierarchicalCanvas';
import { BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT } from '../utils/boardWorkspaceEvents';
import {
    getCachedBoardStateForInvestigation,
    loadBoardStateForInvestigation,
    saveBoardStateForInvestigation,
} from '../utils/investigationPersistence';

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
    alertKey?: string;
    entity: string;
    currentVaultId: string;
    connectedCases: string[];
    nodes: NodeContextPayload[];
    analysis: string;
    timestamp: string;
    score?: number;
}

type AlertBuckets = Record<string, SynthesisAlert[]>;
const EMPTY_ALERTS: SynthesisAlert[] = [];

const LEGACY_ALERTS_KEY = 'gorantula_synthesis_alerts';
const ALERT_BUCKETS_KEY = 'gorantula_synthesis_alerts_by_investigation';
const MAX_ALERTS_PER_INVESTIGATION = 20;
const MAX_TOTAL_ALERTS = 80;
const MAX_ANALYSIS_LENGTH = 700;
const MAX_NODE_SUMMARY_LENGTH = 220;
const TOAST_DURATION_MS = 5000;

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

            acc[investigationId] = alerts
                .filter((alert): alert is SynthesisAlert => {
                    return Boolean(
                        alert &&
                        typeof alert === 'object' &&
                        typeof (alert as SynthesisAlert).entity === 'string' &&
                        typeof (alert as SynthesisAlert).currentVaultId === 'string',
                    );
                })
                .map(normalizeAlert)
                .slice(0, MAX_ALERTS_PER_INVESTIGATION);
            return acc;
        }, {});
    } catch {
        return {};
    }
};

const trimText = (value: string, maxLength: number): string => {
    const normalized = value.trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 3)}...`;
};

const buildAlertKey = (alert: Partial<SynthesisAlert>): string => {
    const currentVaultId = (alert.currentVaultId || '').trim();
    const entity = (alert.entity || 'unknown').trim().toLowerCase();
    const connectedCases = Array.isArray(alert.connectedCases)
        ? Array.from(new Set(alert.connectedCases.filter((caseId): caseId is string => typeof caseId === 'string' && caseId.trim().length > 0))).sort()
        : [];

    return [currentVaultId, entity, connectedCases.join('|')].join('::');
};

const normalizeAlert = (alert: SynthesisAlert): SynthesisAlert => ({
    ...alert,
    alertKey: alert.alertKey || buildAlertKey(alert),
    entity: trimText(alert.entity || 'unknown', 80),
    analysis: trimText(alert.analysis || '', MAX_ANALYSIS_LENGTH),
    connectedCases: Array.isArray(alert.connectedCases) ? alert.connectedCases.slice(0, 8) : [],
    nodes: Array.isArray(alert.nodes)
        ? alert.nodes.slice(0, 8).map((node) => ({
            vaultId: node.vaultId,
            nodeId: node.nodeId,
            summary: trimText(node.summary || '', MAX_NODE_SUMMARY_LENGTH),
        }))
        : [],
});

const upsertAlertBucket = (alerts: SynthesisAlert[], incomingAlert: SynthesisAlert): SynthesisAlert[] => {
    const deduped = alerts.filter((alert) => (alert.alertKey || buildAlertKey(alert)) !== incomingAlert.alertKey);
    return [incomingAlert, ...deduped].slice(0, MAX_ALERTS_PER_INVESTIGATION);
};

const persistInvestigationAlerts = (investigationId: string, alerts: SynthesisAlert[]) => {
    const savedState = getCachedBoardStateForInvestigation(investigationId);
    if (!savedState) {
        return;
    }

    void saveBoardStateForInvestigation(investigationId, {
        ...savedState,
        synthesisAlerts: alerts as PersistedSynthesisAlert[],
    });
};

const pruneBucketsForStorage = (buckets: AlertBuckets): AlertBuckets => {
    const orderedEntries = Object.entries(buckets).map(([investigationId, alerts]) => [
        investigationId,
        alerts.map(normalizeAlert).slice(0, MAX_ALERTS_PER_INVESTIGATION),
    ] as const);

    let runningCount = 0;
    const pruned: AlertBuckets = {};
    for (const [investigationId, alerts] of orderedEntries) {
        if (runningCount >= MAX_TOTAL_ALERTS) {
            break;
        }
        const remaining = MAX_TOTAL_ALERTS - runningCount;
        const trimmedAlerts = alerts.slice(0, remaining);
        if (trimmedAlerts.length === 0) {
            continue;
        }
        pruned[investigationId] = trimmedAlerts;
        runningCount += trimmedAlerts.length;
    }
    return pruned;
};

const persistAlertBuckets = (buckets: AlertBuckets): AlertBuckets => {
    const pruned = pruneBucketsForStorage(buckets);
    try {
        localStorage.setItem(ALERT_BUCKETS_KEY, JSON.stringify(pruned));
        return pruned;
    } catch (error) {
        console.warn('[SynthesisPanel] Failed to persist synthesis alert cache; continuing in-memory only.', error);
        return pruned;
    }
};

const pruneBucketsForState = (buckets: AlertBuckets, prioritizedInvestigationId?: string | null): AlertBuckets => {
    const prioritizedEntries = Object.entries(buckets).sort(([leftId], [rightId]) => {
        if (leftId === prioritizedInvestigationId) {
            return -1;
        }
        if (rightId === prioritizedInvestigationId) {
            return 1;
        }
        return 0;
    });

    let runningCount = 0;
    const pruned: AlertBuckets = {};
    for (const [investigationId, alerts] of prioritizedEntries) {
        if (runningCount >= MAX_TOTAL_ALERTS) {
            break;
        }

        const remaining = MAX_TOTAL_ALERTS - runningCount;
        const trimmedAlerts = alerts.slice(0, remaining);
        if (trimmedAlerts.length === 0) {
            continue;
        }

        pruned[investigationId] = trimmedAlerts;
        runningCount += trimmedAlerts.length;
    }

    return pruned;
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
                acc[alert.currentVaultId] = [...current, normalizeAlert(alert as SynthesisAlert)].slice(0, MAX_ALERTS_PER_INVESTIGATION);
            }
            return acc;
        }, {});

        const persisted = persistAlertBuckets(buckets);
        localStorage.removeItem(LEGACY_ALERTS_KEY);
        return persisted;
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
    showHandle?: boolean;
    currentTheoryReport?: string | null;
    hasTheoryReady?: boolean;
    hasUnreadTheory?: boolean;
    onMarkTheoryRead?: () => void;
}

export default function SynthesisPanel({
    sharedSocket,
    currentInvestigationId,
    onNavigateVault,
    returnVaultId,
    investigations = [],
    onMergeInvestigations,
    showHandle = true,
    currentTheoryReport = null,
    hasTheoryReady = false,
    hasUnreadTheory = false,
    onMarkTheoryRead,
}: SynthesisPanelProps) {
    const [alertsByInvestigation, setAlertsByInvestigation] = useState<AlertBuckets>({});
    const [isOpen, setIsOpen] = useState(false);
    const [unreadByInvestigation, setUnreadByInvestigation] = useState<Record<string, boolean>>({});
    const [pulledNodeId, setPulledNodeId] = useState<string | null>(null);
    const [activeToast, setActiveToast] = useState<SynthesisAlert | null>(null);
    const currentAlerts = currentInvestigationId ? (alertsByInvestigation[currentInvestigationId] ?? EMPTY_ALERTS) : EMPTY_ALERTS;
    const trimmedTheoryReport = (currentTheoryReport || '').trim();
    const hasUnread = currentInvestigationId
        ? Boolean(unreadByInvestigation[currentInvestigationId]) || Boolean(hasUnreadTheory)
        : false;

    const markCurrentTheoryRead = () => {
        if (!currentInvestigationId) {
            return;
        }
        setUnreadByInvestigation(prev => ({
            ...prev,
            [currentInvestigationId]: false,
        }));
        onMarkTheoryRead?.();
    };

    useEffect(() => {
        console.debug('[SynthesisPanel] Mounted with current investigation:', currentInvestigationId);
        setAlertsByInvestigation(migrateLegacyAlerts());
    }, []);

    useEffect(() => {
        console.debug('[SynthesisPanel] Investigation state changed', {
            currentInvestigationId,
            alertCount: currentAlerts.length,
            hasUnread,
            isOpen,
            hasToast: Boolean(activeToast),
            toastVaultId: activeToast?.currentVaultId || null,
        });
    }, [activeToast, currentAlerts.length, currentInvestigationId, hasUnread, isOpen]);

    useEffect(() => {
        if (!currentInvestigationId) {
            return;
        }

        let cancelled = false;
        void (async () => {
            const savedState = await loadBoardStateForInvestigation(currentInvestigationId);
            if (cancelled) {
                return;
            }
            const hasExplicitAlertSnapshot = Boolean(
                savedState &&
                Object.prototype.hasOwnProperty.call(savedState, 'synthesisAlerts') &&
                Array.isArray(savedState.synthesisAlerts),
            );
            if (!hasExplicitAlertSnapshot) {
                return;
            }
            const persistedAlerts = savedState?.synthesisAlerts?.map((alert) => normalizeAlert(alert as SynthesisAlert)) || [];
            if (persistedAlerts.length === 0) {
                return;
            }

            setAlertsByInvestigation(prev => {
                console.debug('[SynthesisPanel] Rehydrating synthesis alerts from persisted board state', {
                    currentInvestigationId,
                    count: persistedAlerts.length,
                });

                const nextBucketsDraft = {
                    ...prev,
                    [currentInvestigationId]: persistedAlerts,
                };
                const nextBuckets = pruneBucketsForState(nextBucketsDraft, currentInvestigationId);
                persistAlertBuckets(nextBuckets);
                return nextBuckets;
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [currentInvestigationId]);

    useEffect(() => {
        if (!currentInvestigationId) {
            return;
        }

        persistInvestigationAlerts(currentInvestigationId, currentAlerts);
    }, [currentAlerts, currentInvestigationId]);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (e: MessageEvent) => {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'SYNTHESIS_ALERT') {
                    const newAlert = normalizeAlert(msg.payload as SynthesisAlert);
                    console.debug('[SynthesisPanel] Received SYNTHESIS_ALERT', {
                        currentInvestigationId,
                        alertCurrentVaultId: newAlert.currentVaultId,
                        alertKey: newAlert.alertKey,
                        entity: newAlert.entity,
                        connectedCases: newAlert.connectedCases,
                    });
                    if (!newAlert.currentVaultId) {
                        console.warn('[SynthesisPanel] Ignoring alert without currentVaultId', newAlert);
                        return;
                    }
                    setAlertsByInvestigation(prev => {
                        const currentAlertsForVault = prev[newAlert.currentVaultId] || [];
                        const updatedBucket = upsertAlertBucket(currentAlertsForVault, newAlert);
                        console.debug('[SynthesisPanel] Updating alert bucket', {
                            targetVaultId: newAlert.currentVaultId,
                            previousCount: currentAlertsForVault.length,
                            nextCount: updatedBucket.length,
                            duplicateKey: currentAlertsForVault.some((alert) => (alert.alertKey || buildAlertKey(alert)) === newAlert.alertKey),
                        });
                        const updated = pruneBucketsForState({
                            ...prev,
                            [newAlert.currentVaultId]: updatedBucket,
                        }, newAlert.currentVaultId);
                        persistAlertBuckets(updated);
                        persistInvestigationAlerts(newAlert.currentVaultId, updatedBucket);
                        return updated;
                    });
                    setUnreadByInvestigation(prev => ({
                        ...prev,
                        [newAlert.currentVaultId]: true,
                    }));
                    if (newAlert.currentVaultId === currentInvestigationId) {
                        console.debug('[SynthesisPanel] Auto-opening panel for active investigation alert', {
                            currentInvestigationId,
                            alertKey: newAlert.alertKey,
                        });
                        setActiveToast(newAlert);
                        setIsOpen(true);
                        setUnreadByInvestigation(prev => ({
                            ...prev,
                            [newAlert.currentVaultId]: false,
                        }));
                    } else {
                        console.debug('[SynthesisPanel] Alert stored for non-active investigation', {
                            currentInvestigationId,
                            alertCurrentVaultId: newAlert.currentVaultId,
                        });
                    }
                }
            } catch (err) { }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [currentInvestigationId, sharedSocket]);

    useEffect(() => {
        if (!activeToast || activeToast.currentVaultId !== currentInvestigationId) {
            return;
        }

        console.debug('[SynthesisPanel] Starting toast auto-dismiss timer', {
            alertKey: activeToast.alertKey,
            currentInvestigationId,
        });
        const timeoutId = window.setTimeout(() => {
            setActiveToast((current) => current?.alertKey === activeToast.alertKey ? null : current);
        }, TOAST_DURATION_MS);

        return () => window.clearTimeout(timeoutId);
    }, [activeToast, currentInvestigationId]);

    useEffect(() => {
        if (activeToast && activeToast.currentVaultId !== currentInvestigationId) {
            console.debug('[SynthesisPanel] Clearing toast because investigation changed', {
                toastVaultId: activeToast.currentVaultId,
                currentInvestigationId,
            });
            setActiveToast(null);
        }
    }, [activeToast, currentInvestigationId]);

    const togglePanel = () => {
        setIsOpen(!isOpen);
        if (!isOpen && currentInvestigationId) {
            markCurrentTheoryRead();
        }
    };

    useEffect(() => {
        const handlePanelToggle = () => {
            setIsOpen((current) => {
                const next = !current;
                if (next && currentInvestigationId) {
                    markCurrentTheoryRead();
                }
                return next;
            });
        };

        window.addEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, handlePanelToggle);
        return () => window.removeEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, handlePanelToggle);
    }, [currentInvestigationId, onMarkTheoryRead]);

    const clearAlerts = () => {
        if (!currentInvestigationId) {
            return;
        }

        setAlertsByInvestigation(prev => {
            const updated = { ...prev };
            delete updated[currentInvestigationId];
            persistInvestigationAlerts(currentInvestigationId, []);
            persistAlertBuckets(updated);
            return updated;
        });
        setUnreadByInvestigation(prev => ({
            ...prev,
            [currentInvestigationId]: false,
        }));
        onMarkTheoryRead?.();
    };

    const handleJump = (vaultId: string, nodeId?: string) => {
        if (onNavigateVault) onNavigateVault(vaultId, nodeId);
    };

    const handleReturn = () => {
        if (returnVaultId && onNavigateVault) {
            onNavigateVault(returnVaultId);
        }
    };

    const handleReviewToast = () => {
        console.debug('[SynthesisPanel] Review toast clicked', {
            currentInvestigationId,
            alertKey: activeToast?.alertKey || null,
        });
        setIsOpen(true);
        setActiveToast(null);
        if (!currentInvestigationId) {
            return;
        }
        markCurrentTheoryRead();
    };

    const showToast = Boolean(activeToast && activeToast.currentVaultId === currentInvestigationId);
    const displayedAlerts = currentAlerts.length > 0
        ? currentAlerts
        : (showToast && activeToast ? [activeToast] : []);
    const hasPanelAlerts = displayedAlerts.length > 0;
    const showPanelHandle = Boolean(currentInvestigationId) && showHandle;

    if (!currentInvestigationId) return null;

    return (
        <>
            {showToast && activeToast && (
                <div
                    data-testid="synthesis-overlap-toast"
                    className="forensic-overlay-toast absolute right-4 top-4 z-[60] w-[min(24rem,calc(100vw-2rem))] rounded-[1.15rem] p-4"
                >
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent)]">New Overlap Detected</span>
                        <button
                            onClick={() => setActiveToast(null)}
                            className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--forensic-text-faint)] transition-colors hover:text-white"
                        >
                            Dismiss
                        </button>
                    </div>
                    <div className="text-sm font-black text-[var(--forensic-text)]">{activeToast.entity}</div>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--forensic-text-muted)]">{activeToast.analysis}</p>
                    <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-[10px] text-[var(--forensic-text-faint)]">{activeToast.connectedCases.length} linked investigations</span>
                        <button
                            onClick={handleReviewToast}
                            className="forensic-badge rounded px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition-colors hover:bg-[var(--forensic-accent)] hover:text-black"
                        >
                            Review
                        </button>
                    </div>
                </div>
            )}

            {/* Floating Toggle Button */}
            {showPanelHandle && (
                <button
                    onClick={togglePanel}
                    aria-label={`${isOpen ? 'Hide synthesis panel' : 'Show synthesis panel'}${hasTheoryReady ? ' - Grand Unified Theory ready' : ''}`}
                    title={`${isOpen ? 'Hide synthesis panel' : 'Show synthesis panel'}${hasTheoryReady ? ' - Grand Unified Theory ready' : ''}`}
                    className="forensic-overlay-handle absolute right-0 top-24 z-[60] flex items-center gap-2 rounded-l-xl p-3 transition-all hover:bg-[var(--forensic-accent)] hover:text-black"
                >
                    {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    <Network size={20} className={hasUnread ? "animate-pulse text-[var(--forensic-accent)]" : hasTheoryReady ? "text-[var(--forensic-accent)]" : ""} />
                    {hasUnread && (
                        <span className="absolute -top-2 -left-2 bg-red-500 text-white text-[10px] font-black w-5 h-5 flex items-center justify-center rounded-full">
                            !
                        </span>
                    )}
                </button>
            )}

            {/* Slide-out Panel */}
            <div
                className={`forensic-overlay-panel absolute top-0 right-0 bottom-0 w-96 z-50 transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : 'translate-x-full'
                    }`}
            >
                    <div className="p-4 border-b border-[rgba(129,227,255,0.15)] flex flex-col gap-2 bg-[linear-gradient(180deg,rgba(129,227,255,0.08),rgba(129,227,255,0.03))]">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 text-[var(--forensic-accent)] font-black uppercase tracking-[0.16em]">
                            <Network size={20} />
                            <h2>GRAND UNIFIED THEORY</h2>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={clearAlerts} className="text-[var(--forensic-text-faint)] hover:text-[var(--forensic-danger)] text-xs font-bold">
                                CLEAR
                            </button>
                            <button onClick={togglePanel} className="text-[var(--forensic-text-faint)] hover:text-white">
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                    {returnVaultId && (
                        <div className="forensic-board-section rounded-xl p-2 flex justify-between items-center text-xs text-[var(--forensic-accent)] animate-pulse">
                            <span>Viewing Portal Node</span>
                            <button onClick={handleReturn} className="flex items-center gap-1 font-bold hover:text-white bg-black/40 px-2 py-1 rounded-lg border border-white/8">
                                <ArrowLeft size={12} /> RETURN
                            </button>
                        </div>
                    )}
                </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {hasPanelAlerts ? displayedAlerts.map((alert, idx) => (
                        <div key={alert.alertKey || idx} className="forensic-board-section p-4 rounded-[1.25rem] relative group hover:border-[var(--forensic-border-strong)] transition-colors">
                            <div className="absolute top-0 right-0 p-2 opacity-[0.08]">
                                <Network size={40} />
                            </div>

                            <div className="flex items-center gap-2 mb-3">
                                <span className="forensic-badge rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                                    Overlap Detected
                                </span>
                                <span className="text-[var(--forensic-text-faint)] text-[10px] flex items-center gap-1">
                                    <Clock size={10} /> {alert.timestamp}
                                </span>
                            </div>

                            <div className="mb-4">
                                <h3 className="text-[var(--forensic-text)] font-bold text-lg mb-1 flex items-center gap-2">
                                    <Hash size={16} className="text-[var(--forensic-accent)]" />
                                    <span className="text-[var(--forensic-accent)]">{alert.entity}</span>
                                </h3>
                                <p className="text-[var(--forensic-text-muted)] text-xs leading-relaxed">
                                    {alert.analysis}
                                </p>
                                {alert.connectedCases.length >= 2 && onMergeInvestigations && (
                                    <button
                                        onClick={() => onMergeInvestigations(
                                            alert.entity,
                                            alert.connectedCases,
                                            alert.nodes.map((node) => ({ vaultId: node.vaultId, nodeId: node.nodeId })),
                                        )}
                                        className="forensic-badge mt-3 inline-flex items-center gap-2 rounded px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] transition-colors hover:bg-[var(--forensic-accent)] hover:text-black"
                                    >
                                        <Network size={12} />
                                        Merge Investigation
                                    </button>
                                )}
                            </div>

                            <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
                                <div className="text-[10px] text-[var(--forensic-text-faint)] mb-2 flex items-center justify-between uppercase">
                                    <div className="flex items-center gap-1"><Database size={10} /> Connected Vaults</div>
                                    {alert.score !== undefined && (
                                        <div className="text-[var(--forensic-success)]/70">Rarity: {alert.score.toFixed(2)}</div>
                                    )}
                                </div>
                                <div className="flex flex-col gap-2">
                                    {alert.connectedCases.map((caseId, cIdx) => {
                                        const caseNodes = alert.nodes?.filter(n => n.vaultId === caseId) || [];
                                        return (
                                            <div key={cIdx} className="rounded-xl border border-[rgba(118,177,214,0.14)] bg-[rgba(255,255,255,0.025)] text-[var(--forensic-text-muted)] p-2 text-xs flex flex-col gap-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="font-mono text-[10px] text-[var(--forensic-accent)] truncate max-w-[200px]" title={caseId}>
                                                        {investigations.find(inv => inv.id === caseId)?.displayTopic || investigations.find(inv => inv.id === caseId)?.topic || caseId}
                                                        {caseId === currentInvestigationId && ' (CURRENT)'}
                                                    </span>
                                                    {caseId !== currentInvestigationId && (
                                                        <button
                                                            onClick={() => handleJump(caseId, caseNodes[0]?.nodeId)}
                                                            className="rounded-lg border border-[rgba(129,227,255,0.18)] bg-[rgba(129,227,255,0.08)] px-2 py-0.5 text-[9px] text-[var(--forensic-accent-strong)] hover:bg-[var(--forensic-accent)] hover:text-black transition-colors flex items-center gap-1 font-bold"
                                                        >
                                                            PORTAL JUMP <ArrowRightToLine size={10} />
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Hover context nodes */}
                                                <div className="flex flex-col gap-1">
                                                    {caseNodes.map((n, i) => (
                                                        <div key={i} className="group/node relative truncate max-w-full text-[10px] text-[var(--forensic-text-faint)] cursor-help hover:text-white border-l-2 border-[rgba(129,227,255,0.26)] pl-2">
                                                            {n.summary}
                                                            {/* Tooltip on hover */}
                                                            <div className="absolute top-full left-0 mt-1 hidden group-hover/node:block z-50 forensic-board-dialog p-2 w-64 text-xs text-[var(--forensic-text-muted)] whitespace-normal break-words rounded-xl">
                                                                <div className="text-[var(--forensic-accent)] font-bold mb-1 border-b border-[rgba(129,227,255,0.14)] pb-1">Context Node ({n.nodeId})</div>
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
                                                                    className={`mt-3 w-full py-1.5 px-3 rounded-lg font-black transition-all flex items-center justify-center gap-2 text-[9px] tracking-widest uppercase ${
                                                                        pulledNodeId === n.nodeId 
                                                                        ? 'bg-[var(--forensic-success)] text-black shadow-[0_0_10px_rgba(144,243,218,0.32)]' 
                                                                        : 'bg-[rgba(129,227,255,0.08)] text-[var(--forensic-accent)] border border-[rgba(129,227,255,0.24)] hover:bg-[var(--forensic-accent)] hover:text-black hover:border-transparent'
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
                    )) : trimmedTheoryReport ? (
                        <div className="forensic-board-section rounded-[1.2rem] p-4 text-xs leading-relaxed text-[var(--forensic-text-muted)]">
                            <div className="mb-3 flex items-center gap-2 text-[var(--forensic-accent)]">
                                <Database size={12} />
                                <span className="text-[10px] font-black uppercase tracking-[0.18em]">Current Investigation Theory</span>
                            </div>
                            <div className="max-h-[52vh] overflow-y-auto whitespace-pre-wrap pr-1">
                                {trimmedTheoryReport}
                            </div>
                        </div>
                    ) : (
                        <div className="forensic-board-section rounded-[1.2rem] p-4 text-xs leading-relaxed text-[var(--forensic-text-muted)]">
                            No cross-investigation overlaps yet for this investigation. Run <span className="font-black uppercase tracking-[0.16em] text-[var(--forensic-accent)]">Reconnect The Dots</span> to check for links against older cases.
                        </div>
                    )}
                    </div>
                </div>
        </>
    );
}
