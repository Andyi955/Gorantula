import { Fragment, memo, useCallback, useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { NodeResizeControl, ResizeControlVariant } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import { ExternalLink, BookOpen, Search, ArrowRight, ChevronDown, ChevronUp, MessageCircle, X, ArrowRightToLine, CheckCircle, Trash2, Edit2, Save, Image as ImageIcon } from 'lucide-react';
import { BOARD_GRID_SIZE, MIN_NODE_HEIGHT, MIN_NODE_WIDTH, NODE_AUTO_MAX_WIDTH, NODE_FRAME_GRID_SIZE, NODE_IMAGE_PREVIEW_HEIGHT, calculateNodeFrame, getPortSlotsForDimensions } from './boardGeometry';
import type { BoardMode } from './boardGeometry';
import type { NodeImageAsset } from './nodeImages';
import { nodeHasImages } from './nodeImages';

// Persona insight type
export interface PersonaInsight {
    personaName: string;
    perspective: string;
    keyFindings: string[];
    observations?: string[];
    hypotheses?: string[];
    connections: string[];
    questions: string[];
    proposedConnections?: string[];
    confidence: number;
    fullAnalysis: string;
    nodeIDs?: string[];
    timelineEvents?: { timestamp: string, event: string, sourceNodeId: string }[];
}

export interface NodeData {
    id?: string;
    title?: string;
    summary?: string;
    fullText?: string;
    sourceURL?: string;
    images?: NodeImageAsset[];
    evidenceCount?: number;
    mergedSourceURLs?: string[];
    duplicateNodeIds?: string[];
    origin?: 'rabbit-hole' | string;
    rabbitState?: 'provisional' | 'promoted' | 'stale' | string;
    rabbitTool?: string;
    rabbitPass?: number;
    evidenceRole?: 'primary' | 'supporting' | string;
    supportCluster?: 'web' | 'vault' | 'timeline' | string;
    isSupportEvidenceCompact?: boolean;
    isSupportTetherSource?: boolean;
    isSupportTetherTarget?: boolean;
    confidence?: number;
    nodeKind?: 'discovery';
    discoveryClaim?: string;
    discoveryImpact?: string;
    discoveryConfidence?: number;
    sourceNodeIDs?: string[];
    isDeepDiveSource?: boolean;
    linkedInvestigationId?: string;
    portalKind?: 'merged-child';
    parentInvestigationId?: string;
    sourceVaultId?: string;
    sourceNodeId?: string;
    derivedFromMerge?: boolean;
    personaInsights?: PersonaInsight[]; // Full insight objects
    handleCounts?: {
        left: number;
        right: number;
        top: number;
        bottom: number;
    };
    activePortIds?: string[];
    onReadFull: () => void;
    onDeepDive?: (prompt: string, titleStr: string, sourceId: string) => void;
    onNavigateToChild?: (id: string, parentId?: string) => void;
    onExpand?: (nodeId: string, expanded: boolean) => void;
    onDelete?: (nodeId: string) => void;
    onUpdate?: (nodeId: string, data: Partial<NodeData>) => void;
    onSave?: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => void;
    onResizeCommit?: (nodeId: string, width: number, height: number) => void;
    onViewImages?: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => void;
    onAttachImage?: (nodeId: string, file: File) => Promise<void>;
    onRemoveImage?: (nodeId: string, imageId: string) => void;
    onSupportHover?: (nodeId: string, active: boolean) => void;
    expanded?: boolean;
    isRecentlyImported?: boolean;
    isConnectionHighlighted?: boolean;
    connectionHighlightColor?: string;
    nodeEntryAnimation?: 'evidence' | 'imported';
    nodeEntryDelayMs?: number;
    nodeEntryStartedAt?: number;
    isPersonaScanActive?: boolean;
    personaScanStartedAt?: number;
    isLayoutChoreographyActive?: boolean;
    layoutChoreographyStartedAt?: number;
    isTimelineFocused?: boolean;
    timelineFocusStartedAt?: number;
    returnVaultId?: string | null;
    currentInvestigationId?: string | null;
    sharedSocket?: WebSocket | null;
    onSetEditing?: (id: string | null) => void;
    isEditing?: boolean;
    isAnalyzing?: boolean;
    boardMode?: BoardMode;
}

export type NodeSaveMode = 'save' | 'analyze-and-save';

const escapeHTML = (text: string) => {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};

const parseHighlightedText = (text: string) => {
    if (!text) return 'Awaiting further analysis...';
    const safeText = escapeHTML(text);
    // Favor crisp emphasis over heavy glow so highlights stay readable at board zoom levels.
    let parsed = safeText.replace(/\*\*(.*?)\*\*/g, '<span class="text-cyber-green font-bold">$1</span>');
    
    // Keep entity chips high-contrast and edge-defined instead of bloom-heavy.
    parsed = parsed.replace(/\[PERSON:(.*?)\]/gi, '<span class="text-white font-black bg-cyber-purple/22 px-1.5 py-0.5 rounded border border-cyber-purple/55 text-[11px] uppercase tracking-tight">$1</span>');
    parsed = parsed.replace(/\[ORG:(.*?)\]/gi, '<span class="text-white font-black bg-cyber-cyan/20 px-1.5 py-0.5 rounded border border-cyber-cyan/55 text-[11px] uppercase tracking-tight">$1</span>');
    parsed = parsed.replace(/\[LOC:(.*?)\]/gi, '<span class="text-white font-black bg-orange-500/20 px-1.5 py-0.5 rounded border border-orange-500/55 text-[11px] uppercase tracking-tight">$1</span>');
    parsed = parsed.replace(/\[DATE:(.*?)\]/gi, '<span class="text-white font-black bg-yellow-500/20 px-1.5 py-0.5 rounded border border-yellow-500/55 text-[11px] uppercase tracking-tight">$1</span>');
    parsed = parsed.replace(/\[TIME:(.*?)\]/gi, '<span class="text-white font-black bg-yellow-400/20 px-1.5 py-0.5 rounded border border-yellow-400/55 text-[11px] uppercase tracking-tight">$1</span>');
    
    return parsed;
};

const SUPPORTING_EVIDENCE_PREVIEW_MAX_LENGTH = 320;
const SUPPORTING_EVIDENCE_PREVIEW_ENTITY_LIMIT = 3;
const EXPANDED_EVIDENCE_BRIEF_MAX_LENGTH = 1180;
const EXPANDED_EVIDENCE_SIGNAL_LIMIT = 4;
const EXPANDED_EVIDENCE_LINE_MAX_LENGTH = 210;
const SUPPORTING_EVIDENCE_ENTITY_STOP_WORDS = new Set([
    'active',
    'crawler result vault',
    'executive summary',
    'final summary',
    'intelligence report',
    'rabbit hole',
    'source',
    'summary',
]);

type SupportPreviewEntityTag = {
    token: string;
    value: string;
};

const stripSupportPreviewMarkup = (line: string) => line
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)]\((?:https?:\/\/|\/)[^)]+\)/gi, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[\s>#*-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeSupportEntityValue = (value: string) => stripSupportPreviewMarkup(value)
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const isUsableSupportEntityValue = (value: string) => {
    const normalized = normalizeSupportEntityValue(value);
    if (!normalized || normalized.length < 2) {
        return false;
    }

    const lower = normalized.toLowerCase();
    return !SUPPORTING_EVIDENCE_ENTITY_STOP_WORDS.has(lower)
        && !/^(?:rabbit|hole|timeline|context|source|report|summary)$/i.test(normalized)
        && /[a-z0-9]/i.test(normalized);
};

const getBracketSupportEntityTags = (text: string) => {
    const seen = new Set<string>();
    const tags: SupportPreviewEntityTag[] = [];
    const entityPattern = /\[(PERSON|ORG|LOC|DATE|TIME):([^\]]+)]/gi;

    Array.from(text.matchAll(entityPattern)).forEach((match) => {
        const type = match[1].toUpperCase();
        const value = normalizeSupportEntityValue(match[2] || '');
        if (!isUsableSupportEntityValue(value)) {
            return;
        }

        const key = `${type}:${value.toLowerCase()}`;
        if (seen.has(key)) {
            return;
        }

        seen.add(key);
        tags.push({ token: `[${type}:${value}]`, value });
    });

    return tags.slice(0, SUPPORTING_EVIDENCE_PREVIEW_ENTITY_LIMIT);
};

