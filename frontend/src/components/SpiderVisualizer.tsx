import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Activity, BarChart3, Braces, CircuitBoard, Crosshair, Database, DatabaseZap, Gauge, Info, Network, RadioTower, ScanLine, Zap, type LucideIcon } from 'lucide-react';
import { SpiderScene } from './SpiderScene';

type PipelineRailStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
export type SpiderLegVisualStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
export type SpiderOperationMode = 'web' | 'local' | 'rabbit-hole';
export type LocalIngestionFileState = 'queued' | 'parsing' | 'chunking' | 'summarizing' | 'imported' | 'failed';

export interface SpiderEvidencePacket {
    id: string;
    legId: number;
    createdAt: number;
    status: SpiderLegVisualStatus;
    mode?: SpiderOperationMode;
}

export interface SpiderTelemetryDemoRequest {
    investigationId?: string;
    requestId: string;
}

export interface LocalIngestionFile {
    path: string;
    name: string;
    state: LocalIngestionFileState;
}

export interface LocalIngestionProgress {
    stepId?: string;
    status?: PipelineRailStatus | string;
    detail?: string;
    counters?: Record<string, number>;
}

interface SpiderVisualizerProps {
    sharedSocket: WebSocket | null;
    displayMetrics?: {
        nodeCount?: number;
        edgeCount?: number;
        evidenceCount?: number;
        imageCount?: number;
        confidenceScore?: number;
        lastActivityLabel?: string;
    };
    pipelineStatus?: PipelineRailStatus;
    pipelineLabel?: string;
    pipelineProgressPercent?: number;
    onOpenPipelineMonitor?: () => void;
    tokenReadout?: {
        value: string;
        title?: string;
    };
    qaTelemetryDemoRequest?: SpiderTelemetryDemoRequest | null;
    operationMode?: SpiderOperationMode;
    localIngestionFiles?: LocalIngestionFile[];
    localIngestionProgress?: LocalIngestionProgress | null;
    qaLocalIngestionDemoRequest?: SpiderTelemetryDemoRequest | null;
    qaErrorEmptyDemoRequest?: SpiderTelemetryDemoRequest | null;
}

const webLegRoles = ['Discovery', 'Link Finder', 'Scraper', 'Content Map', 'Extractor', 'Deduper', 'Validator', 'Archiver'];
const localLegRoles = ['Parser', 'Chunker', 'Summarizer', 'Classifier', 'Indexer', 'Verifier', 'Dossier', 'Archiver'];
const rabbitHoleLegRoles = ['Descent', 'Trace', 'Source Drill', 'Contradiction', 'Entity Echo', 'Timeline Rift', 'Gatekeeper', 'Archive'];

const getSignalColor = (state: string) => {
    if (state.includes('Error')) return '#ff8c86';
    if (state.includes('Rabbit') || state.includes('Gatekeeper')) return '#ff2f54';
    if (state.includes('Synthesizing') || state.includes('Deep Dive')) return '#f6c879';
    if (state.includes('Reading') || state.includes('Processing')) return '#bc13fe';
    if (state.includes('Scraping')) return '#59e4ff';
    if (state.includes('Searching')) return '#90f3da';
    return '#36505d';
};

const getSignalLevel = (state: string) => {
    if (state === 'Idle') return 5;
    if (state.includes('Error')) return 3;
    if (state.includes('Synthesizing') || state.includes('Deep Dive')) return 12;
    if (state.includes('Reading') || state.includes('Processing')) return 10;
    return 9;
};

const resetLegStates = () => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 'Idle']));

const isIdleState = (state: string) => state === 'Idle';

const getLegVisualStatus = (state: string, pipelineStatus: PipelineRailStatus): SpiderLegVisualStatus => {
    if (isIdleState(state)) return 'idle';
    if (pipelineStatus === 'cancelled') return 'cancelled';
    if (state.match(/error|failed|timeout/i)) return 'error';
    if (state.match(/complete|done|sent nutrient|finished/i)) return 'complete';
    return 'running';
};

const getLegDisplayState = (status: SpiderLegVisualStatus) => {
    if (status === 'idle') return 'Idle';
    if (status === 'complete') return 'Complete';
    if (status === 'error') return 'Failed';
    if (status === 'cancelled') return 'Powering Down';
    return 'Active';
};

const getBrainVisualStatus = (
    brainState: string,
    activeLegCount: number,
    pipelineStatus: PipelineRailStatus,
) => {
    if (brainState === 'Offline' || brainState === 'Disconnected') return 'offline';
    if (pipelineStatus === 'cancelled') return 'cancelled';
    if (pipelineStatus === 'error') return 'error';
    if (pipelineStatus === 'running' || activeLegCount > 0) return 'running';
    if (pipelineStatus === 'complete') return 'complete';
    return 'connected';
};

