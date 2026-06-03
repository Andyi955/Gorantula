import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import ReactFlow, {
    Background,
    BackgroundVariant,
    applyEdgeChanges,
    applyNodeChanges,
    addEdge,
    useReactFlow,
    useViewport,
    ReactFlowProvider,
    Position,
    reconnectEdge,
    ConnectionMode
} from 'reactflow';
import type {
    Node,
    Edge,
    OnNodesChange,
    OnEdgesChange,
    Connection,
    OnConnect,
    XYPosition,
    Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode, { type NodeData, type NodeSaveMode, type PersonaInsight } from './CustomNode';
import CustomEdge from './CustomEdge';
import { assignStrictGridPorts, BOARD_GRID_SIZE, buildStrictGridRoute, calculateNodeFrame, getNodeDimensions, getPortById, normalizeNodeFrame, snapCoordinateToGrid } from './boardGeometry';
import type { BoardMode } from './boardGeometry';
import type { NodeImageAsset } from './nodeImages';
import { nodeHasImages } from './nodeImages';
import { getLayoutedElements } from './detectiveBoardLayout';
import {
    getStrictGridLayoutedNodes,
    normalizeStrictGridNodes,
    STRICT_GRID_EDGE_Z_INDEX,
    STRICT_GRID_EXPANDED_NODE_Z_INDEX,
    STRICT_GRID_NODE_Z_INDEX,
} from './detectiveBoardStrictGridLayout';
import { type PersistedBoardState } from '../utils/hierarchicalCanvas';
import {
    getCachedBoardStateForInvestigation,
    getCachedInvestigations,
    getCachedVaultResultForInvestigation,
    loadBoardStateForInvestigation,
    loadRelationshipResultForInvestigation,
    saveBoardStateForInvestigation,
    saveVaultResultForInvestigation,
} from '../utils/investigationPersistence';
import { readImageScrapingPreference } from '../utils/searchPreferences';
import {
    createTagStyle,
    getRelationshipEdgeVisuals,
    sanitizeTagStyles,
    SUPPORTED_RELATIONSHIP_PATTERNS,
    SUPPORTED_RELATIONSHIP_SHAPES,
} from '../utils/relationshipStyles';
import type { RelationshipPattern, RelationshipShape, TagStyle } from '../utils/relationshipStyles';
import {
    BOARD_RESTORE_COMPLETE_EVENT,
    BOARD_TOGGLE_DISCOVERY_PANEL_EVENT,
    BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT,
    type BoardRestoreCompleteDetail,
    emitBoardWorkspaceEvent,
} from '../utils/boardWorkspaceEvents';
import {
    BROWSER_QA_ANIMATION_DEMO_EVENT,
    BROWSER_QA_ANIMATION_DEMO_PENDING_KEY,
    BROWSER_QA_DISCOVERY_DEMO_EVENT,
    BROWSER_QA_ERROR_EMPTY_DEMO_EVENT,
    BROWSER_QA_EVIDENCE_EXPANSION_DEMO_EVENT,
    BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT,
    BROWSER_QA_PIPELINE_DEMO_EVENT,
    BROWSER_QA_RABBIT_HOLE_DEMO_EVENT,
    BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT,
    BROWSER_QA_SYNTHESIS_DEMO_EVENT,
    BROWSER_QA_TIMELINE_DEMO_EVENT,
    type BrowserQaAnimationDemoDetail,
    type BrowserQaEvidenceExpansionDemoDetail,
    type BrowserQaRabbitHoleDemoDetail,
} from '../utils/browserQaSeed';
import type { InvestigationRecord } from '../utils/investigations';
import {
    buildSupportTethers,
    layoutSupportingEvidenceNodes,
    SUPPORT_NODE_FRAME,
    type SupportTether,
    type SupportingEvidenceBand,
} from './supportingEvidenceLayer';
import { getMiniMapNodeColor } from './detectiveBoardMinimap';

import { Zap, Info, Trash2, Edit2, Download, ChevronDown, ChevronUp, FileText, Image as ImageIcon, Box, PlusSquare, Grid3X3, Target, Move, SlidersHorizontal, Eye, ArrowLeft, Maximize2, Minimize2, Search, X, Lightbulb, Network, Crosshair, FlaskConical, PlayCircle, RadioTower, Activity, Clock, FileSearch, AlertTriangle, ExternalLink } from 'lucide-react';
const normalizeRelationshipTag = (tag?: string | null) => {
    const trimmed = (tag || '').trim();
    return trimmed ? trimmed.toUpperCase() : 'RELATED';
};

type RelationshipDisplayRule = {
    label: string;
    all?: string[];
    any?: string[];
};

const RELATIONSHIP_DISPLAY_RULES: RelationshipDisplayRule[] = [
    { label: 'Duplicate Evidence', any: ['DUPLICATE', 'DUPL', 'COPYCAT', 'MIRROR', 'REPEAT'] },
    { label: 'Contradiction', any: ['CONTRADICT', 'CONFLICT', 'INCONSIST', 'DISCREP', 'DISPUTED', 'MISMATCH'] },
    { label: 'Timeline Lead', any: ['PRECEDES', 'FOLLOWS', 'TIMELINE', 'MILESTONE', 'WINDOW', 'SEQUENCE', 'DELAY', 'PROGRESSION', 'SHIFT'] },
    { label: 'Evidence Match', any: ['REFERENCE', 'REFERS', 'CITES'] },
    { label: 'Trigger Event', any: ['IGNITION', 'TRIGGER', 'CATALYST', 'CAUSE'] },
    { label: 'Grid Threat', all: ['POWER', 'SWING'] },
    { label: 'Grid Threat', all: ['GRID', 'RISK'] },
    { label: 'Grid Threat', any: ['BROWNOUT', 'BLACKOUT'] },
    { label: 'Power Pressure', all: ['ELECTRICITY', 'PRICE'] },
    { label: 'Power Pressure', any: ['PRICE_HIKE', 'RATEPAYER', 'UTILITY_BILL'] },
    { label: 'Policy Trigger', any: ['POLICY', 'DIRECTIVE', 'REGULATION', 'REGULATORY', 'GOVERNANCE', 'DPA', 'NERC', 'WHITE_HOUSE', 'WH', 'TRUMP', 'SEC', 'LAW', 'ORDER', 'MANDATE'] },
    { label: 'Money Trail', any: ['PRICE', 'COST', 'FUNDING', 'INVESTMENT', 'MARKET', 'STOCK', 'BILL', 'BUDGET', 'REVENUE', 'MERGER', 'IPO', 'FINANCIAL'] },
    { label: 'Operator Response', any: ['DEMAND_RESPONSE', 'RESPONSE', 'CURTAILMENT', 'DISPATCH'] },
    { label: 'Operational Constraint', any: ['CONSTRAINT', 'BOTTLENECK', 'SHORTAGE'] },
    { label: 'Pressure Point', any: ['DEMAND', 'STRAIN', 'STRESS', 'CAPACITY', 'LOAD', 'PRESSURE'] },
    { label: 'Competing Interests', any: ['COMPETING', 'RIVAL', 'ALTERNATIVE', 'SOLUTION', 'VS', 'VERSUS'] },
    { label: 'Evidence Match', any: ['CORROBORAT', 'ALIGNMENT', 'MATCH', 'SHARED', 'SHARE', 'COMMON', 'SAME', 'EXEMPLIFIES'] },
    { label: 'Threat Level', any: ['RISK', 'THREAT', 'ALERT', 'WARNING', 'CRISIS', 'ESCALATION'] },
    { label: 'Breakthrough Lead', any: ['BREAKTHROUGH', 'MILESTONE', 'UNVEILED', 'LAUNCH', 'RELEASE', 'PROTOTYPE'] },
    { label: 'Hidden Connection', any: ['RELATED', 'CONNECTION', 'LINK', 'ASSOCIATION'] },
];

const RELATIONSHIP_DISPLAY_FILLER_TOKENS = new Set([
    'A',
    'AN',
    'AND',
    'THE',
    'TO',
    'OF',
    'FOR',
    'WITH',
    'BY',
    'FROM',
    'NODE',
    'NODES',
    'EDGE',
    'EVENT',
    'EVENTS',
]);

const RELATIONSHIP_DISPLAY_ACRONYMS = new Set([
    'AI',
    'US',
    'EU',
    'UK',
    'SEC',
    'DPA',
    'NERC',
    'IBM',
    'WH',
    'GPU',
    'CPU',
    'DDR5',
    'DDR6',
]);

const titleRelationshipToken = (token: string) => {
    if (RELATIONSHIP_DISPLAY_ACRONYMS.has(token) || /^[0-9]+$/.test(token)) {
        return token;
    }

    return token.charAt(0) + token.slice(1).toLowerCase();
};

const getRelationshipDisplayLabel = (tag?: string | null) => {
    const normalizedTag = normalizeRelationshipTag(tag);

    const matchingRule = RELATIONSHIP_DISPLAY_RULES.find((rule) => {
        const allMatch = !rule.all || rule.all.every((term) => normalizedTag.includes(term));
        const anyMatch = !rule.any || rule.any.some((term) => normalizedTag.includes(term));
        return allMatch && anyMatch;
    });

    if (matchingRule) {
        return matchingRule.label;
    }

    const tokens = normalizedTag
        .split(/[^A-Z0-9]+/)
        .filter((token) => token && !RELATIONSHIP_DISPLAY_FILLER_TOKENS.has(token))
        .slice(0, 3);

    if (tokens.length === 0) {
        return 'Hidden Connection';
    }

    return tokens.map(titleRelationshipToken).join(' ');
};

const getEdgeRawRelationshipTag = (edge: Edge) => normalizeRelationshipTag(
    typeof edge.data?.tag === 'string'
        ? edge.data.tag
        : typeof edge.label === 'string'
            ? edge.label
            : null
);

const getEdgeRelationshipDisplayLabel = (edge: Edge) => {
    const rawTag = getEdgeRawRelationshipTag(edge);

    if (typeof edge.data?.displayLabel === 'string' && edge.data.displayLabel.trim()) {
        return edge.data.displayLabel.trim();
    }

    if (edge.data?.generatedBy === 'connectTheDots') {
        return getRelationshipDisplayLabel(rawTag);
    }

    return typeof edge.label === 'string' && edge.label.trim() ? edge.label : rawTag;
};

type VisibleLegendStyle = {
    displayLabel: string;
    tag: string;
    tags: string[];
    style: TagStyle;
};

const shouldPreserveExistingFullText = (summary?: string, fullText?: string) =>
    Boolean(summary && fullText && summary !== fullText);

type NodeDossier = {
    title: string;
    summary: string;
    fullText: string;
    sourceURL?: string;
    origin?: string;
    rabbitTool?: string;
    rabbitPass?: number;
    evidenceRole?: string;
    images?: NodeImageAsset[];
};

type NodeDossierInput = {
    id?: string;
    title?: string;
    summary?: string;
    fullText?: string;
    sourceURL?: string;
    origin?: string;
    rabbitTool?: string;
    rabbitPass?: number;
    evidenceRole?: string;
    images?: readonly NodeImageAsset[];
};

type DossierBodyBlock = {
    kind: 'heading' | 'paragraph';
    text: string;
};

const DOSSIER_INLINE_URL_PATTERN = /(https?:\/\/[^\s,)\]]+|vault:\/\/[^\s,)\]]+|timeline:\/\/[^\s,)\]]+|rabbit:\/\/[^\s,)\]]+)/i;
const DOSSIER_ENTITY_PATTERN = /\[(PERSON|ORG|LOC|DATE|TIME):([^\]]+)]/i;
const DOSSIER_RICH_TEXT_PATTERN = new RegExp(
    `(${DOSSIER_INLINE_URL_PATTERN.source}|${DOSSIER_ENTITY_PATTERN.source})`,
    'gi'
);
const DOSSIER_HEADING_PATTERN = /^(#{1,4}\s*)?[A-Z0-9][A-Z0-9\s:/&().,'"-]{8,}$/;

const normalizeDossierText = (text?: string) =>
    (text || '')
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

const getDossierBrief = (summary?: string, fullText?: string) => {
    const source = normalizeDossierText(summary) || normalizeDossierText(fullText);
    if (!source) {
        return 'No dossier text has been captured for this evidence card yet.';
    }

    const firstParagraph = source.split(/\n{2,}/)[0] || source;
    const firstSentences = firstParagraph.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.slice(0, 2).join(' ').trim();
    const brief = firstSentences || firstParagraph;

    if (brief.length <= 420) {
        return brief;
    }

    return `${brief.slice(0, 416).trimEnd()}...`;
};

const getDossierBodyBlocks = (fullText?: string): DossierBodyBlock[] => {
    const normalized = normalizeDossierText(fullText);
    if (!normalized) {
        return [];
    }

    return normalized
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => {
            const singleLine = paragraph.replace(/\s+/g, ' ').trim();
            const heading = singleLine
                .replace(/^#{1,4}\s*/, '')
                .replace(/[_-]+/g, ' ')
                .trim();

            if (paragraph.split('\n').length === 1 && heading.length <= 110 && DOSSIER_HEADING_PATTERN.test(singleLine)) {
                return { kind: 'heading', text: heading };
            }

            return { kind: 'paragraph', text: paragraph };
        });
};

const getDossierSourceLinks = (dossier: NodeDossier) => {
    const explicitSources = [
        dossier.sourceURL,
        ...(dossier.images || []).map((image) => image.sourceURL || image.path),
    ];
    const textSources = normalizeDossierText(dossier.fullText).match(new RegExp(DOSSIER_INLINE_URL_PATTERN.source, 'gi')) || [];

    return Array.from(new Set(
        [...explicitSources, ...textSources]
            .flatMap((source) => (source || '').split(','))
            .map((source) => source.trim())
            .filter(Boolean)
    ));
};

const isDossierLink = (text: string) => DOSSIER_INLINE_URL_PATTERN.test(text);

const getDossierEntityClassName = (type: string) => {
    switch (type.toUpperCase()) {
        case 'PERSON':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-person';
        case 'ORG':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-org';
        case 'LOC':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-loc';
        case 'DATE':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-date';
        case 'TIME':
            return 'forensic-dossier-entity-chip forensic-dossier-entity-time';
        default:
            return 'forensic-dossier-entity-chip';
    }
};

const formatDossierMetaLabel = (value?: string | number) =>
    String(value || '')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());

const renderDossierTextWithLinks = (text: string) => {
    const fragments: React.ReactNode[] = [];
    let lastIndex = 0;

    Array.from(text.matchAll(DOSSIER_RICH_TEXT_PATTERN)).forEach((match, index) => {
        const token = match[0];
        const tokenIndex = match.index ?? 0;

        if (tokenIndex > lastIndex) {
            fragments.push(
                <React.Fragment key={`text-${index}-${lastIndex}`}>
                    {text.slice(lastIndex, tokenIndex)}
                </React.Fragment>
            );
        }

        if (isDossierLink(token)) {
            fragments.push(
                <a
                    key={`link-${index}-${tokenIndex}`}
                    href={token}
                    target="_blank"
                    rel="noreferrer"
                    className="forensic-dossier-inline-link"
                >
                    {token}
                </a>
            );
        } else {
            const entityMatch = token.match(DOSSIER_ENTITY_PATTERN);
            if (entityMatch) {
                fragments.push(
                    <span
                        key={`entity-${index}-${tokenIndex}`}
                        className={getDossierEntityClassName(entityMatch[1])}
                    >
                        {entityMatch[2]}
                    </span>
                );
            }
        }

        lastIndex = tokenIndex + token.length;
    });

    if (lastIndex < text.length) {
        fragments.push(
            <React.Fragment key={`text-tail-${lastIndex}`}>
                {text.slice(lastIndex)}
            </React.Fragment>
        );
    }

    if (fragments.length === 0) {
        return text;
    }

    return fragments;
};

const mergeEvidenceEdges = (currentEdges: Edge[], incomingEdges: Edge[]) => {
    const persistedEdges = currentEdges.filter((edge) => edge.data?.generatedBy !== 'discovery');
    const persistedEdgeIds = new Set(persistedEdges.map((edge) => edge.id));
    const incomingById = new Map(incomingEdges.map((edge) => [edge.id, edge]));

    const mergedEdges = persistedEdges.map((edge) => incomingById.get(edge.id) || edge);
    incomingEdges.forEach((edge) => {
        if (!persistedEdgeIds.has(edge.id)) {
            mergedEdges.push(edge);
        }
    });

    return mergedEdges;
};

const edgeTouchesPendingNode = (edge: Edge, pendingNodeIdSet: Set<string>) =>
    pendingNodeIdSet.has(edge.source) || pendingNodeIdSet.has(edge.target);

const fileToDataURL = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
        if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
        }

        reject(new Error('Failed to read file as data URL.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
    reader.readAsDataURL(file);
});

const mergeIncrementalEvidenceEdges = (currentEdges: Edge[], incomingEdges: Edge[], pendingNodeIds: string[]) => {
    const pendingNodeIdSet = new Set(pendingNodeIds);
    const preservedEdges = currentEdges.filter((edge) => {
        if (edge.data?.generatedBy === 'discovery') {
            return false;
        }

        if (edge.data?.generatedBy !== 'connectTheDots') {
            return true;
        }

        return !edgeTouchesPendingNode(edge, pendingNodeIdSet);
    });

    const preservedEdgeIds = new Set(preservedEdges.map((edge) => edge.id));
    const mergedEdges = [...preservedEdges];

    incomingEdges.forEach((edge) => {
        if (!preservedEdgeIds.has(edge.id)) {
            mergedEdges.push(edge);
        }
    });

    return mergedEdges;
};

type AnalysisMode = 'full' | 'incremental' | null;

type RelationshipConnection = {
    source: string;
    target: string;
    label?: string;
    tag?: string;
    confidence?: number;
    reasoning?: string;
    vaultId?: string;
    type?: string;
    [key: string]: unknown;
};

type ConnectionsFoundPayload = {
    connections: RelationshipConnection[];
    vaultId?: string;
};

const coerceConnectionsFoundPayload = (payload: unknown): ConnectionsFoundPayload => {
    if (Array.isArray(payload)) {
        return { connections: payload as RelationshipConnection[] };
    }

    if (payload && typeof payload === 'object') {
        const candidate = payload as { connections?: unknown; vaultId?: unknown };
        return {
            connections: Array.isArray(candidate.connections) ? candidate.connections as RelationshipConnection[] : [],
            vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId.trim() : undefined,
        };
    }

    return { connections: [] };
};

const connectionVaultId = (connection: RelationshipConnection) =>
    typeof connection?.vaultId === 'string' ? connection.vaultId.trim() : '';

const hasConnectTheDotsEdges = (edges: Edge[]) =>
    edges.some((edge) => edge.data?.generatedBy === 'connectTheDots');

const isVisibleBoardRelationshipEdge = (edge: Edge) =>
    edge.hidden !== true &&
    edge.data?.generatedBy !== 'discovery' &&
    edge.data?.generatedBy !== 'supportEvidenceTether';

const hasVisibleBoardRelationshipEdges = (edges: Edge[]) =>
    edges.some(isVisibleBoardRelationshipEdge);

const hasPersistedStrictGridRoute = (edge: Edge) =>
    !isVisibleBoardRelationshipEdge(edge) ||
    (
        typeof edge.sourceHandle === 'string' &&
        edge.sourceHandle.trim().length > 0 &&
        typeof edge.targetHandle === 'string' &&
        edge.targetHandle.trim().length > 0 &&
        Array.isArray(edge.data?.routePoints) &&
        edge.data.routePoints.length >= 2
    );

const attachRestoredActivePorts = (nodes: Node[], edges: Edge[]) => {
    const activePortIdsByNode = new Map<string, Set<string>>();

    edges.filter(isVisibleBoardRelationshipEdge).forEach((edge) => {
        if (edge.sourceHandle) {
            if (!activePortIdsByNode.has(edge.source)) {
                activePortIdsByNode.set(edge.source, new Set<string>());
            }
            activePortIdsByNode.get(edge.source)?.add(edge.sourceHandle);
        }

        if (edge.targetHandle) {
            if (!activePortIdsByNode.has(edge.target)) {
                activePortIdsByNode.set(edge.target, new Set<string>());
            }
            activePortIdsByNode.get(edge.target)?.add(edge.targetHandle);
        }
    });

    return nodes.map((node) => ({
        ...node,
        data: {
            ...node.data,
            activePortIds: Array.from(activePortIdsByNode.get(node.id) || []),
        },
    }));
};

interface DetectiveBoardProps {
    investigationId: string | null;
    returnVaultId?: string | null;
    sharedSocket: WebSocket | null;
    onDeepDiveNode: (prompt: string, titleStr: string, sourceNodeId: string) => void;
    onNavigateToChild: (id: string, parentId?: string) => void;
    focusNodeId?: string | null;
    onReturnToParent?: () => void;
    isMergedChild?: boolean;
    hasTheoryReady?: boolean;
    hasUnreadTheory?: boolean;
    hasDiscoveryReady?: boolean;
    hasUnreadDiscoveries?: boolean;
}

interface MarqueeState {
    active: boolean;
    start: XYPosition;
    current: XYPosition;
    screenStart: XYPosition;
    screenCurrent: XYPosition;
}

interface ImageLightboxState {
    images: NodeImageAsset[];
    nodeTitle?: string;
    index: number;
    nodeId?: string;
}

const getMarqueeRect = (start: XYPosition, current: XYPosition) => ({
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
});

const doesNodeIntersectRect = (node: Node, rect: ReturnType<typeof getMarqueeRect>) => {
    const measuredNode = node as Node & { measured?: { width?: number; height?: number } };
    const width = typeof node.width === 'number'
        ? node.width
        : typeof measuredNode.measured?.width === 'number'
            ? measuredNode.measured.width
            : typeof node.style?.width === 'number'
                ? node.style.width
                : 288;
    const height = typeof node.height === 'number'
        ? node.height
        : typeof measuredNode.measured?.height === 'number'
            ? measuredNode.measured.height
            : typeof node.style?.height === 'number'
                ? node.style.height
                : 192;

    const nodeLeft = node.position.x;
    const nodeRight = node.position.x + width;
    const nodeTop = node.position.y;
    const nodeBottom = node.position.y + height;
    const rectRight = rect.x + rect.width;
    const rectBottom = rect.y + rect.height;

    return !(
        nodeRight < rect.x ||
        nodeLeft > rectRight ||
        nodeBottom < rect.y ||
        nodeTop > rectBottom
    );
};

type RelationshipDraft =
    | { mode: 'create'; connection: Connection; initialValue: string }
    | { mode: 'rename'; edgeId: string; initialValue: string };

// Memoize nodeTypes and edgeTypes outside to satisfy React Flow optimization
// Utility components were moved inside DetectiveBoardContent to ensure proper memoization and resolve warnings.
// Helper to distribute edges evenly around ALL sides of every node (Load Balancing) to prevent overlaps and use all sides
const distributeEdges = (edges: Edge[], nodes: Node[]): { edges: Edge[], handledNodes: Node[] } => {
    const nodeSideUsage: Record<string, { top: number, bottom: number, left: number, right: number }> = {};

    // Initialize handle counts for all nodes
    nodes.forEach(n => {
        nodeSideUsage[n.id] = { top: 0, bottom: 0, left: 0, right: 0 };
    });

    // We will assign specific handles to edges, tracking usage to perfectly balance each node
    const distributedEdges = edges.map(e => {
        const sId = e.source;
        const tId = e.target;

        let sHandle = 'port-right-0';
        let tHandle = 'port-left-0';

        if (nodeSideUsage[sId] && nodeSideUsage[tId]) {
            // Find least used side for Source (prefer Right -> Bottom -> Top -> Left)
            const sUsage = nodeSideUsage[sId];
            const sMin = Math.min(sUsage.right, sUsage.bottom, sUsage.top, sUsage.left);
            let sSide: 'right' | 'bottom' | 'top' | 'left' = 'right';

            // For stability, prefer placing outgoing connections on right/bottom naturally
            if (sUsage.right === sMin) sSide = 'right';
            else if (sUsage.bottom === sMin) sSide = 'bottom';
            else if (sUsage.top === sMin) sSide = 'top';
            else sSide = 'left';

            // CustomNode names bottom handle prefix 'bot'
            const sSideString = sSide === 'bottom' ? 'bot' : sSide;
            sHandle = `port-${sSideString}-${sUsage[sSide]}`;
            sUsage[sSide]++;

            // Find least used side for Target (prefer Left -> Top -> Bottom -> Right)
            const tUsage = nodeSideUsage[tId];
            const tMin = Math.min(tUsage.left, tUsage.top, tUsage.bottom, tUsage.right);
            let tSide: 'left' | 'top' | 'bottom' | 'right' = 'left';

            // Prefer placing incoming connections on left/top naturally
            if (tUsage.left === tMin) tSide = 'left';
            else if (tUsage.top === tMin) tSide = 'top';
            else if (tUsage.bottom === tMin) tSide = 'bottom';
            else tSide = 'right';

            // CustomNode names bottom handle prefix 'bot'
            const tSideString = tSide === 'bottom' ? 'bot' : tSide;
            tHandle = `port-${tSideString}-${tUsage[tSide]}`;
            tUsage[tSide]++;
        }

        return {
            ...e,
            sourceHandle: sHandle,
            targetHandle: tHandle,
            type: 'customEdge',
            zIndex: 0 // Force edges to render in background layer behind all cards
        };
    });

    // Update node data with final handle counts so CustomNode renders exactly the right amount
    // Set zIndex 100 so nodes render visually on top of all lines
    const handledNodes = nodes.map(n => ({
        ...n,
        zIndex: 100, // Force nodes into the foreground layer above all lines
        data: {
            ...n.data,
            handleCounts: nodeSideUsage[n.id] || { top: 0, bottom: 0, left: 0, right: 0 }
        }
    }));

    return { edges: distributedEdges, handledNodes };
};

const EDGE_TYPES = {
    customEdge: CustomEdge,
};

const NODE_TYPES = {
    custom: CustomNode,
};

const logResizePipelineDebug = (stage: string, payload: Record<string, unknown>) => {
    if (!import.meta.env.DEV) {
        return;
    }

    console.debug(`[DetectiveBoard][Resize:${stage}]`, payload);
};

const applyResizeDimensionsToStyles = (nodes: Node[], changes: Parameters<OnNodesChange>[0]) => {
    const resizedDimensions = new Map<string, { width: number; height: number; isLiveResize: boolean }>();

    changes.forEach((change) => {
        if (change.type !== 'dimensions' || !('dimensions' in change) || !change.dimensions) {
            return;
        }

        const width = change.dimensions.width;
        const height = change.dimensions.height;

        if (typeof width !== 'number' || typeof height !== 'number') {
            return;
        }

        const isLiveResize = 'resizing' in change && change.resizing;
        resizedDimensions.set(
            change.id,
            { ...(isLiveResize ? { width, height } : normalizeNodeFrame(width, height)), isLiveResize: Boolean(isLiveResize) }
        );
    });

    if (resizedDimensions.size === 0) {
        return nodes;
    }

    logResizePipelineDebug('apply-dimensions', {
        resizedNodeIds: Array.from(resizedDimensions.keys()),
        normalizedDimensions: Array.from(resizedDimensions.entries()).map(([id, dimensions]) => ({
            id,
            ...dimensions,
        })),
    });

    // Persist resize events into node.style so strict-grid syncs do not wipe out manual node sizing.
    return nodes.map((node) => {
        const nextDimensions = resizedDimensions.get(node.id);
        if (!nextDimensions) {
            return node;
        }
        if (node.data?.evidenceRole === 'supporting' && !node.data?.expanded && !nextDimensions.isLiveResize) {
            return node;
        }
        const { isLiveResize: _isLiveResize, ...styleDimensions } = nextDimensions;

        return {
            ...node,
            style: {
                ...node.style,
                ...styleDimensions,
            }
        };
    });
};

const BOARD_DEFAULT_VIEWPORT = { x: 0, y: 96, zoom: 1 };
const BOARD_MIN_ZOOM = 0.5;
const BOARD_FIT_VIEW_OPTIONS = { padding: 0.16, minZoom: 0.72, maxZoom: 1 };
const BOARD_MINIMAP_GLIDE_DURATION_MS = 620;
const BOARD_MINIMAP_DRAG_DURATION_MS = 0;
const BOARD_CAMERA_GLIDE_DURATION_MS = 900;
const BOARD_CAMERA_SETTLE_BUFFER_MS = 140;
const INITIAL_RESTORE_VIEWPORT_FIT_DELAY_MS = 80;
const INITIAL_RESTORE_VIEWPORT_REVEAL_DELAY_MS = 16;
const BOARD_RESTORE_OVERLAY_MIN_MS = 380;
const BOARD_RESTORE_OVERLAY_MAX_MS = 1600;
const RELATIONSHIP_LEGEND_VISIBILITY_KEY = 'detective_board_relationship_legend_visible';
const BOARD_NAVIGATOR_DEFAULT_VIEWPORT_SIZE = { width: 960, height: 540 };
const BOARD_NAVIGATOR_BOUNDS_PADDING = BOARD_GRID_SIZE * 3;
const BOARD_NAVIGATOR_MIN_SPAN = BOARD_GRID_SIZE * 10;
const MINIMAP_PANEL_LAYOUT = {
    compact: {
        panel: { width: 244, height: 220 },
        map: { width: 212, height: 116 },
    },
    expanded: {
        panel: { width: 320, height: 280 },
        map: { width: 288, height: 176 },
    },
} as const;
const MINIMAP_PANEL_OFFSET = { left: 24, top: 16, padding: 16, header: 42, toolbarGap: 20 };
const EXPORT_MENU_WIDTH = 224;
const BOARD_CONTROLS_PANEL_MAX_WIDTH = 416;
const BOARD_CONTROLS_PANEL_MARGIN = 16;
const RECENT_IMPORT_HIGHLIGHT_DURATION_MS = 3000;
const CONNECTION_REVEAL_DURATION_MS = 3200;
const CONNECT_LAYOUT_SETTLE_MS = 850;
const NODE_ENTRY_STAGGER_MS = 120;
const NODE_ENTRY_MAX_DELAY_MS = 840;
const NODE_ENTRY_ANIMATION_DURATION_MS = 1800;
const PERSONA_SCAN_DURATION_MS = 2200;
const TIMELINE_FOCUS_DURATION_MS = 1300;
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };
const LAYOUT_CHOREOGRAPHY_NODE_CLASS = 'forensic-react-flow-node-moving';

const appendClassName = (className: string | undefined, nextClassName: string) => {
    const classes = new Set((className || '').split(/\s+/).filter(Boolean));
    classes.add(nextClassName);
    return Array.from(classes).join(' ');
};

const removeClassName = (className: string | undefined, targetClassName: string) =>
    (className || '').split(/\s+/).filter((classNamePart) => classNamePart && classNamePart !== targetClassName).join(' ');

const getBoardLoadNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

const getConnectLayoutSettleDelay = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return CONNECT_LAYOUT_SETTLE_MS;
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : CONNECT_LAYOUT_SETTLE_MS;
};

const getBoardCameraMotionDuration = (durationMs: number) => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return durationMs;
    }

    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : durationMs;
};

const isImportedEvidenceNode = (nodeLike: { id?: string; title?: string } | null | undefined) =>
    Boolean(nodeLike?.title?.includes('[IMPORTED]') || nodeLike?.id?.startsWith('imported-'));

