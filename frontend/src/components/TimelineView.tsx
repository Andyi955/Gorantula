import React, { useEffect, useState, useRef } from 'react';
import { Clock, AlertTriangle, ArrowRight, ZoomIn, ZoomOut } from 'lucide-react';

interface TimelineEvent {
    timestamp: string;
    event: string;
    sourceNodeId: string;
}

interface ParsedEvent extends TimelineEvent {
    parsedDate: number | null;
    nodeTitle?: string;
}

interface TimelineViewProps {
    investigationId: string | null;
    onNavigateToNode?: (nodeId: string) => void;
}

const parseDateOrNull = (dateStr: string): number | null => {
    if (!dateStr || dateStr.toLowerCase().includes('unknown')) return null;
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) return parsed;

    // Fallback: try to extract a 4-digit year
    const yearMatch = dateStr.match(/\b(18|19|20)\d{2}\b/);
    if (yearMatch) return new Date(`${yearMatch[0]}-01-01`).getTime();

    return null;
};

const getYearColor = (date: number | null) => {
    const defaultColor = {
        border: 'border-cyber-cyan',
        text: 'text-cyber-cyan',
        line: 'bg-cyber-cyan',
        dotActive: 'group-hover/card:bg-cyber-cyan',
        shadow: 'shadow-[0_0_15px_rgba(0,243,255,0.3)]'
    };
    if (!date) return defaultColor;
    const year = new Date(date).getFullYear();

    // Cyclic color based on year
    const colors = [
        defaultColor,
        { border: 'border-cyber-green', text: 'text-cyber-green', line: 'bg-cyber-green', dotActive: 'group-hover/card:bg-cyber-green', shadow: 'shadow-[0_0_15px_rgba(0,255,65,0.3)]' },
        { border: 'border-cyber-purple', text: 'text-cyber-purple', line: 'bg-cyber-purple', dotActive: 'group-hover/card:bg-cyber-purple', shadow: 'shadow-[0_0_15px_rgba(188,19,254,0.3)]' },
        { border: 'border-yellow-400', text: 'text-yellow-400', line: 'bg-yellow-400', dotActive: 'group-hover/card:bg-yellow-400', shadow: 'shadow-[0_0_15px_rgba(250,204,21,0.3)]' },
        { border: 'border-pink-500', text: 'text-pink-500', line: 'bg-pink-500', dotActive: 'group-hover/card:bg-pink-500', shadow: 'shadow-[0_0_15px_rgba(236,72,153,0.3)]' },
    ];
    return colors[Math.abs(year) % colors.length];
};

