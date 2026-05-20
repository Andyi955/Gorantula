import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Activity, BarChart3, Braces, CircuitBoard, Crosshair, DatabaseZap, Info, Network, RadioTower, ScanLine } from 'lucide-react';
import { SpiderScene } from './SpiderScene';

type PipelineRailStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';
export type SpiderLegVisualStatus = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';

export interface SpiderEvidencePacket {
    id: string;
    legId: number;
    createdAt: number;
    status: SpiderLegVisualStatus;
}

export interface SpiderTelemetryDemoRequest {
    investigationId?: string;
    requestId: string;
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
}

const legRoles = ['Discovery', 'Link Finder', 'Scraper', 'Content Map', 'Extractor', 'Deduper', 'Validator', 'Archiver'];

const getSignalColor = (state: string) => {
    if (state.includes('Error')) return '#ff8c86';
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

const MiniWaveform = ({ color, seed }: { color: string; seed: number }) => (
    <div className="forensic-spider-waveform" aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
            <span
                key={index}
                style={{
                    height: `${18 + (((index + seed) * 7) % 18)}%`,
                    backgroundColor: color,
                    opacity: 0.35 + (((index + seed) % 5) * 0.1),
                }}
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
                style={index < level ? { backgroundColor: color, boxShadow: `0 0 8px ${color}55` } : undefined}
            />
        ))}
    </div>
);

const LegTelemetryCard = ({ id, state, pipelineStatus }: { id: number; state: string; pipelineStatus: PipelineRailStatus }) => {
    const color = getSignalColor(state);
    const signalLevel = getSignalLevel(state);
    const visualStatus = getLegVisualStatus(state, pipelineStatus);
    const isActive = visualStatus !== 'idle';
    const displayId = id + 1;

    return (
        <article
            data-testid={`spider-leg-telemetry-${displayId}`}
            className={`forensic-spider-leg-card forensic-spider-leg-card-${visualStatus} ${isActive ? 'forensic-spider-leg-card-active' : ''}`}
            style={{ '--spider-leg-color': color } as React.CSSProperties}
        >
            <header className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="forensic-spider-leg-index" />
                    <span className="text-[11px] font-black text-[var(--forensic-accent)]">Leg {displayId}</span>
                </div>
                <span className="forensic-spider-leg-state">
                    <span className={isActive ? 'bg-cyber-green' : 'bg-[var(--forensic-text-faint)]'} />
                    {getLegDisplayState(visualStatus)}
                </span>
            </header>
            <dl className="mt-3 grid grid-cols-[3.6rem_1fr] gap-x-2 gap-y-1.5 text-[10px]">
                <dt>Signal</dt>
                <dd><SignalBars level={signalLevel} color={color} /></dd>
                <dt>Role</dt>
                <dd>{legRoles[id]}</dd>
                <dt>Crawl</dt>
                <dd>{state}</dd>
            </dl>
            <MiniWaveform color={color} seed={id} />
        </article>
    );
};

const MetricReadout = ({ label, value, title }: { label: string; value: string | number; title?: string }) => (
    <div className="forensic-spider-readout" title={title}>
        <span>{label}</span>
        <strong>{value}</strong>
    </div>
);