const QA_ANIMATION_DEMO_NODES = [
    {
        id: 'qa-animation-grid-load',
        title: 'Grid Load Spike',
        summary: 'A regional utility report flags a sudden load spike near clustered AI data centers during a peak demand window.',
        fullText: 'A regional utility report flags a sudden load spike near clustered AI data centers during a peak demand window.',
        sourceURL: 'https://example.com/qa-grid-load',
    },
    {
        id: 'qa-animation-thermal-cooling',
        title: 'Thermal Cooling Alert',
        summary: 'A facilities memo links emergency cooling draw to the same substation corridor and notes elevated transformer temperatures.',
        fullText: 'A facilities memo links emergency cooling draw to the same substation corridor and notes elevated transformer temperatures.',
        sourceURL: 'https://example.com/qa-thermal-cooling',
    },
    {
        id: 'imported-qa-animation-brief',
        title: '[IMPORTED] Regulator Brief',
        summary: 'An imported regulator brief references prior near-miss events and recommends tighter demand-response rules for data center operators.',
        fullText: 'An imported regulator brief references prior near-miss events and recommends tighter demand-response rules for data center operators.',
        sourceURL: 'https://example.com/qa-regulator-brief',
    },
    {
        id: 'qa-animation-capacity-auction',
        title: 'Capacity Auction Shock',
        summary: 'A market note ties higher capacity prices to forecast AI compute load and warns that utility upgrades are lagging demand.',
        fullText: 'A market note ties higher capacity prices to forecast AI compute load and warns that utility upgrades are lagging demand.',
        sourceURL: 'https://example.com/qa-capacity-auction',
    },
    {
        id: 'qa-animation-demand-response',
        title: 'Operator Curtailment Plan',
        summary: 'A grid operator drafts a demand-response playbook requiring large campuses to shed load during fast voltage swings.',
        fullText: 'A grid operator drafts a demand-response playbook requiring large campuses to shed load during fast voltage swings.',
        sourceURL: 'https://example.com/qa-demand-response',
    },
    {
        id: 'qa-animation-backup-dispatch',
        title: 'Backup Dispatch Window',
        summary: 'Emergency backup generation was briefly dispatched after cooling systems and compute racks peaked at the same time.',
        fullText: 'Emergency backup generation was briefly dispatched after cooling systems and compute racks peaked at the same time.',
        sourceURL: 'https://example.com/qa-backup-dispatch',
    },
    {
        id: 'qa-animation-interconnection-queue',
        title: 'Interconnection Queue Delay',
        summary: 'A utility queue filing shows delayed interconnection studies for the same constrained substation corridor.',
        fullText: 'A utility queue filing shows delayed interconnection studies for the same constrained substation corridor.',
        sourceURL: 'https://example.com/qa-interconnection-queue',
    },
    {
        id: 'qa-animation-transformer-order',
        title: 'Transformer Order Slip',
        summary: 'A procurement note warns that transformer lead times slipped again, delaying planned upgrades for the load pocket.',
        fullText: 'A procurement note warns that transformer lead times slipped again, delaying planned upgrades for the load pocket.',
        sourceURL: 'https://example.com/qa-transformer-order',
    },
    {
        id: 'qa-animation-water-permit',
        title: 'Water Permit Constraint',
        summary: 'A cooling water permit amendment caps withdrawals during heat events, narrowing the operating window for the campus.',
        fullText: 'A cooling water permit amendment caps withdrawals during heat events, narrowing the operating window for the campus.',
        sourceURL: 'https://example.com/qa-water-permit',
    },
    {
        id: 'qa-animation-community-hearing',
        title: 'Community Hearing Pushback',
        summary: 'A local hearing transcript shows residents pressing officials about backup generators, water use, and grid reliability.',
        fullText: 'A local hearing transcript shows residents pressing officials about backup generators, water use, and grid reliability.',
        sourceURL: 'https://example.com/qa-community-hearing',
    },
] as const;

const QA_ANIMATION_DEMO_STAGING_POSITIONS = [
    { x: 96, y: 96 },
    { x: 768, y: 384 },
    { x: 288, y: 672 },
    { x: 864, y: 96 },
    { x: 96, y: 456 },
    { x: 576, y: 672 },
    { x: 528, y: 96 },
    { x: 960, y: 456 },
    { x: 288, y: 384 },
    { x: 864, y: 672 },
] as const;

const getQaAnimationDemoStagingPosition = (index: number) =>
    QA_ANIMATION_DEMO_STAGING_POSITIONS[index] || {
        x: 96 + (index % 3) * 384,
        y: 96 + Math.floor(index / 3) * 288,
    };

const QA_ANIMATION_DEMO_NODE_STEP_MS = 220;
const QA_ANIMATION_DEMO_NODE_COMPLETE_MS = (QA_ANIMATION_DEMO_NODES.length - 1) * QA_ANIMATION_DEMO_NODE_STEP_MS;
const QA_GATHERING_STATUS_DEMO_MS = 5000;

const QA_EVIDENCE_EXPANSION_NODE_ID = 'qa-evidence-expansion-node';
const QA_EVIDENCE_EXPANSION_IMAGE_SRC = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22640%22 height=%22360%22 viewBox=%220 0 640 360%22%3E%3Crect width=%22640%22 height=%22360%22 fill=%22071118%22/%3E%3Crect x=%2238%22 y=%2244%22 width=%22564%22 height=%22272%22 fill=%220c1a22%22 stroke=%2281e3ff%22 stroke-width=%222%22 opacity=%220.78%22/%3E%3Cpath d=%22M70 112h260M70 150h430M70 188h380M70 226h300%22 stroke=%22%2381e3ff%22 stroke-width=%229%22 opacity=%220.28%22/%3E%3Ccircle cx=%22522%22 cy=%22128%22 r=%2248%22 fill=%22%23f6c879%22 opacity=%220.22%22/%3E%3Ctext x=%2270%22 y=%2286%22 fill=%22%2381e3ff%22 font-size=%2224%22 font-family=%22monospace%22 font-weight=%22700%22%3EQA VISUAL EVIDENCE%3C/text%3E%3C/svg%3E';

const QA_DUPLICATE_SQUASH_DEMO_NODES = [
    {
        id: 'qa-duplicate-squashed-evidence',
        title: 'QA Squashed Duplicate Evidence',
        summary: 'Three duplicate excerpts from mirrored reports have been squashed into this single visible evidence card.',
        fullText: 'Three duplicate excerpts from mirrored reports have been squashed into this single visible evidence card. The merged card keeps source provenance while avoiding duplicate board clutter.',
        sourceURL: 'https://example.com/qa-duplicate-primary',
        evidenceCount: 3,
        mergedSourceURLs: [
            'https://example.com/qa-duplicate-primary',
            'https://mirror.example/qa-duplicate-primary',
            'https://wire.example/qa-duplicate-primary',
        ],
        duplicateNodeIds: ['qa-duplicate-source-a', 'qa-duplicate-source-b'],
    },
    {
        id: 'qa-duplicate-policy-response',
        title: 'Policy Response Lead',
        summary: 'A regulator memo responds to the same evidence cluster with proposed reporting requirements.',
        fullText: 'A regulator memo responds to the same evidence cluster with proposed reporting requirements.',
        sourceURL: 'https://example.com/qa-duplicate-policy',
    },
    {
        id: 'qa-duplicate-money-trail',
        title: 'Funding Pressure Note',
        summary: 'A market note links the evidence cluster to higher compliance and infrastructure costs.',
        fullText: 'A market note links the evidence cluster to higher compliance and infrastructure costs.',
        sourceURL: 'https://example.com/qa-duplicate-money',
    },
] as const;

const QA_DUPLICATE_SQUASH_DEMO_POSITIONS = [
    { x: 160, y: 160 },
    { x: 640, y: 112 },
    { x: 640, y: 416 },
] as const;

const QA_DUPLICATE_SQUASH_DEMO_CONNECTIONS = [
    {
        source: 'qa-duplicate-squashed-evidence',
        target: 'qa-duplicate-policy-response',
        tag: 'POLICY_TRIGGER',
        reasoning: 'The policy memo responds to the squashed evidence cluster.',
    },
    {
        source: 'qa-duplicate-money-trail',
        target: 'qa-duplicate-squashed-evidence',
        tag: 'MONEY_TRAIL',
        reasoning: 'The cost note adds financial pressure context to the squashed evidence cluster.',
    },
] as const;

const QA_TEXT_FIT_DEMO_NODES = [
    {
        id: 'qa-text-fit-sentiment',
        title: 'QA Global AI Sentiment Stress Text',
        legacyWidth: 336,
        summary: 'Recent surveys from [ORG:PEW RESEARCH CENTER] show respondents in [LOC:MALAYSIA], [LOC:THAILAND], [LOC:INDONESIA], and [LOC:SINGAPORE] splitting sharply on AI benefits while telecom filings, school guidance, labor concerns, newsroom policies, and public-trust notes all stack into line seven and line eight pressure that should still remain readable instead of disappearing under the collapsed card mask.',
        fullText: 'Recent surveys from PEW RESEARCH CENTER show respondents in Malaysia, Thailand, Indonesia, and Singapore splitting sharply on AI benefits. This QA node is intentionally wordy so the collapsed card must grow horizontally when the rendered preview reaches the seventh and eighth visual lines.',
        sourceURL: 'https://example.com/qa-text-fit-sentiment',
    },
    {
        id: 'qa-text-fit-milestones',
        title: 'QA AI Acceleration Milestones',
        legacyWidth: 336,
        summary: 'Over the past year, [ORG:AI SAFETY INSTITUTE], [ORG:IBM], [ORG:OpenAI], and [ORG:DeepMind] milestones crowded the same paragraph with long organization names, policy notes, benchmark caveats, procurement delays, safety memos, chip-capacity constraints, and line seven and line eight pressure that should trigger intelligent width growth before clipped text hides the final words.',
        fullText: 'Over the past year, AI SAFETY INSTITUTE, IBM, OpenAI, and DeepMind milestones crowded the same paragraph with long organization names and policy notes. The collapsed preview should widen by a grid block or two when the browser measures hidden overflow.',
        sourceURL: 'https://example.com/qa-text-fit-milestones',
    },
    {
        id: 'qa-text-fit-chip-density',
        title: 'QA Chip Density Preview',
        legacyWidth: 336,
        summary: 'A dense preview with [DATE:2026-05-25], [PERSON:Sam Altman], [PERSON:Jensen Huang], [ORG:NVIDIA], [ORG:Microsoft], [ORG:Google], supplier exceptions, export paperwork, inference-demand forecasts, cloud-region constraints, and multiple procurement clauses creates line seven and line eight pressure for visual QA without requiring a backend crawl.',
        fullText: 'A dense preview with dates, people, organizations, and procurement clauses creates visual pressure for collapsed text QA without requiring a backend crawl. It should be wide enough that the final visible line is not horizontally or vertically clipped.',
        sourceURL: 'https://example.com/qa-text-fit-chip-density',
    },
] as const;

const QA_TEXT_FIT_DEMO_POSITIONS = [
    { x: 120, y: 128 },
    { x: 760, y: 128 },
    { x: 1400, y: 128 },
] as const;

const QA_RABBIT_HOLE_DEMO_PROMOTION_MS = 1450;

const QA_RABBIT_HOLE_DEMO_NODES = [
    {
        id: 'qa-rabbit-web-descent',
        title: 'QA Rabbit Web Descent',
        summary: 'Rabbit Hole web_search follows data center grid pressure, cooling water filings, and operator reliability warnings into a live provisional evidence trail.',
        fullText: 'Rabbit Hole web_search follows data center grid pressure, cooling water filings, and operator reliability warnings into a live provisional evidence trail. This browser-only QA node should appear as RABBIT TRAIL / ACTIVE before promotion.',
        sourceURL: 'https://example.com/qa-rabbit-web-descent',
        rabbitTool: 'web_search',
        confidence: 0.82,
    },
    {
        id: 'qa-rabbit-vault-echo',
        title: 'QA Rabbit Vault Echo',
        summary: 'Rabbit Hole vault_search finds an older investigation that mentions the same substation corridor, water constraint, and procurement delay pattern.',
        fullText: 'Rabbit Hole vault_search finds an older investigation that mentions the same substation corridor, water constraint, and procurement delay pattern. It is intentionally clickable while still provisional.',
        sourceURL: 'vault://qa-browser-prior-near-miss',
        rabbitTool: 'vault_search',
        confidence: 0.76,
    },
    {
        id: 'qa-rabbit-timeline-rift',
        title: 'QA Rabbit Timeline Rift',
        summary: 'Rabbit Hole timeline_context extracts May 2026 filings, hearing dates, and operator notes into a chronological pressure trail for the Gatekeeper.',
        fullText: 'Rabbit Hole timeline_context extracts May 2026 filings, hearing dates, and operator notes into a chronological pressure trail for the Gatekeeper.',
        sourceURL: 'timeline://qa-rabbit-hole',
        rabbitTool: 'timeline_context',
        confidence: 0.79,
    },
] as const;

const QA_RABBIT_HOLE_DEMO_POSITIONS = [
    { x: 128, y: 136 },
    { x: 640, y: 136 },
    { x: 1152, y: 136 },
] as const;

const QA_RABBIT_HOLE_DEMO_CONNECTIONS = [
    {
        source: 'qa-rabbit-web-descent',
        target: 'qa-rabbit-vault-echo',
        tag: 'HIDDEN_CONNECTION',
        reasoning: 'The live web trail and older vault memory share the same infrastructure stress pattern.',
    },
    {
        source: 'qa-rabbit-vault-echo',
        target: 'qa-rabbit-timeline-rift',
        tag: 'TIMELINE_LEAD',
        reasoning: 'The older memory gives the timeline context a prior event window to compare against the current descent.',
    },
] as const;

const QA_ANIMATION_DEMO_INSIGHTS = [
    {
        personaName: 'Discovery',
        perspective: 'Looks for non-obvious operational patterns.',
        keyFindings: ['Grid load, cooling draw, capacity pricing, backup dispatch, and curtailment planning point to the same reliability pressure.'],
        observations: ['The load spike, thermal alert, market shock, and backup dispatch cluster around the same operational stress pattern.'],
        hypotheses: ['Clustered AI compute demand is creating repeatable grid stress rather than isolated incidents.'],
        connections: ['The scattered evidence resolves into a single chain: load growth, cooling demand, market pressure, operator response, and regulatory action.'],
        questions: ['Which operators are tied to the constrained corridor?'],
        confidence: 0.86,
        fullAnalysis: 'The demo evidence suggests a recurring reliability pattern across load, cooling, market, backup, operator, and regulatory signals.',
        nodeIDs: QA_ANIMATION_DEMO_NODES.map((node) => node.id),
    },
];

const QA_ANIMATION_DEMO_CONNECTIONS = [
    {
        source: 'qa-animation-grid-load',
        target: 'qa-animation-thermal-cooling',
        tag: 'INFRASTRUCTURE_STRESS',
        reasoning: 'The load spike and cooling alert point to the same stressed infrastructure corridor.',
        confidence: 0.86,
    },
    {
        source: 'qa-animation-thermal-cooling',
        target: 'imported-qa-animation-brief',
        tag: 'REGULATORY_SIGNAL',
        reasoning: 'The regulator brief references the same cooling and substation pressure pattern.',
        confidence: 0.82,
    },
    {
        source: 'qa-animation-capacity-auction',
        target: 'qa-animation-grid-load',
        tag: 'MARKET_PRESSURE',
        reasoning: 'The auction shock follows the same AI load forecasts that triggered the utility stress warning.',
        confidence: 0.8,
    },
    {
        source: 'qa-animation-demand-response',
        target: 'qa-animation-grid-load',
        tag: 'DEMAND_RESPONSE',
        reasoning: 'The curtailment plan is an operator response to fast voltage swings caused by clustered load spikes.',
        confidence: 0.84,
    },
    {
        source: 'qa-animation-backup-dispatch',
        target: 'qa-animation-thermal-cooling',
        tag: 'RESILIENCE_GAP',
        reasoning: 'Backup dispatch coincides with the same cooling-demand peak flagged in the facilities alert.',
        confidence: 0.78,
    },
    {
        source: 'qa-animation-interconnection-queue',
        target: 'qa-animation-capacity-auction',
        tag: 'INTERCONNECTION_DELAY',
        reasoning: 'Delayed interconnection studies explain why capacity prices are reacting faster than physical upgrades.',
        confidence: 0.81,
    },
    {
        source: 'qa-animation-transformer-order',
        target: 'qa-animation-interconnection-queue',
        tag: 'SUPPLY_CHAIN',
        reasoning: 'Transformer lead-time slips compound the interconnection queue and keep the constrained corridor underbuilt.',
        confidence: 0.79,
    },
    {
        source: 'qa-animation-water-permit',
        target: 'qa-animation-thermal-cooling',
        tag: 'WATER_CONSTRAINT',
        reasoning: 'The permit cap constrains cooling during the same heat windows that trigger the thermal alert.',
        confidence: 0.83,
    },
    {
        source: 'qa-animation-community-hearing',
        target: 'qa-animation-backup-dispatch',
        tag: 'PUBLIC_PRESSURE',
        reasoning: 'Community concerns focus on the backup dispatch pattern and its reliability tradeoffs.',
        confidence: 0.77,
    },
] as const;

const stripTransientNodeData = (node: Node): Node => {
    const {
        isConnectionHighlighted: _isConnectionHighlighted,
        connectionHighlightColor: _connectionHighlightColor,
        nodeEntryAnimation: _nodeEntryAnimation,
        nodeEntryDelayMs: _nodeEntryDelayMs,
        nodeEntryStartedAt: _nodeEntryStartedAt,
        nodeEntrySequence: _nodeEntrySequence,
        isPersonaScanActive: _isPersonaScanActive,
        personaScanStartedAt: _personaScanStartedAt,
        isLayoutChoreographyActive: _isLayoutChoreographyActive,
        layoutChoreographyStartedAt: _layoutChoreographyStartedAt,
        isTimelineFocused: _isTimelineFocused,
        timelineFocusStartedAt: _timelineFocusStartedAt,
        isSupportTetherSource: _isSupportTetherSource,
        isSupportTetherTarget: _isSupportTetherTarget,
        ...stableNodeData
    } = node.data || {};
    const stableClassName = removeClassName((node as Node & { className?: string }).className, LAYOUT_CHOREOGRAPHY_NODE_CLASS);
    const stableNode = {
        ...node,
        data: {
            ...stableNodeData,
            isRecentlyImported: false,
            personaInsights: Array.isArray(node.data?.personaInsights)
                ? node.data.personaInsights.map((insight: PersonaInsight) => ({
                    personaName: insight?.personaName,
                    perspective: insight?.perspective,
                    confidence: insight?.confidence,
                    keyFindings: Array.isArray(insight?.keyFindings) ? insight.keyFindings.slice(0, 4) : [],
                    observations: Array.isArray(insight?.observations) ? insight.observations.slice(0, 4) : [],
                    hypotheses: Array.isArray(insight?.hypotheses) ? insight.hypotheses.slice(0, 3) : [],
                    connections: Array.isArray(insight?.connections) ? insight.connections.slice(0, 4) : [],
                    questions: Array.isArray(insight?.questions) ? insight.questions.slice(0, 3) : [],
                    nodeIDs: Array.isArray(insight?.nodeIDs) ? insight.nodeIDs.slice(0, 12) : [],
                    proposedConnections: Array.isArray(insight?.proposedConnections) ? insight.proposedConnections.slice(0, 6) : [],
                }))
                : node.data?.personaInsights,
        }
    } as Node & { className?: string };

    if (stableClassName) {
        stableNode.className = stableClassName;
    } else {
        delete stableNode.className;
    }

    return stableNode;
};

const sanitizeNodesForPersistence = (nodes: Node[]) => nodes.map(stripTransientNodeData);

const stripTransientEdgeData = (edge: Edge): Edge => {
    const {
        isConnectionRevealing: _isConnectionRevealing,
        connectionRevealStartedAt: _connectionRevealStartedAt,
        onConnectionHover: _onConnectionHover,
        ...stableEdgeData
    } = edge.data || {};

    return {
        ...edge,
        data: stableEdgeData,
    };
};

const sanitizeEdgesForPersistence = (edges: Edge[]) => edges.map(stripTransientEdgeData);

type BoardNavigatorInteraction = 'click' | 'drag';

interface BoardNavigatorSize {
    width: number;
    height: number;
}

interface BoardNavigatorRect extends BoardNavigatorSize {
    x: number;
    y: number;
}

interface BoardNavigatorNodeRect extends BoardNavigatorRect {
    node: Node;
}