const TimelineView: React.FC<TimelineViewProps> = ({ investigationId, onNavigateToNode }) => {
    const [events, setEvents] = useState<ParsedEvent[]>([]);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isDragging, setIsDragging] = useState(false);

    const pointerHistoryRef = useRef<{ t: number, x: number }[]>([]);
    const dragStartXRef = useRef(0);
    const dragStartTranslateXRef = useRef(0);
    const animationFrameRef = useRef<number | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLDivElement>(null);
    const translateXRef = useRef(0);
    const zoomLevelRef = useRef(zoomLevel);

    useEffect(() => {
        zoomLevelRef.current = zoomLevel;
        if (canvasRef.current) {
            canvasRef.current.style.transform = `translateX(${translateXRef.current}px) scale(${zoomLevel})`;
        }
    }, [zoomLevel]);

    // Auto focus container so arrow keys work instantly
    useEffect(() => {
        if (containerRef.current) containerRef.current.focus();
    }, []);

    // Clean up animation frame on unmount
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!investigationId) {
            setEvents([]);
            return;
        }

        const saved = localStorage.getItem(`inv_data_${investigationId}`);
        if (!saved) {
            setEvents([]);
            return;
        }

        try {
            const { nodes } = JSON.parse(saved);
            const extractedEvents: ParsedEvent[] = [];

            nodes.forEach((node: any) => {
                const nodeTitle = node.data?.title || 'Unknown Source';
                const insights = node.data?.personaInsights || [];

                insights.forEach((insight: any) => {
                    if (insight.timelineEvents && Array.isArray(insight.timelineEvents)) {
                        insight.timelineEvents.forEach((te: any) => {
                            extractedEvents.push({
                                timestamp: te.timestamp,
                                event: te.event,
                                sourceNodeId: te.sourceNodeId || node.id,
                                parsedDate: parseDateOrNull(te.timestamp),
                                nodeTitle
                            });
                        });
                    }
                });
            });

            // Sort events: known dates first (chronological), then unknown dates
            extractedEvents.sort((a, b) => {
                if (a.parsedDate !== null && b.parsedDate !== null) {
                    return a.parsedDate - b.parsedDate;
                }
                if (a.parsedDate !== null) return -1;
                if (b.parsedDate !== null) return 1;
                return 0; // retain original order for unknowns
            });

            // Deduplicate exact events to avoid clutter
            const uniqueEvents = extractedEvents.filter((ev, index, self) =>
                index === self.findIndex((t) => (
                    t.timestamp === ev.timestamp && t.event === ev.event
                ))
            );

            setEvents(uniqueEvents);
        } catch (err) {
            console.error('[TimelineView] Error parsing investigation data:', err);
            setEvents([]);
        }
    }, [investigationId]);

    useEffect(() => {
        const handleWheel = (e: WheelEvent) => {
            if (events.length === 0) return;

            // Determine if the scroll is primarily vertical or horizontal
            if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                // Vertical scrolling = Zoom
                e.preventDefault();
                let zDelta = e.deltaY * -0.0005;
                if (zDelta > 0.05) zDelta = 0.05;
                if (zDelta < -0.05) zDelta = -0.05;
                setZoomLevel(z => Math.min(Math.max(0.1, z + zDelta), 5));
            } else {
                // Horizontal scroll (trackpad)
                e.preventDefault();
                translateXRef.current -= e.deltaX;
                if (canvasRef.current) {
                    canvasRef.current.style.transform = `translateX(${translateXRef.current}px) scale(${zoomLevelRef.current})`;
                }
            }
        };
        const el = containerRef.current;
        if (el) {
            el.addEventListener('wheel', handleWheel, { passive: false });
        }
        return () => {
            if (el) {
                el.removeEventListener('wheel', handleWheel);
            }
        };
    }, [events.length]);

    if (!investigationId) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-cyber-black text-gray-500 font-mono text-sm tracking-widest">
                NO INVESTIGATION SELECTED
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <div className="w-full h-full flex flex-col items-center justify-center bg-cyber-black text-cyber-cyan font-mono text-sm gap-4">
                <AlertTriangle className="text-yellow-500 w-12 h-12 animate-pulse" />
                <div className="tracking-widest uppercase text-center">
                    <p>No timeline events extracted yet.</p>
                    <p className="text-[10px] text-gray-500 mt-2">The Timeline Analyst persona will automatically populate this view during data gathering.</p>
                </div>
            </div>
        );
    }

    const handlePointerDown = (e: React.PointerEvent) => {
        if (!containerRef.current) return;

        e.currentTarget.setPointerCapture(e.pointerId);

        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        setIsDragging(true);

        const now = performance.now();
        dragStartXRef.current = e.pageX;
        dragStartTranslateXRef.current = translateXRef.current;
        pointerHistoryRef.current = [{ t: now, x: e.pageX }];

        console.log('[TimelineView] Virtual Drag Started:', { startX: e.pageX, translateX: translateXRef.current });
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!isDragging) return;
        e.preventDefault();

        // 1:1 absolute math binds screen exactly to mouse travel
        const walk = e.pageX - dragStartXRef.current;
        translateXRef.current = dragStartTranslateXRef.current + walk;

        if (canvasRef.current) {
            canvasRef.current.style.transform = `translateX(${translateXRef.current}px) scale(${zoomLevelRef.current})`;
        }

        const now = performance.now();
        const history = pointerHistoryRef.current;
        history.push({ t: now, x: e.pageX });
        // Keep only points from the last 100ms
        pointerHistoryRef.current = history.filter(p => now - p.t < 100);
    };

    const handlePointerUpOrCancel = (e: React.PointerEvent) => {
        if (!isDragging) return;
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);

        const now = performance.now();
        const history = pointerHistoryRef.current.filter(p => now - p.t < 100);

        let velocity = 0;
        if (history.length > 1) {
            const oldest = history[0];
            const newest = history[history.length - 1];
            const dt = newest.t - oldest.t;
            if (dt > 0) {
                // Compute average velocity over the trailing 100ms window
                velocity = (newest.x - oldest.x) / dt;
            }
        }

        console.log(`[TimelineView] Virtual Drag Ended (${e.type}). Computed Velocity:`, velocity);

        if (Math.abs(velocity) > 0.05) {
            const applyInertia = () => {
                translateXRef.current += velocity * 16; // 16ms roughly 1 frame
                if (canvasRef.current) {
                    canvasRef.current.style.transform = `translateX(${translateXRef.current}px) scale(${zoomLevelRef.current})`;
                }

                velocity *= 0.92; // Slightly stronger friction to prevent gliding forever

                if (Math.abs(velocity) > 0.01) {
                    animationFrameRef.current = requestAnimationFrame(applyInertia);
                }
            };
            animationFrameRef.current = requestAnimationFrame(applyInertia);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!containerRef.current) return;
        const panAmount = 50 / zoomLevelRef.current; // Pan faster when zoomed out

        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            translateXRef.current += panAmount;
            if (canvasRef.current) {
                canvasRef.current.style.transform = `translateX(${translateXRef.current}px) scale(${zoomLevelRef.current})`;
            }
        } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            translateXRef.current -= panAmount;
            if (canvasRef.current) {
                canvasRef.current.style.transform = `translateX(${translateXRef.current}px) scale(${zoomLevelRef.current})`;
            }
        }
    };

    const { knownEvents, unknownEvents } = events.reduce((acc, ev) => {
        if (ev.parsedDate !== null) acc.knownEvents.push(ev);
        else acc.unknownEvents.push(ev);
        return acc;
    }, { knownEvents: [] as ParsedEvent[], unknownEvents: [] as ParsedEvent[] });

    return (
        <div className="w-full h-full relative bg-cyber-black flex flex-col font-mono overflow-hidden">
            {/* HUD Header */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
                <div className="flex items-center gap-2 px-6 py-2 bg-black border border-cyber-cyan text-cyber-cyan font-black uppercase tracking-widest text-xs shadow-[0_0_15px_rgba(0,243,255,0.3)]">
                    <Clock size={14} /> Chronological Timeline Analysis
                </div>
                <div className="flex items-center gap-3 border border-cyber-cyan/30 bg-black/90 px-3 py-1 rounded shadow-[0_0_10px_rgba(0,243,255,0.1)]">
                    <button onClick={() => setZoomLevel(z => Math.max(0.2, z - 0.2))} className="text-cyber-cyan hover:text-white transition-colors p-1" title="Zoom Out"><ZoomOut size={14} /></button>
                    <span className="text-cyber-cyan text-[10px] font-mono w-8 text-center select-none">{Math.round(zoomLevel * 100)}%</span>
                    <button onClick={() => setZoomLevel(z => Math.min(5, z + 0.2))} className="text-cyber-cyan hover:text-white transition-colors p-1" title="Zoom In"><ZoomIn size={14} /></button>
                </div>
            </div>

            {/* Main Timeline Virtual Canvas Area */}
            <div
                ref={containerRef}
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUpOrCancel}
                onPointerCancel={handlePointerUpOrCancel}
                onDragStart={(e) => e.preventDefault()}
                className={`flex-1 overflow-hidden touch-none relative bg-[linear-gradient(rgba(0,243,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,243,255,0.03)_1px,transparent_1px)] bg-[size:20px_20px] focus:outline-none focus:ring-1 focus:ring-cyber-cyan/30 ${isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'}`}
            >
                {/* Floating Canvas */}
                <div
                    ref={canvasRef}
                    className="absolute top-0 bottom-0 flex flex-col justify-center origin-left will-change-transform"
                    style={{ left: '50vw', transform: 'translateX(0px) scale(1)' }}
                >
                    <div className="flex items-center h-1 bg-cyber-cyan/30 shrink-0">
                        {/* Event Nodes on Timeline */}
                        {knownEvents.map((ev, i) => {
                            const isTop = i % 2 === 0;
                            const colors = getYearColor(ev.parsedDate);

                            return (
                                <div key={`ev-${i}`} className="relative group shrink-0 w-64 flex flex-col items-center group/card">
                                    {/* Dot on the line */}
                                    <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-black border-2 ${colors.border} z-10 transition-transform group-hover/card:scale-150 ${colors.dotActive} shadow-[0_0_10px_rgba(0,0,0,0.5)]`} />

                                    {/* Connector Line */}
                                    <div className={`absolute left-1/2 w-0.5 ${colors.line} opacity-40 h-24 ${isTop ? 'bottom-1/2 origin-bottom' : 'top-1/2 origin-top'} transition-all group-hover/card:opacity-100 group-hover/card:shadow-[0_0_10px_rgba(0,243,255,0.5)]`} />

                                    {/* Event Card */}
                                    <div
                                        onPointerDown={(e) => e.stopPropagation()}
                                        className={`absolute left-1/2 -translate-x-1/2 ${isTop ? 'bottom-[calc(50%+6rem)]' : 'top-[calc(50%+6rem)]'} w-64 bg-black/90 border ${colors.border} opacity-80 p-4 transition-all hover:bg-black hover:opacity-100 shadow-[0_0_10px_rgba(0,0,0,0.8)] hover:${colors.shadow} flex flex-col gap-2 z-20`}
                                    >
                                        <div className={`${colors.text} font-black text-[11px] tracking-widest uppercase border-b border-white/20 pb-1 break-words`}>
                                            {ev.timestamp}
                                        </div>
                                        <div className="text-gray-300 text-xs leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
                                            {ev.event}
                                        </div>
                                        <div className="mt-2 flex justify-between items-center text-[9px] text-gray-500 uppercase tracking-tighter pt-2 border-t border-white/10">
                                            <span className="truncate max-w-[150px]" title={ev.nodeTitle}>Ref: {ev.nodeTitle}</span>
                                            {onNavigateToNode && (
                                                <button
                                                    onClick={() => onNavigateToNode(ev.sourceNodeId)}
                                                    className="text-cyber-purple hover:text-white flex items-center gap-1"
                                                >
                                                    SOURCE <ArrowRight size={10} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Unknown Dates / Imprecise Tray */}
            {unknownEvents.length > 0 && (
                <div className="h-48 border-t border-cyber-purple/30 bg-black/80 flex flex-col shrink-0 p-4">
                    <h3 className="text-cyber-purple font-black text-[10px] uppercase tracking-widest mb-3 flex items-center gap-2">
                        <AlertTriangle size={12} /> Unknown or Imprecise Dates ({unknownEvents.length})
                    </h3>
                    <div className="flex-1 flex gap-4 overflow-x-auto pb-2 custom-scrollbar">
                        {unknownEvents.map((ev, i) => (
                            <div key={`unk-${i}`} className="w-64 shrink-0 bg-cyber-gray/30 border border-cyber-purple/30 p-3 hover:border-cyber-purple/80 transition-colors flex flex-col gap-1">
                                <span className="text-cyber-purple font-bold text-[10px] break-words">{ev.timestamp}</span>
                                <p className="text-gray-300 text-[11px] flex-1 overflow-y-auto custom-scrollbar leading-relaxed">
                                    {ev.event}
                                </p>
                                <div className="text-[9px] text-gray-500 uppercase flex justify-between items-center pt-1 mt-1 border-t border-cyber-purple/10">
                                    <span className="truncate max-w-[120px]" title={ev.nodeTitle}>{ev.nodeTitle}</span>
                                    {onNavigateToNode && (
                                        <button
                                            onClick={() => onNavigateToNode(ev.sourceNodeId)}
                                            className="text-cyber-purple hover:text-white flex items-center gap-1"
                                        >
                                            SOURCE <ArrowRight size={10} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TimelineView;