const prefersReducedMotion = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const getLocalIngestionStateLabel = (state: LocalIngestionFileState) => {
    if (state === 'parsing') return 'Parsing';
    if (state === 'chunking') return 'Chunking';
    if (state === 'summarizing') return 'Summarizing';
    if (state === 'imported') return 'Imported';
    if (state === 'failed') return 'Stopped';
    return 'Queued';
};

const deriveLocalIngestionFileState = (
    fallbackState: LocalIngestionFileState,
    progress: LocalIngestionProgress | null,
    pipelineStatus: PipelineRailStatus,
): LocalIngestionFileState => {
    if (pipelineStatus === 'cancelled' || progress?.status === 'cancelled') return 'failed';
    if (pipelineStatus === 'error' || progress?.status === 'error') return 'failed';
    if (pipelineStatus === 'complete' || progress?.status === 'complete' && progress?.stepId === 'complete') return 'imported';

    const stepId = progress?.stepId || '';
    const detail = progress?.detail || '';
    if (/summar/i.test(detail) || stepId === 'gather_evidence' || stepId === 'rank_facts') return 'summarizing';
    if (/chunk|dispatch/i.test(detail) || stepId === 'dispatch_legs') return 'chunking';
    if (/pars/i.test(detail) || stepId === 'plan_queries') return 'parsing';
    return fallbackState;
};

const MiniWaveform = ({ color, seed }: { color: string; seed: number }) => (
    <div className="forensic-spider-waveform" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
            <span
                key={index}
                style={{
                    height: `${18 + (((index + seed) * 7) % 18)}%`,
                    backgroundColor: color,
                    opacity: 0.35 + (((index + seed) % 5) * 0.1),
                    '--spider-bar-index': index,
                } as React.CSSProperties}
            />
        ))}
    </div>
);

const SignalBars = ({ level, color }: { level: number; color: string }) => (
    <div className="forensic-spider-signal-bars" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
            <span
                key={index}
                className={index < level ? 'forensic-spider-signal-bar-active' : ''}
                style={{
                    ...(index < level ? { backgroundColor: color, boxShadow: `0 0 8px ${color}55` } : {}),
                    '--spider-bar-index': index,
                } as React.CSSProperties}
            />
        ))}
    </div>
);

const LegTelemetryCard = ({
    id,
    state,
    pipelineStatus,
    role,
    transientStatus,
}: {
    id: number;
    state: string;
    pipelineStatus: PipelineRailStatus;
    role: string;
    transientStatus?: 'error' | 'recovering';
}) => {
    const color = getSignalColor(state);
    const signalLevel = getSignalLevel(state);
    const visualStatus = getLegVisualStatus(state, pipelineStatus);
    const isActive = visualStatus !== 'idle';
    const displayId = id + 1;

    return (
        <article
            data-testid={`spider-leg-telemetry-${displayId}`}
            className={`forensic-spider-leg-card forensic-spider-leg-card-${visualStatus} ${isActive ? 'forensic-spider-leg-card-active' : ''} ${transientStatus === 'error' ? 'forensic-spider-leg-card-error-flash' : ''} ${transientStatus === 'recovering' ? 'forensic-spider-leg-card-recovering' : ''}`}
            style={{ '--spider-leg-color': color } as React.CSSProperties}
        >
            <header className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <span className="forensic-spider-leg-index" />
                    <span className="text-[11px] font-black text-[var(--forensic-accent)]">Leg {displayId}</span>
                </div>
                <span className="forensic-spider-leg-state">
                    <span className={isActive ? 'bg-cyber-green' : 'bg-[var(--forensic-text-faint)]'} />
                    {getLegDisplayState(visualStatus)}
                </span>
            </header>
            <div className="forensic-spider-leg-subrow">
                <span className="forensic-spider-leg-role" title={role}>{role}</span>
                <span className="forensic-spider-leg-crawl" title={state}>{state}</span>
            </div>
            <div className="forensic-spider-leg-viz">
                <SignalBars level={signalLevel} color={color} />
                <MiniWaveform color={color} seed={id} />
            </div>
        </article>
    );
};

const RabbitDescentTelemetryPanel = ({
    legIds,
    legStates,
    legVisualStatuses,
    legRoles,
}: {
    legIds: number[];
    legStates: Record<number, string>;
    legVisualStatuses: Record<number, SpiderLegVisualStatus>;
    legRoles: string[];
}) => {
    const activeTools = legIds.filter((id) => legVisualStatuses[id] !== 'idle').length;

    return (
        <section data-testid="rabbit-descent-telemetry" className="forensic-rabbit-descent-telemetry" aria-label="Rabbit Hole descent tools">
            <header className="forensic-rabbit-descent-header">
                <div>
                    <span>Descent Tools</span>
                    <strong>{activeTools} / 8 armed</strong>
                </div>
                <small>Agentic trail control</small>
            </header>
            <div className="forensic-rabbit-descent-tool-grid">
                {legIds.map((id) => {
                    const state = legStates[id] || 'Idle';
                    const color = getSignalColor(state);
                    const visualStatus = legVisualStatuses[id] || 'idle';

                    return (
                        <article
                            key={id}
                            data-testid={`rabbit-descent-tool-${id + 1}`}
                            className={`forensic-rabbit-descent-tool forensic-rabbit-descent-tool-${visualStatus}`}
                            style={{ '--rabbit-tool-color': color } as React.CSSProperties}
                        >
                            <div className="forensic-rabbit-descent-tool-head">
                                <span>{legRoles[id]}</span>
                                <strong>{getLegDisplayState(visualStatus)}</strong>
                            </div>
                            <p>{state}</p>
                            <SignalBars level={getSignalLevel(state)} color={color} />
                        </article>
                    );
                })}
            </div>
        </section>
    );
};