interface BoardNavigatorProps {
    nodes: Node[];
    viewport: Viewport;
    viewportSize: BoardNavigatorSize;
    width: number;
    height: number;
    isCameraMoving: boolean;
    activeSupportTethers?: SupportTether[];
    getNodeColor: (node: Node) => string;
    onNavigate: (position: XYPosition, interaction: BoardNavigatorInteraction) => void;
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

const getSafeNavigatorZoom = (viewport: Viewport) =>
    Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1;

const getNavigatorViewportSize = (viewportSize: BoardNavigatorSize) => ({
    width: viewportSize.width > 0 ? viewportSize.width : BOARD_NAVIGATOR_DEFAULT_VIEWPORT_SIZE.width,
    height: viewportSize.height > 0 ? viewportSize.height : BOARD_NAVIGATOR_DEFAULT_VIEWPORT_SIZE.height,
});

const getVisibleBoardRect = (viewport: Viewport, viewportSize: BoardNavigatorSize): BoardNavigatorRect => {
    const zoom = getSafeNavigatorZoom(viewport);
    const safeViewportSize = getNavigatorViewportSize(viewportSize);

    return {
        x: -viewport.x / zoom,
        y: -viewport.y / zoom,
        width: safeViewportSize.width / zoom,
        height: safeViewportSize.height / zoom,
    };
};

const getBoardNavigatorBounds = (rects: BoardNavigatorRect[]): BoardNavigatorRect => {
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const width = Math.max(maxX - minX, BOARD_NAVIGATOR_MIN_SPAN);
    const height = Math.max(maxY - minY, BOARD_NAVIGATOR_MIN_SPAN);

    return {
        x: centerX - width / 2 - BOARD_NAVIGATOR_BOUNDS_PADDING,
        y: centerY - height / 2 - BOARD_NAVIGATOR_BOUNDS_PADDING,
        width: width + BOARD_NAVIGATOR_BOUNDS_PADDING * 2,
        height: height + BOARD_NAVIGATOR_BOUNDS_PADDING * 2,
    };
};

const getNavigatorProjection = (bounds: BoardNavigatorRect, width: number, height: number) => {
    const scale = Math.min(width / bounds.width, height / bounds.height);
    const projectedWidth = bounds.width * scale;
    const projectedHeight = bounds.height * scale;

    return {
        scale,
        offsetX: (width - projectedWidth) / 2,
        offsetY: (height - projectedHeight) / 2,
    };
};

const projectNavigatorRect = (
    rect: BoardNavigatorRect,
    bounds: BoardNavigatorRect,
    projection: ReturnType<typeof getNavigatorProjection>
) => ({
    x: projection.offsetX + (rect.x - bounds.x) * projection.scale,
    y: projection.offsetY + (rect.y - bounds.y) * projection.scale,
    width: Math.max(2, rect.width * projection.scale),
    height: Math.max(2, rect.height * projection.scale),
});

const projectNavigatorPoint = (
    point: XYPosition,
    bounds: BoardNavigatorRect,
    projection: ReturnType<typeof getNavigatorProjection>
): XYPosition => ({
    x: projection.offsetX + (point.x - bounds.x) * projection.scale,
    y: projection.offsetY + (point.y - bounds.y) * projection.scale,
});

const BoardNavigator: React.FC<BoardNavigatorProps> = ({
    nodes,
    viewport,
    viewportSize,
    width,
    height,
    isCameraMoving,
    activeSupportTethers = [],
    getNodeColor,
    onNavigate,
}) => {
    const activePointerIdRef = useRef<number | null>(null);
    const hasDraggedRef = useRef(false);
    const suppressClickRef = useRef(false);
    const nodeRects: BoardNavigatorNodeRect[] = nodes
        .filter((node) => !node.hidden)
        .map((node) => {
            const dimensions = getNodeDimensions(node);

            return {
                node,
                x: node.position.x,
                y: node.position.y,
                width: dimensions.width,
                height: dimensions.height,
            };
        });
    const visibleRect = getVisibleBoardRect(viewport, viewportSize);
    const bounds = getBoardNavigatorBounds([...nodeRects, visibleRect]);
    const projection = getNavigatorProjection(bounds, width, height);
    const viewportRect = projectNavigatorRect(visibleRect, bounds, projection);
    const activeSupportSourceIds = new Set(activeSupportTethers.map((tether) => tether.sourceId));
    const activeSupportTargetIds = new Set(activeSupportTethers.map((tether) => tether.targetId));
    const getFlowPositionFromEvent = (
        event: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>
    ): XYPosition => {
        const rect = event.currentTarget.getBoundingClientRect();
        const renderedWidth = rect.width || width;
        const renderedHeight = rect.height || height;
        const localX = clamp(((event.clientX - rect.left) / renderedWidth) * width, 0, width);
        const localY = clamp(((event.clientY - rect.top) / renderedHeight) * height, 0, height);

        return {
            x: bounds.x + (localX - projection.offsetX) / projection.scale,
            y: bounds.y + (localY - projection.offsetY) / projection.scale,
        };
    };
    const navigateFromEvent = (
        event: React.MouseEvent<SVGSVGElement> | React.PointerEvent<SVGSVGElement>,
        interaction: BoardNavigatorInteraction
    ) => {
        onNavigate(getFlowPositionFromEvent(event), interaction);
    };

    return (
        <svg
            data-testid="board-navigator"
            aria-label="Board minimap navigator"
            className="forensic-board-navigator pointer-events-auto rounded-xl"
            role="button"
            tabIndex={0}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            style={{ width, height }}
            onClick={(event) => {
                if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                }

                navigateFromEvent(event, 'click');
            }}
            onPointerDown={(event) => {
                if (event.button !== 0) {
                    return;
                }

                activePointerIdRef.current = event.pointerId;
                hasDraggedRef.current = false;
                event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={(event) => {
                if (activePointerIdRef.current !== event.pointerId) {
                    return;
                }

                hasDraggedRef.current = true;
                suppressClickRef.current = true;
                navigateFromEvent(event, 'drag');
            }}
            onPointerUp={(event) => {
                if (activePointerIdRef.current !== event.pointerId) {
                    return;
                }

                activePointerIdRef.current = null;
                event.currentTarget.releasePointerCapture?.(event.pointerId);
                if (hasDraggedRef.current) {
                    window.setTimeout(() => {
                        suppressClickRef.current = false;
                    }, 0);
                }
            }}
            onPointerCancel={(event) => {
                if (activePointerIdRef.current === event.pointerId) {
                    activePointerIdRef.current = null;
                }
                suppressClickRef.current = false;
            }}
        >
            <rect
                className="forensic-board-navigator-background"
                x={0}
                y={0}
                width={width}
                height={height}
                rx={14}
            />
            <g aria-hidden="true">
                {activeSupportTethers.length > 0 && (
                    <g data-testid="board-navigator-support-tethers" className="forensic-board-navigator-support-tethers">
                        {activeSupportTethers.map((tether) => {
                            const source = projectNavigatorPoint(tether.source, bounds, projection);
                            const target = projectNavigatorPoint(tether.target, bounds, projection);

                            return (
                                <line
                                    key={`${tether.sourceId}-${tether.targetId}`}
                                    data-testid="board-navigator-support-tether"
                                    className={`forensic-board-navigator-support-tether forensic-board-navigator-support-tether-${tether.strength}`}
                                    x1={source.x}
                                    y1={source.y}
                                    x2={target.x}
                                    y2={target.y}
                                />
                            );
                        })}
                    </g>
                )}
                {nodeRects.map((nodeRect) => {
                    const projectedNode = projectNavigatorRect(nodeRect, bounds, projection);
                    const isSupportSource = activeSupportSourceIds.has(nodeRect.node.id);
                    const isSupportTarget = activeSupportTargetIds.has(nodeRect.node.id);
                    const supportStateClass = isSupportSource
                        ? 'forensic-board-navigator-node-support-source'
                        : isSupportTarget
                            ? 'forensic-board-navigator-node-support-target'
                            : '';

                    return (
                        <rect
                            key={nodeRect.node.id}
                            data-testid="board-navigator-node"
                            data-node-id={nodeRect.node.id}
                            className={`forensic-board-navigator-node ${supportStateClass}`}
                            x={projectedNode.x}
                            y={projectedNode.y}
                            width={projectedNode.width}
                            height={projectedNode.height}
                            rx={4}
                            fill={getNodeColor(nodeRect.node)}
                        />
                    );
                })}
            </g>
            <rect
                data-testid="board-navigator-viewport"
                className={`forensic-board-navigator-viewport ${isCameraMoving ? 'forensic-board-navigator-viewport-moving' : ''}`}
                x={viewportRect.x}
                y={viewportRect.y}
                width={viewportRect.width}
                height={viewportRect.height}
                rx={7}
            />
        </svg>
    );
};

const DetectiveBoardContent: React.FC<DetectiveBoardProps> = ({
    investigationId,
    returnVaultId,
    sharedSocket,
    onDeepDiveNode,
    onNavigateToChild,
    focusNodeId,
    onReturnToParent,
    isMergedChild,
    hasTheoryReady = false,
    hasUnreadTheory = false,
    hasDiscoveryReady = false,
    hasUnreadDiscoveries = false,
}) => {
    const { fitView, screenToFlowPosition, setCenter, getZoom } = useReactFlow();
    const boardViewport = useViewport();
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);

    const [selectedDossier, setSelectedDossier] = useState<NodeDossier | null>(null);
    const [edgeReasoning, setEdgeReasoning] = useState<{ tag: string, rawTag?: string, text: string, color: string, personas?: string[], qualityScore?: number, evidenceNodeIDs?: string[] } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGathering, setIsGathering] = useState(false);
    const [isReorganizing, setIsReorganizing] = useState(false);
    const [deepDiveTopic, setDeepDiveTopic] = useState<string | null>(null);
    const [loadedInvestigationId, setLoadedInvestigationId] = useState<string | null>(null);
    const loadedInvestigationIdRef = useRef<string | null>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [exportMenuPosition, setExportMenuPosition] = useState<{ top: number; left: number; width: number }>({
        top: 0,
        left: 0,
        width: EXPORT_MENU_WIDTH,
    });
    const [showBoardControls, setShowBoardControls] = useState(false);
    const [boardControlsPosition, setBoardControlsPosition] = useState<{ top: number; width: number; maxHeight: number }>({
        top: 0,
        width: BOARD_CONTROLS_PANEL_MAX_WIDTH,
        maxHeight: 520,
    });
    const [showRelationshipLegend, setShowRelationshipLegend] = useState<boolean>(() => {
        if (typeof window === 'undefined') {
            return true;
        }

        const storedValue = window.localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY);
        return storedValue === null ? true : storedValue === 'true';
    });
    const [showGrid, setShowGrid] = useState(true);
    const [snapNodes, setSnapNodes] = useState(false);
    const [snapConnectionLabels, setSnapConnectionLabels] = useState(false);
    const [boardMode, setBoardMode] = useState<BoardMode>('strict-grid');
    const [appendSearchPrompt, setAppendSearchPrompt] = useState('');
    const [pendingIntegrationNodeIds, setPendingIntegrationNodeIds] = useState<string[]>([]);
    const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [hasConnectedDots, setHasConnectedDots] = useState(false);
    const [autoConnectRequest, setAutoConnectRequest] = useState<{ vaultId: string; runId: string; requestedAt: number } | null>(null);
    const [tagStyles, setTagStyles] = useState<Record<string, TagStyle>>({});
    const [editingTag, setEditingTag] = useState<string | null>(null);
    const [relationshipDraft, setRelationshipDraft] = useState<RelationshipDraft | null>(null);
    const [relationshipNameInput, setRelationshipNameInput] = useState('RELATED');
    const [marquee, setMarquee] = useState<MarqueeState | null>(null);
    const [isMiniMapExpanded, setIsMiniMapExpanded] = useState(false);
    const [isBoardCameraMoving, setIsBoardCameraMoving] = useState(false);
    const [imageLightbox, setImageLightbox] = useState<ImageLightboxState | null>(null);
    const [supportHoverNodeId, setSupportHoverNodeId] = useState<string | null>(null);
    const [connectionHover, setConnectionHover] = useState<{ edgeId?: string; nodeIds: string[]; color: string } | null>(null);
    const [isInitialRestoreViewportSettling, setIsInitialRestoreViewportSettling] = useState(false);
    const [boardRestoreOverlay, setBoardRestoreOverlay] = useState<{
        investigationId: string;
        startedAt: number;
        source: string;
    } | null>(null);
    const showBrowserQaBoardTools = import.meta.env.DEV || import.meta.env.MODE === 'test';
    const [qaToolsEnabled, setQaToolsEnabled] = useState(false);
    const [showQaReplayMenu, setShowQaReplayMenu] = useState(false);
    const lightboxFileInputRef = useRef<HTMLInputElement>(null);
    const lightboxDialogRef = useRef<HTMLDivElement>(null);
    const previousFocusedElementRef = useRef<HTMLElement | null>(null);
    const boardContainerRef = useRef<HTMLDivElement>(null);
    const exportButtonRef = useRef<HTMLButtonElement>(null);
    const exportMenuPanelRef = useRef<HTMLDivElement>(null);
    const boardToolbarRef = useRef<HTMLDivElement>(null);
    const boardActionBarRef = useRef<HTMLDivElement>(null);
    const boardControlsButtonRef = useRef<HTMLButtonElement>(null);
    const boardControlsPanelRef = useRef<HTMLDivElement>(null);
    const flowWrapperRef = useRef<HTMLDivElement>(null);
    const [boardViewportSize, setBoardViewportSize] = useState<BoardNavigatorSize>(BOARD_NAVIGATOR_DEFAULT_VIEWPORT_SIZE);
    const nodesRef = useRef<Node[]>([]);
    const edgesRef = useRef<Edge[]>([]);
    const pendingIntegrationNodeIdsRef = useRef<string[]>([]);
    const analysisModeRef = useRef<AnalysisMode>(null);
    const latestPipelineRunIdRef = useRef<string | null>(null);
    const relationshipRecoveryStartedAtRef = useRef(0);
    const stoppedPipelineRunIdsRef = useRef<Set<string>>(new Set());
    const isDraggingNodeRef = useRef(false);
    const draggingNodeIdsRef = useRef<Set<string>>(new Set());
    const dragRouteFrameRef = useRef<number | null>(null);
    const persistTimerRef = useRef<number | null>(null);
    const marqueePointerIdRef = useRef<number | null>(null);
    const marqueeSelectedIdsRef = useRef<Set<string>>(new Set());
    const recentImportTimeoutsRef = useRef<Map<string, number>>(new Map());
    const connectionRevealTimeoutsRef = useRef<Map<string, number>>(new Map());
    const nodeEntrySequenceRef = useRef(0);
    const nodeEntryTimeoutsRef = useRef<Map<string, number>>(new Map());
    const personaScanTimeoutsRef = useRef<Map<string, number>>(new Map());
    const layoutChoreographyTimeoutsRef = useRef<number[]>([]);
    const isLayoutChoreographyActiveRef = useRef(false);
    const visibleConnectEdgeIdsRef = useRef<Set<string>>(new Set());
    const connectChoreographyBaseNodesRef = useRef<Node[]>([]);
    const connectChoreographyBaseEdgesRef = useRef<Edge[]>([]);
    const qaAnimationTimeoutsRef = useRef<number[]>([]);
    const qaGatheringStatusTimeoutRef = useRef<number | null>(null);
    const qaAnimationDemoActiveRef = useRef(false);
    const qaEvidenceExpansionDemoActiveRef = useRef(false);
    const qaRabbitHoleDemoActiveRef = useRef(false);
    const lastQaAnimationDemoRequestIdRef = useRef<string | null>(null);
    const timelineFocusTimeoutRef = useRef<number | null>(null);
    const boardCameraMovementTimeoutRef = useRef<number | null>(null);
    const initialRestoreViewportFitTimeoutRef = useRef<number | null>(null);
    const boardRestoreOverlayTimeoutRef = useRef<number | null>(null);
    const pendingInitialRestoreViewportFitRef = useRef<string | null>(null);
    const completedInitialRestoreViewportFitRef = useRef<string | null>(null);

    nodesRef.current = nodes;
    edgesRef.current = edges;
    pendingIntegrationNodeIdsRef.current = pendingIntegrationNodeIds;
    analysisModeRef.current = analysisMode;

    const openNodeDossier = useCallback((nodeData?: NodeDossierInput) => {
        const summary = normalizeDossierText(nodeData?.summary);
        const fullText = normalizeDossierText(nodeData?.fullText || nodeData?.summary);

        setSelectedDossier({
            title: normalizeDossierText(nodeData?.title) || 'Evidence Dossier',
            summary,
            fullText,
            sourceURL: nodeData?.sourceURL,
            origin: nodeData?.origin,
            rabbitTool: nodeData?.rabbitTool,
            rabbitPass: nodeData?.rabbitPass,
            evidenceRole: nodeData?.evidenceRole,
            images: nodeData?.images ? [...nodeData.images] : undefined,
        });
    }, []);

    const supportingEvidenceLayer = useMemo(
        () => layoutSupportingEvidenceNodes(nodes, edges).band,
        [nodes, edges]
    );
    const supportTethers = useMemo(
        () => supportHoverNodeId ? buildSupportTethers(nodes, supportHoverNodeId) : [],
        [nodes, supportHoverNodeId]
    );
    const supportTetherTargetIds = useMemo(
        () => new Set(supportTethers.map((tether) => tether.targetId)),
        [supportTethers]
    );
    const handleSupportHover = useCallback((nodeId: string, active: boolean) => {
        setSupportHoverNodeId((currentNodeId) => {
            if (active) {
                return nodeId;
            }
            return currentNodeId === nodeId ? null : currentNodeId;
        });
    }, []);
    const connectionHoverNodeIds = useMemo(
        () => new Set(connectionHover?.nodeIds || []),
        [connectionHover]
    );
    const nodesForRender = useMemo(() => nodes.map((node) => {
        const isHoveredConnectionNode = connectionHoverNodeIds.has(node.id);

        return {
            ...node,
            zIndex: supportHoverNodeId === node.id && node.data?.evidenceRole === 'supporting'
                ? STRICT_GRID_EXPANDED_NODE_Z_INDEX
                : node.zIndex,
            data: {
                ...node.data,
                onSupportHover: handleSupportHover,
                isConnectionHighlighted: isHoveredConnectionNode ? true : node.data?.isConnectionHighlighted,
                connectionHighlightColor: isHoveredConnectionNode ? connectionHover?.color : node.data?.connectionHighlightColor,
                isSupportTetherSource: supportHoverNodeId === node.id && node.data?.evidenceRole === 'supporting',
                isSupportTetherTarget: supportTetherTargetIds.has(node.id),
            },
        };
    }), [connectionHover?.color, connectionHoverNodeIds, handleSupportHover, nodes, supportHoverNodeId, supportTetherTargetIds]);
    const selectedDossierBrief = useMemo(
        () => selectedDossier ? getDossierBrief(selectedDossier.summary, selectedDossier.fullText) : '',
        [selectedDossier]
    );
    const selectedDossierBodyBlocks = useMemo(
        () => selectedDossier ? getDossierBodyBlocks(selectedDossier.fullText) : [],
        [selectedDossier]
    );
    const selectedDossierSourceLinks = useMemo(
        () => selectedDossier ? getDossierSourceLinks(selectedDossier).slice(0, 8) : [],
        [selectedDossier]
    );
    const selectedDossierMetaChips = useMemo(() => {
        if (!selectedDossier) {
            return [];
        }

        const chips = [
            selectedDossier.origin ? formatDossierMetaLabel(selectedDossier.origin) : 'Evidence',
            selectedDossier.rabbitTool ? formatDossierMetaLabel(selectedDossier.rabbitTool) : '',
            selectedDossier.rabbitPass ? `Pass ${selectedDossier.rabbitPass}` : '',
            selectedDossier.evidenceRole ? formatDossierMetaLabel(selectedDossier.evidenceRole) : '',
            selectedDossier.images?.length ? `${selectedDossier.images.length} image${selectedDossier.images.length === 1 ? '' : 's'}` : '',
        ];

        return chips.filter(Boolean);
    }, [selectedDossier]);
    const supportBandScreenStyle = useCallback((band: SupportingEvidenceBand) => ({
        width: `${band.width}px`,
        height: `${band.height}px`,
        transform: `translate(${(band.x * boardViewport.zoom) + boardViewport.x}px, ${(band.y * boardViewport.zoom) + boardViewport.y}px) scale(${boardViewport.zoom})`,
    }), [boardViewport.x, boardViewport.y, boardViewport.zoom]);
    const supportTetherScreenPoint = useCallback((point: XYPosition) => ({
        x: (point.x * boardViewport.zoom) + boardViewport.x,
        y: (point.y * boardViewport.zoom) + boardViewport.y,
    }), [boardViewport.x, boardViewport.y, boardViewport.zoom]);

    useEffect(() => {
        if (supportHoverNodeId && !nodes.some((node) => node.id === supportHoverNodeId)) {
            setSupportHoverNodeId(null);
        }
    }, [nodes, supportHoverNodeId]);

    useEffect(() => {
        const updateViewportSize = () => {
            const rect = flowWrapperRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                return;
            }

            setBoardViewportSize((current) => (
                current.width === rect.width && current.height === rect.height
                    ? current
                    : { width: rect.width, height: rect.height }
            ));
        };

        updateViewportSize();

        if (!flowWrapperRef.current || typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateViewportSize);
        observer.observe(flowWrapperRef.current);

        return () => observer.disconnect();
    }, []);

    const startBoardRestoreLoad = useCallback((nextInvestigationId: string) => {
        const startedAt = getBoardLoadNow();

        if (boardRestoreOverlayTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreOverlayTimeoutRef.current);
            boardRestoreOverlayTimeoutRef.current = null;
        }

        setBoardRestoreOverlay({
            investigationId: nextInvestigationId,
            startedAt,
            source: 'loading',
        });
        console.debug('[BoardLoad] started', { investigationId: nextInvestigationId });

        return startedAt;
    }, []);

    const finishBoardRestoreLoad = useCallback((
        nextInvestigationId: string,
        startedAt: number,
        source: string,
        nodeCount: number,
        edgeCount: number
    ) => {
        const durationMs = Math.max(0, Math.round(getBoardLoadNow() - startedAt));
        console.info('[BoardLoad] restored', {
            investigationId: nextInvestigationId,
            source,
            durationMs,
            nodeCount,
            edgeCount,
        });
        window.dispatchEvent(new CustomEvent<BoardRestoreCompleteDetail>(BOARD_RESTORE_COMPLETE_EVENT, {
            detail: {
                investigationId: nextInvestigationId,
                source,
                durationMs,
                nodeCount,
                edgeCount,
            },
        }));

        const hideDelayMs = Math.min(
            BOARD_RESTORE_OVERLAY_MAX_MS,
            Math.max(BOARD_RESTORE_OVERLAY_MIN_MS - durationMs, INITIAL_RESTORE_VIEWPORT_FIT_DELAY_MS)
        );

        setBoardRestoreOverlay({
            investigationId: nextInvestigationId,
            startedAt,
            source,
        });

        if (boardRestoreOverlayTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreOverlayTimeoutRef.current);
        }

        boardRestoreOverlayTimeoutRef.current = window.setTimeout(() => {
            boardRestoreOverlayTimeoutRef.current = null;
            setBoardRestoreOverlay((current) => (
                current?.investigationId === nextInvestigationId && current.startedAt === startedAt
                    ? null
                    : current
            ));
        }, hideDelayMs);
    }, []);

    const persistTagStyles = useCallback((nextStyles: Record<string, TagStyle>) => {
        setTagStyles(nextStyles);
        localStorage.setItem('board_tag_styles', JSON.stringify(nextStyles));
    }, []);

    const clearMarqueeSelection = useCallback(() => {
        setMarquee(null);
        marqueeSelectedIdsRef.current.clear();
        marqueePointerIdRef.current = null;
    }, []);

    const closeRelationshipLegend = useCallback(() => {
        setShowRelationshipLegend(false);
        setEditingTag(null);
    }, []);

    const openRelationshipLegend = useCallback(() => {
        setShowRelationshipLegend(true);
    }, []);

    const clearConnectionRevealForEdges = useCallback((edgeIds: string[]) => {
        if (edgeIds.length === 0) {
            return;
        }

        const edgeIdSet = new Set(edgeIds);
        setEdges((currentEdges) => currentEdges.map((edge) => {
            if (!edgeIdSet.has(edge.id)) {
                return edge;
            }

            const {
                isConnectionRevealing: _isConnectionRevealing,
                connectionRevealStartedAt: _connectionRevealStartedAt,
                ...stableData
            } = edge.data || {};

            return {
                ...edge,
                data: stableData,
            };
        }));
    }, []);

    const scheduleConnectionRevealCleanup = useCallback((edgeIds: string[]) => {
        edgeIds.forEach((edgeId) => {
            const existingTimeout = connectionRevealTimeoutsRef.current.get(edgeId);
            if (existingTimeout) {
                window.clearTimeout(existingTimeout);
            }

            const timeoutId = window.setTimeout(() => {
                connectionRevealTimeoutsRef.current.delete(edgeId);
                clearConnectionRevealForEdges([edgeId]);
            }, CONNECTION_REVEAL_DURATION_MS);

            connectionRevealTimeoutsRef.current.set(edgeId, timeoutId);
        });
    }, [clearConnectionRevealForEdges]);

    const stripNodeEntryFromNodes = useCallback((nodesToStrip: Node[]) => nodesToStrip.map((node) => {
        const {
            nodeEntryAnimation: _nodeEntryAnimation,
            nodeEntryDelayMs: _nodeEntryDelayMs,
            nodeEntryStartedAt: _nodeEntryStartedAt,
            nodeEntrySequence: _nodeEntrySequence,
            ...stableData
        } = node.data || {};

        return {
            ...node,
            data: stableData,
        };
    }), []);

    const cancelNodeEntryCleanupForNodes = useCallback((nodeIds: string[]) => {
        nodeIds.forEach((nodeId) => {
            const activeTimeout = nodeEntryTimeoutsRef.current.get(nodeId);
            if (activeTimeout) {
                window.clearTimeout(activeTimeout);
                nodeEntryTimeoutsRef.current.delete(nodeId);
            }
        });
    }, []);

    const clearNodeEntryForNodes = useCallback((nodeIds: string[]) => {
        const targetIds = new Set(nodeIds);
        if (targetIds.size === 0) {
            return;
        }

        setNodes((currentNodes) => currentNodes.map((node) => {
            if (!targetIds.has(node.id)) {
                return node;
            }

            return stripNodeEntryFromNodes([node])[0] || node;
        }));
    }, [stripNodeEntryFromNodes]);

    const createNodeEntryMetadata = useCallback((isImported: boolean) => {
        const sequence = nodeEntrySequenceRef.current;
        nodeEntrySequenceRef.current += 1;
        const nodeEntryDelayMs = Math.min(sequence * NODE_ENTRY_STAGGER_MS, NODE_ENTRY_MAX_DELAY_MS);

        return {
            nodeEntryAnimation: isImported ? 'imported' as const : 'evidence' as const,
            nodeEntryDelayMs,
            nodeEntryStartedAt: Date.now(),
            nodeEntrySequence: sequence,
        };
    }, []);

    const scheduleNodeEntryCleanup = useCallback((nodeId: string, delayMs = 0) => {
        const activeTimeout = nodeEntryTimeoutsRef.current.get(nodeId);
        if (activeTimeout) {
            window.clearTimeout(activeTimeout);
        }

        const timeoutId = window.setTimeout(() => {
            nodeEntryTimeoutsRef.current.delete(nodeId);
            clearNodeEntryForNodes([nodeId]);
        }, NODE_ENTRY_ANIMATION_DURATION_MS + delayMs);

        nodeEntryTimeoutsRef.current.set(nodeId, timeoutId);
    }, [clearNodeEntryForNodes]);

    const clearPersonaScanForNodes = useCallback((nodeIds: string[]) => {
        const targetIds = new Set(nodeIds);
        if (targetIds.size === 0) {
            return;
        }

        setNodes((currentNodes) => currentNodes.map((node) => {
            if (!targetIds.has(node.id)) {
                return node;
            }

            const {
                isPersonaScanActive: _isPersonaScanActive,
                personaScanStartedAt: _personaScanStartedAt,
                ...stableData
            } = node.data || {};

            return {
                ...node,
                data: stableData,
            };
        }));
    }, []);

    const schedulePersonaScanCleanup = useCallback((nodeIds: string[]) => {
        nodeIds.forEach((nodeId) => {
            const activeTimeout = personaScanTimeoutsRef.current.get(nodeId);
            if (activeTimeout) {
                window.clearTimeout(activeTimeout);
            }

            const timeoutId = window.setTimeout(() => {
                personaScanTimeoutsRef.current.delete(nodeId);
                clearPersonaScanForNodes([nodeId]);
            }, PERSONA_SCAN_DURATION_MS);

            personaScanTimeoutsRef.current.set(nodeId, timeoutId);
        });
    }, [clearPersonaScanForNodes]);

    const clearLayoutChoreographyTimeouts = useCallback(() => {
        layoutChoreographyTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        layoutChoreographyTimeoutsRef.current = [];
    }, []);

    const trackLayoutChoreographyTimeout = useCallback((callback: () => void, delayMs: number) => {
        const timeoutId = window.setTimeout(() => {
            layoutChoreographyTimeoutsRef.current = layoutChoreographyTimeoutsRef.current.filter((activeTimeoutId) => activeTimeoutId !== timeoutId);
            callback();
        }, delayMs);

        layoutChoreographyTimeoutsRef.current.push(timeoutId);
        return timeoutId;
    }, []);

    const markNodesForLayoutChoreography = useCallback((nodesToMark: Node[]) => {
        const startedAt = Date.now();

        return nodesToMark.map((node) => ({
            ...node,
            className: appendClassName((node as Node & { className?: string }).className, LAYOUT_CHOREOGRAPHY_NODE_CLASS),
            data: {
                ...node.data,
                isLayoutChoreographyActive: true,
                layoutChoreographyStartedAt: startedAt,
            },
        }));
    }, []);

    const stripLayoutChoreographyFromNodes = useCallback((nodesToStrip: Node[]) => nodesToStrip.map((node) => {
        const {
            isLayoutChoreographyActive: _isLayoutChoreographyActive,
            layoutChoreographyStartedAt: _layoutChoreographyStartedAt,
            ...stableData
        } = node.data || {};
        const stableClassName = removeClassName((node as Node & { className?: string }).className, LAYOUT_CHOREOGRAPHY_NODE_CLASS);
        const stableNode = {
            ...node,
            data: stableData,
        } as Node & { className?: string };

        if (stableClassName) {
            stableNode.className = stableClassName;
        } else {
            delete stableNode.className;
        }

        return stableNode;
    }), []);

    const clearLayoutChoreographyState = useCallback(() => {
        clearLayoutChoreographyTimeouts();
        isLayoutChoreographyActiveRef.current = false;
        connectChoreographyBaseNodesRef.current = [];
        connectChoreographyBaseEdgesRef.current = [];
        setNodes((currentNodes) => stripLayoutChoreographyFromNodes(currentNodes));
    }, [clearLayoutChoreographyTimeouts, stripLayoutChoreographyFromNodes]);

    const handleConnectionHover = useCallback((payload: { edgeId?: string; source?: string; target?: string; color?: string; active?: boolean }) => {
        const highlightIds = [payload.source, payload.target].filter((id): id is string => Boolean(id));
        if (highlightIds.length === 0) {
            return;
        }

        const shouldHighlight = payload.active === true;
        const highlightColor = typeof payload.color === 'string' && payload.color.trim()
            ? payload.color.trim()
            : '#8ee8ff';
        const highlightNodeIds = new Set(highlightIds);

        setConnectionHover((currentHover) => {
            if (!shouldHighlight) {
                return !payload.edgeId || currentHover?.edgeId === payload.edgeId ? null : currentHover;
            }

            return {
                edgeId: payload.edgeId,
                nodeIds: highlightIds,
                color: highlightColor,
            };
        });

        setNodes((currentNodes) => currentNodes.map((node) => {
            if (!highlightNodeIds.has(node.id)) {
                return node;
            }

            return {
                ...node,
                data: {
                    ...node.data,
                    isConnectionHighlighted: shouldHighlight,
                    connectionHighlightColor: shouldHighlight ? highlightColor : undefined,
                },
            };
        }));
    }, [setNodes]);

    const openImageLightbox = useCallback((images: NodeImageAsset[], initialIndex = 0, nodeTitle?: string, nodeId?: string) => {
        if (!images.length) {
            return;
        }

        if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
            previousFocusedElementRef.current = document.activeElement;
        }

        const clampedIndex = Math.max(0, Math.min(initialIndex, images.length - 1));
        setImageLightbox({
            images,
            nodeTitle,
            index: clampedIndex,
            nodeId,
        });
    }, []);

    const closeImageLightbox = useCallback(() => {
        setImageLightbox(null);
    }, []);

    const stepImageLightbox = useCallback((direction: -1 | 1) => {
        setImageLightbox((current) => {
            if (!current || current.images.length <= 1) {
                return current;
            }

            return {
                ...current,
                index: (current.index + direction + current.images.length) % current.images.length,
            };
        });
    }, []);

    const isBoardBusy = isAnalyzing || isGathering || isReorganizing;
    const hasNodes = nodes.length > 0;
    const isBoardEmptyIdle = showGrid && !isBoardBusy && !deepDiveTopic && nodes.length === 0 && edges.length === 0;
    const canConnectDots = !isAnalyzing && !isGathering && !isReorganizing && nodes.length >= 2;
    const canExport = hasNodes && !isReorganizing;
    const activeLightboxImage = imageLightbox ? imageLightbox.images[imageLightbox.index] : null;

    const syncOpenLightboxImages = useCallback((nodeId: string, nextImages: NodeImageAsset[]) => {
        setImageLightbox((current) => {
            if (!current || current.nodeId !== nodeId) {
                return current;
            }

            if (nextImages.length === 0) {
                return null;
            }

            const nextIndex = Math.min(current.index, nextImages.length - 1);
            return {
                ...current,
                images: nextImages,
                index: nextIndex,
            };
        });
    }, []);
    const canArrange = hasNodes && !isBoardBusy;
    const canAppendSearch = !!investigationId && !isBoardBusy && appendSearchPrompt.trim().length > 0;
    const hasPendingEvidenceIntegration = pendingIntegrationNodeIds.length > 0;
    const minimapLayout = isMiniMapExpanded ? MINIMAP_PANEL_LAYOUT.expanded : MINIMAP_PANEL_LAYOUT.compact;
    const toolbarPosition = {
        left: MINIMAP_PANEL_OFFSET.left + minimapLayout.panel.width + MINIMAP_PANEL_OFFSET.toolbarGap,
        right: 24,
    };

    const ensureTagStyles = useCallback((tags: string[]) => {
        const normalizedTags = tags.map(tag => normalizeRelationshipTag(tag));
        const missingTags = normalizedTags.filter(tag => !tagStyles[tag]);

        if (missingTags.length === 0) {
            return tagStyles;
        }

        const nextStyles = { ...tagStyles };
        missingTags.forEach((tag) => {
            nextStyles[tag] = createTagStyle(tag);
        });

        persistTagStyles(nextStyles);
        return nextStyles;
    }, [persistTagStyles, tagStyles]);

    const buildEdgeVisuals = useCallback((tag: string, styles: Record<string, TagStyle>) => {
        const normalizedTag = normalizeRelationshipTag(tag);
        const styleDef = styles[normalizedTag] || createTagStyle(normalizedTag);
        const edgeVisuals = getRelationshipEdgeVisuals(styleDef.pattern, styleDef.shape);

        return {
            tag: normalizedTag,
            color: styleDef.color,
            pattern: styleDef.pattern,
            shape: styleDef.shape,
            ...edgeVisuals,
        };
    }, []);

    const clearBoardCameraMovement = useCallback(() => {
        if (boardCameraMovementTimeoutRef.current !== null) {
            window.clearTimeout(boardCameraMovementTimeoutRef.current);
            boardCameraMovementTimeoutRef.current = null;
        }
        setIsBoardCameraMoving(false);
    }, []);

    const startBoardCameraMovement = useCallback((durationMs: number) => {
        const motionDuration = getBoardCameraMotionDuration(durationMs);

        if (boardCameraMovementTimeoutRef.current !== null) {
            window.clearTimeout(boardCameraMovementTimeoutRef.current);
            boardCameraMovementTimeoutRef.current = null;
        }

        if (motionDuration <= 0) {
            setIsBoardCameraMoving(false);
            return 0;
        }

        setIsBoardCameraMoving(true);
        boardCameraMovementTimeoutRef.current = window.setTimeout(() => {
            setIsBoardCameraMoving(false);
            boardCameraMovementTimeoutRef.current = null;
        }, motionDuration + BOARD_CAMERA_SETTLE_BUFFER_MS);

        return motionDuration;
    }, []);

    useEffect(() => () => {
        if (boardCameraMovementTimeoutRef.current !== null) {
            window.clearTimeout(boardCameraMovementTimeoutRef.current);
            boardCameraMovementTimeoutRef.current = null;
        }
    }, []);

    const handleMiniMapNavigate = useCallback((position: XYPosition, interaction: BoardNavigatorInteraction) => {
        const duration = startBoardCameraMovement(interaction === 'drag'
            ? BOARD_MINIMAP_DRAG_DURATION_MS
            : BOARD_MINIMAP_GLIDE_DURATION_MS);
        setCenter(position.x, position.y, {
            zoom: getZoom(),
            duration,
        });
    }, [getZoom, setCenter, startBoardCameraMovement]);

    const getViewportCenteredNodePosition = useCallback((
        frame: { width: number; height: number },
        mode: BoardMode = boardMode
    ) => {
        const wrapperRect = flowWrapperRef.current?.getBoundingClientRect();
        const screenCenter = wrapperRect
            ? {
                x: wrapperRect.left + wrapperRect.width / 2,
                y: wrapperRect.top + wrapperRect.height / 2,
            }
            : {
                x: typeof window !== 'undefined' ? window.innerWidth / 2 : frame.width / 2,
                y: typeof window !== 'undefined' ? window.innerHeight / 2 : frame.height / 2,
            };
        const flowCenter = screenToFlowPosition(screenCenter);
        const rawPosition = {
            x: flowCenter.x - (frame.width / 2),
            y: flowCenter.y - (frame.height / 2),
        };

        if (mode === 'strict-grid') {
            return {
                x: snapCoordinateToGrid(rawPosition.x),
                y: snapCoordinateToGrid(rawPosition.y),
            };
        }

        return rawPosition;
    }, [boardMode, screenToFlowPosition]);

    const getNodeEntryStagingPosition = useCallback((
        frame: { width: number; height: number },
        mode: BoardMode,
        sequence: number
    ) => {
        const basePosition = getViewportCenteredNodePosition(frame, mode);
        const stagingOffsets = [
            { x: 0, y: 0 },
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: 1, y: 1 },
            { x: 0, y: -1 },
            { x: -1, y: -1 },
            { x: 1, y: -1 },
        ];
        const offset = stagingOffsets[sequence % stagingOffsets.length];
        const ring = Math.floor(sequence / stagingOffsets.length);
        const spacingX = snapCoordinateToGrid(Math.max(frame.width + BOARD_GRID_SIZE * 4, BOARD_GRID_SIZE * 16));
        const spacingY = snapCoordinateToGrid(Math.max(frame.height + BOARD_GRID_SIZE * 3, BOARD_GRID_SIZE * 11));
        const rawPosition = {
            x: basePosition.x + offset.x * spacingX + ring * BOARD_GRID_SIZE * 2,
            y: basePosition.y + offset.y * spacingY + ring * BOARD_GRID_SIZE * 2,
        };

        if (mode === 'strict-grid') {
            return {
                x: snapCoordinateToGrid(rawPosition.x),
                y: snapCoordinateToGrid(rawPosition.y),
            };
        }

        return rawPosition;
    }, [getViewportCenteredNodePosition]);

    const markNodeAsRecentlyImported = useCallback((nodeId: string) => {
        const activeTimeout = recentImportTimeoutsRef.current.get(nodeId);
        if (activeTimeout) {
            window.clearTimeout(activeTimeout);
        }

        setNodes((currentNodes) => currentNodes.map((node) => (
            node.id === nodeId
                ? {
                    ...node,
                    data: {
                        ...node.data,
                        isRecentlyImported: true,
                    }
                }
                : node
        )));

        const timeoutId = window.setTimeout(() => {
            recentImportTimeoutsRef.current.delete(nodeId);
            setNodes((currentNodes) => currentNodes.map((node) => (
                node.id === nodeId
                    ? {
                        ...node,
                        data: {
                            ...node.data,
                            isRecentlyImported: false,
                        }
                    }
                    : node
            )));
        }, RECENT_IMPORT_HIGHLIGHT_DURATION_MS);

        recentImportTimeoutsRef.current.set(nodeId, timeoutId);
    }, []);

    const applyPersonaInsightsToNodes = useCallback((insights: Array<{
        personaName: string;
        perspective: string;
        keyFindings: string[];
        connections: string[];
        observations?: string[];
        hypotheses?: string[];
        questions: string[];
        confidence: number;
        fullAnalysis: string;
        nodeIDs: string[];
        proposedConnections?: Array<{
            source: string;
            target: string;
            tag: string;
            reasoning: string;
            evidenceNodeIDs: string[];
            confidence: number;
        }>;
    }>) => {
        if (!Array.isArray(insights)) {
            return;
        }

        const scannedNodeIds = new Set(
            insights
                .flatMap((insight) => Array.isArray(insight.nodeIDs) ? insight.nodeIDs : [])
                .filter((nodeId): nodeId is string => typeof nodeId === 'string')
        );
        console.debug('[PERSONA_INSIGHTS] Current nodes:', nodesRef.current.map(n => ({ id: n.id, title: n.data.title })));

        setNodes((nds) => nds.map(node => {
            const nodeInsights = insights.filter(insight =>
                insight.nodeIDs && insight.nodeIDs.includes(node.id)
            );
            console.debug(`[PERSONA_INSIGHTS] Node ${node.id}: matched ${nodeInsights.length} insights, all nodeIDs:`, insights.map(i => i.nodeIDs));

            const nextData = {
                ...node.data,
                personaInsights: nodeInsights
            };

            if (nodeInsights.length > 0) {
                return {
                    ...node,
                    data: {
                        ...nextData,
                        isPersonaScanActive: true,
                        personaScanStartedAt: Date.now(),
                    }
                };
            }

            const {
                isPersonaScanActive: _isPersonaScanActive,
                personaScanStartedAt: _personaScanStartedAt,
                ...stableData
            } = nextData;

            return {
                ...node,
                data: stableData,
            };
        }));

        schedulePersonaScanCleanup(Array.from(scannedNodeIds));
    }, [schedulePersonaScanCleanup]);

    const decorateStrictGridEdges = useCallback((nextEdges: Edge[], nextNodes: Node[]) => {
        const nodeMap = new Map(nextNodes.map((node) => [node.id, node]));
        const assignments = assignStrictGridPorts(nextEdges, nextNodes);

        return nextEdges.map((edge) => {
            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);

            if (!sourceNode || !targetNode) {
                return {
                    ...edge,
                    zIndex: STRICT_GRID_EDGE_Z_INDEX,
                    data: {
                        ...edge.data,
                        boardMode: 'strict-grid' as BoardMode,
                        onConnectionHover: handleConnectionHover,
                        snapEnabled: snapConnectionLabels,
                    }
                };
            }

            const route = assignments.get(edge.id)?.route || buildStrictGridRoute(
                sourceNode,
                targetNode,
                edge.sourceHandle,
                edge.targetHandle
            );
            const routeSourcePoint = getPortById(sourceNode, route.sourcePortId);
            const routeTargetPoint = getPortById(targetNode, route.targetPortId);

            if (import.meta.env.DEV) {
                console.debug('[StrictGridRoute]', {
                    edgeId: edge.id,
                    source: edge.source,
                    target: edge.target,
                    sourceHandleIn: edge.sourceHandle,
                    targetHandleIn: edge.targetHandle,
                    sourceHandleOut: route.sourcePortId,
                    targetHandleOut: route.targetPortId,
                    routePoints: route.points,
                    routeSourcePoint,
                    routeTargetPoint,
                });
            }

            return {
                ...edge,
                sourceHandle: route.sourcePortId,
                targetHandle: route.targetPortId,
                type: 'customEdge',
                zIndex: STRICT_GRID_EDGE_Z_INDEX,
                data: {
                    ...edge.data,
                    boardMode: 'strict-grid' as BoardMode,
                    routePoints: route.points,
                    routeStrategy: route.strategy,
                    routeLabelPoint: route.labelPoint,
                    routeSourcePoint,
                    routeTargetPoint,
                    sourcePortSide: route.sourceSide,
                    targetPortSide: route.targetSide,
                    onConnectionHover: handleConnectionHover,
                    snapEnabled: snapConnectionLabels,
                }
            };
        });
    }, [handleConnectionHover, snapConnectionLabels]);

    const buildStrictGridState = useCallback((nextEdges: Edge[], nextNodes = nodesRef.current) => {
        const collectActivePortIds = (edgesToInspect: Edge[]) => {
            const activePortIdsByNode = new Map<string, Set<string>>();

            edgesToInspect.forEach((edge) => {
                if (edge.sourceHandle) {
                    if (!activePortIdsByNode.has(edge.source)) {
                        activePortIdsByNode.set(edge.source, new Set<string>());
                    }
                    activePortIdsByNode.get(edge.source)?.add(edge.sourceHandle);
                }

                if (edge.targetHandle) {
                    if (!activePortIdsByNode.has(edge.target)) {
                        activePortIdsByNode.set(edge.target, new Set<string>());
                    }
                    activePortIdsByNode.get(edge.target)?.add(edge.targetHandle);
                }
            });

            return activePortIdsByNode;
        };

        const normalizedNodes = normalizeStrictGridNodes(nextNodes);
        const strictEdges = decorateStrictGridEdges(nextEdges, normalizedNodes);
        const activePortIdsByNode = collectActivePortIds(strictEdges);
        const nodesWithActivePorts = normalizedNodes.map((node) => ({
            ...node,
            data: {
                ...node.data,
                activePortIds: Array.from(activePortIdsByNode.get(node.id) || []),
            }
        }));

        const finalizedStrictEdges = decorateStrictGridEdges(strictEdges, nodesWithActivePorts);
        const finalizedActivePortIdsByNode = collectActivePortIds(finalizedStrictEdges);
        const finalizedNodes = nodesWithActivePorts.map((node) => ({
            ...node,
            data: {
                ...node.data,
                activePortIds: Array.from(finalizedActivePortIdsByNode.get(node.id) || []),
            }
        }));

        logResizePipelineDebug('strict-sync-all', {
            nodeCount: finalizedNodes.length,
            edgeCount: finalizedStrictEdges.length,
        });
        const supportLayerState = layoutSupportingEvidenceNodes(finalizedNodes, finalizedStrictEdges);

        return {
            nodes: supportLayerState.nodes,
            edges: finalizedStrictEdges,
        };
    }, [decorateStrictGridEdges]);

    const syncStrictGridEdgesToNodes = useCallback((nextEdges: Edge[], nextNodes = nodesRef.current) => {
        const finalizedState = buildStrictGridState(nextEdges, nextNodes);

        setBoardMode('strict-grid');
        setNodes(finalizedState.nodes);
        setEdges(finalizedState.edges);
    }, [buildStrictGridState]);

    const syncStrictGridSubset = useCallback((
        changedNodeIds: string[],
        nextEdges = edgesRef.current,
        nextNodes = nodesRef.current
    ) => {
        const changedNodeIdSet = new Set(changedNodeIds);
        if (changedNodeIdSet.size === 0) {
            return;
        }

        const normalizedNodes = normalizeStrictGridNodes(nextNodes);
        const normalizedNodeMap = new Map(normalizedNodes.map((node) => [node.id, node]));
        const affectedEdges = nextEdges.filter((edge) => changedNodeIdSet.has(edge.source) || changedNodeIdSet.has(edge.target));
        const affectedAssignments = assignStrictGridPorts(affectedEdges, normalizedNodes);
        const updatedEdges = nextEdges.map((edge) => {
            const route = affectedAssignments.get(edge.id)?.route;
            if (!route) {
                return edge;
            }
            const sourceNode = normalizedNodeMap.get(edge.source);
            const targetNode = normalizedNodeMap.get(edge.target);

            return {
                ...edge,
                sourceHandle: route.sourcePortId,
                targetHandle: route.targetPortId,
                type: 'customEdge',
                zIndex: STRICT_GRID_EDGE_Z_INDEX,
                data: {
                    ...edge.data,
                    boardMode: 'strict-grid' as BoardMode,
                    routePoints: route.points,
                    routeStrategy: route.strategy,
                    routeLabelPoint: route.labelPoint,
                    routeSourcePoint: sourceNode ? getPortById(sourceNode, route.sourcePortId) : undefined,
                    routeTargetPoint: targetNode ? getPortById(targetNode, route.targetPortId) : undefined,
                    sourcePortSide: route.sourceSide,
                    targetPortSide: route.targetSide,
                    snapEnabled: snapConnectionLabels,
                }
            };
        });

        const activePortIdsByNode = new Map<string, Set<string>>();
        updatedEdges.forEach((edge) => {
            if (edge.sourceHandle) {
                if (!activePortIdsByNode.has(edge.source)) {
                    activePortIdsByNode.set(edge.source, new Set<string>());
                }
                activePortIdsByNode.get(edge.source)?.add(edge.sourceHandle);
            }

            if (edge.targetHandle) {
                if (!activePortIdsByNode.has(edge.target)) {
                    activePortIdsByNode.set(edge.target, new Set<string>());
                }
                activePortIdsByNode.get(edge.target)?.add(edge.targetHandle);
            }
        });

        const finalizedNodes = normalizedNodes.map((node) => {
            if (!changedNodeIdSet.has(node.id) && !activePortIdsByNode.has(node.id)) {
                return node;
            }

            return {
                ...node,
                data: {
                    ...node.data,
                    activePortIds: Array.from(activePortIdsByNode.get(node.id) || []),
                }
            };
        });
        const supportLayerState = layoutSupportingEvidenceNodes(finalizedNodes, updatedEdges);

        logResizePipelineDebug('strict-sync-subset', {
            changedNodeIds,
            changedCount: changedNodeIds.length,
        });

        setBoardMode('strict-grid');
        setNodes(supportLayerState.nodes);
        setEdges(updatedEdges);
    }, [snapConnectionLabels]);

    const updateStrictGridDragRoutes = useCallback((
        changedNodeIds: string[],
        nextNodes: Node[]
    ) => {
        const changedNodeIdSet = new Set(changedNodeIds);
        if (changedNodeIdSet.size === 0) {
            return;
        }

        const nodeMap = new Map(nextNodes.map((node) => [node.id, node]));
        setEdges((currentEdges) => {
            const assignments = assignStrictGridPorts(currentEdges, nextNodes);

            return currentEdges.map((edge) => {
                if (!changedNodeIdSet.has(edge.source) && !changedNodeIdSet.has(edge.target)) {
                    return edge;
                }

                const sourceNode = nodeMap.get(edge.source);
                const targetNode = nodeMap.get(edge.target);
                if (!sourceNode || !targetNode) {
                    return edge;
                }

                const route = assignments.get(edge.id)?.route || buildStrictGridRoute(
                    sourceNode,
                    targetNode,
                    edge.sourceHandle,
                    edge.targetHandle
                );
                const routeSourcePoint = getPortById(sourceNode, route.sourcePortId);
                const routeTargetPoint = getPortById(targetNode, route.targetPortId);

                return {
                    ...edge,
                    sourceHandle: route.sourcePortId,
                    targetHandle: route.targetPortId,
                    type: 'customEdge',
                    zIndex: STRICT_GRID_EDGE_Z_INDEX,
                    data: {
                        ...edge.data,
                        boardMode: 'strict-grid' as BoardMode,
                        routePoints: route.points,
                        routeStrategy: route.strategy,
                        routeLabelPoint: route.labelPoint,
                        routeSourcePoint,
                        routeTargetPoint,
                        sourcePortSide: route.sourceSide,
                        targetPortSide: route.targetSide,
                        snapEnabled: snapConnectionLabels,
                    }
                };
            });
        });
    }, [snapConnectionLabels]);

    const openRelationshipEditor = useCallback((draft: RelationshipDraft) => {
        setRelationshipDraft(draft);
        setRelationshipNameInput(draft.initialValue);
    }, []);

    const closeRelationshipEditor = useCallback(() => {
        setRelationshipDraft(null);
        setRelationshipNameInput('RELATED');
    }, []);

    const appendSearchToInvestigation = useCallback(() => {
        const prompt = appendSearchPrompt.trim();
        if (!prompt) {
            return;
        }
        if (!investigationId) {
            alert('Select an investigation before appending more search.');
            return;
        }
        if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
            alert('Connection lost. Please wait for reconnect.');
            return;
        }

        setIsGathering(true);
        setAppendSearchPrompt('');
        sharedSocket.send(JSON.stringify({
            type: 'APPEND_CRAWL',
            payload: prompt,
            vaultId: investigationId,
            scrapeImages: readImageScrapingPreference(),
        }));
    }, [appendSearchPrompt, investigationId, sharedSocket]);

    const addPendingIntegrationNodeId = useCallback((nodeId: string) => {
        setPendingIntegrationNodeIds((currentIds) => (
            currentIds.includes(nodeId) ? currentIds : [...currentIds, nodeId]
        ));
    }, []);

    const clearPendingIntegrationNodeIds = useCallback(() => {
        setPendingIntegrationNodeIds([]);
    }, []);

    const syncEdgesToNodes = useCallback((nextEdges: Edge[], nextNodes = nodesRef.current) => {
        if (boardMode === 'strict-grid') {
            syncStrictGridEdgesToNodes(nextEdges, nextNodes);
            return;
        }

        const { edges: finalEdges, handledNodes } = distributeEdges(nextEdges, nextNodes);
        const supportLayerState = layoutSupportingEvidenceNodes(handledNodes, finalEdges);
        setNodes(supportLayerState.nodes);
        setEdges(finalEdges);
    }, [boardMode, syncStrictGridEdgesToNodes]);

    const buildConnectLayoutState = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
        if (boardMode === 'strict-grid') {
            const layoutedNodes = getStrictGridLayoutedNodes(nextNodes, nextEdges);
            return buildStrictGridState(nextEdges, layoutedNodes);
        }

        const { edges: finalEdges, handledNodes } = distributeEdges(nextEdges, nextNodes);
        const { nodes: layoutedNodes } = getLayoutedElements(handledNodes, finalEdges);
        const supportLayerState = layoutSupportingEvidenceNodes(layoutedNodes, finalEdges);

        return {
            nodes: supportLayerState.nodes,
            edges: finalEdges,
        };
    }, [boardMode, buildStrictGridState]);

    const buildFixedLayoutEdgeState = useCallback((layoutedNodes: Node[], nextEdges: Edge[]) => {
        if (boardMode === 'strict-grid') {
            return buildStrictGridState(nextEdges, layoutedNodes);
        }

        return {
            nodes: layoutSupportingEvidenceNodes(layoutedNodes, nextEdges).nodes,
            edges: nextEdges,
        };
    }, [boardMode, buildStrictGridState]);

    const startConnectLayoutChoreography = useCallback((nextNodes: Node[], nextEdges: Edge[]) => {
        clearLayoutChoreographyTimeouts();
        isLayoutChoreographyActiveRef.current = true;
        const stableNodes = stripNodeEntryFromNodes(nextNodes);
        cancelNodeEntryCleanupForNodes(stableNodes.map((node) => node.id));
        connectChoreographyBaseNodesRef.current = stableNodes;
        connectChoreographyBaseEdgesRef.current = nextEdges;
        visibleConnectEdgeIdsRef.current = new Set(nextEdges.map((edge) => edge.id));
        const layoutState = buildConnectLayoutState(stableNodes, nextEdges);

        setBoardMode(boardMode);
        setNodes(markNodesForLayoutChoreography(layoutState.nodes));
        setEdges(layoutState.edges);
        trackLayoutChoreographyTimeout(() => {
            const duration = startBoardCameraMovement(BOARD_CAMERA_GLIDE_DURATION_MS);
            fitView({ duration, ...BOARD_FIT_VIEW_OPTIONS });
        }, 100);
    }, [boardMode, buildConnectLayoutState, cancelNodeEntryCleanupForNodes, clearLayoutChoreographyTimeouts, fitView, markNodesForLayoutChoreography, startBoardCameraMovement, stripNodeEntryFromNodes, trackLayoutChoreographyTimeout]);

    const finishConnectLayoutChoreography = useCallback((finalNodes: Node[], immediateEdges: Edge[], finalEdges: Edge[], delayedEdgeIds: string[], pendingIdsForPersistence = pendingIntegrationNodeIdsRef.current) => {
        clearLayoutChoreographyTimeouts();
        const settleDelayMs = getConnectLayoutSettleDelay();
        const stableFinalNodes = stripNodeEntryFromNodes(finalNodes);
        cancelNodeEntryCleanupForNodes(stableFinalNodes.map((node) => node.id));

        setNodes(markNodesForLayoutChoreography(stableFinalNodes));
        setEdges(immediateEdges);

        trackLayoutChoreographyTimeout(() => {
            isLayoutChoreographyActiveRef.current = false;
            connectChoreographyBaseNodesRef.current = [];
            connectChoreographyBaseEdgesRef.current = [];
            setNodes(stripLayoutChoreographyFromNodes(stableFinalNodes));
            setEdges(finalEdges);
            scheduleConnectionRevealCleanup(delayedEdgeIds);
            if (investigationId && loadedInvestigationId === investigationId) {
                const existingState = getCachedBoardStateForInvestigation(investigationId);
                void saveBoardStateForInvestigation(investigationId, {
                    mode: boardMode,
                    nodes: sanitizeNodesForPersistence(stableFinalNodes),
                    edges: sanitizeEdgesForPersistence(finalEdges),
                    pendingIntegrationNodeIds: pendingIdsForPersistence,
                    synthesisAlerts: existingState?.synthesisAlerts || [],
                });
            }
            setHasConnectedDots(true);
            setIsAnalyzing(false);
            setAnalysisMode(null);
            trackLayoutChoreographyTimeout(() => {
                const duration = startBoardCameraMovement(BOARD_CAMERA_GLIDE_DURATION_MS);
                fitView({ duration, ...BOARD_FIT_VIEW_OPTIONS });
            }, 100);
        }, settleDelayMs);
    }, [boardMode, cancelNodeEntryCleanupForNodes, clearLayoutChoreographyTimeouts, fitView, investigationId, loadedInvestigationId, markNodesForLayoutChoreography, scheduleConnectionRevealCleanup, startBoardCameraMovement, stripLayoutChoreographyFromNodes, stripNodeEntryFromNodes, trackLayoutChoreographyTimeout]);

    const handleDeleteNode = useCallback((id: string) => {
        setNodes(nds => nds.filter(n => n.id !== id));
        setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
        setPendingIntegrationNodeIds((currentIds) => currentIds.filter((nodeId) => nodeId !== id));
    }, [setNodes, setEdges]);

    const handleNodeExpand = useCallback((id: string, expanded: boolean) => {
        setNodes((nds) => nds.map((node) => {
            if (node.id !== id) {
                return node;
            }

            const nextFrame = node.data?.evidenceRole === 'supporting' && !expanded
                ? SUPPORT_NODE_FRAME
                : calculateNodeFrame(
                    node.data.summary || '',
                    node.data.fullText || '',
                    expanded,
                    nodeHasImages(node.data.images)
                );

            return {
                ...node,
                zIndex: expanded ? STRICT_GRID_EXPANDED_NODE_Z_INDEX : STRICT_GRID_NODE_Z_INDEX,
                data: {
                    ...node.data,
                    expanded,
                },
                style: {
                    ...node.style,
                    ...nextFrame,
                }
            };
        }));

        if (boardMode === 'strict-grid') {
            window.requestAnimationFrame(() => {
                syncStrictGridSubset([id], edgesRef.current, nodesRef.current);
            });
        }
    }, [boardMode, syncStrictGridSubset]);

    const handleUpdateNode = useCallback((id: string, data: Partial<NodeData>) => {
        console.debug(`[DetectiveBoard] Updating node ${id}`, data);
        setNodes(nds => nds.map(n => {
            if (n.id === id) {
                const nextSummary = data.summary ?? n.data.summary ?? '';
                const nextFullText = data.fullText ?? n.data.fullText ?? '';
                const nextImages = Array.isArray(data.images) ? data.images : n.data.images;
                const isExpanded = Boolean(n.data.expanded);
                const nextFrame = calculateNodeFrame(nextSummary, nextFullText, isExpanded, nodeHasImages(nextImages));

                return {
                    ...n,
                    data: { ...n.data, ...data },
                    style: {
                        ...n.style,
                        ...nextFrame,
                    }
                };
            }
            return n;
        }));

        if (boardMode === 'strict-grid') {
            window.requestAnimationFrame(() => {
                syncStrictGridSubset([id], edgesRef.current, nodesRef.current);
            });
        }
    }, [boardMode, setNodes, syncStrictGridSubset]);

    const handleAnalyzeNode = useCallback((id: string, inputText: string) => {
        if (!inputText) {
            console.warn(`[DetectiveBoard] Skipping manual analysis for ${id}: no input text`);
            return;
        }
        if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
            console.warn(`[DetectiveBoard] Skipping manual analysis for ${id}: socket not ready`);
            return;
        }

        console.debug(`[DetectiveBoard] Triggering LLM processing for node ${id}`);
        setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, isAnalyzing: true } } : n));
        sharedSocket.send(JSON.stringify({
            type: 'PROCESS_MANUAL_NODE',
            payload: {
                nodeId: id,
                text: inputText
            }
        }));
    }, [sharedSocket, setNodes]);

    const handleSaveNode = useCallback((id: string, title: string, text: string, mode: NodeSaveMode) => {
        const nextText = text;
        const existingNode = nodesRef.current.find((node) => node.id === id);
        const existingSummary = typeof existingNode?.data?.summary === 'string' ? existingNode.data.summary : '';
        const existingFullText = typeof existingNode?.data?.fullText === 'string' ? existingNode.data.fullText : '';
        const preserveFullText = shouldPreserveExistingFullText(existingSummary, existingFullText);

        handleUpdateNode(id, {
            title,
            summary: nextText,
            fullText: preserveFullText ? existingFullText : nextText,
        });

        if (mode === 'analyze-and-save') {
            handleAnalyzeNode(id, nextText);
        }
    }, [handleAnalyzeNode, handleUpdateNode]);

    const handleAttachImage = useCallback(async (nodeId: string, file: File) => {
        if (!investigationId) {
            throw new Error('Select an investigation before attaching images.');
        }

        const dataURL = await fileToDataURL(file);
        const response = await fetch(`http://localhost:8080/api/investigations/${encodeURIComponent(investigationId)}/nodes/${encodeURIComponent(nodeId)}/images`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                fileName: file.name,
                dataUrl: dataURL,
            }),
        });

        if (!response.ok) {
            throw new Error((await response.text()) || 'Failed to upload image.');
        }

        const payload = await response.json();
        const image = payload.image as NodeImageAsset | undefined;
        if (!image) {
            throw new Error('Backend did not return image metadata.');
        }

        setNodes((currentNodes) => currentNodes.map((node) => {
            if (node.id !== nodeId) {
                return node;
            }

            const nextImages = [...(Array.isArray(node.data.images) ? node.data.images : []), image];
            syncOpenLightboxImages(nodeId, nextImages);
            const nextFrame = calculateNodeFrame(
                node.data.summary || '',
                node.data.fullText || '',
                Boolean(node.data.expanded),
                nodeHasImages(nextImages)
            );

            return {
                ...node,
                data: {
                    ...node.data,
                    images: nextImages,
                },
                style: {
                    ...node.style,
                    ...nextFrame,
                },
            };
        }));

        if (boardMode === 'strict-grid') {
            window.requestAnimationFrame(() => {
                syncStrictGridSubset([nodeId], edgesRef.current, nodesRef.current);
            });
        }
    }, [boardMode, investigationId, syncOpenLightboxImages, syncStrictGridSubset]);

    const handleRemoveImage = useCallback((nodeId: string, imageId: string) => {
        setNodes((currentNodes) => currentNodes.map((node) => {
            if (node.id !== nodeId) {
                return node;
            }

            const nextImages = (Array.isArray(node.data.images) ? node.data.images : [])
                .filter((image: NodeImageAsset) => image.id !== imageId);
            syncOpenLightboxImages(nodeId, nextImages);
            const nextFrame = calculateNodeFrame(
                node.data.summary || '',
                node.data.fullText || '',
                Boolean(node.data.expanded),
                nodeHasImages(nextImages)
            );

            return {
                ...node,
                data: {
                    ...node.data,
                    images: nextImages,
                },
                style: {
                    ...node.style,
                    ...nextFrame,
                },
            };
        }));

        if (boardMode === 'strict-grid') {
            window.requestAnimationFrame(() => {
                syncStrictGridSubset([nodeId], edgesRef.current, nodesRef.current);
            });
        }
    }, [boardMode, syncOpenLightboxImages, syncStrictGridSubset]);

    const handleNodeResizeCommit = useCallback((id: string, width: number, height: number) => {
        const snappedFrame = normalizeNodeFrame(width, height);
        let nextNodesSnapshot: Node[] = [];

        logResizePipelineDebug('commit', {
            id,
            width,
            height,
            snappedWidth: snappedFrame.width,
            snappedHeight: snappedFrame.height,
        });

        setNodes((nds) => {
            const nextNodes = nds.map((node) => (
                node.id === id
                    ? {
                        ...node,
                        style: {
                            ...node.style,
                            ...snappedFrame,
                        }
                    }
                    : node
            ));

            nextNodesSnapshot = nextNodes;
            return nextNodes;
        });

        if (boardMode === 'strict-grid') {
            window.requestAnimationFrame(() => {
                syncStrictGridSubset([id], edgesRef.current, nextNodesSnapshot.length > 0 ? nextNodesSnapshot : nodesRef.current);
            });
        }
    }, [boardMode, syncStrictGridSubset]);

    const handleSetEditing = useCallback((id: string | null) => {
        console.debug(`[DetectiveBoard] Setting active editing node: ${id}`);
        setEditingNodeId(id);
        setNodes(nds => nds.map(node => ({
            ...node,
            data: {
                ...node.data,
                isEditing: node.id === id
            }
        })));
    }, [setNodes]);

    const renameRelationshipEdge = useCallback((edgeId: string) => {
        const currentEdge = edgesRef.current.find(edge => edge.id === edgeId);
        if (!currentEdge) return;

        const currentTag = normalizeRelationshipTag(currentEdge.label as string);
        openRelationshipEditor({ mode: 'rename', edgeId, initialValue: currentTag });
    }, [openRelationshipEditor]);

    const deleteRelationshipEdge = useCallback((edgeId: string) => {
        const updatedEdges = edgesRef.current.filter(edge => edge.id !== edgeId);
        syncEdgesToNodes(updatedEdges);
        setEdgeReasoning(null);
    }, [syncEdgesToNodes]);

    useEffect(() => {
        const needsActions = edges.some((edge) =>
            edge.data?.onRename !== renameRelationshipEdge ||
            edge.data?.onDelete !== deleteRelationshipEdge ||
            edge.data?.onConnectionHover !== handleConnectionHover ||
            edge.data?.snapEnabled !== snapConnectionLabels
        );

        if (!needsActions) return;

        setEdges((currentEdges) => currentEdges.map((edge) => ({
            ...edge,
            data: {
                ...edge.data,
                onRename: renameRelationshipEdge,
                onDelete: deleteRelationshipEdge,
                onConnectionHover: handleConnectionHover,
                snapEnabled: snapConnectionLabels,
            }
        })));
    }, [deleteRelationshipEdge, edges, handleConnectionHover, renameRelationshipEdge, snapConnectionLabels]);

    const lastFocusedRef = useRef<string | null>(null);
    const clearTimelineFocus = useCallback(() => {
        if (timelineFocusTimeoutRef.current !== null) {
            window.clearTimeout(timelineFocusTimeoutRef.current);
            timelineFocusTimeoutRef.current = null;
        }
        setNodes((currentNodes) => currentNodes.map((node) => {
            if (!node.data?.isTimelineFocused && !node.data?.timelineFocusStartedAt) {
                return node;
            }

            const {
                isTimelineFocused: _isTimelineFocused,
                timelineFocusStartedAt: _timelineFocusStartedAt,
                ...stableData
            } = node.data || {};
            return {
                ...node,
                data: stableData,
            };
        }));
    }, [setNodes]);

    // Handle node focusing from props (e.g. from Timeline)
    useEffect(() => {
        if (focusNodeId && focusNodeId !== lastFocusedRef.current) {
            const nodeExists = nodesRef.current.some(n => n.id === focusNodeId);

            if (nodeExists) {
                console.debug('[Board] Focusing node:', focusNodeId);
                lastFocusedRef.current = focusNodeId;

                // Close any open side panels (intel reports) to show the node clearly
                setSelectedDossier(null);

                // Center and zoom in slightly on the node
                const duration = startBoardCameraMovement(BOARD_CAMERA_GLIDE_DURATION_MS);
                fitView({ nodes: [{ id: focusNodeId }], duration, padding: 0.32, minZoom: 1, maxZoom: 1.12 });

                // Visually select it
                setNodes(nds => nds.map(n => ({
                    ...n,
                    selected: n.id === focusNodeId,
                    data: n.id === focusNodeId
                        ? {
                            ...n.data,
                            isTimelineFocused: true,
                            timelineFocusStartedAt: Date.now(),
                        }
                        : n.data,
                })));
                if (timelineFocusTimeoutRef.current !== null) {
                    window.clearTimeout(timelineFocusTimeoutRef.current);
                }
                timelineFocusTimeoutRef.current = window.setTimeout(() => {
                    clearTimelineFocus();
                }, TIMELINE_FOCUS_DURATION_MS);
            }
        } else if (!focusNodeId) {
            lastFocusedRef.current = null;
            clearTimelineFocus();
        }
    }, [clearTimelineFocus, focusNodeId, fitView, startBoardCameraMovement]);

    // Help distribute edges evenly

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const targetNode = event.target as unknown as globalThis.Node;
            const clickedExportButton = exportButtonRef.current?.contains(targetNode);
            const clickedExportPanel = exportMenuPanelRef.current?.contains(targetNode);
            if (!clickedExportButton && !clickedExportPanel) {
                setShowExportMenu(false);
            }

            const clickedBoardControlsButton = boardControlsButtonRef.current?.contains(targetNode);
            const clickedBoardControlsPanel = boardControlsPanelRef.current?.contains(targetNode);
            if (!clickedBoardControlsButton && !clickedBoardControlsPanel) {
                setShowBoardControls(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const updateExportMenuPosition = useCallback(() => {
        const container = boardContainerRef.current;
        const button = exportButtonRef.current;
        if (!container || !button) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const availableWidth = Math.max(180, Math.min(EXPORT_MENU_WIDTH, containerRect.width - (BOARD_CONTROLS_PANEL_MARGIN * 2)));
        const unclampedLeft = buttonRect.left - containerRect.left;
        const maxLeft = Math.max(BOARD_CONTROLS_PANEL_MARGIN, containerRect.width - availableWidth - BOARD_CONTROLS_PANEL_MARGIN);
        const nextLeft = Math.min(Math.max(unclampedLeft, BOARD_CONTROLS_PANEL_MARGIN), maxLeft);
        const nextTop = buttonRect.bottom - containerRect.top + 12;

        setExportMenuPosition({
            top: nextTop,
            left: nextLeft,
            width: availableWidth,
        });
    }, []);

    const updateBoardControlsPosition = useCallback(() => {
        const container = boardContainerRef.current;
        const actionBar = boardActionBarRef.current;
        const positioningRoot = boardToolbarRef.current;
        if (!container || !actionBar || !positioningRoot) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const actionBarRect = actionBar.getBoundingClientRect();
        const positioningRootRect = positioningRoot.getBoundingClientRect();
        const availableWidth = Math.max(280, Math.min(BOARD_CONTROLS_PANEL_MAX_WIDTH, containerRect.width - (BOARD_CONTROLS_PANEL_MARGIN * 2)));
        const nextTop = actionBarRect.bottom - positioningRootRect.top + 12;
        const availableHeight = Math.max(0, containerRect.bottom - actionBarRect.bottom - 12 - BOARD_CONTROLS_PANEL_MARGIN);

        setBoardControlsPosition({
            top: nextTop,
            width: availableWidth,
            maxHeight: availableHeight,
        });
    }, []);

    useEffect(() => {
        if (!showExportMenu) {
            return;
        }

        updateExportMenuPosition();

        const handleViewportChange = () => updateExportMenuPosition();
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [showExportMenu, updateExportMenuPosition]);

    useEffect(() => {
        if (!showBoardControls) {
            return;
        }

        updateBoardControlsPosition();

        const handleViewportChange = () => updateBoardControlsPosition();
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [showBoardControls, updateBoardControlsPosition]);

    const toggleExportMenu = useCallback(() => {
        if (!canExport) {
            return;
        }

        setShowBoardControls(false);
        updateExportMenuPosition();
        setShowExportMenu((current) => !current);
    }, [canExport, updateExportMenuPosition]);

    const toggleBoardControlsPanel = useCallback(() => {
        setShowExportMenu(false);
        updateBoardControlsPosition();
        setShowBoardControls((current) => !current);
    }, [updateBoardControlsPosition]);

    const recenterBoardViewport = useCallback(() => {
        setShowExportMenu(false);
        setShowBoardControls(false);
        const duration = startBoardCameraMovement(BOARD_CAMERA_GLIDE_DURATION_MS);
        fitView({
            ...BOARD_FIT_VIEW_OPTIONS,
            duration,
        });
    }, [fitView, startBoardCameraMovement]);

    const toggleDiscoveryWorkspacePanel = useCallback(() => {
        emitBoardWorkspaceEvent(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT);
    }, []);

    const toggleSynthesisWorkspacePanel = useCallback(() => {
        emitBoardWorkspaceEvent(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT);
    }, []);

    const synthesisUtilityLabel = hasTheoryReady
        ? `Toggle synthesis panel - Grand Unified Theory ready${hasUnreadTheory ? ' with unread notification' : ''}`
        : 'Toggle synthesis panel';
    const discoveryUtilityLabel = hasDiscoveryReady
        ? `Toggle discoveries panel - Discoveries ready${hasUnreadDiscoveries ? ' with unread notification' : ''}`
        : 'Toggle discoveries panel';

    const toggleRelationshipWorkspacePanel = useCallback(() => {
        setEditingTag(null);
        setShowRelationshipLegend((current) => !current);
    }, []);

    // Load tag styles on mount
    useEffect(() => {
        const saved = localStorage.getItem('board_tag_styles');
        if (saved) {
            try {
                setTagStyles(sanitizeTagStyles(JSON.parse(saved)));
            } catch (e) {
                console.error("Failed to parse tag styles", e);
            }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY, String(showRelationshipLegend));
    }, [showRelationshipLegend]);

    useEffect(() => {
        if (!imageLightbox) {
            previousFocusedElementRef.current?.focus?.();
            previousFocusedElementRef.current = null;
            return undefined;
        }

        lightboxDialogRef.current?.focus();

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeImageLightbox();
                return;
            }

            if (event.key === 'ArrowLeft') {
                stepImageLightbox(-1);
                return;
            }

            if (event.key === 'ArrowRight') {
                stepImageLightbox(1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeImageLightbox, imageLightbox, stepImageLightbox]);

    useEffect(() => {
        const savedGridPreference = localStorage.getItem('detective_board_show_grid');
        if (savedGridPreference !== null) {
            console.debug('[DetectiveBoard] Loaded grid preference:', savedGridPreference);
            setShowGrid(savedGridPreference === 'true');
        } else {
            console.debug('[DetectiveBoard] No saved grid preference found. Defaulting to visible grid.');
        }

        const savedSnappingPreference = localStorage.getItem('detective_board_snap_connection_labels');
        if (savedSnappingPreference !== null) {
            setSnapConnectionLabels(savedSnappingPreference === 'true');
        }

        const savedNodeSnappingPreference = localStorage.getItem('detective_board_snap_nodes');
        if (savedNodeSnappingPreference !== null) {
            setSnapNodes(savedNodeSnappingPreference === 'true');
        }
    }, []);

    useEffect(() => {
        clearMarqueeSelection();
    }, [clearMarqueeSelection, investigationId]);

    useEffect(() => {
        setAppendSearchPrompt('');
        setPendingIntegrationNodeIds([]);
        setIsGathering(false);
        setIsAnalyzing(false);
        setAnalysisMode(null);
        setDeepDiveTopic(null);
        setImageLightbox(null);
        relationshipRecoveryStartedAtRef.current = 0;
        nodeEntrySequenceRef.current = 0;
        if (qaGatheringStatusTimeoutRef.current !== null) {
            window.clearTimeout(qaGatheringStatusTimeoutRef.current);
            qaGatheringStatusTimeoutRef.current = null;
        }
        clearBoardCameraMovement();
        clearLayoutChoreographyState();
        qaAnimationDemoActiveRef.current = false;
        qaEvidenceExpansionDemoActiveRef.current = false;
        qaRabbitHoleDemoActiveRef.current = false;
    }, [clearBoardCameraMovement, clearLayoutChoreographyState, investigationId]);

    useEffect(() => {
        console.debug('[DetectiveBoard] Grid visibility changed:', showGrid);
        localStorage.setItem('detective_board_show_grid', String(showGrid));
    }, [showGrid]);

    useEffect(() => {
        localStorage.setItem('detective_board_snap_connection_labels', String(snapConnectionLabels));
    }, [snapConnectionLabels]);

    useEffect(() => {
        localStorage.setItem('detective_board_snap_nodes', String(snapNodes));
    }, [snapNodes]);

    useEffect(() => {
        if (!showBrowserQaBoardTools || typeof window === 'undefined') {
            return;
        }
        window.localStorage.removeItem('detective_board_qa_tools_enabled');
    }, [showBrowserQaBoardTools]);

    useEffect(() => {
        if (!qaToolsEnabled) {
            setShowQaReplayMenu(false);
        }
    }, [qaToolsEnabled]);

    useEffect(() => {
        const edgeTags = edges
            .map((edge) => getEdgeRawRelationshipTag(edge))
            .filter(Boolean);

        if (edgeTags.length > 0) {
            ensureTagStyles(edgeTags);
        }
    }, [edges, ensureTagStyles]);

    // Effect to update edge styles dynamically when tagStyles change
    useEffect(() => {
        setEdges(eds => eds.map(e => {
            const tag = getEdgeRawRelationshipTag(e);
            const styleDef = tagStyles[tag];
            if (!styleDef) return e;
            const edgeVisuals = getRelationshipEdgeVisuals(styleDef.pattern, styleDef.shape);
            const isGeneratedRelationship = e.data?.generatedBy === 'connectTheDots';
            const displayLabel = isGeneratedRelationship ? getRelationshipDisplayLabel(tag) : e.label;

            return {
                ...e,
                type: 'customEdge',
                label: displayLabel,
                style: {
                    ...e.style,
                    stroke: styleDef.color,
                    strokeDasharray: edgeVisuals.strokeDasharray,
                    strokeLinecap: edgeVisuals.strokeLinecap,
                    strokeWidth: edgeVisuals.strokeWidth ?? e.style?.strokeWidth,
                },
                animated: edgeVisuals.animated,
                data: {
                    ...e.data,
                    tag,
                    displayLabel: isGeneratedRelationship ? displayLabel : e.data?.displayLabel,
                    color: styleDef.color,
                    pattern: styleDef.pattern,
                    shape: styleDef.shape,
                },
                labelStyle: { ...e.labelStyle, fill: styleDef.color },
                labelBgStyle: { ...e.labelBgStyle, stroke: styleDef.color },
            };
        }));
    }, [tagStyles]);

    // Persist per investigation
    useEffect(() => {
        if (!investigationId || loadedInvestigationIdRef.current === investigationId) return;

        console.debug('[DetectiveBoard] Loading investigation:', investigationId);
        let cancelled = false;
        const loadStartedAt = startBoardRestoreLoad(investigationId);

        const applyBoardState = (savedState: PersistedBoardState | null, source: string, shouldFinishLoad = true) => {
            if (cancelled) {
                return;
            }
            let restoredNodeCount = 0;
            let restoredEdgeCount = 0;
            if (savedState) {
                const savedMode = savedState.mode === 'strict-grid' ? 'strict-grid' : 'legacy';
                const savedNodes = savedState.nodes.filter((node: Node) => node.data?.nodeKind !== 'discovery');
                const savedNodeIdSet = new Set(savedNodes.map((node: Node) => node.id));
                const savedEdges = savedState.edges.filter((edge: Edge) => (
                    edge.data?.generatedBy !== 'discovery' &&
                    (
                        savedMode !== 'strict-grid' ||
                        (savedNodeIdSet.has(edge.source) && savedNodeIdSet.has(edge.target))
                    )
                ));
                restoredNodeCount = savedNodes.length;
                restoredEdgeCount = savedEdges.length;
                if (savedNodes.length > 0) {
                    pendingInitialRestoreViewportFitRef.current = investigationId;
                    completedInitialRestoreViewportFitRef.current = null;
                    setIsInitialRestoreViewportSettling(true);
                } else {
                    pendingInitialRestoreViewportFitRef.current = null;
                    setIsInitialRestoreViewportSettling(false);
                }
                const restoredPendingIntegrationNodeIds = (savedState.pendingIntegrationNodeIds || [])
                    .filter((nodeId) => savedNodeIdSet.has(nodeId));
                const restoredNodes = savedNodes.map((n: Node) => {
                    const stableNode = stripTransientNodeData(n);
                    const autoFrame = calculateNodeFrame(
                        stableNode.data?.summary || '',
                        stableNode.data?.fullText || '',
                        Boolean(stableNode.data?.expanded),
                        nodeHasImages(stableNode.data?.images)
                    );
                    const persistedWidth = typeof stableNode.style?.width === 'number' ? stableNode.style.width : 288;
                    const persistedHeight = typeof stableNode.style?.height === 'number' ? stableNode.style.height : 192;
                    const normalizedFrame = normalizeNodeFrame(
                        Math.max(persistedWidth, autoFrame.width),
                        Math.max(persistedHeight, autoFrame.height)
                    );

                    return {
                        ...stableNode,
                        zIndex: stableNode.zIndex ?? STRICT_GRID_NODE_Z_INDEX,
                        style: {
                            ...stableNode.style,
                            ...normalizedFrame,
                        },
                        data: {
                            ...stableNode.data,
                            onReadFull: () => openNodeDossier(stableNode.data),
                            onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                            onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                            onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                            onDelete: (id: string) => handleDeleteNode(id),
                            onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                            onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                            onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                            onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                            onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                            onResizeCommit: handleNodeResizeCommit,
                            isDeepDiveSource: !!stableNode.data?.isDeepDiveSource,
                            isRecentlyImported: false,
                            boardMode: savedMode,
                        }
                    };
                });
                const restoredEdges = savedEdges.map((e: Edge) => {
                    const stableEdge = stripTransientEdgeData(e);
                    return {
                        ...stableEdge,
                        type: 'customEdge',
                        updatable: true,
                        interactionWidth: 20,
                        data: { ...stableEdge.data, snapEnabled: snapConnectionLabels, boardMode: savedMode }
                    };
                });

                setBoardMode(savedMode);
                if (savedMode === 'strict-grid') {
                    if (restoredEdges.every(hasPersistedStrictGridRoute)) {
                        const supportLayerState = layoutSupportingEvidenceNodes(
                            attachRestoredActivePorts(restoredNodes, restoredEdges),
                            restoredEdges
                        );
                        setNodes(supportLayerState.nodes);
                        setEdges(restoredEdges);
                    } else {
                        syncStrictGridEdgesToNodes(restoredEdges, restoredNodes);
                    }
                } else {
                    const { edges: finalEdges, handledNodes } = distributeEdges(restoredEdges, restoredNodes);
                    const supportLayerState = layoutSupportingEvidenceNodes(handledNodes, finalEdges);
                    setNodes(supportLayerState.nodes);
                    setEdges(finalEdges);
                }
                setPendingIntegrationNodeIds(restoredPendingIntegrationNodeIds);
                setHasConnectedDots(savedEdges.some((e: Edge) => e.data?.generatedBy === 'connectTheDots'));
            } else {
                if (pendingInitialRestoreViewportFitRef.current === investigationId) {
                    pendingInitialRestoreViewportFitRef.current = null;
                }
                setIsInitialRestoreViewportSettling(false);
                setBoardMode('strict-grid');
                setNodes([]);
                setEdges([]);
                setPendingIntegrationNodeIds([]);
                setHasConnectedDots(false);
            }
            loadedInvestigationIdRef.current = investigationId;
            setLoadedInvestigationId(investigationId);
            if (shouldFinishLoad) {
                finishBoardRestoreLoad(investigationId, loadStartedAt, source, restoredNodeCount, restoredEdgeCount);
            }
        };

        const immediateState = getCachedBoardStateForInvestigation(investigationId);
        applyBoardState(immediateState, immediateState ? 'memory-cache' : 'awaiting-async-restore', Boolean(immediateState));

        void loadBoardStateForInvestigation(investigationId).then((backendState) => {
            if (qaAnimationDemoActiveRef.current || qaEvidenceExpansionDemoActiveRef.current || qaRabbitHoleDemoActiveRef.current) {
                return;
            }
            if (backendState && backendState !== immediateState) {
                applyBoardState(backendState, immediateState ? 'backend-refresh' : 'async-restore');
                return;
            }
            if (!immediateState) {
                finishBoardRestoreLoad(investigationId, loadStartedAt, backendState ? 'async-restore' : 'empty', 0, 0);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [finishBoardRestoreLoad, handleAttachImage, handleDeleteNode, handleNodeExpand, handleNodeResizeCommit, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, investigationId, onDeepDiveNode, onNavigateToChild, openImageLightbox, openNodeDossier, snapConnectionLabels, startBoardRestoreLoad, syncStrictGridEdgesToNodes]);

    useEffect(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) return;
        if (pendingInitialRestoreViewportFitRef.current !== investigationId) return;
        if (completedInitialRestoreViewportFitRef.current === investigationId) return;
        if (nodes.length === 0) return;

        if (initialRestoreViewportFitTimeoutRef.current !== null) {
            window.clearTimeout(initialRestoreViewportFitTimeoutRef.current);
            initialRestoreViewportFitTimeoutRef.current = null;
        }

        initialRestoreViewportFitTimeoutRef.current = window.setTimeout(() => {
            initialRestoreViewportFitTimeoutRef.current = null;

            if (
                loadedInvestigationIdRef.current !== investigationId ||
                pendingInitialRestoreViewportFitRef.current !== investigationId ||
                nodesRef.current.length === 0
            ) {
                setIsInitialRestoreViewportSettling(false);
                return;
            }

            pendingInitialRestoreViewportFitRef.current = null;
            completedInitialRestoreViewportFitRef.current = investigationId;
            fitView({
                ...BOARD_FIT_VIEW_OPTIONS,
                duration: 0,
            });
            initialRestoreViewportFitTimeoutRef.current = window.setTimeout(() => {
                initialRestoreViewportFitTimeoutRef.current = null;
                setIsInitialRestoreViewportSettling(false);
            }, INITIAL_RESTORE_VIEWPORT_REVEAL_DELAY_MS);
        }, INITIAL_RESTORE_VIEWPORT_FIT_DELAY_MS);

        return () => {
            if (initialRestoreViewportFitTimeoutRef.current !== null) {
                window.clearTimeout(initialRestoreViewportFitTimeoutRef.current);
                initialRestoreViewportFitTimeoutRef.current = null;
            }
        };
    }, [fitView, investigationId, loadedInvestigationId, nodes.length]);

    useEffect(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) return;
        if (nodes.length === 0 && edges.length === 0) return;
        if (
            qaEvidenceExpansionDemoActiveRef.current ||
            qaRabbitHoleDemoActiveRef.current ||
            nodes.some((node) => node.id === QA_EVIDENCE_EXPANSION_NODE_ID || node.id.startsWith('qa-rabbit-'))
        ) return;
        if (isDraggingNodeRef.current) return;

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
        }

        persistTimerRef.current = window.setTimeout(() => {
            const existingState = getCachedBoardStateForInvestigation(investigationId);
            void saveBoardStateForInvestigation(investigationId, {
                mode: boardMode,
                nodes: sanitizeNodesForPersistence(nodes),
                edges: sanitizeEdgesForPersistence(edges),
                pendingIntegrationNodeIds,
                synthesisAlerts: existingState?.synthesisAlerts || [],
            });
            persistTimerRef.current = null;
        }, 250);

        return () => {
            if (persistTimerRef.current) {
                window.clearTimeout(persistTimerRef.current);
                persistTimerRef.current = null;
            }
        };
    }, [boardMode, nodes, edges, investigationId, loadedInvestigationId, pendingIntegrationNodeIds]);

    const persistBoardNow = useCallback(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) return;

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
        }

        const existingState = getCachedBoardStateForInvestigation(investigationId);
        void saveBoardStateForInvestigation(investigationId, {
            mode: boardMode,
            nodes: sanitizeNodesForPersistence(nodesRef.current),
            edges: sanitizeEdgesForPersistence(edgesRef.current),
            pendingIntegrationNodeIds: pendingIntegrationNodeIdsRef.current,
            synthesisAlerts: existingState?.synthesisAlerts || [],
        });
    }, [boardMode, investigationId, loadedInvestigationId]);

    useEffect(() => () => {
        recentImportTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        recentImportTimeoutsRef.current.clear();
        connectionRevealTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        connectionRevealTimeoutsRef.current.clear();
        nodeEntryTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        nodeEntryTimeoutsRef.current.clear();
        personaScanTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        personaScanTimeoutsRef.current.clear();
        layoutChoreographyTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        layoutChoreographyTimeoutsRef.current = [];
        qaAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaAnimationTimeoutsRef.current = [];
        if (qaGatheringStatusTimeoutRef.current !== null) {
            window.clearTimeout(qaGatheringStatusTimeoutRef.current);
            qaGatheringStatusTimeoutRef.current = null;
        }
        if (timelineFocusTimeoutRef.current !== null) {
            window.clearTimeout(timelineFocusTimeoutRef.current);
            timelineFocusTimeoutRef.current = null;
        }
        if (boardRestoreOverlayTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreOverlayTimeoutRef.current);
            boardRestoreOverlayTimeoutRef.current = null;
        }
    }, []);

    const onNodesChange: OnNodesChange = useCallback(
        (changes) => {
            let nextNodesSnapshot: Node[] = [];
            const hasSelectChange = changes.some((change) => change.type === 'select');
            const dimensionChanges = changes
                .flatMap((change) => {
                    if (change.type !== 'dimensions' || !('id' in change) || !('dimensions' in change) || !change.dimensions) {
                        return [];
                    }

                    return [{
                        id: change.id,
                        width: change.dimensions.width,
                        height: change.dimensions.height,
                        resizing: 'resizing' in change ? change.resizing : undefined,
                        setAttributes: 'setAttributes' in change ? change.setAttributes : undefined,
                    }];
                });

            if (dimensionChanges.length > 0) {
                logResizePipelineDebug('onNodesChange:incoming', {
                    boardMode,
                    dimensionChanges,
                });
            }

            setNodes((nds) => {
                let nextNodes = applyResizeDimensionsToStyles(applyNodeChanges(changes, nds), changes);
                if (marquee && !hasSelectChange && marqueeSelectedIdsRef.current.size > 0) {
                    nextNodes = nextNodes.map((node) => ({
                        ...node,
                        selected: marqueeSelectedIdsRef.current.has(node.id),
                    }));
                }
                nextNodesSnapshot = nextNodes;

                if (dimensionChanges.length > 0) {
                    logResizePipelineDebug('onNodesChange:next-state', {
                        nodes: nextNodes
                            .filter((node) => dimensionChanges.some((change) => change.id === node.id))
                            .map((node) => ({
                                id: node.id,
                                styleWidth: node.style?.width,
                                styleHeight: node.style?.height,
                            })),
                    });
                }

                return nextNodes;
            });

            if (hasSelectChange) {
                const currentSnapshot = nextNodesSnapshot.length > 0 ? nextNodesSnapshot : nodesRef.current;
                marqueeSelectedIdsRef.current = new Set(
                    currentSnapshot
                        .filter((node) => node.selected)
                        .map((node) => node.id)
                );
            }

            const hasNonSelectionChange = changes.some((change) => change.type !== 'select');
            const hasDragPositionChange = changes.some((change) => change.type === 'position');
            if (isDraggingNodeRef.current && hasDragPositionChange) {
                changes.forEach((change) => {
                    if (change.type === 'position' && 'id' in change) {
                        draggingNodeIdsRef.current.add(change.id);
                    }
                });

                if (dragRouteFrameRef.current) {
                    window.cancelAnimationFrame(dragRouteFrameRef.current);
                }

                dragRouteFrameRef.current = window.requestAnimationFrame(() => {
                    dragRouteFrameRef.current = null;
                    updateStrictGridDragRoutes(
                        Array.from(draggingNodeIdsRef.current),
                        nextNodesSnapshot.length > 0 ? nextNodesSnapshot : nodesRef.current
                    );
                });
            }

            if (
                boardMode === 'strict-grid' &&
                hasNonSelectionChange &&
                !(isDraggingNodeRef.current && hasDragPositionChange)
            ) {
                if (dimensionChanges.some((change) => change.resizing)) {
                    logResizePipelineDebug('onNodesChange:resize-preview', {
                        resizedNodeIds: dimensionChanges.map((change) => change.id),
                    });
                } else if (dimensionChanges.length > 0) {
                    logResizePipelineDebug('onNodesChange:awaiting-commit', {
                        resizedNodeIds: dimensionChanges.map((change) => change.id),
                    });
                } else {
                    window.requestAnimationFrame(() => {
                        syncStrictGridEdgesToNodes(edgesRef.current, nextNodesSnapshot.length > 0 ? nextNodesSnapshot : nodesRef.current);
                    });
                }
            }
        },
        [boardMode, marquee, syncStrictGridEdgesToNodes, updateStrictGridDragRoutes]
    );
    const onEdgesChange: OnEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        []
    );
    const onConnect: OnConnect = useCallback((params: Connection) => {
        openRelationshipEditor({ mode: 'create', connection: params, initialValue: 'RELATED' });
    }, [openRelationshipEditor]);
    const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
        const updatedEdges = reconnectEdge(oldEdge, newConnection, edgesRef.current).map((edge) => {
            if (edge.id !== oldEdge.id) return edge;

            return {
                ...edge,
                sourceHandle: newConnection.sourceHandle || 'port-right-0',
                targetHandle: newConnection.targetHandle || 'port-left-0',
                data: {
                    ...edge.data,
                    generatedBy: edge.data?.generatedBy || 'manual',
                    reasoning: edge.data?.reasoning || 'Manual connection',
                    snapEnabled: snapConnectionLabels,
                }
            };
        });

        if (boardMode === 'strict-grid') {
            syncStrictGridEdgesToNodes(updatedEdges);
            return;
        }

        syncEdgesToNodes(updatedEdges);
    }, [boardMode, snapConnectionLabels, syncEdgesToNodes, syncStrictGridEdgesToNodes]);
    const submitRelationshipEditor = useCallback(() => {
        if (!relationshipDraft) return;

        const tag = normalizeRelationshipTag(relationshipNameInput);
        const nextStyles = ensureTagStyles([tag]);
        const visuals = buildEdgeVisuals(tag, nextStyles);

        if (relationshipDraft.mode === 'create') {
            const nextEdge = addEdge({
                ...relationshipDraft.connection,
                id: `manual-${relationshipDraft.connection.source}-${relationshipDraft.connection.target}-${Date.now()}`,
                sourceHandle: relationshipDraft.connection.sourceHandle || 'port-right-0',
                targetHandle: relationshipDraft.connection.targetHandle || 'port-left-0',
                type: 'customEdge',
                label: visuals.tag,
                zIndex: STRICT_GRID_EDGE_Z_INDEX,
                updatable: true,
                interactionWidth: 20,
                animated: visuals.animated,
                data: {
                    tag: visuals.tag,
                    reasoning: 'Manual connection',
                    color: visuals.color,
                    pattern: visuals.pattern,
                    shape: visuals.shape,
                    generatedBy: 'manual',
                    snapEnabled: snapConnectionLabels,
                    boardMode
                },
                style: {
                    stroke: visuals.color,
                    strokeWidth: visuals.strokeWidth ?? 2,
                    strokeDasharray: visuals.strokeDasharray,
                    strokeLinecap: visuals.strokeLinecap,
                },
                labelStyle: { fill: visuals.color, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: visuals.color, strokeWidth: 1 },
                labelBgPadding: [8, 4] as [number, number],
                labelBgBorderRadius: 2,
            }, edgesRef.current) as Edge[];

            if (boardMode === 'strict-grid') {
                syncStrictGridEdgesToNodes(nextEdge);
            } else {
                syncEdgesToNodes(nextEdge);
            }
        } else {
            const updatedEdges = edgesRef.current.map((edge) => {
                if (edge.id !== relationshipDraft.edgeId) return edge;

                return {
                    ...edge,
                    label: visuals.tag,
                    animated: visuals.animated,
                    data: {
                        ...edge.data,
                        tag: visuals.tag,
                        displayLabel: undefined,
                        color: visuals.color,
                        pattern: visuals.pattern,
                        shape: visuals.shape,
                        reasoning: edge.data?.reasoning || 'Manual connection',
                        generatedBy: edge.data?.generatedBy || 'manual',
                        snapEnabled: snapConnectionLabels,
                        boardMode,
                    },
                    style: {
                        ...edge.style,
                        stroke: visuals.color,
                        strokeWidth: visuals.strokeWidth ?? 2,
                        strokeDasharray: visuals.strokeDasharray,
                        strokeLinecap: visuals.strokeLinecap,
                    },
                    labelStyle: { ...edge.labelStyle, fill: visuals.color, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                    labelBgStyle: { ...edge.labelBgStyle, fill: '#050505', fillOpacity: 0.9, stroke: visuals.color, strokeWidth: 1 },
                    labelBgPadding: [8, 4] as [number, number],
                    labelBgBorderRadius: 2,
                };
            });

            if (boardMode === 'strict-grid') {
                syncStrictGridEdgesToNodes(updatedEdges);
            } else {
                syncEdgesToNodes(updatedEdges);
            }
        }

        closeRelationshipEditor();
    }, [boardMode, buildEdgeVisuals, closeRelationshipEditor, ensureTagStyles, relationshipDraft, relationshipNameInput, snapConnectionLabels, syncEdgesToNodes, syncStrictGridEdgesToNodes]);
    const onNodeDragStart = useCallback(() => {
        isDraggingNodeRef.current = true;
        draggingNodeIdsRef.current.clear();
        if (dragRouteFrameRef.current) {
            window.cancelAnimationFrame(dragRouteFrameRef.current);
            dragRouteFrameRef.current = null;
        }
        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
        }
    }, []);
    const onNodeDragStop = useCallback(() => {
        isDraggingNodeRef.current = false;
        if (dragRouteFrameRef.current) {
            window.cancelAnimationFrame(dragRouteFrameRef.current);
            dragRouteFrameRef.current = null;
        }
        if (boardMode === 'strict-grid') {
            const changedNodeIds = Array.from(draggingNodeIdsRef.current);
            draggingNodeIdsRef.current.clear();
            if (changedNodeIds.length > 0) {
                syncStrictGridSubset(changedNodeIds, edgesRef.current, nodesRef.current);
            } else {
                syncStrictGridEdgesToNodes(edgesRef.current, nodesRef.current);
            }
        }
        persistBoardNow();
    }, [boardMode, persistBoardNow, syncStrictGridEdgesToNodes, syncStrictGridSubset]);

    const updateMarqueeSelection = useCallback((nextMarquee: MarqueeState) => {
        const rect = getMarqueeRect(nextMarquee.start, nextMarquee.current);
        const selectedIds = nodesRef.current
            .filter((node) => doesNodeIntersectRect(node, rect))
            .map((node) => node.id);

        const selectedIdsSet = new Set(selectedIds);
        marqueeSelectedIdsRef.current = selectedIdsSet;
        setMarquee(nextMarquee);
        setNodes((currentNodes) => currentNodes.map((node) => ({
            ...node,
            selected: selectedIdsSet.has(node.id),
        })));
    }, []);

    const finalizeMarqueeSelection = useCallback(() => {
        setMarquee(null);
        marqueePointerIdRef.current = null;
    }, []);

    const onPanePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!event.ctrlKey || isDraggingNodeRef.current || relationshipDraft) {
            return;
        }

        const target = event.target as HTMLElement | null;
        if (target !== event.currentTarget && !target?.closest('.react-flow__pane')) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if ('setPointerCapture' in event.currentTarget) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }

        const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const wrapperRect = flowWrapperRef.current?.getBoundingClientRect();
        const screenStart = wrapperRect
            ? { x: event.clientX - wrapperRect.left, y: event.clientY - wrapperRect.top }
            : start;
        marqueePointerIdRef.current = event.pointerId;
        updateMarqueeSelection({ active: true, start, current: start, screenStart, screenCurrent: screenStart });
    }, [relationshipDraft, screenToFlowPosition, updateMarqueeSelection]);

    const onPanePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!marquee || marqueePointerIdRef.current !== event.pointerId) {
            return;
        }

        const current = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const wrapperRect = flowWrapperRef.current?.getBoundingClientRect();
        const screenCurrent = wrapperRect
            ? { x: event.clientX - wrapperRect.left, y: event.clientY - wrapperRect.top }
            : current;
        updateMarqueeSelection({ ...marquee, current, screenCurrent });
    }, [marquee, screenToFlowPosition, updateMarqueeSelection]);

    const onPanePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!marquee || marqueePointerIdRef.current !== event.pointerId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if ('hasPointerCapture' in event.currentTarget && 'releasePointerCapture' in event.currentTarget && event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finalizeMarqueeSelection();
    }, [finalizeMarqueeSelection, marquee]);

    useEffect(() => {
        if (!marquee) {
            return;
        }

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Control') {
                finalizeMarqueeSelection();
            }
        };

        window.addEventListener('keyup', handleKeyUp);
        return () => window.removeEventListener('keyup', handleKeyUp);
    }, [finalizeMarqueeSelection, marquee]);

    const handleNewConnections = useCallback((payload: unknown) => {
        const { connections, vaultId: payloadVaultId } = coerceConnectionsFoundPayload(payload);
        const payloadVaultMismatch = Boolean(payloadVaultId && investigationId && payloadVaultId !== investigationId);
        if (payloadVaultMismatch) {
            console.debug('[Board] Ignoring relationship batch for another investigation:', {
                payloadVaultId,
                investigationId,
                count: connections.length,
            });
            return;
        }

        const scopedConnections = connections.filter((connection) => {
            const scopedVaultId = connectionVaultId(connection);
            const matches = !scopedVaultId || !investigationId || scopedVaultId === investigationId;
            if (!matches) {
                console.debug('[Board] Ignoring relationship for another investigation:', {
                    connectionVaultId: scopedVaultId,
                    investigationId,
                    source: connection?.source,
                    target: connection?.target,
                    tag: connection?.tag,
                });
            }
            return matches;
        });

        if (connections.length > 0 && scopedConnections.length === 0) {
            return;
        }

        console.debug('[Board] Received connections:', {
            total: connections.length,
            scoped: scopedConnections.length,
            investigationId,
            payloadVaultId,
            connections: scopedConnections,
        });
        const currentNodes = isLayoutChoreographyActiveRef.current
            ? connectChoreographyBaseNodesRef.current
            : nodesRef.current;
        const activeAnalysisMode = analysisModeRef.current;
        const activePendingNodeIds = pendingIntegrationNodeIdsRef.current;
        console.debug('[Board] Current nodes:', currentNodes.map(n => ({ id: n.id, title: n.data.title })));

        // Filter connections to only include those where source and target exist
        const nodeIds = new Set(currentNodes.map(n => n.id));
        const validConnections = scopedConnections.filter(c => {
            const sourceExists = nodeIds.has(c.source);
            const targetExists = nodeIds.has(c.target);
            if (!sourceExists || !targetExists) {
                console.warn('[Board] Skipping relationship with missing local node:', {
                    source: c.source,
                    target: c.target,
                    tag: c.tag,
                    sourceExists,
                    targetExists,
                    investigationId,
                    availableNodeIds: Array.from(nodeIds),
                });
            }
            return sourceExists && targetExists;
        });

        console.debug('[Board] Valid connections:', validConnections.length, 'of', scopedConnections.length);

        const nextStyles = { ...tagStyles };
        let stylesUpdated = false;

        validConnections.forEach(c => {
            const tag = normalizeRelationshipTag(c.tag);
            if (!nextStyles[tag]) {
                nextStyles[tag] = createTagStyle(tag);
                stylesUpdated = true;
            }
        });

        if (stylesUpdated) {
            persistTagStyles(nextStyles);
        }

        const newEdges: Edge[] = validConnections.map((c: RelationshipConnection) => {
            const visuals = buildEdgeVisuals(c.tag || c.label || c.type || 'RELATED', nextStyles);
            const displayLabel = getRelationshipDisplayLabel(visuals.tag);

            return {
                id: `e-${c.source}-${c.target}-${visuals.tag}`,
                source: c.source,
                target: c.target,
                type: 'customEdge',
                label: displayLabel,
                zIndex: STRICT_GRID_EDGE_Z_INDEX,
                updatable: true,
                interactionWidth: 20,
                animated: visuals.animated,
                data: {
                    tag: visuals.tag,
                    displayLabel,
                    reasoning: c.reasoning,
                    color: visuals.color,
                    pattern: visuals.pattern,
                    shape: visuals.shape,
                    confidence: c.confidence,
                    qualityScore: c.qualityScore,
                    supportingPersonas: c.supportingPersonas || [],
                    evidenceNodeIDs: c.evidenceNodeIDs || [],
                    validationStatus: c.validationStatus,
                    candidateSources: c.candidateSources || [],
                    generatedBy: 'connectTheDots',
                    isConnectionRevealing: true,
                    connectionRevealStartedAt: Date.now(),
                    onConnectionHover: handleConnectionHover,
                    snapEnabled: snapConnectionLabels,
                    boardMode
                },
                style: {
                    stroke: visuals.color,
                    strokeWidth: visuals.strokeWidth ?? 2,
                    strokeDasharray: visuals.strokeDasharray,
                    strokeLinecap: visuals.strokeLinecap,
                },
                labelStyle: { fill: visuals.color, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: visuals.color, strokeWidth: 1 },
                labelBgPadding: [8, 4] as [number, number],
                labelBgBorderRadius: 2,
            };
        });
        const sourceEdgesForMerge = isLayoutChoreographyActiveRef.current
            ? connectChoreographyBaseEdgesRef.current
            : edgesRef.current;
        const combinedEdges = activeAnalysisMode === 'incremental'
            ? mergeIncrementalEvidenceEdges(sourceEdgesForMerge, newEdges, activePendingNodeIds)
            : mergeEvidenceEdges(sourceEdgesForMerge, newEdges);
        if (!isLayoutChoreographyActiveRef.current) {
            const finalLayoutState = buildConnectLayoutState(currentNodes, combinedEdges);
            setNodes(stripLayoutChoreographyFromNodes(finalLayoutState.nodes));
            setEdges(finalLayoutState.edges);
            scheduleConnectionRevealCleanup(newEdges.map((edge) => edge.id));
            if (activeAnalysisMode === 'incremental') {
                clearPendingIntegrationNodeIds();
            }
            setHasConnectedDots(true);
            setIsAnalyzing(false);
            setAnalysisMode(null);
            return;
        }

        const delayedEdgeIds = newEdges
            .map((edge) => edge.id)
            .filter((edgeId) => !visibleConnectEdgeIdsRef.current.has(edgeId));
        const delayedEdgeIdSet = new Set(delayedEdgeIds);
        const finalEdges = combinedEdges.map((edge) => (
            delayedEdgeIdSet.has(edge.id) ? edge : stripTransientEdgeData(edge)
        ));
        const immediateEdges = finalEdges.filter((edge) => !delayedEdgeIdSet.has(edge.id));
        const finalLayoutState = buildConnectLayoutState(currentNodes, finalEdges);
        const immediateLayoutState = buildFixedLayoutEdgeState(finalLayoutState.nodes, immediateEdges);
        const finalFixedState = buildFixedLayoutEdgeState(finalLayoutState.nodes, finalEdges);

        finishConnectLayoutChoreography(
            finalFixedState.nodes,
            immediateLayoutState.edges,
            finalFixedState.edges,
            delayedEdgeIds,
            activeAnalysisMode === 'incremental' ? [] : pendingIntegrationNodeIdsRef.current
        );
        if (activeAnalysisMode === 'incremental') {
            clearPendingIntegrationNodeIds();
        }
    }, [boardMode, buildConnectLayoutState, buildEdgeVisuals, buildFixedLayoutEdgeState, clearPendingIntegrationNodeIds, finishConnectLayoutChoreography, handleConnectionHover, investigationId, persistTagStyles, scheduleConnectionRevealCleanup, snapConnectionLabels, stripLayoutChoreographyFromNodes, tagStyles]);

    const playBrowserQaAnimationDemo = useCallback((includeConnections = true) => {
        qaAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaAnimationTimeoutsRef.current = [];
        clearLayoutChoreographyState();
        nodeEntrySequenceRef.current = 0;
        setBoardMode('strict-grid');
        setPendingIntegrationNodeIds([]);
        setHasConnectedDots(false);
        setIsGathering(false);
        setIsAnalyzing(false);
        setAnalysisMode(null);
        setDeepDiveTopic(null);
        qaAnimationDemoActiveRef.current = true;
        qaRabbitHoleDemoActiveRef.current = false;
        setEdges([]);
        setNodes([]);

        QA_ANIMATION_DEMO_NODES.forEach((demoNode, index) => {
            const timeoutId = window.setTimeout(() => {
                const frame = calculateNodeFrame(demoNode.summary, demoNode.fullText, false, false);
                const isImported = isImportedEvidenceNode(demoNode);
                const { nodeEntrySequence: _nodeEntrySequence, ...entryMetadata } = createNodeEntryMetadata(isImported);
                const newNode: Node = {
                    id: demoNode.id,
                    type: 'custom',
                    zIndex: STRICT_GRID_NODE_Z_INDEX,
                    style: frame,
                    data: {
                        ...demoNode,
                        onReadFull: () => openNodeDossier(demoNode),
                        onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                        onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                        onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                        onDelete: (id: string) => handleDeleteNode(id),
                        onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                        onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                        onSetEditing: (id: string | null) => handleSetEditing(id),
                        onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                        onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                        onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                        onResizeCommit: handleNodeResizeCommit,
                        isDeepDiveSource: false,
                        isRecentlyImported: isImported,
                        ...entryMetadata,
                        expanded: false,
                        boardMode: 'strict-grid' as BoardMode,
                    },
                    position: getQaAnimationDemoStagingPosition(index),
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left
                };

                setNodes((currentNodes) => (
                    currentNodes.some((node) => node.id === demoNode.id)
                        ? currentNodes
                        : [...currentNodes, newNode]
                ));
                scheduleNodeEntryCleanup(demoNode.id, entryMetadata.nodeEntryDelayMs);
                if (isImported) {
                    markNodeAsRecentlyImported(demoNode.id);
                }
            }, index * QA_ANIMATION_DEMO_NODE_STEP_MS);
            qaAnimationTimeoutsRef.current.push(timeoutId);
        });

        const insightsTimeout = window.setTimeout(() => {
            applyPersonaInsightsToNodes(QA_ANIMATION_DEMO_INSIGHTS);
        }, QA_ANIMATION_DEMO_NODE_COMPLETE_MS + 120);

        qaAnimationTimeoutsRef.current.push(insightsTimeout);

        if (includeConnections) {
            const connectTimeout = window.setTimeout(() => {
                const demoNodeIds = new Set<string>(QA_ANIMATION_DEMO_NODES.map((demoNode) => demoNode.id));
                let demoNodes = nodesRef.current.filter((node) => demoNodeIds.has(node.id));
                if (demoNodes.length < 2) {
                    demoNodes = QA_ANIMATION_DEMO_NODES.map((demoNode, index) => {
                        const frame = calculateNodeFrame(demoNode.summary, demoNode.fullText, false, false);
                        return {
                            id: demoNode.id,
                            type: 'custom',
                            zIndex: STRICT_GRID_NODE_Z_INDEX,
                            style: frame,
                            data: {
                                ...demoNode,
                                onReadFull: () => openNodeDossier(demoNode),
                                isDeepDiveSource: false,
                                expanded: false,
                                boardMode: 'strict-grid' as BoardMode,
                            },
                            position: getQaAnimationDemoStagingPosition(index),
                            sourcePosition: Position.Right,
                            targetPosition: Position.Left,
                        };
                    });
                }
                if (demoNodes.length < 2) {
                    return;
                }

                setIsAnalyzing(true);
                setAnalysisMode('full');
                startConnectLayoutChoreography(demoNodes, []);

                const revealTimeout = window.setTimeout(() => {
                    handleNewConnections({
                        connections: QA_ANIMATION_DEMO_CONNECTIONS,
                        vaultId: investigationId,
                    });
                }, 180);
                qaAnimationTimeoutsRef.current.push(revealTimeout);
            }, QA_ANIMATION_DEMO_NODE_COMPLETE_MS + 520);

            qaAnimationTimeoutsRef.current.push(connectTimeout);
        }
    }, [
        applyPersonaInsightsToNodes,
        clearLayoutChoreographyState,
        createNodeEntryMetadata,
        handleAttachImage,
        handleDeleteNode,
        handleNodeExpand,
        handleNodeResizeCommit,
        handleNewConnections,
        handleRemoveImage,
        handleSaveNode,
        handleSetEditing,
        handleUpdateNode,
        investigationId,
        markNodeAsRecentlyImported,
        onDeepDiveNode,
        onNavigateToChild,
        openImageLightbox,
        openNodeDossier,
        scheduleNodeEntryCleanup,
        startConnectLayoutChoreography,
    ]);

    const tryPlayBrowserQaAnimationDemo = useCallback((detail?: BrowserQaAnimationDemoDetail | null) => {
        const requestedInvestigationId = typeof detail?.investigationId === 'string'
            ? detail.investigationId.trim()
            : '';
        if (!requestedInvestigationId || requestedInvestigationId !== investigationId || loadedInvestigationId !== investigationId) {
            return false;
        }
        const requestId = typeof detail?.requestId === 'string' ? detail.requestId.trim() : '';
        if (requestId && lastQaAnimationDemoRequestIdRef.current === requestId) {
            return true;
        }

        try {
            window.sessionStorage.removeItem(BROWSER_QA_ANIMATION_DEMO_PENDING_KEY);
        } catch {
            // Session storage is optional; the in-memory event path is enough for active boards.
        }
        if (requestId) {
            lastQaAnimationDemoRequestIdRef.current = requestId;
        }
        playBrowserQaAnimationDemo(detail?.includeConnections !== false);
        return true;
    }, [investigationId, loadedInvestigationId, playBrowserQaAnimationDemo]);

    const playBrowserQaDiscoveryDemo = useCallback(() => {
        if (!investigationId) {
            return;
        }

        window.dispatchEvent(new CustomEvent(BROWSER_QA_DISCOVERY_DEMO_EVENT, {
            detail: {
                investigationId,
                requestId: `qa-discovery-${Date.now()}`,
            },
        }));
    }, [investigationId]);

    const playBrowserQaSynthesisDemo = useCallback(() => {
        if (!investigationId) {
            return;
        }

        window.dispatchEvent(new CustomEvent(BROWSER_QA_SYNTHESIS_DEMO_EVENT, {
            detail: {
                investigationId,
                requestId: `qa-synthesis-${Date.now()}`,
            },
        }));
    }, [investigationId]);

    const playBrowserQaSpiderTelemetryDemo = useCallback(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, {
            detail: {
                investigationId,
                requestId: `qa-spider-${Date.now()}`,
            },
        }));
    }, [investigationId]);

    const playBrowserQaPipelineDemo = useCallback(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_PIPELINE_DEMO_EVENT, {
            detail: {
                investigationId,
                requestId: `qa-pipeline-${Date.now()}`,
            },
        }));
    }, [investigationId]);

    const playBrowserQaLocalIngestionDemo = useCallback(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT, {
            detail: {
                investigationId,
                requestId: `qa-local-ingestion-${Date.now()}`,
            },
        }));
    }, [investigationId]);

    const playBrowserQaGatheringStatusDemo = useCallback(() => {
        if (qaGatheringStatusTimeoutRef.current !== null) {
            window.clearTimeout(qaGatheringStatusTimeoutRef.current);
            qaGatheringStatusTimeoutRef.current = null;
        }

        setDeepDiveTopic(null);
        setIsGathering(true);
        qaGatheringStatusTimeoutRef.current = window.setTimeout(() => {
            setIsGathering(false);
            qaGatheringStatusTimeoutRef.current = null;
        }, QA_GATHERING_STATUS_DEMO_MS);
    }, []);

    const playBrowserQaErrorEmptyDemo = useCallback(() => {
        const requestId = `qa-error-empty-${Date.now()}`;
        window.dispatchEvent(new CustomEvent(BROWSER_QA_ERROR_EMPTY_DEMO_EVENT, {
            detail: {
                investigationId: requestId,
                requestId,
            },
        }));
    }, []);

    const playBrowserQaTimelineDemo = useCallback(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_TIMELINE_DEMO_EVENT, {
            detail: {
                investigationId,
                requestId: `qa-timeline-${Date.now()}`,
            },
        }));
    }, [investigationId]);

    const playBrowserQaDuplicateEvidenceDemo = useCallback(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) {
            return;
        }

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
        }

        qaAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaAnimationTimeoutsRef.current = [];
        clearLayoutChoreographyState();
        qaAnimationDemoActiveRef.current = false;
        qaEvidenceExpansionDemoActiveRef.current = false;
        qaRabbitHoleDemoActiveRef.current = false;
        nodeEntrySequenceRef.current = 0;
        setBoardMode('strict-grid');
        setPendingIntegrationNodeIds([]);
        setHasConnectedDots(true);
        setIsGathering(false);
        setIsAnalyzing(false);
        setAnalysisMode(null);
        setDeepDiveTopic(null);
        setEditingNodeId(null);

        const demoNodes: Node[] = QA_DUPLICATE_SQUASH_DEMO_NODES.map((demoNode, index) => {
            const frame = calculateNodeFrame(demoNode.summary, demoNode.fullText, false, false);

            return {
                id: demoNode.id,
                type: 'custom',
                zIndex: STRICT_GRID_NODE_Z_INDEX,
                position: QA_DUPLICATE_SQUASH_DEMO_POSITIONS[index] || { x: 160 + index * 360, y: 160 },
                style: frame,
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                data: {
                    ...demoNode,
                    onReadFull: () => openNodeDossier(demoNode),
                    onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                    onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                    onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                    onDelete: (id: string) => handleDeleteNode(id),
                    onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                    onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                    onSetEditing: (id: string | null) => handleSetEditing(id),
                    onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                    onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                    onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                    onResizeCommit: handleNodeResizeCommit,
                    boardMode: 'strict-grid' as BoardMode,
                    expanded: false,
                },
            };
        });

        const demoEdges: Edge[] = QA_DUPLICATE_SQUASH_DEMO_CONNECTIONS.map((connection) => {
            const visuals = buildEdgeVisuals(connection.tag, tagStyles);
            const displayLabel = getRelationshipDisplayLabel(visuals.tag);

            return {
                id: `qa-duplicate-edge-${connection.source}-${connection.target}-${visuals.tag}`,
                source: connection.source,
                target: connection.target,
                type: 'customEdge',
                label: displayLabel,
                zIndex: STRICT_GRID_EDGE_Z_INDEX,
                updatable: true,
                interactionWidth: 20,
                animated: visuals.animated,
                data: {
                    tag: visuals.tag,
                    displayLabel,
                    reasoning: connection.reasoning,
                    color: visuals.color,
                    pattern: visuals.pattern,
                    shape: visuals.shape,
                    generatedBy: 'qaDuplicateEvidenceSquash',
                    snapEnabled: snapConnectionLabels,
                    boardMode: 'strict-grid',
                    onConnectionHover: handleConnectionHover,
                },
                style: {
                    stroke: visuals.color,
                    strokeWidth: visuals.strokeWidth ?? 2,
                    strokeDasharray: visuals.strokeDasharray,
                    strokeLinecap: visuals.strokeLinecap,
                },
                labelStyle: { fill: visuals.color, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: visuals.color, strokeWidth: 1 },
                labelBgPadding: [8, 4] as [number, number],
                labelBgBorderRadius: 2,
            };
        });

        setNodes(demoNodes);
        setEdges(demoEdges);
    }, [buildEdgeVisuals, clearLayoutChoreographyState, handleAttachImage, handleConnectionHover, handleDeleteNode, handleNodeExpand, handleNodeResizeCommit, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, investigationId, loadedInvestigationId, onDeepDiveNode, onNavigateToChild, openImageLightbox, openNodeDossier, snapConnectionLabels, tagStyles]);

    const playBrowserQaTextFitDemo = useCallback(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) {
            return;
        }

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
        }

        qaAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaAnimationTimeoutsRef.current = [];
        clearLayoutChoreographyState();
        qaAnimationDemoActiveRef.current = false;
        qaEvidenceExpansionDemoActiveRef.current = false;
        qaRabbitHoleDemoActiveRef.current = false;
        nodeEntrySequenceRef.current = 0;
        setBoardMode('strict-grid');
        setPendingIntegrationNodeIds([]);
        setHasConnectedDots(false);
        setIsGathering(false);
        setIsAnalyzing(false);
        setAnalysisMode(null);
        setDeepDiveTopic(null);
        setEditingNodeId(null);
        setEdges([]);

        const demoNodes: Node[] = QA_TEXT_FIT_DEMO_NODES.map((demoNode, index) => {
            const frame = calculateNodeFrame(demoNode.summary, demoNode.fullText, false, false);

            return {
                id: demoNode.id,
                type: 'custom',
                zIndex: STRICT_GRID_NODE_Z_INDEX,
                position: QA_TEXT_FIT_DEMO_POSITIONS[index] || { x: 120 + index * 560, y: 128 },
                style: frame,
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                data: {
                    ...demoNode,
                    onReadFull: () => openNodeDossier(demoNode),
                    onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                    onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                    onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                    onDelete: (id: string) => handleDeleteNode(id),
                    onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                    onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                    onSetEditing: (id: string | null) => handleSetEditing(id),
                    onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                    onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                    onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                    onResizeCommit: handleNodeResizeCommit,
                    boardMode: 'strict-grid' as BoardMode,
                    expanded: false,
                },
            };
        });

        setNodes(demoNodes);
    }, [clearLayoutChoreographyState, handleAttachImage, handleDeleteNode, handleNodeExpand, handleNodeResizeCommit, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, investigationId, loadedInvestigationId, onDeepDiveNode, onNavigateToChild, openImageLightbox, openNodeDossier]);

    const playBrowserQaRabbitHoleDemo = useCallback((detail?: BrowserQaRabbitHoleDemoDetail | null) => {
        const requestedInvestigationId = typeof detail?.investigationId === 'string'
            ? detail.investigationId.trim()
            : '';
        if (!investigationId || loadedInvestigationId !== investigationId) {
            return;
        }
        if (requestedInvestigationId && requestedInvestigationId !== investigationId) {
            return;
        }

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
        }

        qaAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaAnimationTimeoutsRef.current = [];
        clearLayoutChoreographyState();
        qaAnimationDemoActiveRef.current = false;
        qaEvidenceExpansionDemoActiveRef.current = false;
        qaRabbitHoleDemoActiveRef.current = true;
        nodeEntrySequenceRef.current = 0;
        setBoardMode('strict-grid');
        setPendingIntegrationNodeIds(QA_RABBIT_HOLE_DEMO_NODES.map((demoNode) => demoNode.id));
        setHasConnectedDots(false);
        setIsGathering(true);
        setIsAnalyzing(false);
        setAnalysisMode(null);
        setDeepDiveTopic('Rabbit Hole QA');
        setEditingNodeId(null);
        setEdges([]);

        const demoNodes: Node[] = QA_RABBIT_HOLE_DEMO_NODES.map((demoNode, index) => {
            const frame = calculateNodeFrame(demoNode.summary, demoNode.fullText, false, false);

            return {
                id: demoNode.id,
                type: 'custom',
                zIndex: STRICT_GRID_NODE_Z_INDEX,
                position: QA_RABBIT_HOLE_DEMO_POSITIONS[index] || { x: 128 + index * 512, y: 136 },
                style: frame,
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                data: {
                    ...demoNode,
                    origin: 'rabbit-hole',
                    rabbitState: 'provisional',
                    rabbitPass: 1,
                    onReadFull: () => openNodeDossier(demoNode),
                    onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                    onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                    onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                    onDelete: (id: string) => handleDeleteNode(id),
                    onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                    onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                    onSetEditing: (id: string | null) => handleSetEditing(id),
                    onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                    onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                    onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                    onResizeCommit: handleNodeResizeCommit,
                    boardMode: 'strict-grid' as BoardMode,
                    expanded: false,
                },
            };
        });

        setNodes(demoNodes);

        const promotionTimeout = window.setTimeout(() => {
            setIsGathering(false);
            setDeepDiveTopic(null);
            setPendingIntegrationNodeIds([]);
            setHasConnectedDots(true);
            setNodes((currentNodes) => currentNodes.map((node) => (
                QA_RABBIT_HOLE_DEMO_NODES.some((demoNode) => demoNode.id === node.id)
                    ? { ...node, data: { ...node.data, rabbitState: 'promoted' } }
                    : node
            )));
            setEdges(QA_RABBIT_HOLE_DEMO_CONNECTIONS.map((connection) => {
                const visuals = buildEdgeVisuals(connection.tag, tagStyles);
                const displayLabel = getRelationshipDisplayLabel(visuals.tag);

                return {
                    id: `qa-rabbit-edge-${connection.source}-${connection.target}-${visuals.tag}`,
                    source: connection.source,
                    target: connection.target,
                    type: 'customEdge',
                    label: displayLabel,
                    zIndex: STRICT_GRID_EDGE_Z_INDEX,
                    updatable: true,
                    interactionWidth: 20,
                    animated: visuals.animated,
                    data: {
                        tag: visuals.tag,
                        displayLabel,
                        reasoning: connection.reasoning,
                        color: visuals.color,
                        pattern: visuals.pattern,
                        shape: visuals.shape,
                        generatedBy: 'qaRabbitHole',
                        snapEnabled: snapConnectionLabels,
                        boardMode: 'strict-grid',
                        onConnectionHover: handleConnectionHover,
                    },
                    style: {
                        stroke: visuals.color,
                        strokeWidth: visuals.strokeWidth ?? 2,
                        strokeDasharray: visuals.strokeDasharray,
                        strokeLinecap: visuals.strokeLinecap,
                    },
                    labelStyle: { fill: visuals.color, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                    labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: visuals.color, strokeWidth: 1 },
                    labelBgPadding: [8, 4] as [number, number],
                    labelBgBorderRadius: 2,
                };
            }));
        }, QA_RABBIT_HOLE_DEMO_PROMOTION_MS);
        qaAnimationTimeoutsRef.current.push(promotionTimeout);
    }, [
        buildEdgeVisuals,
        clearLayoutChoreographyState,
        handleAttachImage,
        handleConnectionHover,
        handleDeleteNode,
        handleNodeExpand,
        handleNodeResizeCommit,
        handleRemoveImage,
        handleSaveNode,
        handleSetEditing,
        handleUpdateNode,
        investigationId,
        loadedInvestigationId,
        onDeepDiveNode,
        onNavigateToChild,
        openImageLightbox,
        openNodeDossier,
        snapConnectionLabels,
        tagStyles,
    ]);

    const playBrowserQaEvidenceExpansionDemo = useCallback(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) {
            return;
        }

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
            persistTimerRef.current = null;
        }

        qaAnimationTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        qaAnimationTimeoutsRef.current = [];
        clearLayoutChoreographyState();
        qaAnimationDemoActiveRef.current = false;
        qaEvidenceExpansionDemoActiveRef.current = true;
        qaRabbitHoleDemoActiveRef.current = false;
        nodeEntrySequenceRef.current = 0;
        setBoardMode('strict-grid');
        setPendingIntegrationNodeIds([]);
        setHasConnectedDots(false);
        setIsGathering(false);
        setIsAnalyzing(false);
        setAnalysisMode(null);
        setDeepDiveTopic(null);
        setEditingNodeId(null);
        setEdges([]);

        const summary = 'A QA case file combines a long report body, a source link, visual evidence, and persona discussion so node expansion can be tuned without a backend run.';
        const fullText = [
            'A QA case file combines a long report body, a source link, visual evidence, and persona discussion so node expansion can be tuned without a backend run.',
            '',
            'The first paragraph is deliberately compact enough to look like a normal evidence card while collapsed.',
            '',
            'The expanded body adds operational detail: a facilities note, a dated source link, and a visual appendix all point to the same reliability pattern. The copy is long enough to make the smooth case-file reveal visible while preserving React Flow edge routing.',
            '',
            'A second paragraph gives the persona discussion something to react to. Analysts should be able to open the discussion modal, see each specialist card arrive in sequence, and close it without the board stealing wheel events.',
        ].join('\n');
        const frame = calculateNodeFrame(summary, fullText, true, true);
        const qaNode: Node = {
            id: QA_EVIDENCE_EXPANSION_NODE_ID,
            type: 'custom',
            zIndex: STRICT_GRID_NODE_Z_INDEX,
            position: { x: 160, y: 128 },
            style: frame,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            data: {
                id: QA_EVIDENCE_EXPANSION_NODE_ID,
                title: 'QA Evidence Expansion Case File',
                summary,
                fullText,
                sourceURL: 'https://example.com/qa-evidence-expansion',
                images: [
                    {
                        id: 'qa-evidence-expansion-image',
                        path: QA_EVIDENCE_EXPANSION_IMAGE_SRC,
                        sourceURL: 'https://example.com/qa-evidence-expansion',
                        caption: 'QA visual evidence attachment',
                        origin: 'manual',
                        mimeType: 'image/svg+xml',
                        width: 640,
                        height: 360,
                    },
                ],
                personaInsights: [
                    {
                        personaName: 'Connector',
                        perspective: 'Looks for hidden relationships across evidence.',
                        confidence: 0.88,
                        keyFindings: ['The source, image, and long-form note all support the same operational signal.'],
                        connections: ['Source link and visual appendix both strengthen the case-file reading.'],
                        questions: ['Which source detail should be promoted into a relationship candidate?'],
                        fullAnalysis: 'The QA file is intentionally dense enough to verify the staggered discussion reveal and expanded text rhythm.',
                        nodeIDs: [QA_EVIDENCE_EXPANSION_NODE_ID],
                    },
                    {
                        personaName: 'Skeptic',
                        perspective: 'Checks whether the evidence is overstated.',
                        confidence: 0.72,
                        keyFindings: ['The evidence is useful, but the demo should remain visibly marked as QA-only.'],
                        connections: ['The image and report body are corroborative rather than independent findings.'],
                        questions: ['Does the source link remain easy to verify after the hover polish?'],
                        fullAnalysis: 'This card helps tune the reveal without pretending the demo contains real provider output.',
                        nodeIDs: [QA_EVIDENCE_EXPANSION_NODE_ID],
                    },
                ],
                onReadFull: () => openNodeDossier({
                    title: 'QA Evidence Expansion Case File',
                    summary,
                    fullText,
                    sourceURL: 'https://example.com/qa-evidence-expansion',
                }),
                onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                onDelete: (id: string) => handleDeleteNode(id),
                onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                onSetEditing: (id: string | null) => handleSetEditing(id),
                onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                onResizeCommit: handleNodeResizeCommit,
                isDeepDiveSource: false,
                expanded: true,
                boardMode: 'strict-grid' as BoardMode,
            },
        };

        setNodes([qaNode]);
        const detail: BrowserQaEvidenceExpansionDemoDetail = {
            investigationId,
            requestId: `qa-evidence-expansion-${Date.now()}`,
        };
        window.dispatchEvent(new CustomEvent(BROWSER_QA_EVIDENCE_EXPANSION_DEMO_EVENT, { detail }));
    }, [
        clearLayoutChoreographyState,
        handleAttachImage,
        handleDeleteNode,
        handleNodeExpand,
        handleNodeResizeCommit,
        handleRemoveImage,
        handleSaveNode,
        handleSetEditing,
        handleUpdateNode,
        investigationId,
        loadedInvestigationId,
        onDeepDiveNode,
        onNavigateToChild,
        openImageLightbox,
        openNodeDossier,
    ]);

    useEffect(() => {
        const handleBrowserQaAnimationDemo = (event: Event) => {
            const detail = (event as CustomEvent<BrowserQaAnimationDemoDetail>).detail;
            if (!tryPlayBrowserQaAnimationDemo(detail)) {
                try {
                    window.sessionStorage.setItem(BROWSER_QA_ANIMATION_DEMO_PENDING_KEY, JSON.stringify(detail));
                } catch {
                    // Optional QA convenience only.
                }
            }
        };

        window.addEventListener(BROWSER_QA_ANIMATION_DEMO_EVENT, handleBrowserQaAnimationDemo as EventListener);

        try {
            const pending = window.sessionStorage.getItem(BROWSER_QA_ANIMATION_DEMO_PENDING_KEY);
            if (pending) {
                tryPlayBrowserQaAnimationDemo(JSON.parse(pending) as BrowserQaAnimationDemoDetail);
            }
        } catch {
            // Ignore malformed or unavailable session storage.
        }

        return () => {
            window.removeEventListener(BROWSER_QA_ANIMATION_DEMO_EVENT, handleBrowserQaAnimationDemo as EventListener);
        };
    }, [tryPlayBrowserQaAnimationDemo]);

    useEffect(() => {
        const handleBrowserQaRabbitHoleDemo = (event: Event) => {
            const detail = (event as CustomEvent<BrowserQaRabbitHoleDemoDetail>).detail;
            playBrowserQaRabbitHoleDemo(detail);
        };

        window.addEventListener(BROWSER_QA_RABBIT_HOLE_DEMO_EVENT, handleBrowserQaRabbitHoleDemo as EventListener);

        return () => {
            window.removeEventListener(BROWSER_QA_RABBIT_HOLE_DEMO_EVENT, handleBrowserQaRabbitHoleDemo as EventListener);
        };
    }, [playBrowserQaRabbitHoleDemo]);

    useEffect(() => {
        if (!investigationId || loadedInvestigationId !== investigationId || nodes.length < 2) {
            return;
        }

        if (!isAnalyzing && (hasConnectedDots || hasConnectTheDotsEdges(edges) || hasVisibleBoardRelationshipEdges(edges))) {
            return;
        }

        let cancelled = false;

        const replayLatestRelationships = async () => {
            const result = await loadRelationshipResultForInvestigation(investigationId);
            if (cancelled || !result || result.connections.length === 0) {
                return;
            }

            const resultVaultId = typeof result.vaultId === 'string' ? result.vaultId.trim() : '';
            if (resultVaultId && resultVaultId !== investigationId) {
                return;
            }

            if (isAnalyzing) {
                const currentRunId = latestPipelineRunIdRef.current;
                const resultRunId = typeof result.runId === 'string' ? result.runId.trim() : '';
                if (currentRunId && resultRunId && resultRunId !== currentRunId) {
                    return;
                }

                const createdAtMs = Date.parse(result.createdAt || '');
                if (
                    relationshipRecoveryStartedAtRef.current > 0 &&
                    Number.isFinite(createdAtMs) &&
                    createdAtMs + 1000 < relationshipRecoveryStartedAtRef.current
                ) {
                    return;
                }
            }

            handleNewConnections(result);
        };

        const initialDelay = isAnalyzing ? 2000 : 0;
        const timeoutId = window.setTimeout(replayLatestRelationships, initialDelay);
        const intervalId = isAnalyzing ? window.setInterval(replayLatestRelationships, 5000) : null;

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
            if (intervalId !== null) {
                window.clearInterval(intervalId);
            }
        };
    }, [edges, handleNewConnections, hasConnectedDots, investigationId, isAnalyzing, loadedInvestigationId, nodes.length]);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            console.debug('[Board] Received:', msg.type);

            if (msg.type === 'MEMORY_NODE_GATHERED') {
                const { node, vaultId, append } = msg.payload;
                const frame = calculateNodeFrame(node.summary || '', node.fullText || '', false, nodeHasImages(node.images));
                const targetBoardMode = vaultId && vaultId !== investigationId
                    ? (getCachedBoardStateForInvestigation(vaultId)?.mode === 'legacy' ? 'legacy' : 'strict-grid')
                    : boardMode;
                const isImported = isImportedEvidenceNode(node);
                const { nodeEntrySequence, ...entryMetadata } = createNodeEntryMetadata(isImported);

                const newNode: Node = {
                    id: node.id,
                    type: 'custom',
                    zIndex: targetBoardMode === 'strict-grid' ? STRICT_GRID_NODE_Z_INDEX : undefined,
                    style: frame,
                    data: {
                        ...node,
                        onReadFull: () => openNodeDossier(node),
                        onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                        onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                        onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                        onDelete: (id: string) => handleDeleteNode(id),
                        onUpdate: (id: string, data: Partial<NodeData>) => handleUpdateNode(id, data),
                        onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                        onSetEditing: (id: string | null) => handleSetEditing(id),
                        onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                        onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                        onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                        onResizeCommit: handleNodeResizeCommit,
                        isDeepDiveSource: false,
                        isRecentlyImported: isImported,
                        ...entryMetadata,
                        expanded: false,
                        boardMode: targetBoardMode,
                    },
                    position: getNodeEntryStagingPosition(frame, targetBoardMode, nodeEntrySequence),
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left
                };

                // Check if this node is meant for a different investigation (Pull Node flow)
                if (vaultId && vaultId !== investigationId) {
                    console.debug(`[Board] Routing node ${node.id} to target vault: ${vaultId}`);
                    const savedState = getCachedBoardStateForInvestigation(vaultId);
                    const vaultData: PersistedBoardState = savedState || { mode: targetBoardMode, nodes: [], edges: [], pendingIntegrationNodeIds: [] };

                    const nodeExists = (vaultData.nodes || []).some((n: Node) => n.id === node.id);
                    if (!nodeExists) {
                        vaultData.nodes = [...(vaultData.nodes || []), stripTransientNodeData(newNode)];
                        vaultData.mode = vaultData.mode || targetBoardMode;
                        if (append) {
                            const currentIds = vaultData.pendingIntegrationNodeIds || [];
                            vaultData.pendingIntegrationNodeIds = currentIds.includes(node.id) ? currentIds : [...currentIds, node.id];
                        }
                        const existingState = getCachedBoardStateForInvestigation(vaultId);
                        void saveBoardStateForInvestigation(vaultId, {
                            ...vaultData,
                            synthesisAlerts: existingState?.synthesisAlerts || [],
                        });
                        console.debug(`[Board] Node ${node.id} successfully persisted to target vault ${vaultId}`);
                    }
                    return; // Don't add to the currently visible board (which is likely the source/historical vault)
                }

                setNodes((nds) => {
                    if (nds.find(n => n.id === node.id)) return nds;
                    return [...nds, newNode];
                });
                scheduleNodeEntryCleanup(node.id, entryMetadata.nodeEntryDelayMs);
                if (isImported) {
                    markNodeAsRecentlyImported(node.id);
                }
                if (append && vaultId === investigationId) {
                    addPendingIntegrationNodeId(node.id);
                }
            } else if (msg.type === 'RABBIT_HOLE_NODE_UPDATE') {
                const payload = msg.payload || {};
                const vaultId = typeof payload.vaultId === 'string' ? payload.vaultId.trim() : '';
                const nodeIds = Array.isArray(payload.nodeIds)
                    ? payload.nodeIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '').map((id: string) => id.trim())
                    : [];
                const rabbitState = typeof payload.rabbitState === 'string' ? payload.rabbitState.trim() : '';
                if (!vaultId || nodeIds.length === 0 || !rabbitState) {
                    return;
                }
                const nodeIdSet = new Set(nodeIds);
                const applyRabbitState = (node: Node) => nodeIdSet.has(node.id)
                    ? { ...node, data: { ...node.data, rabbitState } }
                    : node;

                if (vaultId && vaultId !== investigationId) {
                    const savedState = getCachedBoardStateForInvestigation(vaultId);
                    if (savedState) {
                        void saveBoardStateForInvestigation(vaultId, {
                            ...savedState,
                            nodes: (savedState.nodes || []).map(applyRabbitState),
                        });
                    }
                    return;
                }

                setNodes((nds) => nds.map(applyRabbitState));
            } else if (msg.type === 'PERSONA_INSIGHTS') {
                // Handle full persona insights with chat data
                const insights = msg.payload as Array<{
                    personaName: string;
                    perspective: string;
                    keyFindings: string[];
                    connections: string[];
                    observations?: string[];
                    hypotheses?: string[];
                    questions: string[];
                    confidence: number;
                    fullAnalysis: string;
                    nodeIDs: string[];
                    proposedConnections?: Array<{
                        source: string;
                        target: string;
                        tag: string;
                        reasoning: string;
                        evidenceNodeIDs: string[];
                        confidence: number;
                    }>;
                }>;
                console.debug('[PERSONA_INSIGHTS] Received insights:', insights);
                if (insights && Array.isArray(insights)) {
                    applyPersonaInsightsToNodes(insights);
                }
                // Stop gathering when persona insights are complete
                setIsGathering(false);
            } else if (msg.type === 'CONNECTIONS_FOUND') {
                handleNewConnections(msg.payload);
                // Also stop gathering/analyzing when connections are actually found and displayed
                setIsGathering(false);
            } else if (msg.type === 'BRAIN_STATE') {
                const state = msg.payload;
                if (state === 'Done' || state === 'Offline' || state === 'Disconnected') {
                    if (isGathering) {
                        setDeepDiveTopic(null);
                    }
                    setIsGathering(false);
                } else {
                    setIsGathering(true);
                }
            } else if (msg.type === 'PIPELINE_PROGRESS') {
                const runId = typeof msg.payload?.runId === 'string' ? msg.payload.runId.trim() : '';
                const vaultId = typeof msg.payload?.vaultId === 'string' ? msg.payload.vaultId.trim() : '';
                const status = typeof msg.payload?.status === 'string' ? msg.payload.status : '';
                if (runId && (!vaultId || vaultId === investigationId) && status === 'cancelled') {
                    stoppedPipelineRunIdsRef.current.add(runId);
                    clearLayoutChoreographyState();
                    setIsGathering(false);
                    setIsAnalyzing(false);
                    setAnalysisMode(null);
                    setDeepDiveTopic(null);
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                const explicitVaultId = typeof msg.payload?.vaultId === 'string'
                    ? msg.payload.vaultId.trim()
                    : '';
                const vaultId = explicitVaultId || investigationId;
                const isAppendResult = Boolean(msg.payload?.append);
                const completedRunId = typeof msg.payload?.runId === 'string'
                    ? msg.payload.runId.trim()
                    : '';

                setIsGathering(false);
                setDeepDiveTopic(null);
                if (vaultId) {
                    void saveVaultResultForInvestigation(vaultId, msg.payload);
                }

                if (explicitVaultId && explicitVaultId !== investigationId) {
                    console.debug('[Board] Ignoring auto reconnect for completed investigation:', {
                        completedVaultId: explicitVaultId,
                        currentInvestigationId: investigationId,
                    });
                    return;
                }

                if (completedRunId) {
                    latestPipelineRunIdRef.current = completedRunId;
                    if (stoppedPipelineRunIdsRef.current.has(completedRunId)) {
                        console.debug('[Board] Ignoring late synthesis completion for stopped run:', completedRunId);
                        return;
                    }
                }

                if (isAppendResult) {
                    return;
                }
                // Queue auto connect dots for full new-investigation crawls once the board has render-ready nodes.
                setAutoConnectRequest({
                    vaultId,
                    runId: completedRunId || latestPipelineRunIdRef.current || '',
                    requestedAt: Date.now(),
                });
            } else if (msg.type === 'ERROR') {
                console.error('[Board] System Error:', msg.payload);
                clearLayoutChoreographyState();
                setIsAnalyzing(false);
                setIsGathering(false);
                setAnalysisMode(null);
                setDeepDiveTopic(null);
                alert(`System Error: ${msg.payload}`);
            } else if (msg.type === 'MANUAL_NODE_PROCESSED') {
                const { nodeId, processedText } = msg.payload;
                console.debug(`[Board] Manual node ${nodeId} processing completed:`);
                console.debug(` - Input snippet: "... [see board]"`);
                console.debug(` - Output snippet: "${processedText.slice(0, 80)}..."`);

                const entities = processedText.match(/\[(?:PERSON|ORG|LOC|DATE|TIME):.*?\]/gi) || [];
                console.debug(` - Highlights determined: ${entities.length > 0 ? entities.join(', ') : 'NONE FOUND'}`);

                setNodes(nds => nds.map(n => {
                    if (n.id === nodeId) {
                        // Strip tags for a clean title
                        const cleanTitle = processedText.replace(/\[(?:PERSON|ORG|LOC|DATE|TIME):(.*?)\]/gi, '$1');
                        const preserveFullText = shouldPreserveExistingFullText(
                            typeof n.data.summary === 'string' ? n.data.summary : '',
                            typeof n.data.fullText === 'string' ? n.data.fullText : '',
                        );
                        return {
                            ...n,
                            data: {
                                ...n.data,
                                summary: processedText,
                                fullText: preserveFullText ? n.data.fullText : processedText,
                                title: n.data.title === 'NEW_EVIDENCE' || !n.data.title ? (cleanTitle.slice(0, 30) + (cleanTitle.length > 30 ? '...' : '')) : n.data.title,
                                isAnalyzing: false
                            }
                        };
                    }
                    return n;
                }));
                setEditingNodeId(null);
            }
        };

        sharedSocket.addEventListener('message', handleMessage);

        return () => {
            sharedSocket.removeEventListener('message', handleMessage);
        };
    }, [addPendingIntegrationNodeId, applyPersonaInsightsToNodes, boardMode, sharedSocket, clearLayoutChoreographyState, createNodeEntryMetadata, getNodeEntryStagingPosition, handleAttachImage, handleNewConnections, handleDeleteNode, handleNodeExpand, handleNodeResizeCommit, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, markNodeAsRecentlyImported, onDeepDiveNode, onNavigateToChild, isGathering, investigationId, openImageLightbox, openNodeDossier, scheduleNodeEntryCleanup]);

    const addManualNode = useCallback(() => {
        const id = `manual-${Date.now()}`;
        const frame = calculateNodeFrame('', '', true, false);
        setBoardMode('strict-grid');
        const newNode: Node = {
            id,
            type: 'custom',
            zIndex: STRICT_GRID_NODE_Z_INDEX,
            position: getViewportCenteredNodePosition(frame, 'strict-grid'),
            style: frame,
            data: {
                id,
                title: 'NEW_EVIDENCE',
                summary: '',
                fullText: '',
                onReadFull: () => openNodeDossier({ id, title: 'NEW_EVIDENCE', summary: '', fullText: '' }),
                onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                onExpand: (nodeId: string, expanded: boolean) => handleNodeExpand(nodeId, expanded),
                onDelete: (id: string) => handleDeleteNode(id),
                onUpdate: (id: string, d: Partial<NodeData>) => handleUpdateNode(id, d),
                onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                onResizeCommit: handleNodeResizeCommit,
                onSetEditing: (id: string | null) => handleSetEditing(id),
                isEditing: true,
                isDeepDiveSource: false,
                isRecentlyImported: false,
                expanded: true,
                boardMode: 'strict-grid',
            },
        };

        setNodes(nds => [...nds, newNode]);
        setEditingNodeId(id);
    }, [getViewportCenteredNodePosition, handleAttachImage, handleDeleteNode, handleNodeExpand, handleNodeResizeCommit, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, onDeepDiveNode, onNavigateToChild, openImageLightbox, openNodeDossier, setNodes, setEditingNodeId]);

    // Enhanced node data that includes all necessary context and stable handlers
    // We update nodes whenever stable props like sharedSocket or returnVaultId change
    useEffect(() => {
        setNodes(nds => nds.map(node => ({
            ...node,
            data: {
                ...node.data,
                returnVaultId,
                currentInvestigationId: investigationId,
                sharedSocket,
                boardMode,
                onExpand: handleNodeExpand,
                onDelete: handleDeleteNode,
                onUpdate: handleUpdateNode,
                onSave: handleSaveNode,
                onViewImages: openImageLightbox,
                onAttachImage: handleAttachImage,
                onRemoveImage: handleRemoveImage,
                onResizeCommit: handleNodeResizeCommit,
                onSetEditing: handleSetEditing,
                isEditing: node.id === editingNodeId
            }
        })));
        // We only want to sync these onto the nodes when the container state changes
    }, [boardMode, returnVaultId, investigationId, sharedSocket, handleAttachImage, handleDeleteNode, handleNodeExpand, handleRemoveImage, handleUpdateNode, handleSaveNode, openImageLightbox, handleNodeResizeCommit, handleSetEditing, editingNodeId]);



    const dispatchConnectTheDots = useCallback((options: { silent?: boolean } = {}) => {
        const evidenceNodes = nodes.filter((node) => node.data?.nodeKind !== 'discovery');
        const incrementalNodeIds = pendingIntegrationNodeIds.filter((nodeId) => evidenceNodes.some((node) => node.id === nodeId));

        if (evidenceNodes.length < 2) {
            if (!options.silent) {
                alert("Need at least 2 nodes!");
            }
            return false;
        }
        if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
            if (!options.silent) {
                alert("Connection lost. Please wait for reconnect.");
            }
            return false;
        }

        console.debug('[Board] Dispatching CONNECT_DOTS...');
        relationshipRecoveryStartedAtRef.current = Date.now();
        setIsAnalyzing(true);
        setAnalysisMode(incrementalNodeIds.length > 0 ? 'incremental' : 'full');
        setEdgeReasoning(null);
        const retainedEdges = edges.filter((edge) => {
            if (edge.data?.generatedBy === 'discovery') {
                return false;
            }

            if (incrementalNodeIds.length === 0 && edge.data?.generatedBy === 'connectTheDots') {
                return false;
            }

            return true;
        });
        startConnectLayoutChoreography(evidenceNodes, retainedEdges);
        if (investigationId) {
            window.dispatchEvent(new CustomEvent('gorantula:clear-discoveries', { detail: { vaultId: investigationId } }));
        }

        const nodeData = evidenceNodes.map(n => ({
            id: n.id,
            title: n.data.title,
            summary: n.data.summary,
            fullText: n.data.fullText
        }));

        if (incrementalNodeIds.length > 0) {
            sharedSocket.send(JSON.stringify({
                type: 'CONNECT_DOTS_INCREMENTAL',
                payload: {
                    allNodes: nodeData,
                    pendingNodeIds: incrementalNodeIds,
                },
                vaultId: investigationId,
                runId: latestPipelineRunIdRef.current || undefined,
            }));
            return true;
        }

        sharedSocket.send(JSON.stringify({
            type: 'CONNECT_DOTS',
            payload: nodeData,
            vaultId: investigationId,
            runId: latestPipelineRunIdRef.current || undefined,
        }));
        return true;
    }, [edges, investigationId, nodes, pendingIntegrationNodeIds, sharedSocket, startConnectLayoutChoreography]);

    const connectTheDots = useCallback(() => {
        dispatchConnectTheDots({ silent: false });
    }, [dispatchConnectTheDots]);

    useEffect(() => {
        if (!autoConnectRequest) {
            return;
        }

        if (!investigationId || autoConnectRequest.vaultId !== investigationId) {
            setAutoConnectRequest(null);
            return;
        }

        if (autoConnectRequest.runId && stoppedPipelineRunIdsRef.current.has(autoConnectRequest.runId)) {
            setAutoConnectRequest(null);
            return;
        }

        const evidenceNodeCount = nodes.filter((node) => node.data?.nodeKind !== 'discovery').length;
        if (evidenceNodeCount < 2 || isReorganizing || !sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            if (dispatchConnectTheDots({ silent: true })) {
                setAutoConnectRequest(null);
            }
        }, 50);

        return () => window.clearTimeout(timeoutId);
    }, [autoConnectRequest, dispatchConnectTheDots, investigationId, isReorganizing, nodes, sharedSocket]);

    const clearBoard = () => {
        if (window.confirm("Clear board?")) {
            clearBoardCameraMovement();
            clearLayoutChoreographyState();
            setBoardMode('strict-grid');
            setPendingIntegrationNodeIds([]);
            setAutoConnectRequest(null);
            setAnalysisMode(null);
            setNodes([]);
            setEdges([]);
            setEdgeReasoning(null);
            setSelectedDossier(null);
            setHasConnectedDots(false);
        }
    };

    const handleReorganize = useCallback(() => {
        console.debug('[TidyUp] Clicked. Current nodes:', nodes.length, 'Current edges:', edges.length);
        if (nodes.length === 0) {
            console.debug('[TidyUp] No nodes to organize.');
            return;
        }

        setIsReorganizing(true);

        // Run calculation after a short timeout to allow UI to show loading state
        setTimeout(() => {
            try {
                if (boardMode === 'strict-grid') {
                    const normalizedNodes = getStrictGridLayoutedNodes(nodes, edges);
                    syncStrictGridEdgesToNodes(edges, normalizedNodes);
                    setTimeout(() => {
                        const duration = startBoardCameraMovement(BOARD_CAMERA_GLIDE_DURATION_MS);
                        fitView({ duration, ...BOARD_FIT_VIEW_OPTIONS });
                        setTimeout(() => {
                            setIsReorganizing(false);
                            console.debug('[TidyUp] Reorganization cycle complete.');
                        }, duration + 50);
                    }, 850);
                    return;
                }

                // Reset handles and distribution
                console.debug('[TidyUp] Distributing edges...');
                const { edges: finalEdges, handledNodes } = distributeEdges(edges, nodes);

                // Compute new layout positions
                console.debug('[TidyUp] Running Dagre layout...');
                const { nodes: layoutedNodes } = getLayoutedElements(handledNodes, finalEdges);
                const supportLayerState = layoutSupportingEvidenceNodes(layoutedNodes, finalEdges);

                console.debug('[TidyUp] Setting state with layouted nodes...');

                // Set both at once. The CSS transition in index.css will handle the motion.
                setNodes(supportLayerState.nodes);
                setEdges(finalEdges);

                // Wait for the SLIDE transition to complete (0.8s) before fitting view
                setTimeout(() => {
                    console.debug('[TidyUp] Triggering fitView...');
                    const duration = startBoardCameraMovement(BOARD_CAMERA_GLIDE_DURATION_MS);
                    fitView({ duration, ...BOARD_FIT_VIEW_OPTIONS });

                    // Final finish after animation
                    setTimeout(() => {
                        setIsReorganizing(false);
                        console.debug('[TidyUp] Reorganization cycle complete.');
                    }, duration + 50);
                }, 850); // Matches the CSS transition duration
            } catch (err) {
                console.error('[TidyUp] Error during reorganization:', err);
                setIsReorganizing(false);
            }
        }, 100);
    }, [boardMode, edges, fitView, nodes, startBoardCameraMovement, syncStrictGridEdgesToNodes]);

    const onEdgeClick = (_: React.MouseEvent, edge: Edge) => {
        if (edge.data?.reasoning) {
            const rawTag = getEdgeRawRelationshipTag(edge);
            const displayLabel = getEdgeRelationshipDisplayLabel(edge);

            setEdgeReasoning({
                tag: displayLabel,
                rawTag: rawTag !== displayLabel ? rawTag : undefined,
                text: edge.data.reasoning,
                color: edge.data.color || '#bc13fe',
                personas: edge.data.supportingPersonas || [],
                qualityScore: edge.data.qualityScore,
                evidenceNodeIDs: edge.data.evidenceNodeIDs || [],
            });
        }
    };

    const activeTags = new Set(edges.map(e => getEdgeRawRelationshipTag(e)));
    const visibleStyles = Object.entries(tagStyles).filter(([tag]) => activeTags.has(tag));
    const visibleLegendStyles = visibleStyles.reduce<VisibleLegendStyle[]>((legendStyles, [tag, style]) => {
        const displayLabel = getRelationshipDisplayLabel(tag);
        const existing = legendStyles.find((entry) => entry.displayLabel === displayLabel);

        if (existing) {
            existing.tags.push(tag);
            return legendStyles;
        }

        legendStyles.push({
            displayLabel,
            tag,
            tags: [tag],
            style,
        });
        return legendStyles;
    }, []);

    const handleExport = async (type: 'png' | 'svg' | 'pdf') => {
        setShowExportMenu(false);
        const boardElementId = 'detective-board-flow';
        const exportUtils = await import('../utils/ExportUtils');

        if (type === 'png') {
            await exportUtils.exportAsPng(boardElementId);
        } else if (type === 'svg') {
            await exportUtils.exportAsSvg(boardElementId);
        } else if (type === 'pdf') {
            const currentInv = getCachedInvestigations()
                .find((i: InvestigationRecord) => i.id === investigationId);

            const saved = investigationId ? getCachedBoardStateForInvestigation(investigationId) : null;
            let nodesData: Array<{ title: string; summary: string; sourceURL: string }> = [];
            if (saved) {
                const { nodes: savedNodes } = saved;
                nodesData = savedNodes.map((n: Node<NodeData>) => ({
                    title: String(n.data?.title || ''),
                    summary: String(n.data?.summary || ''),
                    sourceURL: String(n.data?.sourceURL || '')
                }));
            }

            const vaultSaved = investigationId ? getCachedVaultResultForInvestigation(investigationId) : null;
            const finalSynthesis = typeof vaultSaved?.result === 'string' ? vaultSaved.result : "No synthesis available for this investigation.";

            await exportUtils.exportAsPdf({
                topic: currentInv?.topic || 'Unknown Investigation',
                finalSynthesis: finalSynthesis,
                nodes: nodesData
            });
        }
    };


    const boardRootClassName = `forensic-board-root relative h-full w-full overflow-hidden ${isBoardCameraMoving ? 'forensic-board-camera-moving' : ''} ${isBoardEmptyIdle ? 'forensic-board-empty-idle' : ''}`;
    const shouldHoldInitialRestoreViewport = Boolean((investigationId && loadedInvestigationId !== investigationId) || isInitialRestoreViewportSettling);
    const boardFlowClassName = `relative w-full h-full ${shouldHoldInitialRestoreViewport ? 'forensic-board-restore-prefit' : ''}`;
    const minimapCenterButtonClassName = `forensic-minimap-frame forensic-minimap-center-button pointer-events-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent-muted)] transition-colors hover:border-[rgba(129,227,255,0.36)] hover:text-[var(--forensic-accent)] ${isBoardCameraMoving ? 'forensic-minimap-center-button-active' : ''}`;
    const utilityRecenterButtonClassName = `forensic-utility-button ${isBoardCameraMoving ? 'forensic-utility-button-camera-moving' : ''}`;

    return (
        <div ref={boardContainerRef} className={boardRootClassName} id="detective-board-container">
            <div
                ref={boardToolbarRef}
                data-testid="board-toolbar-shell"
                className="absolute top-4 z-[70] flex flex-col items-stretch gap-3 px-0"
                style={toolbarPosition}
            >
                <div className="pointer-events-none absolute left-0 right-0 top-full mt-3 flex w-full justify-center">
                    {(isGathering || isReorganizing) && (
                        <div className="forensic-busy-pill flex items-center gap-2 rounded-full px-5 py-2 text-[11px] font-black uppercase tracking-[0.24em] backdrop-blur-md animate-pulse">
                            {isReorganizing ? 'Reorganizing Neural Pathways...' : (deepDiveTopic ? `Deep Diving: ${deepDiveTopic}` : 'Gathering Intel...')} {isReorganizing ? '' : `${nodes.length}/8`}
                        </div>
                    )}
                </div>

                <div className="flex w-full justify-center">
                    <div
                        ref={boardActionBarRef}
                        data-testid="board-action-bar"
                        className="forensic-action-bar forensic-toolbar-shell flex w-full max-w-full flex-wrap items-center gap-3 overflow-visible rounded-[1.45rem] p-2.5 backdrop-blur-xl"
                    >
                        <div data-testid="board-search-cluster" className="forensic-toolbar-cluster flex min-w-[18rem] max-w-[30rem] flex-[1_1_20rem] items-center gap-2">
                            <div data-testid="append-search-shell" className="forensic-search-shell flex min-h-11 min-w-0 w-full items-center gap-2 rounded-xl px-3 py-2">
                                <Search size={15} className="text-[var(--forensic-accent-muted)]" />
                                <input
                                    type="text"
                                    value={appendSearchPrompt}
                                    onChange={(event) => setAppendSearchPrompt(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                            appendSearchToInvestigation();
                                        }
                                    }}
                                    disabled={!investigationId || isBoardBusy}
                                    placeholder={investigationId ? 'Search more in this investigation...' : 'Select an investigation to append search'}
                                    className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-[var(--forensic-accent)] outline-none placeholder:text-[var(--forensic-text-faint)] disabled:cursor-not-allowed disabled:text-[var(--forensic-text-faint)]"
                                />
                                <button
                                    type="button"
                                    onClick={appendSearchToInvestigation}
                                    disabled={!canAppendSearch}
                                    className={`shrink-0 rounded-lg border px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] transition-all ${canAppendSearch
                                        ? 'border-[rgba(129,227,255,0.4)] bg-[rgba(129,227,255,0.08)] text-[var(--forensic-accent)] hover:border-[rgba(129,227,255,0.55)] hover:bg-[rgba(129,227,255,0.18)] hover:text-white'
                                        : 'cursor-not-allowed border-[rgba(129,227,255,0.12)] bg-[rgba(129,227,255,0.05)] text-[rgba(129,227,255,0.38)]'
                                        }`}
                                >
                                    Search More
                                </button>
                            </div>
                        </div>

                        <div className="forensic-toolbar-cluster flex shrink-0 items-center gap-2">
                            <button
                                onClick={addManualNode}
                                className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-300/30 bg-emerald-300/12 px-4 py-2 text-[11px] font-black tracking-[0.18em] text-emerald-100 transition-all hover:border-emerald-300/42 hover:bg-emerald-300/20 hover:text-white"
                            >
                                <PlusSquare size={15} />
                                Add Evidence
                            </button>

                            <button
                                id="connect-dots-btn"
                                onClick={connectTheDots}
                                disabled={!canConnectDots}
                                className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-[11px] font-black tracking-[0.18em] transition-all ${isAnalyzing ? 'forensic-connect-button-scanning' : ''} ${canConnectDots
                                    ? 'border-[rgba(170,212,255,0.24)] bg-[rgba(170,212,255,0.08)] text-[var(--forensic-accent-muted)] hover:border-[rgba(170,212,255,0.4)] hover:bg-[rgba(170,212,255,0.16)] hover:text-white'
                                    : 'cursor-not-allowed border-[rgba(170,212,255,0.12)] bg-[rgba(170,212,255,0.04)] text-[rgba(170,212,255,0.38)]'
                                    }`}
                            >
                                <Zap size={15} className={isAnalyzing ? 'animate-spin' : ''} />
                                {isAnalyzing
                                    ? (analysisMode === 'incremental' ? 'Integrating New Evidence...' : 'Analyzing Patterns...')
                                    : hasPendingEvidenceIntegration
                                        ? 'Integrate New Evidence'
                                        : (hasConnectedDots ? 'Reconnect the Dots' : 'Connect the Dots')}
                            </button>
                        </div>

                        {isMergedChild && returnVaultId && onReturnToParent && (
                            <button
                                onClick={onReturnToParent}
                                className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-fuchsia-300/32 bg-fuchsia-300/12 px-4 py-2 text-[11px] font-black tracking-[0.18em] text-fuchsia-100 transition-all hover:border-fuchsia-200/48 hover:bg-fuchsia-300/20 hover:text-white"
                            >
                                <ArrowLeft size={15} />
                                Return To Parent
                            </button>
                        )}

                        <div className="forensic-toolbar-cluster flex shrink-0 items-center gap-2">
                            <div className="relative">
                                <button
                                    ref={exportButtonRef}
                                    onClick={toggleExportMenu}
                                    disabled={!canExport}
                                    className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-[11px] font-bold tracking-[0.18em] transition-all ${canExport
                                        ? 'border-white/14 bg-white/[0.045] text-[var(--forensic-text)] hover:border-white/28 hover:bg-white/12 hover:text-white'
                                        : 'cursor-not-allowed border-white/8 bg-white/[0.04] text-white/35'
                                        }`}
                                >
                                    <Download size={15} />
                                    Export
                                    <ChevronDown size={14} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
                                </button>
                            </div>

                            <div className="relative">
                                <button
                                    ref={boardControlsButtonRef}
                                    onClick={toggleBoardControlsPanel}
                                    className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-[11px] font-bold tracking-[0.18em] transition-all ${showBoardControls
                                        ? 'border-[rgba(129,227,255,0.4)] bg-[rgba(129,227,255,0.12)] text-[var(--forensic-accent)]'
                                        : 'border-white/10 bg-[rgba(8,13,19,0.82)] text-[var(--forensic-text-muted)] hover:border-white/25 hover:text-white'
                                        }`}
                                >
                                    <SlidersHorizontal size={15} />
                                    Board Controls
                                    <ChevronDown size={14} className={`transition-transform ${showBoardControls ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {showBoardControls && (
                    <div
                        ref={boardControlsPanelRef}
                        data-testid="board-controls-overlay"
                        className="forensic-board-dialog absolute z-[80] flex flex-col overflow-hidden rounded-[1.5rem] p-4 backdrop-blur-xl"
                        style={{
                            top: `${boardControlsPosition.top}px`,
                            right: 0,
                            width: `${boardControlsPosition.width}px`,
                            maxHeight: `${boardControlsPosition.maxHeight}px`,
                            maxWidth: `calc(100vw - ${BOARD_CONTROLS_PANEL_MARGIN * 2}px)`,
                        }}
                    >
                        <div className="mb-4 flex items-start justify-between gap-4 border-b border-white/8 pb-3">
                            <div>
                                <h3 className="text-[11px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent)]">Board Controls</h3>
                                <p className="mt-1 text-xs leading-relaxed text-[var(--forensic-text-faint)]">
                                    Manage visibility, snapping, layout, and maintenance actions without crowding the main board.
                                </p>
                            </div>
                            <button
                                onClick={() => setShowBoardControls(false)}
                                className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--forensic-text-faint)] transition-colors hover:border-white/30 hover:text-white"
                            >
                                Close
                            </button>
                        </div>

                        <div data-testid="board-controls-scroll" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
                            <div className="space-y-4">
                                <section className="forensic-board-section rounded-2xl p-3">
                                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-text-faint)]">
                                        <Eye size={13} className="text-white/60" />
                                        View
                                    </div>
                                    <button
                                        onClick={() => setShowGrid((current) => {
                                            const next = !current;
                                            console.debug('[DetectiveBoard] Grid toggle clicked. Next state:', next);
                                            return next;
                                        })}
                                        className={`flex w-full rounded-xl border px-3 py-3 text-left transition-all ${showGrid
                                            ? 'border-white/20 bg-white/7 text-white hover:border-white/35'
                                            : 'border-white/10 bg-black/35 text-gray-300 hover:border-white/25 hover:text-white'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <Grid3X3 size={15} className={`mt-0.5 shrink-0 ${showGrid ? 'text-white' : 'text-gray-500'}`} />
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[11px] font-semibold">Grid Overlay</div>
                                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${showGrid ? 'bg-white text-black' : 'bg-white/8 text-gray-300'}`}>
                                                        {showGrid ? 'On' : 'Off'}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs leading-relaxed text-gray-500">Show the investigation grid behind the board.</div>
                                            </div>
                                        </div>
                                    </button>
                                </section>

                                <section className="forensic-board-section rounded-2xl p-3">
                                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-text-faint)]">
                                        <Target size={13} className="text-[var(--forensic-accent-muted)]" />
                                        Snapping
                                    </div>
                                    <div className="space-y-2">
                                        <button
                                            onClick={() => setSnapConnectionLabels((current) => !current)}
                                            className={`flex w-full rounded-xl border px-3 py-3 text-left transition-all ${snapConnectionLabels
                                                ? 'border-cyber-cyan/40 bg-cyber-cyan/10 text-cyber-cyan'
                                                : 'border-cyber-cyan/18 bg-black/35 text-gray-300 hover:border-cyber-cyan/35 hover:text-white'
                                                }`}
                                        >
                                            <div className="w-full">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[11px] font-semibold">Snap Connections</div>
                                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${snapConnectionLabels ? 'bg-cyber-cyan text-black' : 'bg-white/8 text-gray-300'}`}>
                                                        {snapConnectionLabels ? 'On' : 'Off'}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs leading-relaxed text-gray-500">Keep relationship labels aligned while editing the board.</div>
                                            </div>
                                        </button>

                                        <button
                                            onClick={() => setSnapNodes((current) => !current)}
                                            className={`flex w-full rounded-xl border px-3 py-3 text-left transition-all ${snapNodes
                                                ? 'border-cyber-green/40 bg-cyber-green/10 text-cyber-green'
                                                : 'border-cyber-green/18 bg-black/35 text-gray-300 hover:border-cyber-green/35 hover:text-white'
                                                }`}
                                        >
                                            <div className="w-full">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[11px] font-semibold">Snap Nodes</div>
                                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${snapNodes ? 'bg-cyber-green text-black' : 'bg-white/8 text-gray-300'}`}>
                                                        {snapNodes ? 'On' : 'Off'}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs leading-relaxed text-gray-500">Lock cards to the board grid while moving evidence.</div>
                                            </div>
                                        </button>
                                    </div>
                                </section>

                                <section className="forensic-board-section rounded-2xl p-3">
                                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-text-faint)]">
                                        <Move size={13} className="text-emerald-200/80" />
                                        Arrange
                                    </div>
                                    <div className="space-y-2">
                                        <button
                                            onClick={handleReorganize}
                                            disabled={!canArrange}
                                            className={`flex w-full rounded-xl border px-3 py-3 text-left transition-all ${canArrange
                                                ? 'border-cyber-cyan/28 bg-cyber-cyan/8 text-cyber-cyan hover:border-cyber-cyan/50 hover:bg-cyber-cyan/12'
                                                : 'cursor-not-allowed border-cyber-cyan/12 bg-cyber-cyan/5 text-cyber-cyan/35'
                                                }`}
                                        >
                                            <div className="flex w-full items-start gap-3">
                                                <Edit2 size={15} className={`mt-0.5 shrink-0 ${isReorganizing ? 'animate-bounce' : ''}`} />
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-[11px] font-semibold">{isReorganizing ? 'Tidying...' : 'Tidy Up'}</div>
                                                        <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] text-gray-300">
                                                            Auto
                                                        </span>
                                                    </div>
                                                    <div className="mt-1 text-xs leading-relaxed text-gray-500">Clean up spacing and tighten the current evidence layout.</div>
                                                </div>
                                            </div>
                                        </button>
                                    </div>
                                </section>

                                {showBrowserQaBoardTools && (
                                    <section className="forensic-board-section rounded-2xl p-3">
                                        <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-text-faint)]">
                                            <FlaskConical size={13} className="text-amber-200/80" />
                                            QA
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setQaToolsEnabled((current) => !current)}
                                            aria-pressed={qaToolsEnabled}
                                            className={`flex w-full rounded-xl border px-3 py-3 text-left transition-all ${qaToolsEnabled
                                                ? 'border-amber-300/40 bg-amber-300/10 text-amber-100'
                                                : 'border-amber-300/18 bg-black/35 text-gray-300 hover:border-amber-300/35 hover:text-white'
                                                }`}
                                        >
                                            <div className="w-full">
                                                <div className="flex items-center gap-2">
                                                    <div className="text-[11px] font-semibold">Enable QA Tools</div>
                                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em] ${qaToolsEnabled ? 'bg-amber-200 text-black' : 'bg-white/8 text-gray-300'}`}>
                                                        {qaToolsEnabled ? 'On' : 'Off'}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs leading-relaxed text-gray-500">Show the local animation replay button in the board utility rail.</div>
                                            </div>
                                        </button>
                                    </section>
                                )}

                                <section className="rounded-2xl border border-red-500/20 bg-red-500/[0.03] p-3">
                                    <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
                                        <Trash2 size={13} />
                                        Reset
                                    </div>
                                    <button
                                        onClick={clearBoard}
                                        disabled={!hasNodes}
                                        className={`flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition-all ${hasNodes
                                            ? 'border-red-500/35 bg-red-500/8 text-red-400 hover:border-red-500/60 hover:bg-red-500/14'
                                            : 'cursor-not-allowed border-red-500/12 bg-red-500/5 text-red-500/30'
                                            }`}
                                    >
                                        <div>
                                            <div className="text-[11px] font-semibold">Clear Board</div>
                                            <div className="mt-1 text-xs text-gray-500">Remove all evidence cards and connections from the active board.</div>
                                        </div>
                                        <span className="rounded-full bg-red-500/12 px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-400">
                                            Danger
                                        </span>
                                    </button>
                                </section>

                            </div>
                        </div>
                    </div>
                )}
            </div>

            {showExportMenu && (
                <div
                    ref={exportMenuPanelRef}
                    data-testid="export-menu-overlay"
                    className="forensic-board-dialog absolute z-50 overflow-hidden rounded-2xl backdrop-blur-xl"
                    style={{
                        top: `${exportMenuPosition.top}px`,
                        left: `${exportMenuPosition.left}px`,
                        width: `${exportMenuPosition.width}px`,
                        maxWidth: `calc(100vw - ${BOARD_CONTROLS_PANEL_MARGIN * 2}px)`,
                    }}
                >
                    <button
                        onClick={() => handleExport('png')}
                        className="flex w-full items-center gap-3 border-b border-white/6 px-4 py-3 text-left text-[11px] font-semibold text-[var(--forensic-text-muted)] transition-colors hover:bg-white/8 hover:text-white"
                    >
                        <ImageIcon size={14} className="text-[var(--forensic-accent)]" /> Snapshot (PNG)
                    </button>
                    <button
                        onClick={() => handleExport('svg')}
                        className="flex w-full items-center gap-3 border-b border-white/6 px-4 py-3 text-left text-[11px] font-semibold text-[var(--forensic-text-muted)] transition-colors hover:bg-white/8 hover:text-white"
                    >
                        <Box size={14} className="text-cyber-green" /> Vector (SVG)
                    </button>
                    <button
                        onClick={() => handleExport('pdf')}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left text-[11px] font-semibold text-[var(--forensic-text-muted)] transition-colors hover:bg-white/8 hover:text-white"
                    >
                        <FileText size={14} className="text-cyber-purple" /> Full Report (PDF)
                    </button>
                </div>
            )}

            <div
                ref={flowWrapperRef}
                className={boardFlowClassName}
                id="detective-board-flow"
                onPointerDown={onPanePointerDown}
                onPointerMove={onPanePointerMove}
                onPointerUp={onPanePointerUp}
            >
                <ReactFlow
                    nodes={nodesForRender}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onNodeDragStart={onNodeDragStart}
                    onNodeDragStop={onNodeDragStop}
                    onConnect={onConnect}
                    onReconnect={onReconnect}
                    onEdgeClick={onEdgeClick}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    connectionMode={ConnectionMode.Loose}
                    snapToGrid={boardMode !== 'strict-grid' && snapNodes}
                    snapGrid={[BOARD_GRID_SIZE, BOARD_GRID_SIZE]}
                    fitView
                    fitViewOptions={BOARD_FIT_VIEW_OPTIONS}
                    defaultViewport={BOARD_DEFAULT_VIEWPORT}
                    minZoom={BOARD_MIN_ZOOM}
                    maxZoom={1.75}
                    proOptions={REACT_FLOW_PRO_OPTIONS}
                >
                    {showGrid && (
                        <Background
                            variant={BackgroundVariant.Lines}
                            color="rgba(126, 145, 165, 0.34)"
                            gap={BOARD_GRID_SIZE}
                            size={1}
                        />
                    )}
                </ReactFlow>
                {supportingEvidenceLayer && (
                    <div
                        data-testid="supporting-evidence-layer"
                        className="forensic-supporting-evidence-layer"
                        style={supportBandScreenStyle(supportingEvidenceLayer)}
                        aria-hidden="true"
                    >
                        <div className="forensic-supporting-evidence-label">
                            <span>Supporting Evidence</span>
                            <span className="forensic-supporting-evidence-count">{supportingEvidenceLayer.total}</span>
                        </div>
                        <div className="forensic-supporting-evidence-counters">
                            <span className="forensic-supporting-evidence-chip">Web {supportingEvidenceLayer.counts.web}</span>
                            <span className="forensic-supporting-evidence-chip">Vault {supportingEvidenceLayer.counts.vault}</span>
                            <span className="forensic-supporting-evidence-chip">Timeline {supportingEvidenceLayer.counts.timeline}</span>
                        </div>
                    </div>
                )}
                {supportTethers.length > 0 && (
                    <svg
                        data-testid="support-evidence-tether-overlay"
                        className="forensic-support-tether-overlay"
                        width={boardViewportSize.width}
                        height={boardViewportSize.height}
                        viewBox={`0 0 ${boardViewportSize.width} ${boardViewportSize.height}`}
                        aria-hidden="true"
                    >
                        {supportTethers.map((tether: SupportTether) => {
                            const source = supportTetherScreenPoint(tether.source);
                            const target = supportTetherScreenPoint(tether.target);

                            return (
                                <line
                                    key={`${tether.sourceId}-${tether.targetId}`}
                                    data-testid="support-evidence-tether-line"
                                    className={`forensic-support-tether-line forensic-support-tether-line-${tether.strength}`}
                                    x1={source.x}
                                    y1={source.y}
                                    x2={target.x}
                                    y2={target.y}
                                />
                            );
                        })}
                    </svg>
                )}
                <div
                    data-testid="minimap-panel"
                    className="pointer-events-none absolute z-20"
                    style={{
                        width: minimapLayout.panel.width,
                        height: minimapLayout.panel.height,
                        left: MINIMAP_PANEL_OFFSET.left,
                        top: MINIMAP_PANEL_OFFSET.top,
                    }}
                >
                    <div className="forensic-minimap-module relative flex h-full flex-col overflow-hidden rounded-[1.2rem] p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <div className="forensic-minimap-frame rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.24em] text-[var(--forensic-accent-muted)] backdrop-blur-sm">
                                Navigator
                            </div>
                            <div className="forensic-minimap-readout text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-text-faint)]">
                                {isBoardCameraMoving ? 'Moving' : `${nodes.length} nodes`}
                            </div>
                        </div>
                        <div
                            className="forensic-minimap-map-slot rounded-xl"
                            style={{ height: minimapLayout.map.height }}
                        >
                            <BoardNavigator
                                nodes={nodes}
                                viewport={boardViewport}
                                viewportSize={boardViewportSize}
                                width={minimapLayout.map.width}
                                height={minimapLayout.map.height}
                                isCameraMoving={isBoardCameraMoving}
                                activeSupportTethers={supportTethers}
                                getNodeColor={getMiniMapNodeColor}
                                onNavigate={handleMiniMapNavigate}
                            />
                        </div>
                        <div className="forensic-minimap-footer flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={recenterBoardViewport}
                                aria-label="Center board from minimap"
                                className={minimapCenterButtonClassName}
                            >
                                <Crosshair size={11} />
                                Center
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsMiniMapExpanded((current) => !current)}
                                aria-label={isMiniMapExpanded ? 'Shrink minimap' : 'Enlarge minimap'}
                                className="forensic-minimap-frame pointer-events-auto inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-visible rounded-md text-[var(--forensic-accent-muted)] transition-colors hover:border-[rgba(129,227,255,0.36)] hover:text-[var(--forensic-accent)]"
                            >
                                {isMiniMapExpanded ? <Minimize2 size={15} strokeWidth={2.2} /> : <Maximize2 size={15} strokeWidth={2.2} />}
                            </button>
                        </div>
                    </div>
                </div>
                <div
                    data-testid="board-utility-rail"
                    className={`forensic-utility-rail absolute right-5 top-24 ${showQaReplayMenu ? 'z-[90]' : 'z-20'} flex flex-col items-center gap-2`}
                >
                    <button
                        type="button"
                        onClick={toggleSynthesisWorkspacePanel}
                        aria-label={synthesisUtilityLabel}
                        title={synthesisUtilityLabel}
                        className={`forensic-utility-button ${hasTheoryReady ? 'forensic-utility-button-complete' : ''}`}
                    >
                        <Network size={16} />
                        {hasUnreadTheory && (
                            <span
                                data-testid="theory-utility-notification"
                                className="forensic-utility-notification-dot forensic-utility-notification-dot-theory forensic-utility-notification-dot-unread"
                                aria-hidden="true"
                            />
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={toggleDiscoveryWorkspacePanel}
                        aria-label={discoveryUtilityLabel}
                        title={discoveryUtilityLabel}
                        className={`forensic-utility-button ${hasDiscoveryReady ? 'forensic-utility-button-discovery-complete' : ''}`}
                    >
                        <Lightbulb size={16} />
                        {hasUnreadDiscoveries && (
                            <span
                                data-testid="discovery-utility-notification"
                                className="forensic-utility-notification-dot forensic-utility-notification-dot-discovery forensic-utility-notification-dot-unread"
                                aria-hidden="true"
                            />
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={toggleRelationshipWorkspacePanel}
                        aria-label={showRelationshipLegend ? 'Hide relationships legend' : 'Show relationships legend'}
                        title={showRelationshipLegend ? 'Hide relationships legend' : 'Show relationships legend'}
                        className={`forensic-utility-button ${showRelationshipLegend ? 'forensic-utility-button-active' : ''}`}
                    >
                        <Info size={16} />
                    </button>
                    {showBrowserQaBoardTools && qaToolsEnabled && (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowQaReplayMenu((current) => !current)}
                                aria-label="Open QA replay menu"
                                title="Open QA replay menu"
                                className="forensic-utility-button forensic-utility-button-qa"
                            >
                                <FlaskConical size={16} />
                            </button>
                            {showQaReplayMenu && (
                                <div
                                    data-testid="board-qa-menu"
                                    className="forensic-board-dialog absolute right-[3.75rem] top-0 z-30 flex w-64 max-h-[min(28rem,calc(100vh-8rem))] flex-col gap-1 overflow-y-auto rounded-2xl p-2 backdrop-blur-xl"
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaAnimationDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay board animation demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <PlayCircle size={14} /> Board animation
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaDiscoveryDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay discovery demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <Lightbulb size={14} /> Discovery
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaSynthesisDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay synthesis demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <Network size={14} /> Synthesis
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaSpiderTelemetryDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay spider telemetry demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <RadioTower size={14} /> Spider telemetry
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaPipelineDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay pipeline demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <Activity size={14} /> Pipeline
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaRabbitHoleDemo({ investigationId: investigationId || undefined, requestId: `qa-rabbit-hole-${Date.now()}` });
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay Rabbit Hole trail demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-rose-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <FileSearch size={14} /> Rabbit Hole trails
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaLocalIngestionDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay local ingestion demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <FileText size={14} /> Local ingestion
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaGatheringStatusDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay gathering status demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <Activity size={14} /> Gathering status
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaErrorEmptyDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay error/empty demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <AlertTriangle size={14} /> Error and empty
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaTimelineDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay timeline demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <Clock size={14} /> Timeline
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaEvidenceExpansionDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay evidence expansion demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <FileSearch size={14} /> Evidence expansion
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaDuplicateEvidenceDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay duplicate evidence squash demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <FileSearch size={14} /> Duplicate squash
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            playBrowserQaTextFitDemo();
                                            setShowQaReplayMenu(false);
                                        }}
                                        aria-label="Replay text fit demo"
                                        className="flex items-center gap-3 rounded-xl px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.16em] text-amber-100 transition-colors hover:bg-white/8 hover:text-white"
                                    >
                                        <FileText size={14} /> Text fit
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                    <button
                        type="button"
                        onClick={recenterBoardViewport}
                        aria-label="Recenter board viewport"
                        title="Recenter board viewport"
                        className={utilityRecenterButtonClassName}
                    >
                        <Target size={16} />
                    </button>
                </div>
                {marquee && (
                    <div
                        data-testid="marquee-selection"
                        className="pointer-events-none absolute z-20 border-2 border-[rgba(145,225,255,0.9)] bg-[rgba(129,227,255,0.06)] shadow-[0_0_0_1px_rgba(129,227,255,0.2)]"
                        style={{
                            left: getMarqueeRect(marquee.screenStart, marquee.screenCurrent).x,
                            top: getMarqueeRect(marquee.screenStart, marquee.screenCurrent).y,
                            width: getMarqueeRect(marquee.screenStart, marquee.screenCurrent).width,
                            height: getMarqueeRect(marquee.screenStart, marquee.screenCurrent).height,
                        }}
                    />
                )}
            </div>
            {boardRestoreOverlay && (
                <div
                    data-testid="board-restore-loading"
                    className="forensic-board-restore-loading pointer-events-none absolute inset-0 z-[45] flex items-center justify-center"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    <div className="forensic-board-restore-loading-panel">
                        <div className="forensic-board-restore-loading-scan" />
                        <div className="forensic-board-restore-loading-title">
                            Restoring board
                        </div>
                        <div className="forensic-board-restore-loading-meta">
                            {boardRestoreOverlay.source === 'memory-cache'
                                ? 'Local map ready'
                                : boardRestoreOverlay.source === 'backend-refresh'
                                    ? 'Checking latest board'
                                    : 'Loading evidence map'}
                        </div>
                    </div>
                </div>
            )}

            {edgeReasoning && (
                <div className="forensic-board-dialog absolute bottom-10 left-10 z-40 w-80 p-4 backdrop-blur-md" style={{ borderColor: edgeReasoning.color, boxShadow: `0 24px 44px rgba(0,0,0,0.45), 0 0 20px ${edgeReasoning.color}33` }}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[10px] font-black tracking-tighter uppercase" style={{ color: edgeReasoning.color }}><Info size={12} /> Connection logic: {edgeReasoning.tag}</div>
                        <button onClick={() => setEdgeReasoning(null)} className="text-gray-500 hover:text-white text-xs">×</button>
                    </div>
                    {edgeReasoning.rawTag && (
                        <div className="mb-2 text-[9px] font-black uppercase tracking-[0.16em] text-[var(--forensic-text-faint)]">
                            Evidence tag: {edgeReasoning.rawTag}
                        </div>
                    )}
                    <div className="text-white text-[11px] leading-relaxed italic">{edgeReasoning.text}</div>
                    {typeof edgeReasoning.qualityScore === 'number' && (
                        <div className="mt-3 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: edgeReasoning.color }}>
                            Quality Score: {Math.round(edgeReasoning.qualityScore * 100)}%
                        </div>
                    )}
                    {edgeReasoning.personas && edgeReasoning.personas.length > 0 && (
                        <div className="mt-3 text-[10px] leading-relaxed text-gray-300">
                            Personas: {edgeReasoning.personas.join(', ')}
                        </div>
                    )}
                    {edgeReasoning.evidenceNodeIDs && edgeReasoning.evidenceNodeIDs.length > 0 && (
                        <div className="mt-2 text-[10px] leading-relaxed text-gray-400">
                            Evidence Nodes: {edgeReasoning.evidenceNodeIDs.join(', ')}
                        </div>
                    )}
                </div>
            )}

            {relationshipDraft && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                    <div className="forensic-board-dialog w-full max-w-md p-6">
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-[0.2em] text-[var(--forensic-accent)]">
                                    {relationshipDraft.mode === 'create' ? 'Create Relationship' : 'Rename Relationship'}
                                </h3>
                                <p className="mt-2 text-xs leading-relaxed text-[var(--forensic-text-faint)]">
                                    {relationshipDraft.mode === 'create'
                                        ? 'Name this connection so it appears consistently on the board and in the relationship legend.'
                                        : 'Update the relationship name. The edge styling and legend will update automatically.'}
                                </p>
                            </div>
                            <button
                                onClick={closeRelationshipEditor}
                                className="border border-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--forensic-text-faint)] hover:border-white/30 hover:text-white"
                            >
                                Close
                            </button>
                        </div>

                        <label className="mb-2 block text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--forensic-text-faint)]">
                            Relationship Name
                        </label>
                        <input
                            autoFocus
                            value={relationshipNameInput}
                            onChange={(e) => setRelationshipNameInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    submitRelationshipEditor();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    closeRelationshipEditor();
                                }
                            }}
                            className="w-full border border-[rgba(129,227,255,0.34)] bg-[rgba(4,9,14,0.82)] px-4 py-3 text-sm font-mono text-white outline-none transition-colors focus:border-[rgba(129,227,255,0.54)]"
                            placeholder="RELATED"
                        />

                        <div className="mt-5 flex justify-end gap-3">
                            <button
                                onClick={closeRelationshipEditor}
                                className="border border-white/20 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-gray-300 hover:border-white/40 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={submitRelationshipEditor}
                                className="border border-[rgba(129,227,255,0.34)] bg-[rgba(129,227,255,0.08)] px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--forensic-accent)] hover:bg-[rgba(129,227,255,0.18)] hover:text-white"
                            >
                                Save Relationship
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {imageLightbox && activeLightboxImage && (
                <div
                    data-testid="node-image-lightbox"
                    className="absolute inset-0 z-[60] flex items-center justify-center bg-black/82 px-6 py-8 backdrop-blur-sm"
                    onClick={closeImageLightbox}
                >
                    <div
                        ref={lightboxDialogRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="node-image-lightbox-title"
                        tabIndex={-1}
                        className="forensic-board-dialog relative flex max-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col overflow-hidden rounded-[1.5rem]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <input
                            ref={lightboxFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            onChange={async (event) => {
                                const file = event.target.files?.[0];
                                if (!file || !imageLightbox?.nodeId) {
                                    event.target.value = '';
                                    return;
                                }

                                try {
                                    await handleAttachImage(imageLightbox.nodeId, file);
                                } catch (error) {
                                    console.error('[DetectiveBoard] Failed to attach image from lightbox', error);
                                    alert(error instanceof Error ? error.message : 'Failed to attach image');
                                } finally {
                                    event.target.value = '';
                                }
                            }}
                        />
                        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent)]">Visual Evidence</div>
                                <h3 id="node-image-lightbox-title" className="mt-1 truncate text-sm font-bold text-white">
                                    {imageLightbox.nodeTitle || 'Attached node image'}
                                </h3>
                                <div className="mt-1 text-xs text-gray-400">
                                    {imageLightbox.index + 1} / {imageLightbox.images.length}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeImageLightbox}
                                className="rounded-lg border border-white/10 p-2 text-[var(--forensic-text-faint)] transition-colors hover:border-white/30 hover:text-white"
                                title="Close image viewer"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/70 p-4">
                            <img
                                src={activeLightboxImage.path}
                                alt={activeLightboxImage.caption || imageLightbox.nodeTitle || 'Attached node image'}
                                crossOrigin="anonymous"
                                className="block max-h-full w-auto max-w-full object-contain"
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
                            <div className="min-w-0 flex-1 text-xs text-gray-400">
                                {activeLightboxImage.caption || activeLightboxImage.sourceURL || 'Stored evidence image'}
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {imageLightbox.nodeId && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => lightboxFileInputRef.current?.click()}
                                        className="rounded-lg border border-[rgba(129,227,255,0.3)] bg-[rgba(129,227,255,0.08)] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--forensic-accent)] transition-colors hover:border-[rgba(129,227,255,0.5)] hover:bg-[rgba(129,227,255,0.18)] hover:text-white"
                                        >
                                            Add Image
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveImage(imageLightbox.nodeId!, activeLightboxImage.id)}
                                            className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-red-200 transition-colors hover:border-red-300 hover:bg-red-400 hover:text-black"
                                        >
                                            Remove Image
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={() => stepImageLightbox(-1)}
                                    disabled={imageLightbox.images.length <= 1}
                                    className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-300 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    onClick={() => stepImageLightbox(1)}
                                    disabled={imageLightbox.images.length <= 1}
                                    className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-gray-300 transition-colors hover:border-white/30 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showRelationshipLegend ? (
                <div className="forensic-legend-panel absolute bottom-6 right-6 z-40 flex max-h-[50vh] w-64 flex-col p-4 backdrop-blur-md">
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-[rgba(129,227,255,0.18)] pb-2">
                        <h3 className="text-xs font-black tracking-widest text-[var(--forensic-accent)]">RELATIONSHIPS</h3>
                        <button
                            onClick={closeRelationshipLegend}
                            className="flex items-center gap-1 rounded-md border border-[rgba(129,227,255,0.3)] bg-[rgba(129,227,255,0.08)] px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent)] transition-colors hover:border-[rgba(129,227,255,0.5)] hover:bg-[rgba(129,227,255,0.18)] hover:text-white"
                            title="Hide relationship legend"
                        >
                            <ChevronDown size={12} />
                            Hide
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 custom-scrollbar">
                        {visibleLegendStyles.length === 0 && (
                            <div className="text-[10px] italic text-[var(--forensic-text-faint)]">No connections yet. Dynamic tags will appear here.</div>
                        )}
                        {visibleLegendStyles.map(({ displayLabel, tag, tags, style }) => {
                            const isEditingVisibleLabel = tags.includes(editingTag || '');

                            return (
                                <div
                                    key={tag}
                                    onClick={() => setEditingTag(isEditingVisibleLabel ? null : tag)}
                                    className={`group -ml-1 flex cursor-pointer items-center gap-2 rounded p-1 transition-colors ${isEditingVisibleLabel ? 'border border-[rgba(129,227,255,0.5)] bg-[rgba(129,227,255,0.16)]' : 'border border-transparent hover:bg-white/5'}`}
                                >
                                    <div className="w-3 h-3 rounded-full border border-black shadow-sm shrink-0" style={{ backgroundColor: style.color }}></div>
                                    <span className="truncate text-[10px] font-bold tracking-wider text-[var(--forensic-text-muted)]" title={tags.join(', ')}>{displayLabel}</span>
                                    <Edit2 size={10} className="ml-auto text-[var(--forensic-text-faint)] opacity-0 group-hover:opacity-100" />
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <button
                    onClick={openRelationshipLegend}
                    className="forensic-legend-panel absolute bottom-6 right-6 z-40 flex max-w-[min(16rem,calc(100vw-2.5rem))] items-center gap-2 rounded-full px-4 py-2 text-left text-[10px] font-black uppercase tracking-[0.2em] text-[var(--forensic-accent)] backdrop-blur-md transition-all hover:border-[rgba(129,227,255,0.5)] hover:bg-[rgba(129,227,255,0.14)] hover:text-white"
                    title="Show relationship legend"
                >
                    <ChevronUp size={14} />
                    <span className="truncate">Relationships</span>
                </button>
            )}

            {showRelationshipLegend && editingTag && tagStyles[editingTag] && (
                <div className="forensic-board-dialog absolute bottom-6 right-[calc(1.5rem+17rem)] z-50 w-64 p-4 backdrop-blur-md">
                    <div className="mb-4 flex items-center justify-between border-b border-[rgba(129,227,255,0.18)] pb-2">
                        <h3 className="max-w-[150px] truncate text-xs font-black tracking-widest text-[var(--forensic-accent-muted)]">EDIT: {editingTag}</h3>
                        <button onClick={() => setEditingTag(null)} className="text-gray-400 hover:text-white">✕</button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="mb-2 block text-[10px] font-bold tracking-wider text-[var(--forensic-text-faint)]">COLOR</label>
                            <input
                                type="color"
                                value={tagStyles[editingTag].color || '#bc13fe'}
                                onChange={(e) => {
                                    const newStyles = { ...tagStyles, [editingTag]: { ...tagStyles[editingTag], color: e.target.value } };
                                    persistTagStyles(newStyles);
                                }}
                                className="h-8 w-full cursor-pointer border border-white/12 bg-black"
                            />
                        </div>

                        <div>
                            <label className="mb-2 block text-[10px] font-bold tracking-wider text-[var(--forensic-text-faint)]">LINE PATTERN</label>
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                {SUPPORTED_RELATIONSHIP_PATTERNS.map((pat) => (
                                    <button
                                        key={pat}
                                        onClick={() => {
                                            const newStyles = {
                                                ...tagStyles,
                                                [editingTag]: { ...tagStyles[editingTag], pattern: pat as RelationshipPattern }
                                            };
                                            persistTagStyles(newStyles);
                                        }}
                                        className={`border px-2 py-1 uppercase tracking-wider ${tagStyles[editingTag].pattern === pat ? 'border-[rgba(129,227,255,0.4)] bg-[rgba(129,227,255,0.08)] text-[var(--forensic-accent)]' : 'border-white/12 text-[var(--forensic-text-faint)] hover:border-white/24'}`}
                                    >
                                        {pat}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="mb-2 block text-[10px] font-bold tracking-wider text-[var(--forensic-text-faint)]">LINE SHAPE</label>
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                                {SUPPORTED_RELATIONSHIP_SHAPES.map((shape) => (
                                    <button
                                        key={shape}
                                        onClick={() => {
                                            const newStyles = {
                                                ...tagStyles,
                                                [editingTag]: { ...tagStyles[editingTag], shape: shape as RelationshipShape }
                                            };
                                            persistTagStyles(newStyles);
                                        }}
                                        className={`border px-2 py-1 uppercase tracking-wider ${tagStyles[editingTag].shape === shape ? 'border-[rgba(129,227,255,0.4)] bg-[rgba(129,227,255,0.08)] text-[var(--forensic-accent)]' : 'border-white/12 text-[var(--forensic-text-faint)] hover:border-white/24'}`}
                                    >
                                        {shape}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedDossier && (
                <div
                    data-testid="node-dossier-overlay"
                    className="pointer-events-none absolute inset-0 z-[120] flex justify-end p-4"
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="node-dossier-title"
                        className="forensic-dossier-reader pointer-events-auto flex h-full w-[min(46rem,calc(100vw-2rem))] flex-col overflow-hidden"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-[rgba(129,227,255,0.14)] px-6 py-5">
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[var(--forensic-accent-muted)]">
                                    Dossier
                                </div>
                                <h2 id="node-dossier-title" className="mt-2 text-xl font-black leading-tight text-[var(--forensic-accent)]">
                                    {selectedDossier.title}
                                </h2>
                                {selectedDossierMetaChips.length > 0 && (
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {selectedDossierMetaChips.map((chip) => (
                                            <span key={chip} className="forensic-dossier-chip">
                                                {chip}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelectedDossier(null)}
                                className="shrink-0 rounded-lg border border-[rgba(129,227,255,0.24)] bg-[rgba(129,227,255,0.06)] p-2 text-[var(--forensic-accent-muted)] transition-colors hover:border-[rgba(129,227,255,0.42)] hover:bg-[rgba(129,227,255,0.14)] hover:text-white"
                                title="Close dossier"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
                            <section className="forensic-dossier-brief">
                                <div className="forensic-dossier-section-label">Evidence Brief</div>
                                <p>{renderDossierTextWithLinks(selectedDossierBrief)}</p>
                            </section>

                            {selectedDossierSourceLinks.length > 0 && (
                                <section className="mt-5">
                                    <div className="forensic-dossier-section-label">Sources</div>
                                    <div className="mt-2 grid gap-2">
                                        {selectedDossierSourceLinks.map((source, index) => (
                                            <a
                                                key={`${source}-${index}`}
                                                href={source}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="forensic-dossier-source-link"
                                            >
                                                <span className="truncate">{source}</span>
                                                <ExternalLink size={13} />
                                            </a>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section className="mt-6">
                                <div className="forensic-dossier-section-label">Source Detail</div>
                                <div className="mt-3 space-y-3">
                                    {selectedDossierBodyBlocks.length > 0 ? (
                                        selectedDossierBodyBlocks.map((block, index) => (
                                            block.kind === 'heading' ? (
                                                <h3 key={`${block.kind}-${index}`} className="forensic-dossier-body-heading">
                                                    {block.text}
                                                </h3>
                                            ) : (
                                                <p key={`${block.kind}-${index}`} className="forensic-dossier-body-paragraph">
                                                    {block.text.split('\n').map((line, lineIndex) => (
                                                        <React.Fragment key={`${line}-${lineIndex}`}>
                                                            {lineIndex > 0 && <br />}
                                                            {renderDossierTextWithLinks(line)}
                                                        </React.Fragment>
                                                    ))}
                                                </p>
                                            )
                                        ))
                                    ) : (
                                        <p className="forensic-dossier-body-paragraph">
                                            No extended source text is available for this card yet.
                                        </p>
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const DetectiveBoard: React.FC<DetectiveBoardProps> = (props) => (
    <ReactFlowProvider><DetectiveBoardContent {...props} /></ReactFlowProvider>
);

export default DetectiveBoard;