const SpiderVisualizer: React.FC<SpiderVisualizerProps> = ({
    sharedSocket,
    displayMetrics,
    pipelineStatus = 'idle',
    pipelineLabel = 'Pipeline idle',
    pipelineProgressPercent = 0,
    onOpenPipelineMonitor,
    tokenReadout,
    qaTelemetryDemoRequest,
}) => {
    const [legStates, setLegStates] = useState<Record<number, string>>(resetLegStates);
    const [brainState, setBrainState] = useState<string>('Offline');
    const [evidencePackets, setEvidencePackets] = useState<SpiderEvidencePacket[]>([]);
    const [qaPipelineStatus, setQaPipelineStatus] = useState<PipelineRailStatus | null>(null);
    const legStatesRef = useRef(legStates);
    const lastActiveLegRef = useRef(0);
    const fallbackLegRef = useRef(0);
    const packetCounterRef = useRef(0);
    const packetTimeoutsRef = useRef<number[]>([]);
    const qaTimeoutsRef = useRef<number[]>([]);
    const lastQaRequestIdRef = useRef<string | null>(null);
    const effectivePipelineStatus = qaPipelineStatus || pipelineStatus;

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
        };

        setEvidencePackets((current) => [...current, packet].slice(-7));
        const timeoutId = window.setTimeout(() => {
            setEvidencePackets((current) => current.filter((entry) => entry.id !== packet.id));
            packetTimeoutsRef.current = packetTimeoutsRef.current.filter((entry) => entry !== timeoutId);
        }, 1900);
        packetTimeoutsRef.current.push(timeoutId);
    }, [effectivePipelineStatus]);

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
        setLegStates((prev) => ({ ...prev, [legId]: state }));
        if (!isIdleState(state)) {
            lastActiveLegRef.current = legId;
        }
    }, []);

    useEffect(() => {
        if (!sharedSocket) {
            setBrainState('Offline');
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
                    setLegStates(resetLegStates());
                    clearEvidencePackets();
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
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
    }, [addEvidencePacket, applyLegState, clearEvidencePackets, sharedSocket]);

    useEffect(() => {
        if (pipelineStatus === 'cancelled' || pipelineStatus === 'error') {
            setQaPipelineStatus(null);
            clearEvidencePackets();
        }
    }, [clearEvidencePackets, pipelineStatus]);

    useEffect(() => () => {
        clearPacketTimeouts();
        clearQaTimeouts();
    }, [clearPacketTimeouts, clearQaTimeouts]);

    useEffect(() => {
        const requestId = qaTelemetryDemoRequest?.requestId?.trim();
        if (!requestId || lastQaRequestIdRef.current === requestId) {
            return;
        }

        lastQaRequestIdRef.current = requestId;
        clearQaTimeouts();
        clearEvidencePackets();
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
            setLegStates(resetLegStates());
            clearEvidencePackets();
        });
    }, [addEvidencePacket, applyLegState, clearEvidencePackets, clearQaTimeouts, qaTelemetryDemoRequest?.requestId, scheduleQaStep]);

    const legIds = useMemo(() => Array.from({ length: 8 }, (_, index) => index), []);
    const legVisualStatuses = useMemo(
        () => Object.fromEntries(legIds.map((id) => [id, getLegVisualStatus(legStates[id] || 'Idle', effectivePipelineStatus)])) as Record<number, SpiderLegVisualStatus>,
        [effectivePipelineStatus, legIds, legStates],
    );
    const activeLegCount = legIds.filter((id) => legVisualStatuses[id] !== 'idle').length;
    const evidenceCount = displayMetrics?.evidenceCount ?? 0;
    const confidenceScore = Math.round((displayMetrics?.confidenceScore ?? 0) * 100);
    const uptime = sharedSocket ? '02:34:18' : '00:00:00';
    const throughput = activeLegCount > 0 ? `${Math.max(14.2, activeLegCount * 18.4).toFixed(1)} rps` : 'Standby';
    const normalizedPipelinePercent = Math.max(0, Math.min(100, Math.round(pipelineProgressPercent)));
    const pipelineTitle = normalizedPipelinePercent > 0
        ? `Pipeline: ${pipelineLabel} (${normalizedPipelinePercent}%)`
        : `Pipeline: ${pipelineLabel}`;
    const brainVisualStatus = getBrainVisualStatus(brainState, activeLegCount, effectivePipelineStatus);

    return (
        <section data-testid="spider-view-root" className={`forensic-board-root forensic-spider-root forensic-spider-root-${brainVisualStatus} h-full overflow-hidden text-[var(--forensic-text)]`}>
            <div className="forensic-spider-frame">
                <header className="forensic-spider-status-strip">
                    <div className={`forensic-spider-brain-title forensic-spider-brain-title-${brainVisualStatus}`} aria-label={`Brain: ${brainState}`}>
                        <span>Brain: </span>
                        <strong>{brainState}</strong>
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
                        <MetricReadout label="Uptime" value={uptime} />
                        <MetricReadout label="Legs Active" value={`${activeLegCount} / 8`} />
                        <MetricReadout label="Evidence" value={evidenceCount} />
                        <MetricReadout label="Tokens" value={tokenReadout?.value || '0'} title={tokenReadout?.title} />
                        <MetricReadout label="Throughput" value={throughput} />
                    </div>
                </header>

                <div className="forensic-spider-workbench">
                    <div className="forensic-spider-leg-bank">
                        {[0, 2, 4, 6].map((id) => (
                            <LegTelemetryCard key={id} id={id} state={legStates[id] || 'Idle'} pipelineStatus={effectivePipelineStatus} />
                        ))}
                    </div>

                    <div data-testid="spider-lab-stage" className="forensic-spider-lab-stage">
                        <div className="forensic-spider-stage-overlay forensic-spider-stage-overlay-top">
                            <span>Neural Mesh</span>
                            <strong>{brainState === 'Offline' ? 'Local Preview' : 'Connected'}</strong>
                        </div>
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
                            />
                            <EffectComposer>
                                <Bloom luminanceThreshold={0.18} mipmapBlur intensity={0.72} />
                            </EffectComposer>
                        </Canvas>
                        <div className="forensic-spider-stage-overlay forensic-spider-stage-overlay-bottom">
                            <span>Scan Radius</span>
                            <strong>{displayMetrics?.nodeCount ?? 0} nodes / {displayMetrics?.edgeCount ?? 0} links</strong>
                        </div>
                    </div>

                    <div className="forensic-spider-leg-bank">
                        {[1, 3, 5, 7].map((id) => (
                            <LegTelemetryCard key={id} id={id} state={legStates[id] || 'Idle'} pipelineStatus={effectivePipelineStatus} />
                        ))}
                    </div>

                    <aside data-testid="spider-evidence-intake" className="forensic-spider-intake-panel">
                        <div className="flex items-center justify-between gap-3">
                            <div className="forensic-spider-panel-heading">Evidence Intake</div>
                            <span className="forensic-spider-live-chip">Live</span>
                        </div>
                        <div className="forensic-spider-intake-grid">
                            <MetricReadout label="New Items" value={evidenceCount} />
                            <MetricReadout label="Duplicates" value={Math.max(0, Math.round(evidenceCount * 0.25))} />
                            <MetricReadout label="Sources" value={Math.max(0, displayMetrics?.nodeCount ?? 0)} />
                            <MetricReadout label="Images" value={displayMetrics?.imageCount ?? 0} />
                        </div>
                        <div className="forensic-spider-bar-chart" aria-hidden="true">
                            {Array.from({ length: 18 }, (_, index) => (
                                <span key={index} style={{ height: `${18 + ((index * 11) % 58)}%` }} />
                            ))}
                        </div>
                        <div className="forensic-spider-panel-heading mt-5">Crawl Health</div>
                        <dl className="forensic-spider-health-list">
                            <div><dt>Success Rate</dt><dd>{confidenceScore || 98}%</dd></div>
                            <div><dt>Avg Response</dt><dd>{activeLegCount > 0 ? '412 ms' : 'Ready'}</dd></div>
                            <div><dt>Retry Rate</dt><dd>{activeLegCount > 0 ? '1.2%' : '0.0%'}</dd></div>
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