const MetricReadout = ({ label, value, title, icon: Icon }: { label: string; value: string | number; title?: string; icon?: LucideIcon }) => (
    <div className="forensic-spider-readout" title={title}>
        <span className="forensic-spider-readout-label">
            {Icon && <Icon size={11} aria-hidden="true" />}
            {label}
        </span>
        <strong>{value}</strong>
    </div>
);

const LocalIngestionStack = ({
    files,
    progress,
    pipelineStatus,
}: {
    files: LocalIngestionFile[];
    progress: LocalIngestionProgress | null;
    pipelineStatus: PipelineRailStatus;
}) => {
    const reducedMotion = prefersReducedMotion();
    const visibleFiles = files.length > 0
        ? files
        : [{ path: 'local-intake-placeholder', name: 'Awaiting local files', state: 'queued' as LocalIngestionFileState }];
    const state = deriveLocalIngestionFileState(visibleFiles[0]?.state || 'queued', progress, pipelineStatus);
    const chunkCount = progress?.counters?.documentChunks;
    const overflowCount = Math.max(0, visibleFiles.length - 6);
    const hasScrollableStack = visibleFiles.length > 6;

    return (
        <div
            data-testid="local-ingestion-file-stack"
            className={`forensic-local-ingestion-stack forensic-local-ingestion-stack-${state} ${reducedMotion ? 'forensic-local-ingestion-reduced-motion' : ''}`}
        >
            <div className="forensic-local-ingestion-stack-header">
                <span>Local File Stack</span>
                <strong>{getLocalIngestionStateLabel(state)}</strong>
            </div>
            <div
                data-testid="local-ingestion-file-list"
                className={`forensic-local-ingestion-file-list ${hasScrollableStack ? 'forensic-local-ingestion-file-list-scrollable' : ''}`}
            >
                {visibleFiles.map((file, index) => {
                    const fileState = deriveLocalIngestionFileState(file.state, progress, pipelineStatus);
                    return (
                        <div
                            key={`${file.path}-${index}`}
                            className={`forensic-local-ingestion-file forensic-local-ingestion-file-${fileState}`}
                            style={{ '--local-file-index': index } as React.CSSProperties}
                            title={file.path}
                        >
                            <span className="forensic-local-ingestion-file-icon" aria-hidden="true" />
                            <span className="forensic-local-ingestion-file-name">{file.name}</span>
                            <strong>{getLocalIngestionStateLabel(fileState)}</strong>
                        </div>
                    );
                })}
            </div>
            <div className="forensic-local-ingestion-stack-footer">
                <span>{visibleFiles.length} file{visibleFiles.length === 1 ? '' : 's'}</span>
                <span>
                    {overflowCount > 0 ? `+${overflowCount} more | ` : ''}
                    {Number.isFinite(chunkCount) && chunkCount ? `${chunkCount} chunks` : progress?.detail || 'Ready for local intake'}
                </span>
            </div>
        </div>
    );
};

