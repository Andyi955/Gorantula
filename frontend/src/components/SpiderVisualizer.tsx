import React, { useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Activity, BarChart3, Braces, CircuitBoard, Crosshair, DatabaseZap, Info, Network, RadioTower, ScanLine } from 'lucide-react';
import { SpiderScene } from './SpiderScene';

type PipelineRailStatus = 'idle' | 'running' | 'complete' | 'error';

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

const LegTelemetryCard = ({ id, state }: { id: number; state: string }) => {
    const color = getSignalColor(state);
    const signalLevel = getSignalLevel(state);
    const isActive = state !== 'Idle';
    const displayId = id + 1;

    return (
        <article
            data-testid={`spider-leg-telemetry-${displayId}`}
            className={`forensic-spider-leg-card ${isActive ? 'forensic-spider-leg-card-active' : ''}`}
            style={{ '--spider-leg-color': color } as React.CSSProperties}
        >
            <header className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="forensic-spider-leg-index" />
                    <span className="text-[11px] font-black text-[var(--forensic-accent)]">Leg {displayId}</span>
                </div>
                <span className="forensic-spider-leg-state">
                    <span className={isActive ? 'bg-cyber-green' : 'bg-[var(--forensic-text-faint)]'} />
                    {isActive ? 'Active' : 'Idle'}
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
}) => {
    const [legStates, setLegStates] = useState<Record<number, string>>(resetLegStates);
    const [brainState, setBrainState] = useState<string>('Offline');

    useEffect(() => {
        if (!sharedSocket) {
            setBrainState('Offline');
            return;
        }

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'LEG_UPDATE') {
                const { legId, state } = msg.payload;
                setLegStates((prev) => ({ ...prev, [legId]: state }));
            } else if (msg.type === 'BRAIN_STATE') {
                setBrainState(msg.payload);
                if (['Done', 'Offline', 'Disconnected'].includes(msg.payload)) {
                    setLegStates(resetLegStates());
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                setLegStates(resetLegStates());
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        setBrainState('Connected');

        return () => {
            sharedSocket.removeEventListener('message', handleMessage);
        };
    }, [sharedSocket]);

    const legIds = useMemo(() => Array.from({ length: 8 }, (_, index) => index), []);
    const activeLegCount = legIds.filter((id) => legStates[id] !== 'Idle').length;
    const evidenceCount = displayMetrics?.evidenceCount ?? 0;
    const confidenceScore = Math.round((displayMetrics?.confidenceScore ?? 0) * 100);
    const uptime = sharedSocket ? '02:34:18' : '00:00:00';
    const throughput = activeLegCount > 0 ? `${Math.max(14.2, activeLegCount * 18.4).toFixed(1)} rps` : 'Standby';
    const normalizedPipelinePercent = Math.max(0, Math.min(100, Math.round(pipelineProgressPercent)));
    const pipelineTitle = normalizedPipelinePercent > 0
        ? `Pipeline: ${pipelineLabel} (${normalizedPipelinePercent}%)`
        : `Pipeline: ${pipelineLabel}`;

    return (
        <section data-testid="spider-view-root" className="forensic-board-root forensic-spider-root h-full overflow-hidden text-[var(--forensic-text)]">
            <div className="forensic-spider-frame">
                <header className="forensic-spider-status-strip">
                    <div className="forensic-spider-brain-title" aria-label={`Brain: ${brainState}`}>
                        <span>Brain: </span>
                        <strong>{brainState}</strong>
                        <div className="forensic-spider-ekg" aria-hidden="true" />
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
                            <LegTelemetryCard key={id} id={id} state={legStates[id] || 'Idle'} />
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
                            <SpiderScene legStates={legStates} brainState={brainState} />
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
                            <LegTelemetryCard key={id} id={id} state={legStates[id] || 'Idle'} />
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
                            className={`forensic-spider-pipeline-rail-button forensic-spider-pipeline-rail-button-${pipelineStatus}`}
                            disabled={!onOpenPipelineMonitor}
                        >
                            <Activity size={16} />
                            <span
                                data-testid="spider-pipeline-status-dot"
                                className={`forensic-spider-pipeline-dot forensic-spider-pipeline-dot-${pipelineStatus}`}
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