const getSupportEntityTags = (preview: string, source: string) => {
    return getBracketSupportEntityTags(`${preview}\n${source}`);
};

const applySupportEntityTags = (preview: string, source: string) => {
    let output = preview;
    const prefixTags: string[] = [];

    getSupportEntityTags(preview, source).forEach(({ token, value }) => {
        if (new RegExp(escapeRegExp(token), 'i').test(output)) {
            return;
        }

        const valuePattern = new RegExp(`\\b${escapeRegExp(value)}\\b`, 'i');
        if (valuePattern.test(output)) {
            output = output.replace(valuePattern, token);
            return;
        }

        prefixTags.push(token);
    });

    return [...prefixTags, output].join(' ').trim();
};

const capitalizeSupportPreviewLead = (text: string) => text.replace(
    /^((?:\[[A-Z]+:[^\]]+]\s*)*)([a-z])/,
    (_match, tagPrefix: string, firstLetter: string) => `${tagPrefix}${firstLetter.toUpperCase()}`,
);

const truncateSupportPreview = (text: string) => {
    if (text.length <= SUPPORTING_EVIDENCE_PREVIEW_MAX_LENGTH) {
        return text;
    }

    const slice = text.slice(0, SUPPORTING_EVIDENCE_PREVIEW_MAX_LENGTH + 1);
    const sentenceCut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('? '), slice.lastIndexOf('! '));
    if (sentenceCut > 140) {
        return slice.slice(0, sentenceCut + 1).trim();
    }

    const wordCut = slice.lastIndexOf(' ');
    return `${slice.slice(0, wordCut > 140 ? wordCut : SUPPORTING_EVIDENCE_PREVIEW_MAX_LENGTH).trim()}...`;
};

const truncateEvidenceLine = (text: string, limit = EXPANDED_EVIDENCE_LINE_MAX_LENGTH) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= limit) {
        return normalized;
    }

    const slice = normalized.slice(0, limit + 1);
    const wordCut = slice.lastIndexOf(' ');
    return `${slice.slice(0, wordCut > 120 ? wordCut : limit).trim()}...`;
};

const isExpandedBriefMetadataLine = (line: string) =>
    /^(?:source|sources?|url|query|rationale|rabbit tool|crawler result vault|raw digested facts|final summary|executive summary|intelligence report|report to|from|date|subject)\s*:?\s*/i.test(line) ||
    /^https?:\/\//i.test(line);

const looksLikeRepetitiveEvidenceDump = (sentence: string) => {
    const tokens = sentence.toLowerCase().match(/[a-z0-9]+/g) || [];
    if (tokens.length < 16) {
        return false;
    }

    const uniqueRatio = new Set(tokens).size / tokens.length;
    return uniqueRatio < 0.42;
};

const splitExpandedEvidenceSentences = (line: string) => {
    const matches = line.match(/[^.!?]+[.!?]?/g) || [line];
    return matches
        .map((sentence) => stripSupportPreviewMarkup(sentence))
        .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
        .filter((sentence) => sentence.length >= 48 && /[a-z0-9]/i.test(sentence) && !looksLikeRepetitiveEvidenceDump(sentence));
};

const extractExpandedEvidenceSignals = (text: string) => {
    const seen = new Set<string>();
    const signals: string[] = [];
    const normalizedSource = text
        .replace(/\r/g, '\n')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ');

    normalizedSource.split('\n').forEach((rawLine) => {
        const line = stripSupportPreviewMarkup(rawLine);
        if (!line || isExpandedBriefMetadataLine(line)) {
            return;
        }

        splitExpandedEvidenceSentences(line).forEach((sentence) => {
            const normalizedKey = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            if (!normalizedKey || seen.has(normalizedKey)) {
                return;
            }

            seen.add(normalizedKey);
            signals.push(truncateEvidenceLine(sentence));
        });
    });

    return signals;
};

const getExpandedEvidenceBriefText = (summary?: string, fullText?: string) => {
    const cleanedSummary = stripSupportPreviewMarkup(summary || '');
    const source = (fullText || summary || '').trim();
    if (!source) {
        return '';
    }

    const signals = extractExpandedEvidenceSignals(source);
    const summaryText = cleanedSummary || signals[0] || stripSupportPreviewMarkup(source);
    const uniqueSignals = signals
        .filter((signal) => signal.toLowerCase() !== summaryText.toLowerCase())
        .slice(0, EXPANDED_EVIDENCE_SIGNAL_LIMIT);

    const sections = [`**Brief**\n${truncateEvidenceLine(summaryText, 420)}`];
    if (uniqueSignals.length > 0) {
        sections.push(`**Evidence Signals**\n${uniqueSignals.map((signal) => `- ${signal}`).join('\n')}`);
    }

    const brief = sections.join('\n\n').trim();
    if (brief.length <= EXPANDED_EVIDENCE_BRIEF_MAX_LENGTH) {
        return brief;
    }

    return `${brief.slice(0, EXPANDED_EVIDENCE_BRIEF_MAX_LENGTH).replace(/\s+\S*$/, '').trim()}...`;
};

const getSupportingEvidencePreviewText = (summary?: string, fullText?: string) => {
    const source = (summary || fullText || '').trim();
    if (!source) {
        return '';
    }

    const normalizedSource = source
        .replace(/\r/g, '\n')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/https?:\/\/\S+/gi, ' ');
    const primaryLines: string[] = [];
    const fallbackLines: string[] = [];

    normalizedSource.split('\n').forEach((rawLine) => {
        let line = stripSupportPreviewMarkup(rawLine);
        if (!line) {
            return;
        }

        const rabbitContextMatch = line.match(/^Rabbit Hole\s+[^:]+:\s*(.+)$/i);
        if (rabbitContextMatch) {
            const topic = stripSupportPreviewMarkup(rabbitContextMatch[1].split('::')[0] || '');
            if (topic) {
                fallbackLines.push(topic);
            }
            return;
        }

        if (/^(?:crawler result vault|final summary|executive summary|intelligence report)\b/i.test(line)) {
            line = line
                .replace(/^(?:crawler result vault|final summary|executive summary|intelligence report)\b\s*:?\s*/i, '')
                .trim();
            line = stripSupportPreviewMarkup(line);
            if (!line || /^(?:report to|from|date|subject)\s*:/i.test(line)) {
                return;
            }
        }

        if (/^(?:report to|from|date|subject|source|sources?|url|query|rationale)\s*:/i.test(line)) {
            return;
        }

        line = line
            .replace(/\b(?:final summary|executive summary|intelligence report)\b\s*:?\s*/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        line = stripSupportPreviewMarkup(line);

        if (/[a-z0-9]/i.test(line)) {
            primaryLines.push(line);
        }
    });

    const preview = (primaryLines.length > 0 ? primaryLines : fallbackLines).join(' ').trim();
    return truncateSupportPreview(capitalizeSupportPreviewLead(applySupportEntityTags(
        preview || stripSupportPreviewMarkup(source),
        source,
    )));
};

const getGridAlignedHandleOffsets = (count: number, length: number) => {
    const safeCount = Math.max(1, count);
    const center = Math.round((length / 2) / BOARD_GRID_SIZE) * BOARD_GRID_SIZE;
    const offsets: number[] = [];
    let stepIndex = 0;

    if (safeCount % 2 === 1) {
        offsets.push(center);
    }

    while (offsets.length < safeCount) {
        stepIndex += 1;
        offsets.push(center - (stepIndex * BOARD_GRID_SIZE));

        if (offsets.length < safeCount) {
            offsets.push(center + (stepIndex * BOARD_GRID_SIZE));
        }
    }

    return offsets
        .sort((a, b) => a - b)
        .map((offset) => Math.max(BOARD_GRID_SIZE, Math.min(length - BOARD_GRID_SIZE, offset)));
};

const getVisibleStrictPortSlots = (
    slots: Array<{ id: string; offset: number }>,
    activePortIds: string[] | undefined,
) => {
    if (slots.length === 0) {
        return slots;
    }

    const activeIds = new Set(activePortIds || []);
    const defaultSlot = slots[Math.floor(slots.length / 2)];

    return slots.filter((slot) => slot.id === defaultSlot.id || activeIds.has(slot.id));
};

const isStrictPortVisible = (
    slotId: string,
    visibleSlots: Array<{ id: string }>,
) => visibleSlots.some((slot) => slot.id === slotId);

