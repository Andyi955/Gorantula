import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    BarChart3,
    Clock,
    Database,
    ExternalLink,
    FileText,
    Search,
    Tag,
    Zap,
    ZoomIn,
    ZoomOut,
    RotateCcw,
    SkipBack,
    SkipForward,
} from 'lucide-react';
import {
    loadBoardStateForInvestigation,
    saveBoardStateForInvestigation,
} from '../utils/investigationPersistence';
import type { PersistedBoardState, PersistedTimelineEvent, PersistedTimelineSnapshot } from '../utils/hierarchicalCanvas';
import { BOARD_WORKSPACE_STATE_UPDATED_EVENT } from '../utils/boardWorkspaceEvents';
import {
    buildTimelineSnapshotFromNodes,
    computeTimelineSourceFingerprint,
} from '../utils/timelineExtraction';

interface TimelineViewProps {
    investigationId: string | null;
    investigationTitle?: string | null;
    onNavigateToNode?: (nodeId: string) => void;
    qaTimelineDemoSnapshot?: PersistedTimelineSnapshot | null;
}

type TimelineProvenanceFilter = 'all' | PersistedTimelineEvent['provenance'];

interface TimelineFilters {
    startDate: string;
    endDate: string;
    provenance: TimelineProvenanceFilter;
    sourceNodeId: string;
    minConfidence: number;
}

const DEFAULT_TIMELINE_FILTERS: TimelineFilters = {
    startDate: '',
    endDate: '',
    provenance: 'all',
    sourceNodeId: 'all',
    minConfidence: 0,
};