const SpiderVisualizer: React.FC<SpiderVisualizerProps> = ({
    sharedSocket,
    displayMetrics,
    pipelineStatus = 'idle',
    pipelineLabel = 'Pipeline idle',
    pipelineProgressPercent = 0,
    onOpenPipelineMonitor,
    tokenReadout,
    qaTelemetryDemoRequest,
    operationMode = 'web',
    localIngestionFiles = [],
    localIngestionProgress = null,
    qaLocalIngestionDemoRequest,
    qaErrorEmptyDemoRequest,
}) => {
    const [legStates, setLegStates] = useState<Record<number, string>>(resetLegStates);
    const [brainState, setBrainState] = useState<string>('Offline');
    const [evidencePackets, setEvidencePackets] = useState<SpiderEvidencePacket[]>([]);
    const [qaPipelineStatus, setQaPipelineStatus] = useState<PipelineRailStatus | null>(null);
    const [qaLocalProgress, setQaLocalProgress] = useState<LocalIngestionProgress | null>(null);
    const [legTransitionStates, setLegTransitionStates] = useState<Record<number, 'error' | 'recovering'>>({});
    const legStatesRef = useRef(legStates);
    const legVisualStatusesRef = useRef<Record<number, SpiderLegVisualStatus>>({});
    const lastActiveLegRef = useRef(0);
    const fallbackLegRef = useRef(0);
    const packetCounterRef = useRef(0);
    const packetTimeoutsRef = useRef<number[]>([]);
    const qaTimeoutsRef = useRef<number[]>([]);
    const legTransitionTimeoutsRef = useRef<Record<number, number>>({});
    const lastQaRequestIdRef = useRef<string | null>(null);
    const lastQaLocalRequestIdRef = useRef<string | null>(null);
    const lastQaErrorEmptyRequestIdRef = useRef<string | null>(null);
    const effectivePipelineStatus = qaPipelineStatus || pipelineStatus;
    const effectiveOperationMode: SpiderOperationMode = qaLocalIngestionDemoRequest ? 'local' : operationMode;
    const effectiveLocalProgress = qaLocalProgress || localIngestionProgress;

    useEffect(() => {
        legStatesRef.current = legStates;
    }, [legStates]);

    const clearPacketTimeouts = useCallback(() => {
        packetTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        packetTimeoutsRef.current = [];
    }, []);

    const clearEvidencePackets = useCallback(() => {
        clearPacketTimeouts();
        setEvidencePackets([]);
    }, [clearPacketTimeouts]);

    const clearLegTransitions = useCallback(() => {
        Object.values(legTransitionTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
        legTransitionTimeoutsRef.current = {};
        setLegTransitionStates({});
    }, []);

    const markLegTransition = useCallback((legId: number, transition: 'error' | 'recovering') => {
        if (prefersReducedMotion()) {
            return;
        }

        const existingTimeout = legTransitionTimeoutsRef.current[legId];
        if (existingTimeout) {
            window.clearTimeout(existingTimeout);
        }

        setLegTransitionStates((current) => ({
            ...current,
            [legId]: transition,
        }));

        const timeoutId = window.setTimeout(() => {
            setLegTransitionStates((current) => {
                const next = { ...current };
                delete next[legId];
                return next;
            });
            delete legTransitionTimeoutsRef.current[legId];
        }, 900);
        legTransitionTimeoutsRef.current[legId] = timeoutId;
    }, []);

    const addEvidencePacket = useCallback((preferredLegId?: number) => {
        if (effectivePipelineStatus === 'cancelled' || effectivePipelineStatus === 'error') {
            return;
        }

        const normalizedPreferredLegId = typeof preferredLegId === 'number' && Number.isFinite(preferredLegId)
            ? Math.max(0, Math.min(7, Math.round(preferredLegId)))
            : undefined;
        const legId = normalizedPreferredLegId ?? lastActiveLegRef.current ?? fallbackLegRef.current;
        fallbackLegRef.current = (legId + 1) % 8;
        const state = legStatesRef.current[legId] || 'Idle';
        const packet: SpiderEvidencePacket = {
            id: `spider-packet-${Date.now()}-${packetCounterRef.current++}`,
            legId,
            createdAt: Date.now(),
            status: getLegVisualStatus(state, effectivePipelineStatus),
            mode: effectiveOperationMode,
        };

        setEvidencePackets((current) => [...current, packet].slice(-7));
        const timeoutId = window.setTimeout(() => {
            setEvidencePackets((current) => current.filter((entry) => entry.id !== packet.id));
            packetTimeoutsRef.current = packetTimeoutsRef.current.filter((entry) => entry !== timeoutId);
        }, 1900);
        packetTimeoutsRef.current.push(timeoutId);
    }, [effectiveOperationMode, effectivePipelineStatus]);

    const clearQaTimeouts = useCallback(() => {
        qaTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaTimeoutsRef.current = [];
    }, []);

    const scheduleQaStep = useCallback((delay: number, action: () => void) => {
        const timeoutId = window.setTimeout(() => {
            action();
            qaTimeoutsRef.current = qaTimeoutsRef.current.filter((entry) => entry !== timeoutId);
        }, delay);
        qaTimeoutsRef.current.push(timeoutId);
    }, []);

    const applyLegState = useCallback((legId: number, state: string) => {
        const previousVisualStatus = legVisualStatusesRef.current[legId] || getLegVisualStatus(legStatesRef.current[legId] || 'Idle', effectivePipelineStatus);
        const nextVisualStatus = getLegVisualStatus(state, effectivePipelineStatus);
        legVisualStatusesRef.current[legId] = nextVisualStatus;
        if (nextVisualStatus === 'error') {
            markLegTransition(legId, 'error');
        } else if (previousVisualStatus === 'error' && nextVisualStatus === 'running') {
            markLegTransition(legId, 'recovering');
        }
        setLegStates((prev) => ({ ...prev, [legId]: state }));
        if (!isIdleState(state)) {
            lastActiveLegRef.current = legId;
        }
    }, [effectivePipelineStatus, markLegTransition]);

    useEffect(() => {
        if (!sharedSocket) {
            setBrainState('Offline');
            legVisualStatusesRef.current = {};
            clearLegTransitions();
            clearEvidencePackets();
            return;
        }

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'LEG_UPDATE') {
                const { legId, state } = msg.payload;
                if (typeof legId === 'number' && typeof state === 'string') {
                    applyLegState(legId, state);
                }
            } else if (msg.type === 'BRAIN_STATE') {
                setBrainState(msg.payload);
                if (['Done', 'Offline', 'Disconnected'].includes(msg.payload)) {
                    legVisualStatusesRef.current = {};
                    clearLegTransitions();
                    setLegStates(resetLegStates());
                    clearEvidencePackets();
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                legVisualStatusesRef.current = {};
                clearLegTransitions();
                setLegStates(resetLegStates());
                clearEvidencePackets();
            } else if (msg.type === 'MEMORY_NODE_GATHERED') {
                const payload = msg.payload || {};
                const payloadLegId = typeof payload.legId === 'number'
                    ? payload.legId
                    : (typeof payload.node?.legId === 'number' ? payload.node.legId : undefined);
                addEvidencePacket(payloadLegId);
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        setBrainState('Connected');

        return () => {
            sharedSocket.removeEventListener('message', handleMessage);
        };
    }, [addEvidencePacket, applyLegState, clearEvidencePackets, clearLegTransitions, sharedSocket]);

    useEffect(() => {
        if (pipelineStatus === 'cancelled' || pipelineStatus === 'error') {
            setQaPipelineStatus(null);
            setQaLocalProgress(null);
            clearLegTransitions();
            clearEvidencePackets();
        }
    }, [clearEvidencePackets, clearLegTransitions, pipelineStatus]);

    useEffect(() => () => {
        clearPacketTimeouts();
        clearQaTimeouts();
        clearLegTransitions();
    }, [clearLegTransitions, clearPacketTimeouts, clearQaTimeouts]);

    useEffect(() => {
        const requestId = qaTelemetryDemoRequest?.requestId?.trim();
        if (!requestId || lastQaRequestIdRef.current === requestId) {
            return;
        }

        lastQaRequestIdRef.current = requestId;
        clearQaTimeouts();
        clearEvidencePackets();
        clearLegTransitions();
        legVisualStatusesRef.current = {};
        setBrainState('Connected');
        setQaPipelineStatus('running');
        setLegStates(resetLegStates());
        applyLegState(0, 'Searching sources');
        applyLegState(1, 'Scraping source map');

        scheduleQaStep(260, () => applyLegState(2, 'Reading candidate pages'));
        scheduleQaStep(420, () => addEvidencePacket(0));
        scheduleQaStep(720, () => addEvidencePacket(1));
        scheduleQaStep(980, () => applyLegState(4, 'Error: source timeout'));
        scheduleQaStep(1250, () => {
            applyLegState(0, 'Complete');
            applyLegState(1, 'Sent nutrient back');
        });
        scheduleQaStep(1600, () => setQaPipelineStatus('complete'));
        scheduleQaStep(2150, () => setQaPipelineStatus('cancelled'));
        scheduleQaStep(2850, () => {
            setQaPipelineStatus(null);
            legVisualStatusesRef.current = {};
            clearLegTransitions();
            setLegStates(resetLegStates());
            clearEvidencePackets();
        });
    }, [addEvidencePacket, applyLegState, clearEvidencePackets, clearLegTransitions, clearQaTimeouts, qaTelemetryDemoRequest?.requestId, scheduleQaStep]);

    useEffect(() => {
        const requestId = qaErrorEmptyDemoRequest?.requestId?.trim();
        if (!requestId || lastQaErrorEmptyRequestIdRef.current === requestId) {
            return;
        }

        lastQaErrorEmptyRequestIdRef.current = requestId;
        clearQaTimeouts();
        clearEvidencePackets();
        clearLegTransitions();
        legVisualStatusesRef.current = {};
        setBrainState('Connected');
        setQaPipelineStatus('running');
        setLegStates(resetLegStates());
        applyLegState(2, 'Checking source health');

        scheduleQaStep(180, () => applyLegState(2, 'Error: source timeout'));
        scheduleQaStep(700, () => applyLegState(2, 'Retrying source fetch'));
        scheduleQaStep(1220, () => applyLegState(2, 'Complete'));
        scheduleQaStep(1800, () => {
            setQaPipelineStatus(null);
            legVisualStatusesRef.current = {};
            clearLegTransitions();
            setLegStates(resetLegStates());
            clearEvidencePackets();
        });
    }, [applyLegState, clearEvidencePackets, clearLegTransitions, clearQaTimeouts, qaErrorEmptyDemoRequest?.requestId, scheduleQaStep]);

    useEffect(() => {
        const requestId = qaLocalIngestionDemoRequest?.requestId?.trim();
        if (!requestId || lastQaLocalRequestIdRef.current === requestId) {
            return;
        }

        lastQaLocalRequestIdRef.current = requestId;
        clearQaTimeouts();
        clearEvidencePackets();
        clearLegTransitions();
        legVisualStatusesRef.current = {};
        setBrainState('Connected');
        setQaPipelineStatus('running');
        setQaLocalProgress({ stepId: 'plan_queries', status: 'running', detail: 'Parsing local files into chunks' });
        setLegStates(resetLegStates());
        applyLegState(0, 'Parsing local files');
        applyLegState(1, 'Chunking document text');

        scheduleQaStep(360, () => addEvidencePacket(0));
        scheduleQaStep(620, () => {
            setQaLocalProgress({ stepId: 'dispatch_legs', status: 'running', detail: 'Dispatching document chunks to legs' });
            applyLegState(2, 'Summarizing document chunks');
            addEvidencePacket(1);
        });
        scheduleQaStep(980, () => {
            setQaLocalProgress({ stepId: 'gather_evidence', status: 'running', detail: 'Summarizing local document chunks', counters: { documentChunks: 12 } });
            applyLegState(3, 'Classifying local evidence');
            addEvidencePacket(2);
        });
        scheduleQaStep(1360, () => {
            setQaLocalProgress({ stepId: 'complete', status: 'complete', detail: 'Imported local evidence', counters: { documentChunks: 12 } });
            setQaPipelineStatus('complete');
            applyLegState(0, 'Complete');
            applyLegState(1, 'Complete');
            applyLegState(2, 'Complete');
            applyLegState(3, 'Complete');
        });
        scheduleQaStep(2450, () => {
            setQaPipelineStatus(null);
            setQaLocalProgress(null);
            legVisualStatusesRef.current = {};
            clearLegTransitions();
            setLegStates(resetLegStates());
            clearEvidencePackets();
        });
    }, [addEvidencePacket, applyLegState, clearEvidencePackets, clearLegTransitions, clearQaTimeouts, qaLocalIngestionDemoRequest?.requestId, scheduleQaStep]);

    const legIds = useMemo(() => Array.from({ length: 8 }, (_, index) => index), []);
    const legVisualStatuses = useMemo(
        () => Object.fromEntries(legIds.map((id) => [id, getLegVisualStatus(legStates[id] || 'Idle', effectivePipelineStatus)])) as Record<number, SpiderLegVisualStatus>,
        [effectivePipelineStatus, legIds, legStates],
    );
    const activeLegCount = legIds.filter((id) => legVisualStatuses[id] !== 'idle').length;
    const evidenceCount = displayMetrics?.evidenceCount ?? 0;
    const localFileCount = localIngestionFiles.length;
    const localChunkCount = effectiveLocalProgress?.counters?.documentChunks || 0;
    const confidenceScore = Math.round((displayMetrics?.confidenceScore ?? 0) * 100);
    const throughput = activeLegCount > 0
        ? (effectiveOperationMode === 'local'
            ? `${Math.max(2, activeLegCount * 3)} docs/min`
            : effectiveOperationMode === 'rabbit-hole'
                ? `${Math.max(1, Math.ceil(activeLegCount / 2))} layers/min`
                : `${Math.max(14.2, activeLegCount * 18.4).toFixed(1)} rps`)
        : 'Standby';
    const normalizedPipelinePercent = Math.max(0, Math.min(100, Math.round(pipelineProgressPercent)));
    const pipelineTitle = normalizedPipelinePercent > 0
        ? `Pipeline: ${pipelineLabel} (${normalizedPipelinePercent}%)`
        : `Pipeline: ${pipelineLabel}`;
    const brainVisualStatus = getBrainVisualStatus(brainState, activeLegCount, effectivePipelineStatus);
    const isRabbitHoleMode = effectiveOperationMode === 'rabbit-hole';
    const reducedMotion = prefersReducedMotion();
    const legRoles = effectiveOperationMode === 'local'
        ? localLegRoles
        : isRabbitHoleMode
            ? rabbitHoleLegRoles
            : webLegRoles;
    const stageTopLabel = effectiveOperationMode === 'local'
        ? 'Document Intake'
        : isRabbitHoleMode
            ? 'Rabbit Hole'
            : 'Neural Mesh';
    const stageTopValue = effectiveOperationMode === 'local'
        ? (localFileCount > 0 ? `${localFileCount} file${localFileCount === 1 ? '' : 's'}` : 'Local Files')
        : isRabbitHoleMode
            ? (brainState === 'Offline' ? 'Descent Preview' : 'Descent Active')
            : (brainState === 'Offline' ? 'Local Preview' : 'Connected');
    const stageBottomLabel = effectiveOperationMode === 'local'
        ? 'Case File Index'
        : isRabbitHoleMode
            ? 'Descent Depth'
            : 'Scan Radius';
    const stageBottomValue = effectiveOperationMode === 'local'
        ? `${displayMetrics?.nodeCount ?? 0} evidence / ${localChunkCount || 'queued'} chunks`
        : isRabbitHoleMode
            ? `${displayMetrics?.nodeCount ?? 0} nodes / gatekeeper armed`
            : `${displayMetrics?.nodeCount ?? 0} nodes / ${displayMetrics?.edgeCount ?? 0} links`;
    const intakeHeading = effectiveOperationMode === 'local' ? 'Document Intake' : isRabbitHoleMode ? 'Rabbit Evidence' : 'Evidence Intake';
    const healthHeading = effectiveOperationMode === 'local' ? 'Import Health' : isRabbitHoleMode ? 'Descent Health' : 'Crawl Health';

    return (
        <section data-testid="spider-view-root" className={`forensic-board-root forensic-spider-root forensic-spider-root-${brainVisualStatus} forensic-spider-root-${effectiveOperationMode} h-full overflow-hidden text-[var(--forensic-text)]`}>
            <div className="forensic-spider-frame">
                <header className="forensic-spider-status-strip">
                    <div className={`forensic-spider-brain-title forensic-spider-brain-title-${brainVisualStatus}`} aria-label={`Brain: ${brainState}`}>
                        <div className="forensic-spider-brain-copy">
                            <small className="forensic-spider-brain-caption">Neural Link</small>
                            <div className="forensic-spider-brain-line">
                                <span>Brain: </span>
                                <strong>{brainState}</strong>
                            </div>
                        </div>
                        <div
                            data-testid="spider-brain-signal"
                            className="forensic-spider-brain-signal"
                            aria-hidden="true"
                        >
                            <span data-testid="spider-brain-signal-track" className="forensic-spider-brain-signal-track" />
                            <span data-testid="spider-brain-signal-bolt" className="forensic-spider-brain-signal-bolt" />
                            <span data-testid="spider-brain-signal-scan" className="forensic-spider-brain-signal-scan" />
                        </div>
                    </div>
                    <div className="forensic-spider-top-metrics">
                        <MetricReadout label={isRabbitHoleMode ? 'Tools Active' : 'Legs Active'} value={`${activeLegCount} / 8`} icon={Network} />
                        <MetricReadout label="Evidence" value={evidenceCount} icon={Database} />
                        <MetricReadout label="Tokens" value={tokenReadout?.value || '0'} title={tokenReadout?.title} icon={Zap} />
                        <MetricReadout label="Throughput" value={throughput} icon={Gauge} />
                    </div>
                </header>

                <div className="forensic-spider-workbench">
                    {isRabbitHoleMode ? (
                        <RabbitDescentTelemetryPanel
                            legIds={legIds}
                            legStates={legStates}
                            legVisualStatuses={legVisualStatuses}
                            legRoles={legRoles}
                        />
                    ) : (
                        <div className="forensic-spider-leg-bank">
                            {[0, 2, 4, 6].map((id) => (
                                <LegTelemetryCard
                                    key={id}
                                    id={id}
                                    state={legStates[id] || 'Idle'}
                                    pipelineStatus={effectivePipelineStatus}
                                    role={legRoles[id]}
                                    transientStatus={legTransitionStates[id]}
                                />
                            ))}
                        </div>
                    )}

                    <div data-testid="spider-lab-stage" className="forensic-spider-lab-stage">
                        <div className="forensic-spider-stage-overlay forensic-spider-stage-overlay-top">
                            <span>{stageTopLabel}</span>
                            <strong>{stageTopValue}</strong>
                        </div>
                        {isRabbitHoleMode && (
                            <div
                                data-testid="rabbit-hole-entrance"
                                className={`forensic-rabbit-hole-entrance ${reducedMotion ? 'forensic-rabbit-hole-entrance-reduced-motion' : ''}`}
                                aria-hidden="true"
                            >
                                <div className="forensic-rabbit-hole-tunnel" />
                                <img
                                    src="/assets/rabbit-hole/rabbit-hole-emblem.png"
                                    alt="Rabbit Hole cyber rabbit emblem"
                                    className="forensic-rabbit-hole-emblem"
                                />
                            </div>
                        )}
                        {!isRabbitHoleMode && (
                            <Canvas
                                camera={{ position: [0, -0.4, 13], fov: 45 }}
                                dpr={[1, 1.5]}
                                gl={{ antialias: true, alpha: true }}
                            >
                                <SpiderScene
                                    legStates={legStates}
                                    legVisualStatuses={legVisualStatuses}
                                    brainState={brainState}
                                    pipelineStatus={effectivePipelineStatus}
                                    evidencePackets={evidencePackets}
                                    operationMode={effectiveOperationMode}
                                />
                                <EffectComposer>
                                    <Bloom luminanceThreshold={0.18} mipmapBlur intensity={0.72} />
                                </EffectComposer>
                            </Canvas>
                        )}
                        <div className="forensic-spider-stage-overlay forensic-spider-stage-overlay-bottom">
                            <span>{stageBottomLabel}</span>
                            <strong>{stageBottomValue}</strong>
                        </div>
                    </div>

                    {!isRabbitHoleMode && (
                        <div className="forensic-spider-leg-bank">
                            {[1, 3, 5, 7].map((id) => (
                                <LegTelemetryCard
                                    key={id}
                                    id={id}
                                    state={legStates[id] || 'Idle'}
                                    pipelineStatus={effectivePipelineStatus}
                                    role={legRoles[id]}
                                    transientStatus={legTransitionStates[id]}
                                />
                            ))}
                        </div>
                    )}

                    <aside data-testid="spider-evidence-intake" className="forensic-spider-intake-panel">
                        <div className="flex items-center justify-between gap-3">
                            <div className="forensic-spider-panel-heading">{intakeHeading}</div>
                            <span className="forensic-spider-live-chip">Live</span>
                        </div>
                        {effectiveOperationMode === 'local' && (
                            <LocalIngestionStack
                                files={localIngestionFiles}
                                progress={effectiveLocalProgress}
                                pipelineStatus={effectivePipelineStatus}
                            />
                        )}
                        <div className="forensic-spider-intake-grid">
                            <MetricReadout label={effectiveOperationMode === 'local' ? 'Evidence' : 'New Items'} value={evidenceCount} />
                            <MetricReadout label="Duplicates" value={Math.max(0, Math.round(evidenceCount * 0.25))} />
                            <MetricReadout label={effectiveOperationMode === 'local' ? 'Files' : 'Sources'} value={effectiveOperationMode === 'local' ? localFileCount : Math.max(0, displayMetrics?.nodeCount ?? 0)} />
                            <MetricReadout label={effectiveOperationMode === 'local' ? 'Chunks' : 'Images'} value={effectiveOperationMode === 'local' ? localChunkCount : displayMetrics?.imageCount ?? 0} />
                        </div>
                        <div className="forensic-spider-bar-chart" aria-hidden="true">
                            {Array.from({ length: 18 }, (_, index) => (
                                <span key={index} style={{ height: `${18 + ((index * 11) % 58)}%` }} />
                            ))}
                        </div>
                        <div className="forensic-spider-panel-heading mt-5">{healthHeading}</div>
                        <dl className="forensic-spider-health-list">
                            <div><dt>Success Rate</dt><dd>{confidenceScore || 98}%</dd></div>
                            <div><dt>{effectiveOperationMode === 'local' ? 'Parser State' : 'Avg Response'}</dt><dd>{activeLegCount > 0 ? (effectiveOperationMode === 'local' ? 'Active' : '412 ms') : 'Ready'}</dd></div>
                            <div><dt>{effectiveOperationMode === 'local' ? 'Import Rate' : 'Retry Rate'}</dt><dd>{activeLegCount > 0 ? (effectiveOperationMode === 'local' ? 'Live' : '1.2%') : '0.0%'}</dd></div>
                            <div><dt>Last Activity</dt><dd>{displayMetrics?.lastActivityLabel ?? '--'}</dd></div>
                        </dl>
                    </aside>

                    <nav className="forensic-spider-utility-rail" aria-label="Spider lab readouts">
                        <button
                            type="button"
                            data-testid="spider-pipeline-rail-button"
                            aria-label={`Open pipeline monitor, ${pipelineTitle}`}
                            title={pipelineTitle}
                            onClick={onOpenPipelineMonitor}
                            className={`forensic-spider-pipeline-rail-button forensic-spider-pipeline-rail-button-${effectivePipelineStatus}`}
                            disabled={!onOpenPipelineMonitor}
                        >
                            <Activity size={16} />
                            <span
                                data-testid="spider-pipeline-status-dot"
                                className={`forensic-spider-pipeline-dot forensic-spider-pipeline-dot-${effectivePipelineStatus}`}
                                aria-hidden="true"
                            />
                        </button>
                        {[
                            { icon: Network, label: 'Topology' },
                            { icon: ScanLine, label: 'Scan beam' },
                            { icon: Info, label: 'Run info' },
                            { icon: Crosshair, label: 'Targeting' },
                            { icon: BarChart3, label: 'Crawl metrics' },
                            { icon: Braces, label: 'Parameters' },
                            { icon: CircuitBoard, label: 'Neural mesh' },
                            { icon: DatabaseZap, label: 'Evidence bus' },
                            { icon: RadioTower, label: 'Signal' },
                        ].map(({ icon: Icon, label }) => (
                            <button key={label} type="button" aria-label={label} title={label} disabled>
                                <Icon size={16} />
                            </button>
                        ))}
                    </nav>
                </div>
            </div>
        </section>
    );
};

export default SpiderVisualizer;