const logNodeResizeDebug = (nodeId: string | undefined, stage: string, payload: Record<string, unknown>) => {
    if (!import.meta.env.DEV) {
        return;
    }

    console.debug(`[CustomNode][Resize:${stage}]`, {
        nodeId,
        ...payload,
    });
};

type NodeResizeTelemetry = {
    width: number;
    height: number;
    direction?: number[];
};

const RESIZE_LINE_CLASS = 'forensic-node-resize-line-zone';
const RESIZE_HANDLE_CLASS = 'forensic-node-resize-corner-zone';
const RESIZE_LINE_STYLE: CSSProperties = { borderWidth: 0 };
const RESIZE_HANDLE_STYLE: CSSProperties = {
    width: 34,
    height: 34,
    borderRadius: 0,
    backgroundColor: 'transparent',
    border: '0',
};

const COLLAPSED_TEXT_MAX_HEIGHT = 'calc(8 * 1.65em + 0.75rem)';
const SUPPORTING_EVIDENCE_COMPACT_FRAME = {
    width: MIN_NODE_WIDTH,
    height: MIN_NODE_HEIGHT,
};
const isBackendServedImage = (path?: string) =>
    Boolean(path && /^https?:\/\/localhost:8080\/vault-assets\//i.test(path));
const BACKEND_IMAGE_MAX_RETRIES = 3;
const BACKEND_IMAGE_RETRY_DELAYS_MS = [600, 1200, 2400];

type NodeImageLoadState = 'idle' | 'loading' | 'loaded' | 'retrying' | 'error';

const withImageRetryParam = (path: string, attempt: number) => {
    if (attempt <= 0) {
        return path;
    }
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}gorantulaImageRetry=${attempt}`;
};

const logNodeImageDebug = (stage: string, payload: Record<string, unknown>) => {
    if (!import.meta.env.DEV || import.meta.env.MODE === 'test') {
        return;
    }
    console.debug(`[CustomNode][Image:${stage}]`, payload);
};

const logNodeInteractionDebug = (stage: string, payload: Record<string, unknown> = {}) => {
    if (!import.meta.env.DEV || import.meta.env.MODE === 'test') {
        return;
    }
    console.debug(`[CustomNode][Interaction:${stage}]`, payload);
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const getExternalNodeSourceURL = (sourceURL?: string) =>
    (sourceURL || '')
        .split(',')
        .map((source) => source.trim())
        .find((source) => /^https?:\/\//i.test(source)) || '';

const CustomNode = ({ data, selected, ...props }: NodeProps<NodeData> & { 
    returnVaultId?: string | null, 
    currentInvestigationId?: string | null, 
    sharedSocket?: WebSocket | null,
    onDeleteNode?: (id: string) => void,
    isEditing?: boolean,
    onSetEditing?: (id: string | null) => void,
    width?: number,
    height?: number,
}) => {
    // Read from props first (React Flow injection), then fallback to data object
    const returnVaultId = props.returnVaultId ?? data.returnVaultId;
    const currentInvestigationId = props.currentInvestigationId ?? data.currentInvestigationId;
    const sharedSocket = props.sharedSocket ?? data.sharedSocket;
    const onDeleteNode = props.onDeleteNode ?? data.onDelete;
    const onSaveNode = data.onSave;
    const onResizeCommit = data.onResizeCommit;
    const isEditing = props.isEditing ?? data.isEditing;
    const onSetEditing = props.onSetEditing ?? data.onSetEditing;

    const [isExpanded, setIsExpanded] = useState(data.expanded || false);
    const [showChat, setShowChat] = useState(false);
    const [hasPulled, setHasPulled] = useState(false);
    const [editText, setEditText] = useState(data.summary || data.fullText || '');
    const [editTitle, setEditTitle] = useState(data.title || '');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [isUploadingImage, setIsUploadingImage] = useState(false);
    const shellRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const detailTextRef = useRef<HTMLDivElement>(null);
    const chatContentRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const previewImageRef = useRef<HTMLImageElement>(null);
    const autoFitRequestRef = useRef<string | null>(null);
    const imageRetryTimeoutRef = useRef<number | null>(null);
    const [imageLoadState, setImageLoadState] = useState<NodeImageLoadState>('idle');
    const [imageRetryAttempt, setImageRetryAttempt] = useState(0);
    const reducedMotion = prefersReducedMotion();
    const externalSourceURL = getExternalNodeSourceURL(data.sourceURL);

    // Let the browser handle the smooth scrolling natively!
    // All we do is stop the event from bubbling up to React Flow to prevent canvas zooming.
    useEffect(() => {
        const el = chatContentRef.current;
        if (!el || !showChat) return;

        const handleWheel = (e: WheelEvent) => {
            // ONLY stop the propagation, but let the browser natively (and smoothly) scroll
            e.stopPropagation();
        };

        el.addEventListener('wheel', handleWheel);
        return () => el.removeEventListener('wheel', handleWheel);
    }, [showChat]);

    useEffect(() => {
        const shell = shellRef.current;
        const detail = detailTextRef.current;
        if (!shell || !detail || !isExpanded || isEditing || showDeleteConfirm) return;

        const handleWheel = (event: WheelEvent) => {
            if (detail.scrollHeight <= detail.clientHeight) {
                return;
            }

            event.stopPropagation();
            if (event.target instanceof Node && detail.contains(event.target)) {
                return;
            }

            event.preventDefault();
            const maxScrollTop = Math.max(0, detail.scrollHeight - detail.clientHeight);
            detail.scrollTop = Math.max(0, Math.min(maxScrollTop, detail.scrollTop + event.deltaY));
        };

        shell.addEventListener('wheel', handleWheel, { passive: false });
        return () => shell.removeEventListener('wheel', handleWheel);
    }, [isEditing, isExpanded, showDeleteConfirm]);

    // Sync edit state when entering edit mode or data updates
    useEffect(() => {
        if (isEditing) {
            setEditText(data.summary || data.fullText || '');
            setEditTitle(data.title || '');
        }
    }, [isEditing, data.fullText, data.summary, data.title]);

    const isSupportingEvidence = data.evidenceRole === 'supporting';
    const isCollapsedSupportingEvidence = isSupportingEvidence && !isExpanded;
    const fallbackFrame = isCollapsedSupportingEvidence
        ? SUPPORTING_EVIDENCE_COMPACT_FRAME
        : calculateNodeFrame(
            data.summary || '',
            data.fullText || '',
            isExpanded,
            nodeHasImages(data.images)
        );
    const frameWidth = typeof props.width === 'number' ? props.width : fallbackFrame.width;
    const frameHeight = typeof props.height === 'number' ? props.height : fallbackFrame.height;
    const isStrictGrid = data.boardMode === 'strict-grid';

    useEffect(() => {
        if (!data.id || !onResizeCommit || isEditing || showDeleteConfirm) {
            return;
        }

        const shellRect = shellRef.current?.getBoundingClientRect();
        const renderedWidth = typeof props.width === 'number' && props.width > 0
            ? props.width
            : shellRect && shellRect.width > 0
                ? shellRect.width
                : frameWidth;
        const renderedHeight = typeof props.height === 'number' && props.height > 0
            ? props.height
            : shellRect && shellRect.height > 0
                ? shellRect.height
                : frameHeight;
        const detail = detailTextRef.current;
        const hasCollapsedTextOverflow = Boolean(
            detail &&
            !isExpanded &&
            (
                (detail.clientHeight > 0 && detail.scrollHeight > detail.clientHeight + 2) ||
                (detail.clientWidth > 0 && detail.scrollWidth > detail.clientWidth + 2)
            )
        );
        const renderedWidthGridStep = Math.ceil(renderedWidth / NODE_FRAME_GRID_SIZE) * NODE_FRAME_GRID_SIZE;
        const overflowWidth = hasCollapsedTextOverflow && renderedWidth < NODE_AUTO_MAX_WIDTH
            ? Math.min(NODE_AUTO_MAX_WIDTH, renderedWidthGridStep + NODE_FRAME_GRID_SIZE)
            : renderedWidth;
        const nextWidth = Math.max(renderedWidth, fallbackFrame.width, overflowWidth);
        const nextHeight = Math.max(renderedHeight, fallbackFrame.height);

        if (nextWidth > renderedWidth + 1 || nextHeight > renderedHeight + 1) {
            const requestKey = `${data.id}:${Math.round(nextWidth)}:${Math.round(nextHeight)}`;
            if (autoFitRequestRef.current === requestKey) {
                return;
            }
            autoFitRequestRef.current = requestKey;
            onResizeCommit(data.id, nextWidth, nextHeight);
        } else {
            autoFitRequestRef.current = null;
        }
    });

    const strictPortSlots = getPortSlotsForDimensions(frameWidth, frameHeight);
    const visibleStrictTopSlots = getVisibleStrictPortSlots(strictPortSlots.top, data.activePortIds);
    const visibleStrictBottomSlots = getVisibleStrictPortSlots(strictPortSlots.bottom, data.activePortIds);
    const visibleStrictLeftSlots = getVisibleStrictPortSlots(strictPortSlots.left, data.activePortIds);
    const visibleStrictRightSlots = getVisibleStrictPortSlots(strictPortSlots.right, data.activePortIds);
    const topHandleOffsets = isStrictGrid
        ? strictPortSlots.top.map((slot) => slot.offset)
        : getGridAlignedHandleOffsets(data.handleCounts?.top || 0, frameWidth);
    const bottomHandleOffsets = isStrictGrid
        ? strictPortSlots.bottom.map((slot) => slot.offset)
        : getGridAlignedHandleOffsets(data.handleCounts?.bottom || 0, frameWidth);
    const leftHandleOffsets = isStrictGrid
        ? strictPortSlots.left.map((slot) => slot.offset)
        : getGridAlignedHandleOffsets(data.handleCounts?.left || 0, frameHeight);
    const rightHandleOffsets = isStrictGrid
        ? strictPortSlots.right.map((slot) => slot.offset)
        : getGridAlignedHandleOffsets(data.handleCounts?.right || 0, frameHeight);

    const handleExpand = () => {
        const newExpanded = !isExpanded;
        setIsExpanded(newExpanded);
        // Call the expand callback if provided
        if (data.onExpand && data.id) {
            data.onExpand(data.id, newExpanded);
        }
    };

    // Supporting evidence cards need a compact preview even when raw Rabbit Hole output is report-shaped.
    const collapsedSupportPreview = isCollapsedSupportingEvidence
        ? getSupportingEvidencePreviewText(data.summary, data.fullText)
        : '';
    const expandedEvidenceBrief = isExpanded
        ? getExpandedEvidenceBriefText(data.summary, data.fullText)
        : '';
    const displayContent = isCollapsedSupportingEvidence
        ? collapsedSupportPreview
        : isExpanded ? expandedEvidenceBrief || data.summary : data.summary;
    const images = data.images || [];
    const hasImages = nodeHasImages(images);
    const primaryImage = hasImages ? images[0] : null;
    const usesCompactSupportImage = Boolean(isCollapsedSupportingEvidence && primaryImage);
    const primaryImagePath = primaryImage?.path || '';
    const isBackendImage = isBackendServedImage(primaryImagePath);
    const previewImageSrc = primaryImagePath ? withImageRetryParam(primaryImagePath, isBackendImage ? imageRetryAttempt : 0) : '';
    const imageOverlayLabel = imageLoadState === 'retrying'
        ? 'Retrying evidence image'
        : imageLoadState === 'error'
            ? 'Image unavailable'
            : 'Loading evidence image';
    const isImported = data.title?.includes("[IMPORTED]") || data.id?.startsWith("imported-");
    const isPortalNode = data.portalKind === 'merged-child';
    const isDiscoveryNode = data.nodeKind === 'discovery';
    const isRabbitHoleNode = data.origin === 'rabbit-hole';
    const isRabbitHoleProvisional = isRabbitHoleNode && data.rabbitState === 'provisional';
    const rabbitStatusLabel = data.rabbitState === 'provisional'
        ? 'ACTIVE'
        : data.rabbitState === 'stale'
            ? 'STALE'
            : data.rabbitState === 'promoted'
                ? 'PROMOTED'
                : '';
    const rabbitToolTitle = data.rabbitTool
        ? `Rabbit Hole tool: ${data.rabbitTool}${data.rabbitPass ? `, pass ${data.rabbitPass}` : ''}`
        : 'Rabbit Hole evidence';
    const mergedEvidenceCount = Number.isFinite(data.evidenceCount || 0) ? Math.max(0, data.evidenceCount || 0) : 0;
    const hasMergedEvidence = mergedEvidenceCount > 1;
    const recentImportShellClass = data.isRecentlyImported
        ? 'ring-2 ring-amber-300/90 shadow-[0_0_0_2px_rgba(251,191,36,0.25),0_0_34px_rgba(245,158,11,0.34)]'
        : '';
    const connectionHighlightShellClass = data.isConnectionHighlighted
        ? 'forensic-node-connection-highlight'
        : '';
    const nodeEntryShellClass = data.nodeEntryAnimation
        ? `forensic-node-entry forensic-node-entry-${data.nodeEntryAnimation}`
        : '';
    const personaScanShellClass = data.isPersonaScanActive
        ? 'forensic-node-persona-scan'
        : '';
    const layoutChoreographyShellClass = data.isLayoutChoreographyActive
        ? 'forensic-node-layout-choreography'
        : '';
    const timelineFocusShellClass = data.isTimelineFocused
        ? 'forensic-node-timeline-focus'
        : '';
    const supportEvidenceShellClass = isSupportingEvidence
        ? 'forensic-node-supporting-evidence'
        : '';
    const expandedShellClass = isExpanded
        ? 'forensic-node-expanded'
        : '';
    const expandedOpaqueShellClass = isExpanded
        ? 'forensic-node-expanded-opaque'
        : '';
    const supportTetherSourceShellClass = data.isSupportTetherSource
        ? 'forensic-node-support-tether-source'
        : '';
    const supportTetherTargetShellClass = data.isSupportTetherTarget
        ? 'forensic-node-support-tether-target'
        : '';
    const connectionHighlightColor = data.connectionHighlightColor || '#8ee8ff';
    const nodeEntryDelay = Number.isFinite(data.nodeEntryDelayMs) ? Math.max(0, data.nodeEntryDelayMs || 0) : 0;
    const nodeShellToneClass = isPortalNode
        ? 'forensic-node-portal'
        : isDiscoveryNode
            ? 'forensic-node-discovery'
            : isImported
                ? 'forensic-node-imported'
                : isRabbitHoleProvisional
                    ? 'forensic-node-rabbit-provisional'
                : '';
    const nodeBadgeClass = isPortalNode
        ? 'forensic-badge border-fuchsia-300/40 bg-fuchsia-400/14 text-fuchsia-100'
        : isDiscoveryNode
            ? 'forensic-badge forensic-badge-warning'
            : 'forensic-badge forensic-badge-imported';
    const shellClassName = `forensic-node-shell ${nodeShellToneClass} flex h-full w-full min-w-[288px] flex-col rounded-[0.8rem] p-4 transition-colors duration-300 group relative overflow-visible ${selected ? 'ring-2 ring-cyber-cyan forensic-selection-ring' : ''} ${isEditing ? 'shadow-[0_0_0_1px_rgba(129,227,255,0.08),0_0_34px_rgba(129,227,255,0.12)]' : ''} ${recentImportShellClass} ${connectionHighlightShellClass} ${nodeEntryShellClass} ${personaScanShellClass} ${layoutChoreographyShellClass} ${timelineFocusShellClass} ${supportEvidenceShellClass} ${expandedShellClass} ${expandedOpaqueShellClass} ${supportTetherSourceShellClass} ${supportTetherTargetShellClass}`;
    const iconControlClass = 'forensic-node-control nodrag nowheel flex items-center justify-center rounded-md p-1 text-[rgba(201,216,229,0.62)] transition-all hover:border-[rgba(129,227,255,0.28)] hover:bg-[rgba(129,227,255,0.08)] hover:text-[var(--forensic-accent)]';
    const footerActionClass = 'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-tight transition-all';
    const footerPillClass = 'rounded-md border px-2.5 py-1 text-[10px] font-black uppercase tracking-tight transition-all';
    const detailMotionClassName = reducedMotion
        ? 'forensic-node-detail-motion forensic-node-detail-reduced-motion'
        : `forensic-node-detail-motion ${isExpanded ? 'forensic-node-detail-expanded' : 'forensic-node-detail-collapsed'}`;
    const supportCompactDetailClassName = isCollapsedSupportingEvidence
        ? `forensic-node-detail-support-compact ${usesCompactSupportImage ? 'forensic-node-detail-support-has-image' : ''}`
        : '';
    const expandedBriefDetailClassName = isExpanded
        ? 'forensic-node-expanded-brief'
        : '';
    const imagePreviewMotionClassName = reducedMotion
        ? 'forensic-node-image-reduced-motion'
        : `forensic-node-image-fade ${imageLoadState === 'loaded' ? 'forensic-node-image-loaded' : 'forensic-node-image-loading'} ${data.isAnalyzing ? 'forensic-node-image-analyzing' : ''}`;
    const imagePreviewClassName = usesCompactSupportImage
        ? `forensic-node-image forensic-node-support-image-thumb ${imagePreviewMotionClassName} nodrag nowheel group/image absolute right-1 top-1 z-20 overflow-hidden rounded-lg text-left transition-all hover:border-[rgba(129,227,255,0.42)] hover:shadow-[0_0_0_1px_rgba(129,227,255,0.22)] ${data.isAnalyzing ? 'opacity-30' : ''}`
        : `forensic-node-image ${imagePreviewMotionClassName} nodrag nowheel group/image relative mb-3 w-full shrink-0 overflow-hidden rounded-xl text-left transition-all hover:border-[rgba(129,227,255,0.34)] hover:shadow-[0_0_0_1px_rgba(129,227,255,0.18)] ${data.isAnalyzing ? 'opacity-30' : ''}`;
    const personaCardMotionClassName = reducedMotion
        ? 'forensic-persona-card-reduced-motion'
        : 'forensic-persona-card-reveal';
    const handleResizeStart = useCallback((_: unknown, params: NodeResizeTelemetry) => {
        logNodeResizeDebug(data.id, 'start', {
            selected,
            width: params.width,
            height: params.height,
            direction: params.direction,
        });
    }, [data.id, selected]);
    const handleResize = useCallback(() => {
        // Skip high-frequency move logging so devtools do not make resizing feel laggy.
    }, []);
    const handleResizeEnd = useCallback((_: unknown, params: NodeResizeTelemetry) => {
        logNodeResizeDebug(data.id, 'end', {
            selected,
            width: params.width,
            height: params.height,
            direction: params.direction,
        });
        if (data.id && onResizeCommit) {
            onResizeCommit(data.id, params.width, params.height);
        }
    }, [data.id, onResizeCommit, selected]);

    useEffect(() => {
        if (imageRetryTimeoutRef.current) {
            window.clearTimeout(imageRetryTimeoutRef.current);
            imageRetryTimeoutRef.current = null;
        }

        setImageRetryAttempt(0);
        setImageLoadState(primaryImage ? 'loading' : 'idle');
        if (primaryImage) {
            logNodeImageDebug('start', {
                nodeId: data.id,
                imageId: primaryImage.id,
                path: primaryImage.path,
                backendServed: isBackendImage,
            });
        }

        return () => {
            if (imageRetryTimeoutRef.current) {
                window.clearTimeout(imageRetryTimeoutRef.current);
                imageRetryTimeoutRef.current = null;
            }
        };
    }, [data.id, isBackendImage, primaryImage]);

    const handlePreviewImageLoad = useCallback(() => {
        if (!primaryImage) {
            return;
        }
        if (imageRetryTimeoutRef.current) {
            window.clearTimeout(imageRetryTimeoutRef.current);
            imageRetryTimeoutRef.current = null;
        }
        setImageLoadState('loaded');
        logNodeImageDebug('loaded', {
            nodeId: data.id,
            imageId: primaryImage.id,
            path: primaryImage.path,
            attempt: imageRetryAttempt,
        });
    }, [data.id, imageRetryAttempt, primaryImage]);

    useEffect(() => {
        const image = previewImageRef.current;
        if (!primaryImage || !image) {
            return;
        }
        if (image.complete && image.naturalWidth > 0) {
            handlePreviewImageLoad();
        }
    }, [handlePreviewImageLoad, previewImageSrc, primaryImage]);

    const handlePreviewImageError = () => {
        if (!primaryImage) {
            return;
        }

        if (isBackendImage && imageRetryAttempt < BACKEND_IMAGE_MAX_RETRIES) {
            const nextAttempt = imageRetryAttempt + 1;
            const delay = BACKEND_IMAGE_RETRY_DELAYS_MS[Math.min(imageRetryAttempt, BACKEND_IMAGE_RETRY_DELAYS_MS.length - 1)];
            setImageLoadState('retrying');
            logNodeImageDebug('retry', {
                nodeId: data.id,
                imageId: primaryImage.id,
                path: primaryImage.path,
                attempt: nextAttempt,
                delay,
            });
            if (imageRetryTimeoutRef.current) {
                window.clearTimeout(imageRetryTimeoutRef.current);
            }
            imageRetryTimeoutRef.current = window.setTimeout(() => {
                imageRetryTimeoutRef.current = null;
                setImageRetryAttempt(nextAttempt);
                setImageLoadState('loading');
            }, delay);
            return;
        }

        setImageLoadState('error');
        logNodeImageDebug('error', {
            nodeId: data.id,
            imageId: primaryImage.id,
            path: primaryImage.path,
            attempt: imageRetryAttempt,
        });
    };

    const handleSave = (mode: NodeSaveMode) => (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        logNodeInteractionDebug('save', { nodeId: data.id, titleLength: editTitle.length, textLength: editText.length, mode });
        if (onSaveNode && data.id) {
            onSaveNode(data.id, editTitle, editText, mode);
        }
        if (onSetEditing) onSetEditing(null);
    };

    const onCancel = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        logNodeInteractionDebug('cancel-edit', { nodeId: data.id });
        setEditText(data.summary || data.fullText || '');
        setEditTitle(data.title || '');
        if (onSetEditing) onSetEditing(null);
    };

    const handleAttachImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !data.id || !data.onAttachImage) {
            event.target.value = '';
            return;
        }

        setIsUploadingImage(true);
        try {
            await data.onAttachImage(data.id, file);
        } catch (error) {
            console.error('[CustomNode] Failed to attach image', error);
            alert(error instanceof Error ? error.message : 'Failed to attach image');
        } finally {
            setIsUploadingImage(false);
            event.target.value = '';
        }
    };

    return (
        <div
            ref={shellRef}
            data-testid="custom-node-shell"
            className={shellClassName}
            onMouseEnter={() => data.id && data.onSupportHover?.(data.id, true)}
            onMouseLeave={() => data.id && data.onSupportHover?.(data.id, false)}
            style={{
                width: '100%',
                height: '100%',
                minWidth: MIN_NODE_WIDTH,
                minHeight: MIN_NODE_HEIGHT,
                '--connection-highlight-color': connectionHighlightColor,
                '--node-entry-delay': `${nodeEntryDelay}ms`,
            } as CSSProperties}
        >
            {selected && (
                <>
                    <NodeResizeControl
                        position="right"
                        variant={ResizeControlVariant.Line}
                        className={RESIZE_LINE_CLASS}
                        minWidth={MIN_NODE_WIDTH}
                        minHeight={MIN_NODE_HEIGHT}
                        color="#00f3ff"
                        style={RESIZE_LINE_STYLE}
                        onResizeStart={handleResizeStart}
                        onResize={handleResize}
                        onResizeEnd={handleResizeEnd}
                    />
                    <NodeResizeControl
                        position="bottom"
                        variant={ResizeControlVariant.Line}
                        className={RESIZE_LINE_CLASS}
                        minWidth={MIN_NODE_WIDTH}
                        minHeight={MIN_NODE_HEIGHT}
                        color="#00f3ff"
                        style={RESIZE_LINE_STYLE}
                        onResizeStart={handleResizeStart}
                        onResize={handleResize}
                        onResizeEnd={handleResizeEnd}
                    />
                    <NodeResizeControl
                        position="bottom-right"
                        className={RESIZE_HANDLE_CLASS}
                        minWidth={MIN_NODE_WIDTH}
                        minHeight={MIN_NODE_HEIGHT}
                        color="#00f3ff"
                        style={RESIZE_HANDLE_STYLE}
                        onResizeStart={handleResizeStart}
                        onResize={handleResize}
                        onResizeEnd={handleResizeEnd}
                    />
                </>
            )}
            {isImported && (
                <div className={`absolute -top-2.5 -left-2 z-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${nodeBadgeClass}`}>
                    IMPORTED
                </div>
            )}
            {isPortalNode && (
                <div className={`absolute -top-2.5 -left-2 z-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${nodeBadgeClass}`}>
                    PORTAL
                </div>
            )}
            {isDiscoveryNode && (
                <div className={`absolute -top-2.5 -left-2 z-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${nodeBadgeClass}`}>
                    DISCOVERY
                </div>
            )}
            {isRabbitHoleNode && !isImported && !isPortalNode && !isDiscoveryNode && (
                <div
                    className="forensic-badge forensic-badge-rabbit-hole absolute -top-2.5 -left-2 z-50 flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em]"
                    title={rabbitToolTitle}
                >
                    {isRabbitHoleProvisional ? 'RABBIT TRAIL' : 'RABBIT HOLE'}
                    {rabbitStatusLabel && (
                        <span className="forensic-rabbit-state-pill">
                            {rabbitStatusLabel}
                        </span>
                    )}
                </div>
            )}
            {data.isDeepDiveSource && (
                <div className="absolute inset-0 bg-emerald-200/[0.035] animate-pulse pointer-events-none" />
            )}
            {data.isRecentlyImported && (
                <div className="absolute inset-0 pointer-events-none bg-[rgba(246,200,121,0.08)] animate-pulse" />
            )}

            {/* Professional Delete Confirmation Overlay */}
            {showDeleteConfirm && (
                <div 
                    className="forensic-board-dialog absolute inset-0 z-[100] flex flex-col items-center justify-center border border-red-400/45 bg-[linear-gradient(180deg,rgba(41,8,10,0.95),rgba(19,6,8,0.95))] p-4 backdrop-blur-md animate-in fade-in zoom-in duration-200 nodrag nowheel"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                    <Trash2 size={32} className="mb-2 text-red-300 animate-pulse" />
                    <h3 className="mb-4 text-center text-[11px] font-black uppercase tracking-[0.18em] text-white">Permanently Erase Evidence?</h3>
                    <div className="flex gap-3">
                        <button 
                            type="button"
                            onClick={(e) => { 
                                logNodeInteractionDebug('cancel-delete', { nodeId: data.id });
                                e.stopPropagation(); 
                                e.preventDefault();
                                setShowDeleteConfirm(false); 
                            }}
                            className="rounded-md border border-white/25 px-3 py-1.5 text-[9px] font-black uppercase tracking-tighter text-[var(--forensic-text-muted)] transition-all hover:border-white/45 hover:bg-white hover:text-black"
                        >
                            CANCEL
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { 
                                logNodeInteractionDebug('confirm-delete', { nodeId: data.id });
                                e.stopPropagation();
                                e.preventDefault(); 
                                if(onDeleteNode && data.id) {
                                    onDeleteNode(data.id); 
                                    setShowDeleteConfirm(false);
                                }
                            }}
                            className="rounded-md border border-red-300/35 bg-red-400/18 px-3 py-1.5 text-[9px] font-black uppercase tracking-tighter text-red-100 transition-all hover:bg-red-400 hover:text-black"
                        >
                            CONFIRM ERASE
                        </button>
                    </div>
                </div>
            )}
            {/* Dynamic Connection Handles - offset so they don't overlap z-indexes restricting drops */}

            {/* Top Handles */}
            {topHandleOffsets.map((offset, i) => {
                const strictSlot = strictPortSlots.top[i];
                const isVisible = !isStrictGrid || isStrictPortVisible(strictSlot.id, visibleStrictTopSlots);
                return (
                    <Fragment key={`top-${i}`}>
                        <Handle
                            key={`top-source-${i}`}
                            type="source"
                            id={isStrictGrid ? strictSlot.id : `port-top-${i}`}
                            position={Position.Top}
                            style={isStrictGrid ? { left: offset, opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none' } : { left: offset }}
                            className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair"
                        />
                        {isStrictGrid && (
                            <Handle key={`top-target-${i}`} type="target" id={strictSlot.id} position={Position.Top} style={{ left: offset, opacity: 0, pointerEvents: 'none' }} className="w-3 h-3" />
                        )}
                    </Fragment>
                );
            })}

            {/* Bottom Handles */}
            {bottomHandleOffsets.map((offset, i) => {
                const strictSlot = strictPortSlots.bottom[i];
                const isVisible = !isStrictGrid || isStrictPortVisible(strictSlot.id, visibleStrictBottomSlots);
                return (
                    <Fragment key={`bottom-${i}`}>
                        <Handle
                            key={`bottom-source-${i}`}
                            type="source"
                            id={isStrictGrid ? strictSlot.id : `port-bot-${i}`}
                            position={Position.Bottom}
                            style={isStrictGrid ? { left: offset, opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none' } : { left: offset }}
                            className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair"
                        />
                        {isStrictGrid && (
                            <Handle key={`bottom-target-${i}`} type="target" id={strictSlot.id} position={Position.Bottom} style={{ left: offset, opacity: 0, pointerEvents: 'none' }} className="w-3 h-3" />
                        )}
                    </Fragment>
                );
            })}

            {/* Left Handles */}
            {leftHandleOffsets.map((offset, i) => {
                const strictSlot = strictPortSlots.left[i];
                const isVisible = !isStrictGrid || isStrictPortVisible(strictSlot.id, visibleStrictLeftSlots);
                return (
                    <Fragment key={`left-${i}`}>
                        <Handle
                            key={`left-source-${i}`}
                            type="source"
                            id={isStrictGrid ? strictSlot.id : `port-left-${i}`}
                            position={Position.Left}
                            style={isStrictGrid ? { top: offset, opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none' } : { top: offset }}
                            className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair"
                        />
                        {isStrictGrid && (
                            <Handle key={`left-target-${i}`} type="target" id={strictSlot.id} position={Position.Left} style={{ top: offset, opacity: 0, pointerEvents: 'none' }} className="w-3 h-3" />
                        )}
                    </Fragment>
                );
            })}

            {/* Right Handles */}
            {rightHandleOffsets.map((offset, i) => {
                const strictSlot = strictPortSlots.right[i];
                const isVisible = !isStrictGrid || isStrictPortVisible(strictSlot.id, visibleStrictRightSlots);
                return (
                    <Fragment key={`right-${i}`}>
                        <Handle
                            key={`right-source-${i}`}
                            type="source"
                            id={isStrictGrid ? strictSlot.id : `port-right-${i}`}
                            position={Position.Right}
                            style={isStrictGrid ? { top: offset, opacity: isVisible ? 1 : 0, pointerEvents: isVisible ? 'auto' : 'none' } : { top: offset }}
                            className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair"
                        />
                        {isStrictGrid && (
                            <Handle key={`right-target-${i}`} type="target" id={strictSlot.id} position={Position.Right} style={{ top: offset, opacity: 0, pointerEvents: 'none' }} className="w-3 h-3" />
                        )}
                    </Fragment>
                );
            })}

            {/* Corner Accents */}
            <div className="absolute -top-1 -left-1 h-2 w-2 border-l-2 border-t-2 border-[rgba(145,225,255,0.75)]" />
            <div className="absolute -bottom-1 -right-1 h-2 w-2 border-b-2 border-r-2 border-[rgba(160,179,195,0.68)]" />

            <div className="flex flex-col flex-1 gap-2 min-h-0">
                {/* Header with Expand Button */}
                <div className="forensic-node-header flex shrink-0 items-center justify-between pb-2">
                    <div className="forensic-node-title flex-1 truncate text-[11px] font-black uppercase leading-none tracking-[0.18em]">
                        {isEditing ? (
                            <input
                                autoFocus
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full border border-[rgba(129,227,255,0.24)] bg-[rgba(5,10,15,0.86)] p-1.5 text-[12px] text-[var(--forensic-accent)] outline-none transition-colors focus:border-[rgba(129,227,255,0.52)]"
                            />
                        ) : (data.title || 'ARCHIVED_INTEL')}
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                        {!isEditing && !isPortalNode && !isDiscoveryNode && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        logNodeInteractionDebug('edit', { nodeId: data.id });
                                        if (onSetEditing) onSetEditing(data.id || null);
                                    }}
                                    className={iconControlClass}
                                    title="Edit Evidence"
                                >
                                    <Edit2 size={12} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        logNodeInteractionDebug('delete', { nodeId: data.id });
                                        setShowDeleteConfirm(true);
                                    }}
                                    className={`${iconControlClass} hover:border-red-300/30 hover:bg-red-400/10 hover:text-red-200`}
                                    title="Delete Evidence"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </>
                        )}
                    {/* Compact Pull Button */}
                    {returnVaultId && currentInvestigationId !== returnVaultId && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN && data.id) {
                                    sharedSocket.send(JSON.stringify({
                                        type: 'PULL_NODE',
                                        payload: {
                                            sourceVaultId: currentInvestigationId,
                                            sourceNodeId: data.id,
                                            targetVaultId: returnVaultId
                                        }
                                    }));
                                    setHasPulled(true);
                                    // Reset after showing feedback
                                    setTimeout(() => setHasPulled(false), 3000);
                                }
                            }}
                            title="IMPORT NODE: Bring this evidence back to your active investigation"
                            className={`forensic-node-control nodrag nowheel rounded-md p-1 transition-all ${
                                hasPulled 
                                    ? 'border-emerald-300/28 bg-emerald-300/14 text-emerald-100'
                                    : 'border-emerald-300/16 bg-emerald-300/8 text-emerald-200/80 hover:border-emerald-300/35 hover:bg-emerald-300/14 hover:text-emerald-100 animate-pulse-glow'
                            }`}
                        >
                            {hasPulled ? <CheckCircle size={16} /> : <ArrowRightToLine size={16} />}
                        </button>
                    )}

                    <button
                        onClick={handleExpand}
                        className="forensic-node-control nodrag nowheel rounded-md p-1 text-[var(--forensic-accent-muted)] transition-all hover:border-[rgba(129,227,255,0.2)] hover:bg-[rgba(129,227,255,0.08)] hover:text-white"
                        title={isExpanded ? "Collapse" : "Expand"}
                    >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>
            </div>

            {hasMergedEvidence && (
                <div
                    className="forensic-badge mb-1.5 flex w-fit shrink-0 items-center gap-1 rounded-md border-amber-200/28 bg-amber-200/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-amber-100"
                    title={`Squashed ${mergedEvidenceCount} duplicate evidence items into this card`}
                >
                    MERGED EVIDENCE {mergedEvidenceCount}
                </div>
            )}

            {isEditing && (
                <div className="forensic-node-edit-panel shrink-0 rounded-xl p-2 nodrag nowheel">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={handleAttachImage}
                    />
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent)]">Images</div>
                            <span className="forensic-badge rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.18em]">
                                Edit Mode
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={(event) => {
                                event.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                            disabled={isUploadingImage || !data.onAttachImage}
                            className="rounded-lg border border-[rgba(129,227,255,0.24)] bg-[rgba(129,227,255,0.08)] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent)] transition-colors hover:border-[rgba(129,227,255,0.48)] hover:bg-[rgba(129,227,255,0.16)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {isUploadingImage ? 'Uploading...' : 'Attach Image'}
                        </button>
                    </div>
                    {hasImages ? (
                        <div className="flex flex-wrap gap-2">
                            {images.map((image, index) => (
                                <div
                                    key={image.id}
                                    className="forensic-node-image flex items-center gap-2 rounded-lg px-2 py-1"
                                >
                                    <button
                                        type="button"
                                        className="text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--forensic-text-muted)] transition-colors hover:text-white"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            data.onViewImages?.(images, index, data.title, data.id);
                                        }}
                                    >
                                        {image.caption || `Image ${index + 1}`}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            if (data.id && data.onRemoveImage) {
                                                data.onRemoveImage(data.id, image.id);
                                            }
                                        }}
                                        className="text-[9px] font-black uppercase tracking-[0.16em] text-red-300 transition-colors hover:text-red-100"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-[10px] text-[var(--forensic-text-faint)]">No images attached yet.</div>
                    )}
                    <div className="mt-2 text-[9px] uppercase tracking-[0.16em] text-[var(--forensic-text-faint)]">
                        Image changes save directly. Re-analysis is only needed for text changes.
                    </div>
                </div>
            )}

            {/* Summary with Auto Flex */}
                <div
                    ref={contentRef}
                    className="relative group/text flex min-h-0 flex-1 flex-col pr-1 transition-all duration-300"
                >
                    <div className="flex-1 min-h-0 flex flex-col relative">
                        {isEditing ? (
                            <div className="flex h-full min-h-0 flex-col gap-2 pb-2">
                                <textarea
                                    autoFocus
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    className="custom-scrollbar nodrag nowheel min-h-0 w-full flex-1 border border-[rgba(129,227,255,0.18)] bg-[rgba(7,12,18,0.9)] p-3 font-mono text-[12px] text-[var(--forensic-text)] outline-none transition-colors focus:border-[rgba(129,227,255,0.45)]"
                                    placeholder="Enter evidence details..."
                                />
                            </div>
                        ) : (
                            <div className="relative flex-1 flex flex-col min-h-0">
                                {data.isAnalyzing && (
                                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 overflow-hidden bg-[rgba(4,9,14,0.7)]">
                                    <div className="absolute top-0 left-0 z-20 h-[2px] w-full bg-[var(--forensic-accent)] animate-scan" />
                                    <div className="flex items-center gap-2 text-[11px] font-black text-[var(--forensic-accent)] animate-pulse">
                                            <div className="h-1 w-1 rounded-full bg-[var(--forensic-accent)]" />
                                            IDENTIFYING ENTITIES...
                                        </div>
                                    </div>
                                )}
                                {primaryImage && (
                                    <button
                                        type="button"
                                        data-testid="node-image-preview"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            data.onViewImages?.(images, 0, data.title, data.id);
                                        }}
                                        className={imagePreviewClassName}
                                        style={usesCompactSupportImage ? undefined : { height: NODE_IMAGE_PREVIEW_HEIGHT }}
                                        title={images.length > 1 ? `View ${images.length} attached images` : 'View attached image'}
                                    >
                                        <img
                                            ref={previewImageRef}
                                            src={previewImageSrc}
                                            alt={primaryImage.caption || `Attached evidence for ${data.title || 'node'}`}
                                            crossOrigin="anonymous"
                                            onLoad={handlePreviewImageLoad}
                                            onError={handlePreviewImageError}
                                            className={`h-full w-full object-cover transition-opacity duration-300 ${imageLoadState === 'loaded' ? 'forensic-node-image-loaded opacity-100' : 'forensic-node-image-loading opacity-35'}`}
                                        />
                                        {imageLoadState !== 'loaded' && (
                                            <div className="pointer-events-none absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-2 bg-[rgba(4,9,14,0.62)] px-3 text-center text-[10px] font-black uppercase tracking-[0.16em] text-[var(--forensic-text-faint)]">
                                                <ImageIcon size={18} className="text-[var(--forensic-accent-muted)]" />
                                                {imageOverlayLabel}
                                            </div>
                                        )}
                                        <div className={usesCompactSupportImage
                                            ? 'absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-[rgba(4,9,14,0.94)] via-[rgba(4,9,14,0.58)] to-transparent px-1.5 py-1'
                                            : 'absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-[rgba(4,9,14,0.94)] via-[rgba(4,9,14,0.58)] to-transparent px-2 py-1.5'}
                                        >
                                            {!usesCompactSupportImage && (
                                                <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent)]">
                                                    <ImageIcon size={11} />
                                                    Visual Evidence
                                                </div>
                                            )}
                                            {usesCompactSupportImage && (
                                                <div className="flex items-center gap-1 text-[8px] font-black uppercase tracking-[0.12em] text-[var(--forensic-accent)]">
                                                    <ImageIcon size={10} />
                                                </div>
                                            )}
                                            {images.length > 1 && (
                                                <span
                                                    data-testid="node-image-count"
                                                    className={usesCompactSupportImage
                                                        ? 'rounded-full border border-white/12 bg-[rgba(8,14,20,0.9)] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-white'
                                                        : 'rounded-full border border-white/12 bg-[rgba(8,14,20,0.9)] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-white'}
                                                >
                                                    +{images.length - 1}
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                )}
                                <div
                                    ref={detailTextRef}
                                    data-testid="node-detail-motion"
                                    className={`forensic-node-text ${detailMotionClassName} ${supportCompactDetailClassName} ${expandedBriefDetailClassName} flex-1 whitespace-pre-wrap pr-2 pb-3 font-mono text-[12px] leading-[1.65] ${isExpanded ? 'overflow-y-auto custom-scrollbar' : 'overflow-hidden'} ${data.isAnalyzing ? 'opacity-30' : ''}`}
                                    style={isExpanded ? undefined : { maxHeight: COLLAPSED_TEXT_MAX_HEIGHT }}
                                    dangerouslySetInnerHTML={{
                                        __html: parseHighlightedText(displayContent || '')
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Persona Chat Icon - shows who discussed this card */}
                {!isDiscoveryNode && data.personaInsights && data.personaInsights.length > 0 && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowChat(true);
                        }}
                        className="forensic-node-control mt-1 flex h-6 w-6 items-center justify-center rounded-md border-amber-200/28 bg-amber-200/10 text-amber-100 transition-all duration-300 group/insight hover:border-amber-200/42 hover:bg-amber-200/16"
                        title="Review Specialist Insights"
                    >
                        <MessageCircle className="w-3 h-3 group-hover/insight:scale-110 transition-transform" />
                    </button>
                )}

                {/* Chat Modal */}
                {showChat && data.personaInsights && data.personaInsights.length > 0 && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowChat(false)}>
                        <div
                            className="forensic-node-chat-panel flex max-h-[85vh] w-full max-w-2xl flex-col rounded-[1.25rem] shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
                                <h3 className="text-lg font-bold text-white">Persona Discussion</h3>
                                <button onClick={() => setShowChat(false)} className="rounded-md border border-white/10 p-1 text-[var(--forensic-text-faint)] transition-colors hover:border-white/30 hover:text-white">
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <div
                                ref={chatContentRef}
                                className="p-4 overflow-y-auto flex-1 custom-scrollbar nowheel nodrag"
                                style={{ maxHeight: 'calc(85vh - 70px)', overflow: 'auto' }}
                            >
                                {data.personaInsights.map((insight, idx) => (
                                    <div
                                        key={idx}
                                        data-testid="persona-insight-card"
                                        className={`${personaCardMotionClassName} p-4 rounded-lg border ${insight.personaName === 'Skeptic' ? 'bg-red-500/10 border-red-400/30' :
                                            insight.personaName === 'Connector' ? 'bg-purple-500/10 border-purple-400/30' :
                                                insight.personaName === 'Timeline Analyst' ? 'bg-cyan-500/10 border-cyan-400/30' :
                                                    insight.personaName === 'Entity Hunter' ? 'bg-green-500/10 border-green-400/30' :
                                                        insight.personaName === 'Context Provider' ? 'bg-amber-500/10 border-amber-400/30' :
                                                            insight.personaName === 'Implications Mapper' ? 'bg-pink-500/10 border-pink-400/30' :
                                                                'bg-cyber-purple/10 border-cyber-purple/30'
                                            }`}
                                        style={{ '--persona-card-delay': reducedMotion ? '0ms' : `${idx * 90}ms` } as CSSProperties}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="font-bold text-white">{insight.personaName}</span>
                                            <span className="text-xs text-gray-400">• {insight.perspective}</span>
                                        </div>
                                        {insight.fullAnalysis && (
                                            <p className="text-sm text-gray-300 mb-3">{insight.fullAnalysis}</p>
                                        )}
                                        {insight.keyFindings && insight.keyFindings.length > 0 && (
                                            <div className="mb-2">
                                                <span className="text-xs font-semibold text-gray-400 uppercase">Key Findings</span>
                                                <ul className="mt-1 space-y-1">
                                                    {insight.keyFindings.map((finding, fidx) => (
                                                        <li key={fidx} className="text-sm text-gray-300 flex gap-2">
                                                            <span className="text-cyan-400">•</span>
                                                            {finding}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {insight.questions && insight.questions.length > 0 && (
                                            <div className="mt-2">
                                                <span className="text-xs font-semibold text-gray-400 uppercase">Questions Raised</span>
                                                <ul className="mt-1 space-y-1">
                                                    {insight.questions.map((q, qidx) => (
                                                        <li key={qidx} className="text-sm text-amber-300 flex gap-2">
                                                            <span className="text-amber-400">?</span>
                                                            {q}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        <div className="mt-2 text-xs text-gray-500">
                                            Confidence: {Math.round(insight.confidence * 100)}%
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Actions Footer */}
                <div className="forensic-node-footer mt-auto flex shrink-0 items-center justify-between pt-3">
                    <div className="flex gap-2 flex-wrap">
                        {!isPortalNode && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    data.onReadFull();
                                }}
                                className={`${footerActionClass} text-[var(--forensic-accent-muted)] hover:text-white`}
                                title="Open Dossier"
                            >
                                <BookOpen size={12} />
                                DOSSIER
                            </button>
                        )}

                        {data.linkedInvestigationId ? (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (data.onNavigateToChild) data.onNavigateToChild(data.linkedInvestigationId!, data.parentInvestigationId);
                                }}
                                className={`${footerPillClass} ${isPortalNode ? 'border-fuchsia-300/25 bg-fuchsia-400/12 text-fuchsia-100 hover:bg-fuchsia-300/18 hover:text-white' : 'border-[rgba(129,227,255,0.24)] bg-[rgba(129,227,255,0.08)] text-[var(--forensic-accent)] hover:bg-[rgba(129,227,255,0.16)] hover:text-white'}`}
                                title={isPortalNode ? 'Go to merged child canvas' : 'Go to detailed canvas'}
                            >
                                <ArrowRight size={12} />
                                {isPortalNode ? 'OPEN CHILD CANVAS' : 'OPEN SUB-FILE'}
                            </button>
                        ) : isDiscoveryNode ? (
                            <div className="forensic-badge forensic-badge-warning flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-tight">
                                CONFIDENCE {Math.round((data.discoveryConfidence || 0) * 100)}%
                            </div>
                        ) : (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (data.onDeepDive && data.id) {
                                        data.onDeepDive(data.fullText || data.summary || data.title || '', data.title || 'Unknown Entity', data.id);
                                    }
                                }}
                                disabled={data.isDeepDiveSource}
                                className={`${footerActionClass} ${data.isDeepDiveSource ? 'text-[var(--forensic-text-faint)]' : 'text-emerald-200 hover:text-white'}`}
                                title="Begin Deep Dive in New Canvas"
                            >
                                <Search size={12} />
                                {data.isDeepDiveSource ? 'SPAWNING...' : 'DEEP_DIVE'}
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        {isEditing && (
                            <>
                                <button
                                    onClick={onCancel}
                                    className="rounded-md border border-white/18 px-2 py-1 text-[9px] font-black uppercase tracking-tight text-[var(--forensic-text-faint)] transition-all hover:border-white/32 hover:bg-white/10 hover:text-white"
                                >
                                    CANCEL
                                </button>
                                <button
                                    onClick={handleSave('analyze-and-save')}
                                    className="flex items-center gap-1 rounded-md border border-[rgba(129,227,255,0.34)] bg-[rgba(129,227,255,0.08)] px-2 py-1 text-[9px] font-black uppercase tracking-tight text-[var(--forensic-accent)] transition-all hover:bg-[rgba(129,227,255,0.16)] hover:text-white"
                                >
                                    <Save size={10} />
                                    ANALYSE & SAVE
                                </button>
                                <button
                                    onClick={handleSave('save')}
                                    className="flex items-center gap-1 rounded-md border border-emerald-300/28 bg-emerald-300/12 px-2 py-1 text-[9px] font-black uppercase tracking-tight text-emerald-100 transition-all hover:bg-emerald-300/20 hover:text-white"
                                >
                                    <Save size={10} />
                                    SAVE
                                </button>
                            </>
                        )}
                        {!isPortalNode && !isDiscoveryNode && externalSourceURL && (
                            <a
                                href={externalSourceURL}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="forensic-node-source-link nodrag nowheel ml-1 text-[var(--forensic-text-faint)] transition-colors hover:text-[var(--forensic-accent)]"
                                title="Verify Source"
                            >
                                <ExternalLink size={12} />
                            </a>
                        )}
                    </div>
                </div>
            </div>


            {/* Status Indicator */}
            <div className="forensic-badge forensic-badge-verified absolute -top-2.5 -right-2 flex items-center gap-1 px-1.5 py-1">
                <div className="h-1 w-1 rounded-full bg-emerald-200 animate-pulse" />
                <span className="text-[8px] font-bold tracking-[0.14em]">VERIFIED</span>
            </div>
        </div>
    );
};

export default memo(CustomNode);