const formatGeneratedAt = (value: string | null) => {
    if (!value) {
        return 'Not generated';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const formatDateRange = (events: PersistedTimelineEvent[]) => {
    const dated = events
        .filter((event) => event.parsedDate !== null)
        .map((event) => event.parsedDate as number);
    if (dated.length === 0) {
        return 'No dated events';
    }
    const formatCompactDate = (value: number) => new Date(value).toISOString().slice(0, 10);
    return `${formatCompactDate(Math.min(...dated))} -> ${formatCompactDate(Math.max(...dated))}`;
};

const getSourceCount = (events: PersistedTimelineEvent[]) =>
    new Set(events.map((event) => event.sourceNodeId)).size;

const getEventTone = (event: PersistedTimelineEvent) => {
    if (event.datePrecision === 'unknown') return 'unknown';
    if (event.provenance === 'persona') return 'persona';
    if (event.provenance === 'date-tag') return 'verified';
    return 'extracted';
};

const getEventStatusLabel = (event: PersistedTimelineEvent) => {
    const combinedText = `${event.sourceTitle} ${event.event}`.toLowerCase();
    if (event.datePrecision === 'unknown') return 'Unknown';
    if (combinedText.match(/\b(risk|security|warning|threat|breach|exposure)\b/)) return 'Risk';
    if (combinedText.match(/\b(regulation|policy|act|law|compliance|governance)\b/)) return 'Regulation';
    if (combinedText.match(/\b(research|paper|study|experiment|model)\b/)) return 'Research';
    if (combinedText.match(/\b(launch|released|release|deploy|debut)\b/)) return 'Launch';
    if (combinedText.match(/\b(partner|partnership|alliance|collaboration)\b/)) return 'Partnership';
    if (combinedText.match(/\b(market|earnings|analysis|analyst|forecast|outlook)\b/)) return 'Analysis';
    if (event.provenance === 'persona') return 'Insight';
    if (event.provenance === 'date-tag') return 'Verified';
    return 'Evidence';
};

const getDatePrecisionLabel = (event: PersistedTimelineEvent) => {
    if (event.datePrecision === 'day') return 'Exact Date';
    if (event.datePrecision === 'month') return 'Month';
    if (event.datePrecision === 'year') return 'Year';
    return 'Unknown Date';
};

const getProvenanceLabel = (event: PersistedTimelineEvent) => {
    if (event.provenance === 'persona') return 'Insight';
    if (event.provenance === 'date-tag') return 'Date Tag';
    return 'Text Match';
};

const getTimelineEventSizeClass = (event: PersistedTimelineEvent) => {
    const longTokens = event.event.match(/\[[^\]]+\]/g) || [];
    const estimatedLineWeight = event.event.length + longTokens.join('').length * 0.18;
    if (estimatedLineWeight >= 190) return 'forensic-timeline-event-extra-wide';
    if (estimatedLineWeight >= 120) return 'forensic-timeline-event-wide';
    return '';
};

const getEventConfidence = (event: PersistedTimelineEvent) => {
    if (event.datePrecision === 'day') return 95;
    if (event.datePrecision === 'month') return 72;
    if (event.datePrecision === 'year') return 50;
    return 15;
};

const getEventIcon = (event: PersistedTimelineEvent) => {
    const status = getEventStatusLabel(event);
    if (status === 'Analysis') return <BarChart3 size={16} aria-hidden="true" />;
    if (status === 'Launch' || status === 'Partnership') return <Zap size={16} aria-hidden="true" />;
    if (status === 'Research') return <Search size={16} aria-hidden="true" />;
    if (status === 'Regulation' || status === 'Verified') return <Tag size={16} aria-hidden="true" />;
    if (event.provenance === 'persona') return <Activity size={16} aria-hidden="true" />;
    return <FileText size={16} aria-hidden="true" />;
};

const formatDateInputValue = (value: number | null) => {
    if (value === null) {
        return '';
    }
    return new Date(value).toISOString().slice(0, 10);
};

const parseDateInputValue = (value: string, endOfDay = false) => {
    if (!value) {
        return null;
    }
    const parsed = Date.parse(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isNaN(parsed) ? null : parsed;
};

const timelineFiltersAreActive = (filters: TimelineFilters) =>
    filters.startDate !== DEFAULT_TIMELINE_FILTERS.startDate ||
    filters.endDate !== DEFAULT_TIMELINE_FILTERS.endDate ||
    filters.provenance !== DEFAULT_TIMELINE_FILTERS.provenance ||
    filters.sourceNodeId !== DEFAULT_TIMELINE_FILTERS.sourceNodeId ||
    filters.minConfidence !== DEFAULT_TIMELINE_FILTERS.minConfidence;

type TimelineMotionKind = 'entering' | 'reordering';

const TIMELINE_EVENT_MOTION_DURATION_MS = 1800;
const EMPTY_TIMELINE_EVENTS: PersistedTimelineEvent[] = [];

const prefersReducedMotion = () => (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
);

const eventMatchesFilters = (event: PersistedTimelineEvent, filters: TimelineFilters) => {
    if (filters.provenance !== 'all' && event.provenance !== filters.provenance) {
        return false;
    }
    if (filters.sourceNodeId !== 'all' && event.sourceNodeId !== filters.sourceNodeId) {
        return false;
    }
    if (getEventConfidence(event) < filters.minConfidence) {
        return false;
    }

    const start = parseDateInputValue(filters.startDate);
    const end = parseDateInputValue(filters.endDate, true);
    if (event.parsedDate === null) {
        return start === null && end === null;
    }
    if (start !== null && event.parsedDate < start) {
        return false;
    }
    if (end !== null && event.parsedDate > end) {
        return false;
    }
    return true;
};

const TimelineView: React.FC<TimelineViewProps> = ({
    investigationId,
    investigationTitle,
    onNavigateToNode,
    qaTimelineDemoSnapshot = null,
}) => {
    const [boardState, setBoardState] = useState<PersistedBoardState | null>(null);
    const [snapshot, setSnapshot] = useState<PersistedTimelineSnapshot | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [translateX, setTranslateX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [draftFilters, setDraftFilters] = useState<TimelineFilters>(() => ({ ...DEFAULT_TIMELINE_FILTERS }));
    const [appliedFilters, setAppliedFilters] = useState<TimelineFilters>(() => ({ ...DEFAULT_TIMELINE_FILTERS }));
    const [eventMotionById, setEventMotionById] = useState<Record<string, TimelineMotionKind>>({});

    const containerRef = useRef<HTMLDivElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const dragStartXRef = useRef(0);
    const dragStartTranslateXRef = useRef(0);
    const pointerHistoryRef = useRef<{ t: number; x: number }[]>([]);
    const animationFrameRef = useRef<number | null>(null);
    const motionCleanupTimeoutRef = useRef<number | null>(null);
    const zoomLevelRef = useRef(zoomLevel);
    const translateXRef = useRef(translateX);

    const clearEventMotion = useCallback(() => {
        if (motionCleanupTimeoutRef.current !== null) {
            window.clearTimeout(motionCleanupTimeoutRef.current);
            motionCleanupTimeoutRef.current = null;
        }
        setEventMotionById({});
    }, []);

    const markTimelineEventsForMotion = useCallback((motionEvents: PersistedTimelineEvent[], kind: TimelineMotionKind) => {
        if (prefersReducedMotion() || motionEvents.length === 0) {
            clearEventMotion();
            return;
        }

        if (motionCleanupTimeoutRef.current !== null) {
            window.clearTimeout(motionCleanupTimeoutRef.current);
            motionCleanupTimeoutRef.current = null;
        }

        setEventMotionById(Object.fromEntries(motionEvents.map((event) => [event.id, kind])));
        motionCleanupTimeoutRef.current = window.setTimeout(() => {
            setEventMotionById({});
            motionCleanupTimeoutRef.current = null;
        }, TIMELINE_EVENT_MOTION_DURATION_MS);
    }, [clearEventMotion]);

    const cancelViewportAnimation = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
    }, []);

    const resetViewport = useCallback(() => {
        cancelViewportAnimation();
        setZoomLevel(1);
        setTranslateX(0);
    }, [cancelViewportAnimation]);

    const clampTranslate = useCallback((value: number, zoom = zoomLevelRef.current) => {
        const container = containerRef.current;
        const track = trackRef.current;
        if (!container || !track) {
            return value;
        }

        const scaledTrackWidth = track.scrollWidth * zoom;
        const containerWidth = container.clientWidth;
        if (scaledTrackWidth <= containerWidth) {
            return 0;
        }

        const minTranslate = containerWidth - scaledTrackWidth;
        return Math.min(0, Math.max(minTranslate, value));
    }, []);

    const loadTimelineState = useCallback(async () => {
        if (!investigationId) {
            setBoardState(null);
            setSnapshot(null);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);
        try {
            const savedState = await loadBoardStateForInvestigation(investigationId);
            setBoardState(savedState);
            if (qaTimelineDemoSnapshot) {
                setSnapshot(qaTimelineDemoSnapshot);
                markTimelineEventsForMotion(qaTimelineDemoSnapshot.events, 'entering');
                return;
            }
            setSnapshot(savedState?.timelineSnapshot || null);
        } catch (loadError) {
            console.error('[TimelineView] Failed to load timeline board state:', loadError);
            setBoardState(null);
            setSnapshot(null);
            setError('Timeline board data is unavailable.');
        } finally {
            setIsLoading(false);
        }
    }, [investigationId, markTimelineEventsForMotion, qaTimelineDemoSnapshot]);

    useEffect(() => {
        setBoardState(null);
        setSnapshot(null);
        setError(null);
        clearEventMotion();
        setDraftFilters({ ...DEFAULT_TIMELINE_FILTERS });
        setAppliedFilters({ ...DEFAULT_TIMELINE_FILTERS });
        resetViewport();
        void loadTimelineState();
    }, [clearEventMotion, loadTimelineState, resetViewport]);

    useEffect(() => {
        if (!investigationId) {
            return undefined;
        }
        const handleBoardUpdate = () => {
            window.setTimeout(() => {
                void loadTimelineState();
            }, 0);
        };
        window.addEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardUpdate);
        return () => window.removeEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardUpdate);
    }, [investigationId, loadTimelineState]);

    useEffect(() => {
        zoomLevelRef.current = zoomLevel;
    }, [zoomLevel]);

    useEffect(() => {
        translateXRef.current = translateX;
    }, [translateX]);

    useEffect(() => {
        setTranslateX((current) => clampTranslate(current, zoomLevel));
    }, [clampTranslate, zoomLevel]);

    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (motionCleanupTimeoutRef.current !== null) {
                window.clearTimeout(motionCleanupTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const handleWheel = (event: WheelEvent) => {
            if (!snapshot || snapshot.events.length === 0) {
                return;
            }
            event.preventDefault();
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                const delta = Math.max(-0.05, Math.min(0.05, event.deltaY * -0.0005));
                setZoomLevel((current) => Math.min(Math.max(0.35, current + delta), 2.4));
            } else {
                setTranslateX((current) => clampTranslate(current - event.deltaX));
            }
        };

        const current = containerRef.current;
        current?.addEventListener('wheel', handleWheel, { passive: false });
        return () => current?.removeEventListener('wheel', handleWheel);
    }, [clampTranslate, snapshot]);

    const sourceFingerprint = useMemo(() => (
        boardState ? computeTimelineSourceFingerprint(boardState.nodes) : null
    ), [boardState]);

    const events = snapshot?.events || EMPTY_TIMELINE_EVENTS;
    const isQaTimelineDemoActive = Boolean(qaTimelineDemoSnapshot && snapshot?.sourceFingerprint === qaTimelineDemoSnapshot.sourceFingerprint);
    const isStale = Boolean(!isQaTimelineDemoActive && snapshot && sourceFingerprint && snapshot.sourceFingerprint !== sourceFingerprint);
    const filteredEvents = useMemo(() => (
        events.filter((event) => eventMatchesFilters(event, appliedFilters))
    ), [appliedFilters, events]);
    const knownEvents = filteredEvents.filter((event) => event.parsedDate !== null);
    const unknownEvents = filteredEvents.filter((event) => event.parsedDate === null);
    const hasUnknownEvents = unknownEvents.length > 0;
    const canJumpTimeline = Boolean(snapshot && knownEvents.length > 0);
    const dateRange = formatDateRange(filteredEvents);
    const sourceCount = getSourceCount(filteredEvents);
    const title = investigationTitle || 'Current Investigation';
    const actionLabel = snapshot ? 'Refresh Timeline' : 'Generate Timeline';
    const filtersActive = timelineFiltersAreActive(appliedFilters);
    const dateBounds = useMemo(() => {
        const dated = events
            .filter((event) => event.parsedDate !== null)
            .map((event) => event.parsedDate as number);
        if (dated.length === 0) {
            return { min: '', max: '' };
        }
        return {
            min: formatDateInputValue(Math.min(...dated)),
            max: formatDateInputValue(Math.max(...dated)),
        };
    }, [events]);
    const sourceOptions = useMemo(() => {
        const sources = new Map<string, string>();
        events.forEach((event) => {
            if (!sources.has(event.sourceNodeId)) {
                sources.set(event.sourceNodeId, event.sourceTitle);
            }
        });
        return Array.from(sources.entries())
            .map(([nodeId, sourceTitle]) => ({ nodeId, sourceTitle }))
            .sort((a, b) => a.sourceTitle.localeCompare(b.sourceTitle));
    }, [events]);
    const sourceBreakdown = useMemo(() => {
        const counts = new Map<string, { nodeId: string; title: string; count: number }>();
        filteredEvents.forEach((event) => {
            const current = counts.get(event.sourceNodeId);
            if (current) {
                current.count += 1;
                return;
            }
            counts.set(event.sourceNodeId, {
                nodeId: event.sourceNodeId,
                title: event.sourceTitle,
                count: 1,
            });
        });
        return Array.from(counts.values())
            .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
    }, [filteredEvents]);
    const getTimelineEventMotionClass = useCallback((event: PersistedTimelineEvent) => {
        const classes: string[] = [];
        if (eventMotionById[event.id] === 'entering') {
            classes.push('forensic-timeline-event-entering');
        }
        if (eventMotionById[event.id] === 'reordering') {
            classes.push('forensic-timeline-event-reordering');
        }
        return classes.join(' ');
    }, [eventMotionById]);

    const getMeterWidth = (count: number) => `${filteredEvents.length > 0 ? Math.max(7, (count / filteredEvents.length) * 100) : 0}%`;

    const applyFilters = () => {
        const nextVisibleEvents = events.filter((event) => eventMatchesFilters(event, draftFilters));
        setAppliedFilters(draftFilters);
        markTimelineEventsForMotion(nextVisibleEvents, 'reordering');
        resetViewport();
    };

    const resetFilters = () => {
        const nextFilters = { ...DEFAULT_TIMELINE_FILTERS };
        setDraftFilters(nextFilters);
        setAppliedFilters(nextFilters);
        markTimelineEventsForMotion(events, 'reordering');
        resetViewport();
    };

    const jumpToTimelineBoundary = useCallback((boundary: 'start' | 'end') => {
        cancelViewportAnimation();
        setTranslateX(clampTranslate(boundary === 'start' ? 0 : Number.NEGATIVE_INFINITY));
    }, [cancelViewportAnimation, clampTranslate]);

    const handleGenerateTimeline = useCallback(async () => {
        if (!investigationId) {
            return;
        }

        setIsGenerating(true);
        setError(null);
        try {
            const latestBoardState = boardState || await loadBoardStateForInvestigation(investigationId);
            const baseState: PersistedBoardState = latestBoardState || { mode: 'strict-grid', nodes: [], edges: [] };
            const nextSnapshot = buildTimelineSnapshotFromNodes(baseState.nodes);
            const nextState: PersistedBoardState = {
                ...baseState,
                timelineSnapshot: nextSnapshot,
            };
            setBoardState(nextState);
            setSnapshot(nextSnapshot);
            markTimelineEventsForMotion(nextSnapshot.events, 'entering');
            resetViewport();
            await saveBoardStateForInvestigation(investigationId, nextState);
        } catch (generateError) {
            console.error('[TimelineView] Failed to generate timeline:', generateError);
            setError('Timeline generation failed.');
        } finally {
            setIsGenerating(false);
        }
    }, [boardState, investigationId, markTimelineEventsForMotion, resetViewport]);

    const handlePointerDown = (event: React.PointerEvent) => {
        if (!snapshot || snapshot.events.length === 0) {
            return;
        }
        if (typeof event.currentTarget.setPointerCapture === 'function') {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        setIsDragging(true);
        const now = performance.now();
        dragStartXRef.current = event.pageX;
        dragStartTranslateXRef.current = translateXRef.current;
        pointerHistoryRef.current = [{ t: now, x: event.pageX }];
    };

    const handlePointerMove = (event: React.PointerEvent) => {
        if (!isDragging) {
            return;
        }
        event.preventDefault();
        setTranslateX(clampTranslate(dragStartTranslateXRef.current + event.pageX - dragStartXRef.current));
        const now = performance.now();
        pointerHistoryRef.current = [
            ...pointerHistoryRef.current,
            { t: now, x: event.pageX },
        ].filter((point) => now - point.t < 100);
    };

    const handlePointerUpOrCancel = (event: React.PointerEvent) => {
        if (!isDragging) {
            return;
        }
        setIsDragging(false);
        if (typeof event.currentTarget.releasePointerCapture === 'function') {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }

        const now = performance.now();
        const history = pointerHistoryRef.current.filter((point) => now - point.t < 100);
        if (history.length < 2) {
            return;
        }

        const oldest = history[0];
        const newest = history[history.length - 1];
        const dt = newest.t - oldest.t;
        let velocity = dt > 0 ? (newest.x - oldest.x) / dt : 0;
        if (Math.abs(velocity) <= 0.05) {
            return;
        }

        const applyInertia = () => {
            setTranslateX((current) => clampTranslate(current + velocity * 16));
            velocity *= 0.9;
            if (Math.abs(velocity) > 0.01) {
                animationFrameRef.current = requestAnimationFrame(applyInertia);
            }
        };
        animationFrameRef.current = requestAnimationFrame(applyInertia);
    };

    const handleKeyDown = (event: React.KeyboardEvent) => {
        if (!snapshot || snapshot.events.length === 0) {
            return;
        }
        const panAmount = 52 / zoomLevelRef.current;
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            setTranslateX((current) => clampTranslate(current + panAmount));
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            setTranslateX((current) => clampTranslate(current - panAmount));
        }
        if (event.key === 'Home' && knownEvents.length > 0) {
            event.preventDefault();
            jumpToTimelineBoundary('start');
        }
        if (event.key === 'End' && knownEvents.length > 0) {
            event.preventDefault();
            jumpToTimelineBoundary('end');
        }
    };

    if (!investigationId) {
        return (
            <section className="forensic-timeline-root forensic-board-root">
                <div className="forensic-timeline-empty">
                    <Clock size={22} />
                    <span>No Investigation Selected</span>
                </div>
            </section>
        );
    }

    return (
        <section className="forensic-timeline-root forensic-board-root" data-testid="timeline-view-root">
            <div className="forensic-timeline-frame">
                <header className="forensic-timeline-status-strip">
                    <div className="forensic-timeline-title-block">
                        <span>Chronology Analysis</span>
                        <strong title={title}>{title}</strong>
                    </div>
                    <div className="forensic-timeline-metrics" aria-label="Timeline metrics">
                        <div>
                            <span>Events</span>
                            <strong>{filtersActive ? `${filteredEvents.length}/${events.length}` : events.length}</strong>
                        </div>
                        <div>
                            <span>Sources</span>
                            <strong>{sourceCount}</strong>
                        </div>
                        <div>
                            <span>Date Span</span>
                            <strong title={dateRange}>{dateRange}</strong>
                        </div>
                        <div>
                            <span>Status</span>
                            <strong className={isStale ? 'forensic-timeline-warning-text' : ''}>
                                {isStale ? 'Needs Refresh' : snapshot ? 'Generated' : 'Ready'}
                            </strong>
                        </div>
                    </div>
                </header>

                <div className="forensic-timeline-command-bar">
                    <div className="forensic-timeline-command-copy">
                        <Database size={15} />
                        <span>{snapshot ? `Generated ${formatGeneratedAt(snapshot.generatedAt)}` : 'Manual board-data generation'}</span>
                    </div>
                    <div className="forensic-timeline-actions">
                        <button
                            type="button"
                            className="forensic-timeline-primary-button"
                            onClick={handleGenerateTimeline}
                            disabled={isGenerating || isLoading}
                        >
                            <RotateCcw size={15} />
                            {isGenerating ? 'Generating...' : actionLabel}
                        </button>
                        <button
                            type="button"
                            className="forensic-timeline-icon-button"
                            onClick={() => jumpToTimelineBoundary('start')}
                            title="Jump to beginning"
                            aria-label="Jump to beginning"
                            disabled={!canJumpTimeline}
                        >
                            <SkipBack size={15} />
                        </button>
                        <button
                            type="button"
                            className="forensic-timeline-icon-button"
                            onClick={() => jumpToTimelineBoundary('end')}
                            title="Jump to end"
                            aria-label="Jump to end"
                            disabled={!canJumpTimeline}
                        >
                            <SkipForward size={15} />
                        </button>
                        <button
                            type="button"
                            className="forensic-timeline-icon-button"
                            onClick={() => setZoomLevel((current) => Math.max(0.35, current - 0.15))}
                            title="Zoom out"
                            aria-label="Zoom out"
                            disabled={!snapshot || events.length === 0}
                        >
                            <ZoomOut size={15} />
                        </button>
                        <span className="forensic-timeline-zoom-readout">{Math.round(zoomLevel * 100)}%</span>
                        <button
                            type="button"
                            className="forensic-timeline-icon-button"
                            onClick={() => setZoomLevel((current) => Math.min(2.4, current + 0.15))}
                            title="Zoom in"
                            aria-label="Zoom in"
                            disabled={!snapshot || events.length === 0}
                        >
                            <ZoomIn size={15} />
                        </button>
                        <button
                            type="button"
                            className="forensic-timeline-icon-button"
                            onClick={resetViewport}
                            title="Recenter timeline"
                            aria-label="Recenter timeline"
                            disabled={!snapshot || events.length === 0}
                        >
                            <Clock size={15} />
                        </button>
                    </div>
                </div>

                {error ? (
                    <div className="forensic-timeline-alert">
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                ) : null}

                <div className="forensic-timeline-workspace">
                    <div className="forensic-timeline-main-stack">
                        {!snapshot ? (
                            <div className="forensic-timeline-empty">
                                <Clock size={26} />
                                <span>No Timeline Generated</span>
                                <p>Generate a chronology from this investigation's saved board evidence when you are ready.</p>
                            </div>
                        ) : events.length === 0 ? (
                            <div className="forensic-timeline-empty">
                                <AlertTriangle size={26} />
                                <span>No Timeline Events Found</span>
                                <p>This board does not contain dated evidence yet. Add dated evidence, then refresh the timeline.</p>
                            </div>
                        ) : filteredEvents.length === 0 ? (
                            <div className="forensic-timeline-empty">
                                <AlertTriangle size={26} />
                                <span>No Matching Timeline Events</span>
                                <p>Adjust the filters to bring more evidence back into the chronology.</p>
                            </div>
                        ) : (
                            <>
                                <div
                                    ref={containerRef}
                                    data-testid="timeline-canvas"
                                    tabIndex={0}
                                    className={`forensic-timeline-canvas ${isDragging ? 'forensic-timeline-canvas-dragging' : ''}`}
                                    onKeyDown={handleKeyDown}
                                    onPointerDown={handlePointerDown}
                                    onPointerMove={handlePointerMove}
                                    onPointerUp={handlePointerUpOrCancel}
                                    onPointerCancel={handlePointerUpOrCancel}
                                    onDragStart={(event) => event.preventDefault()}
                                >
                                    <div
                                        ref={trackRef}
                                        data-testid="timeline-track"
                                        className="forensic-timeline-track"
                                        style={{ transform: `translateX(${translateX}px) scale(${zoomLevel})` }}
                                    >
                                        <div className="forensic-timeline-spine" />
                                        {knownEvents.map((event, index) => (
                                            <article
                                                key={event.id}
                                                className={`forensic-timeline-event forensic-timeline-event-${getEventTone(event)} ${getTimelineEventSizeClass(event)} ${index % 2 === 0 ? 'forensic-timeline-event-top' : 'forensic-timeline-event-bottom'} ${getTimelineEventMotionClass(event)}`}
                                                style={{ '--timeline-event-stagger': `${Math.min(index * 70, 560)}ms` } as React.CSSProperties}
                                            >
                                                <div className="forensic-timeline-pin" />
                                                <div className="forensic-timeline-stem" />
                                                <div
                                                    className="forensic-timeline-event-card"
                                                    onPointerDown={(event) => event.stopPropagation()}
                                                >
                                                    <div className="forensic-timeline-event-card-head">
                                                        <div className="forensic-timeline-event-icon">{getEventIcon(event)}</div>
                                                        <div className="forensic-timeline-event-card-meta">
                                                            <div className="forensic-timeline-event-date">{event.timestamp}</div>
                                                            <span className={`forensic-timeline-event-status forensic-timeline-event-status-${getEventTone(event)}`}>
                                                                {getEventStatusLabel(event)}
                                                            </span>
                                                        </div>
                                                        <span className="forensic-timeline-card-open" aria-hidden="true">
                                                            <ExternalLink size={12} />
                                                        </span>
                                                    </div>
                                                    <h3 title={event.sourceTitle}>{event.sourceTitle}</h3>
                                                    <div className="forensic-timeline-event-tags" aria-label="Timeline event metadata">
                                                        <span>{getProvenanceLabel(event)}</span>
                                                        <span>{getDatePrecisionLabel(event)}</span>
                                                        <span>{getEventConfidence(event)}% Confidence</span>
                                                    </div>
                                                    <p>{event.event}</p>
                                                    <div className="forensic-timeline-event-footer">
                                                        <span title={event.sourceTitle}>Source: {event.sourceTitle}</span>
                                                        {onNavigateToNode ? (
                                                            <button
                                                                type="button"
                                                                aria-label={`Source ${event.sourceTitle}`}
                                                                onClick={() => onNavigateToNode(event.sourceNodeId)}
                                                            >
                                                                Source
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </article>
                                        ))}
                                    </div>
                                </div>

                                <aside className={`forensic-timeline-unknown-tray ${hasUnknownEvents ? '' : 'forensic-timeline-unknown-tray-compact'}`}>
                                    <div className="forensic-timeline-tray-heading">
                                        <AlertTriangle size={14} />
                                        <span>Unknown / Imprecise Dates</span>
                                        <strong>{unknownEvents.length}</strong>
                                    </div>
                                    {hasUnknownEvents ? (
                                        <div className="forensic-timeline-unknown-list">
                                            {unknownEvents.map((event, index) => (
                                                <article
                                                    key={event.id}
                                                    className={`forensic-timeline-unknown-card forensic-timeline-event-${getEventTone(event)} ${getTimelineEventMotionClass(event)} ${eventMotionById[event.id] === 'entering' ? 'forensic-timeline-unknown-card-entering' : ''}`}
                                                    style={{ '--timeline-event-stagger': `${Math.min(index * 60, 420)}ms` } as React.CSSProperties}
                                                >
                                                    <div className="forensic-timeline-unknown-head">
                                                        <div className="forensic-timeline-event-icon">{getEventIcon(event)}</div>
                                                        <div>
                                                            <strong>{event.timestamp}</strong>
                                                            <span>{getEventStatusLabel(event)}</span>
                                                        </div>
                                                        <ExternalLink size={12} aria-hidden="true" />
                                                    </div>
                                                    <h3 title={event.sourceTitle}>{event.sourceTitle}</h3>
                                                    <div className="forensic-timeline-event-tags" aria-label="Timeline event metadata">
                                                        <span>{getProvenanceLabel(event)}</span>
                                                        <span>{getDatePrecisionLabel(event)}</span>
                                                        <span>{getEventConfidence(event)}% Confidence</span>
                                                    </div>
                                                    <p>{event.event}</p>
                                                    <div className="forensic-timeline-unknown-footer">
                                                        <span title={event.sourceTitle}>Source: {event.sourceTitle}</span>
                                                        {onNavigateToNode ? (
                                                            <button
                                                                type="button"
                                                                aria-label={`Source ${event.sourceTitle}`}
                                                                onClick={() => onNavigateToNode(event.sourceNodeId)}
                                                            >
                                                                Source
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </article>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="forensic-timeline-unknown-empty-compact">All extracted events have usable dates.</div>
                                    )}
                                </aside>
                            </>
                        )}
                    </div>

                    <aside className="forensic-timeline-side-panel" aria-label="Timeline filters and sources">
                        <section className="forensic-timeline-side-section forensic-timeline-filter-section">
                            <div className="forensic-timeline-side-heading">
                                <span>Filters</span>
                                <strong>{filteredEvents.length}/{events.length}</strong>
                            </div>

                            <label className="forensic-timeline-filter-control">
                                <span>Date Range</span>
                                <div className="forensic-timeline-date-range">
                                    <input
                                        type="date"
                                        aria-label="Timeline start date"
                                        value={draftFilters.startDate}
                                        min={dateBounds.min}
                                        max={dateBounds.max}
                                        onChange={(event) => setDraftFilters((current) => ({ ...current, startDate: event.target.value }))}
                                        disabled={!snapshot || events.length === 0}
                                    />
                                    <input
                                        type="date"
                                        aria-label="Timeline end date"
                                        value={draftFilters.endDate}
                                        min={dateBounds.min}
                                        max={dateBounds.max}
                                        onChange={(event) => setDraftFilters((current) => ({ ...current, endDate: event.target.value }))}
                                        disabled={!snapshot || events.length === 0}
                                    />
                                </div>
                            </label>

                            <label className="forensic-timeline-filter-control">
                                <span>Event Type</span>
                                <select
                                    aria-label="Timeline event type"
                                    value={draftFilters.provenance}
                                    onChange={(event) => setDraftFilters((current) => ({
                                        ...current,
                                        provenance: event.target.value as TimelineProvenanceFilter,
                                    }))}
                                    disabled={!snapshot || events.length === 0}
                                >
                                    <option value="all">All Types</option>
                                    <option value="persona">Persona</option>
                                    <option value="date-tag">Date Tags</option>
                                    <option value="text-date">Text Dates</option>
                                </select>
                            </label>

                            <label className="forensic-timeline-filter-control">
                                <span>Sources</span>
                                <select
                                    aria-label="Timeline source"
                                    value={draftFilters.sourceNodeId}
                                    onChange={(event) => setDraftFilters((current) => ({ ...current, sourceNodeId: event.target.value }))}
                                    disabled={!snapshot || events.length === 0}
                                >
                                    <option value="all">All Sources</option>
                                    {sourceOptions.map((source) => (
                                        <option key={source.nodeId} value={source.nodeId}>{source.sourceTitle}</option>
                                    ))}
                                </select>
                            </label>

                            <label className="forensic-timeline-filter-control">
                                <span>Date Confidence</span>
                                <div className="forensic-timeline-confidence-row">
                                    <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        step="5"
                                        aria-label="Timeline date confidence"
                                        value={draftFilters.minConfidence}
                                        onChange={(event) => setDraftFilters((current) => ({
                                            ...current,
                                            minConfidence: Number(event.target.value),
                                        }))}
                                        disabled={!snapshot || events.length === 0}
                                    />
                                    <strong>{draftFilters.minConfidence}%</strong>
                                </div>
                            </label>

                            <div className="forensic-timeline-filter-actions">
                                <button
                                    type="button"
                                    onClick={applyFilters}
                                    disabled={!snapshot || events.length === 0}
                                >
                                    Apply Filters
                                </button>
                                <button
                                    type="button"
                                    onClick={resetFilters}
                                    disabled={!snapshot || events.length === 0 || (!filtersActive && !timelineFiltersAreActive(draftFilters))}
                                >
                                    Reset
                                </button>
                            </div>
                        </section>

                        <section className="forensic-timeline-side-section forensic-timeline-source-section">
                            <div className="forensic-timeline-side-heading">
                                <span>Source Overview</span>
                                <strong>{sourceCount}</strong>
                            </div>
                            {sourceBreakdown.length === 0 ? (
                                <div className="forensic-timeline-side-empty">No matching sources yet.</div>
                            ) : (
                                <div className="forensic-timeline-source-list">
                                    {sourceBreakdown.map((source) => (
                                        <div
                                            key={source.nodeId}
                                            data-testid={`timeline-source-row-${source.nodeId}`}
                                            className="forensic-timeline-source-row"
                                        >
                                            <span title={source.title}>{source.title}</span>
                                            <strong>{source.count}</strong>
                                            <div className="forensic-timeline-source-meter">
                                                <i style={{ width: getMeterWidth(source.count) }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </aside>
                </div>
            </div>
        </section>
    );
};

export default TimelineView;
