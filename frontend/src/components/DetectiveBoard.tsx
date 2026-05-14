import React, { useCallback, useEffect, useState, useRef } from 'react';
import ReactFlow, {
    Background,
    BackgroundVariant,
    MiniMap,
    applyEdgeChanges,
    applyNodeChanges,
    addEdge,
    useReactFlow,
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode, { type NodeSaveMode } from './CustomNode';
import CustomEdge from './CustomEdge';
import { assignStrictGridPorts, BOARD_GRID_SIZE, buildStrictGridRoute, calculateNodeFrame, getNodeDimensions, normalizeNodeFrame, snapCoordinateToGrid } from './boardGeometry';
import type { BoardMode } from './boardGeometry';
import type { NodeImageAsset } from './nodeImages';
import { nodeHasImages } from './nodeImages';
import { getLayoutedElements } from './detectiveBoardLayout';
import { type PersistedBoardState } from '../utils/hierarchicalCanvas';
import {
    getCachedBoardStateForInvestigation,
    getCachedInvestigations,
    getCachedVaultResultForInvestigation,
    loadBoardStateForInvestigation,
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
    BOARD_TOGGLE_DISCOVERY_PANEL_EVENT,
    BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT,
    emitBoardWorkspaceEvent,
} from '../utils/boardWorkspaceEvents';

import { Zap, Info, Trash2, Edit2, Download, ChevronDown, ChevronUp, FileText, Image as ImageIcon, Box, PlusSquare, Grid3X3, Target, Move, SlidersHorizontal, Eye, ArrowLeft, Maximize2, Minimize2, Search, X, Lightbulb, Network, Crosshair, PanelRightOpen } from 'lucide-react';
const normalizeRelationshipTag = (tag?: string | null) => {
    const trimmed = (tag || '').trim();
    return trimmed ? trimmed.toUpperCase() : 'RELATED';
};

const shouldPreserveExistingFullText = (summary?: string, fullText?: string) =>
    Boolean(summary && fullText && summary !== fullText);

const STRICT_GRID_EDGE_Z_INDEX = 0;
const STRICT_GRID_NODE_Z_INDEX = 100;
const STRICT_GRID_ROW_GAP = BOARD_GRID_SIZE * 6;
const STRICT_GRID_COLUMN_GAP = BOARD_GRID_SIZE * 8;

const normalizeStrictGridNodes = (nodes: Node[]) => nodes.map((node) => {
    const dimensions = getNodeDimensions(node);

    return {
        ...node,
        zIndex: STRICT_GRID_NODE_Z_INDEX,
        position: {
            x: snapCoordinateToGrid(node.position.x),
            y: snapCoordinateToGrid(node.position.y),
        },
        style: {
            ...node.style,
            ...normalizeNodeFrame(dimensions.width, dimensions.height),
        },
        data: {
            ...node.data,
            boardMode: 'strict-grid' as BoardMode,
        }
    };
});

const getStrictGridBoardOrderedNodes = (nodes: Node[], edges: Edge[]) => {
    const { nodes: layoutedNodes } = getLayoutedElements(nodes, edges);

    return [...layoutedNodes].sort((left, right) => {
        const yDelta = left.position.y - right.position.y;
        if (Math.abs(yDelta) > BOARD_GRID_SIZE * 2) {
            return yDelta;
        }

        return left.position.x - right.position.x;
    });
};

const buildStrictGridRows = (orderedNodes: Node[], columnCount: number) => {
    const rows: Node[][] = [];

    for (let index = 0; index < orderedNodes.length; index += columnCount) {
        rows.push(orderedNodes.slice(index, index + columnCount));
    }

    return rows;
};

const getStrictGridLayoutedNodes = (nodes: Node[], edges: Edge[]) => {
    const orderedNodes = getStrictGridBoardOrderedNodes(nodes, edges);
    const columnCount = Math.max(2, Math.ceil(Math.sqrt(Math.max(orderedNodes.length, 1))));
    const orderedNodeIds = new Set(orderedNodes.map((node) => node.id));
    const connectedNodeIds = new Set(
        edges
            .filter((edge) => orderedNodeIds.has(edge.source) && orderedNodeIds.has(edge.target))
            .flatMap((edge) => [edge.source, edge.target])
    );
    const disconnectedNodes = orderedNodes.filter((node) => !connectedNodeIds.has(node.id));
    const connectedNodes = orderedNodes.filter((node) => connectedNodeIds.has(node.id));
    const rows = [
        ...buildStrictGridRows(disconnectedNodes, columnCount),
        ...buildStrictGridRows(connectedNodes, columnCount),
    ];

    const rowWidths = rows.map((row) =>
        row.reduce((width, node, index) => {
            const dim = getNodeDimensions(node);
            return width + dim.width + (index > 0 ? STRICT_GRID_COLUMN_GAP : 0);
        }, 0)
    );
    const maxRowWidth = Math.max(...rowWidths, 0);

    let currentY = 0;
    const boardNodes = rows.flatMap((row, rowIndex) => {
        const rowHeight = Math.max(...row.map((node) => getNodeDimensions(node).height), 0);
        const rowWidth = rowWidths[rowIndex];
        let currentX = (maxRowWidth - rowWidth) / 2;

        const placedRow = row.map((node) => {
            const dim = getNodeDimensions(node);
            const nextNode = {
                ...node,
                position: {
                    x: currentX,
                    y: currentY,
                },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                style: {
                    ...node.style,
                    width: dim.width,
                    height: dim.height,
                }
            };

            currentX += dim.width + STRICT_GRID_COLUMN_GAP;
            return nextNode;
        });

        currentY += rowHeight + STRICT_GRID_ROW_GAP;
        return placedRow;
    });

    return normalizeStrictGridNodes(boardNodes);
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

type ConnectionsFoundPayload = {
    connections: any[];
    vaultId?: string;
};

const coerceConnectionsFoundPayload = (payload: unknown): ConnectionsFoundPayload => {
    if (Array.isArray(payload)) {
        return { connections: payload };
    }

    if (payload && typeof payload === 'object') {
        const candidate = payload as { connections?: unknown; vaultId?: unknown };
        return {
            connections: Array.isArray(candidate.connections) ? candidate.connections : [],
            vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId.trim() : undefined,
        };
    }

    return { connections: [] };
};

const connectionVaultId = (connection: any) =>
    typeof connection?.vaultId === 'string' ? connection.vaultId.trim() : '';

export const detectiveBoardTestUtils = {
    getStrictGridLayoutedNodes,
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
    const resizedDimensions = new Map<string, { width: number; height: number }>();

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
            isLiveResize ? { width, height } : normalizeNodeFrame(width, height)
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

        return {
            ...node,
            style: {
                ...node.style,
                ...nextDimensions,
            }
        };
    });
};

const BOARD_DEFAULT_VIEWPORT = { x: 0, y: 96, zoom: 1 };
const BOARD_FIT_VIEW_OPTIONS = { padding: 0.16, minZoom: 0.98, maxZoom: 1 };
const RELATIONSHIP_LEGEND_VISIBILITY_KEY = 'detective_board_relationship_legend_visible';
const MINIMAP_NODE_STROKE = '#06080b';
const MINIMAP_MASK_STROKE = 'rgba(152, 255, 255, 1)';
const MINIMAP_MASK_FILL = 'rgba(129, 227, 255, 0.018)';
const MINIMAP_MASK_STROKE_WIDTH = 4;
const MINIMAP_OFFSET_SCALE = 2.5;
const MINIMAP_PANEL_LAYOUT = {
    compact: {
        panel: { width: 244, height: 178 },
        map: { width: 212, height: 116 },
    },
    expanded: {
        panel: { width: 320, height: 238 },
        map: { width: 288, height: 176 },
    },
} as const;
const MINIMAP_PANEL_OFFSET = { left: 24, top: 16, padding: 16, header: 42, toolbarGap: 20 };
const EXPORT_MENU_WIDTH = 224;
const BOARD_CONTROLS_PANEL_MAX_WIDTH = 416;
const BOARD_CONTROLS_PANEL_MARGIN = 16;
const RECENT_IMPORT_HIGHLIGHT_DURATION_MS = 3000;
const REACT_FLOW_PRO_OPTIONS = { hideAttribution: true };

const isImportedEvidenceNode = (nodeLike: { id?: string; title?: string } | null | undefined) =>
    Boolean(nodeLike?.title?.includes('[IMPORTED]') || nodeLike?.id?.startsWith('imported-'));

const stripTransientNodeData = (node: Node): Node => ({
    ...node,
    data: {
        ...node.data,
        isRecentlyImported: false,
        personaInsights: Array.isArray(node.data?.personaInsights)
            ? node.data.personaInsights.map((insight: any) => ({
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
});

const sanitizeNodesForPersistence = (nodes: Node[]) => nodes.map(stripTransientNodeData);

const getMiniMapNodeColor = (node: Node) => {
    if (node.data?.portalKind === 'merged-child') {
        return '#d946ef';
    }

    if (node.data?.isDeepDiveSource) {
        return '#10b981';
    }

    if (typeof node.data?.title === 'string' && (node.data.title.includes('[IMPORTED]') || node.id.startsWith('imported-'))) {
        return '#f59e0b';
    }

    return '#00f3ff';
};

const DetectiveBoardContent: React.FC<DetectiveBoardProps> = ({ investigationId, returnVaultId, sharedSocket, onDeepDiveNode, onNavigateToChild, focusNodeId, onReturnToParent, isMergedChild }) => {
    const { fitView, screenToFlowPosition, setCenter, getZoom } = useReactFlow();
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);

    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [edgeReasoning, setEdgeReasoning] = useState<{ tag: string, text: string, color: string, personas?: string[], qualityScore?: number, evidenceNodeIDs?: string[] } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGathering, setIsGathering] = useState(false);
    const [isReorganizing, setIsReorganizing] = useState(false);
    const [deepDiveTopic, setDeepDiveTopic] = useState<string | null>(null);
    const [loadedInvestigationId, setLoadedInvestigationId] = useState<string | null>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [exportMenuPosition, setExportMenuPosition] = useState<{ top: number; left: number; width: number }>({
        top: 0,
        left: 0,
        width: EXPORT_MENU_WIDTH,
    });
    const [showBoardControls, setShowBoardControls] = useState(false);
    const [boardControlsPosition, setBoardControlsPosition] = useState<{ top: number; left: number; width: number }>({
        top: 0,
        left: 0,
        width: BOARD_CONTROLS_PANEL_MAX_WIDTH,
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
    const [tagStyles, setTagStyles] = useState<Record<string, TagStyle>>({});
    const [editingTag, setEditingTag] = useState<string | null>(null);
    const [relationshipDraft, setRelationshipDraft] = useState<RelationshipDraft | null>(null);
    const [relationshipNameInput, setRelationshipNameInput] = useState('RELATED');
    const [marquee, setMarquee] = useState<MarqueeState | null>(null);
    const [isMiniMapExpanded, setIsMiniMapExpanded] = useState(false);
    const [imageLightbox, setImageLightbox] = useState<ImageLightboxState | null>(null);
    const lightboxFileInputRef = useRef<HTMLInputElement>(null);
    const lightboxDialogRef = useRef<HTMLDivElement>(null);
    const previousFocusedElementRef = useRef<HTMLElement | null>(null);
    const boardContainerRef = useRef<HTMLDivElement>(null);
    const exportButtonRef = useRef<HTMLButtonElement>(null);
    const exportMenuPanelRef = useRef<HTMLDivElement>(null);
    const boardControlsButtonRef = useRef<HTMLButtonElement>(null);
    const boardControlsPanelRef = useRef<HTMLDivElement>(null);
    const flowWrapperRef = useRef<HTMLDivElement>(null);
    const nodesRef = useRef<Node[]>([]);
    const edgesRef = useRef<Edge[]>([]);
    const pendingIntegrationNodeIdsRef = useRef<string[]>([]);
    const analysisModeRef = useRef<AnalysisMode>(null);
    const latestPipelineRunIdRef = useRef<string | null>(null);
    const isDraggingNodeRef = useRef(false);
    const draggingNodeIdsRef = useRef<Set<string>>(new Set());
    const dragRouteFrameRef = useRef<number | null>(null);
    const persistTimerRef = useRef<number | null>(null);
    const marqueePointerIdRef = useRef<number | null>(null);
    const marqueeSelectedIdsRef = useRef<Set<string>>(new Set());
    const recentImportTimeoutsRef = useRef<Map<string, number>>(new Map());

    nodesRef.current = nodes;
    edgesRef.current = edges;
    pendingIntegrationNodeIdsRef.current = pendingIntegrationNodeIds;
    analysisModeRef.current = analysisMode;

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
    const minimapMapPosition = {
        left: MINIMAP_PANEL_OFFSET.left + MINIMAP_PANEL_OFFSET.padding,
        top: MINIMAP_PANEL_OFFSET.top + MINIMAP_PANEL_OFFSET.header,
    };
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

    const handleMiniMapClick = useCallback((_: React.MouseEvent, position: XYPosition) => {
        setCenter(position.x, position.y, {
            zoom: getZoom(),
            duration: 180,
        });
    }, [getZoom, setCenter]);

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
                    sourcePortSide: route.sourceSide,
                    targetPortSide: route.targetSide,
                    snapEnabled: snapConnectionLabels,
                }
            };
        });
    }, [snapConnectionLabels]);

    const syncStrictGridEdgesToNodes = useCallback((nextEdges: Edge[], nextNodes = nodesRef.current) => {
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

        setBoardMode('strict-grid');
        setNodes(finalizedNodes);
        setEdges(finalizedStrictEdges);
    }, [decorateStrictGridEdges]);

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
        const affectedEdges = nextEdges.filter((edge) => changedNodeIdSet.has(edge.source) || changedNodeIdSet.has(edge.target));
        const affectedAssignments = assignStrictGridPorts(affectedEdges, normalizedNodes);
        const updatedEdges = nextEdges.map((edge) => {
            const route = affectedAssignments.get(edge.id)?.route;
            if (!route) {
                return edge;
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

        logResizePipelineDebug('strict-sync-subset', {
            changedNodeIds,
            changedCount: changedNodeIds.length,
        });

        setBoardMode('strict-grid');
        setNodes(finalizedNodes);
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
        setEdges((currentEdges) => currentEdges.map((edge) => {
            if (!changedNodeIdSet.has(edge.source) && !changedNodeIdSet.has(edge.target)) {
                return edge;
            }

            const sourceNode = nodeMap.get(edge.source);
            const targetNode = nodeMap.get(edge.target);
            if (!sourceNode || !targetNode) {
                return edge;
            }

            const route = buildStrictGridRoute(
                sourceNode,
                targetNode,
                edge.sourceHandle,
                edge.targetHandle
            );

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
                    sourcePortSide: route.sourceSide,
                    targetPortSide: route.targetSide,
                    snapEnabled: snapConnectionLabels,
                }
            };
        }));
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
        setNodes(handledNodes);
        setEdges(finalEdges);
    }, [boardMode, syncStrictGridEdgesToNodes]);

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

            const nextFrame = calculateNodeFrame(
                node.data.summary || '',
                node.data.fullText || '',
                expanded,
                nodeHasImages(node.data.images)
            );

            return {
                ...node,
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

    const handleUpdateNode = useCallback((id: string, data: any) => {
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
            edge.data?.snapEnabled !== snapConnectionLabels
        );

        if (!needsActions) return;

        setEdges((currentEdges) => currentEdges.map((edge) => ({
            ...edge,
            data: {
                ...edge.data,
                onRename: renameRelationshipEdge,
                onDelete: deleteRelationshipEdge,
                snapEnabled: snapConnectionLabels,
            }
        })));
    }, [deleteRelationshipEdge, edges, renameRelationshipEdge, snapConnectionLabels]);

    const lastFocusedRef = useRef<string | null>(null);

    // Handle node focusing from props (e.g. from Timeline)
    useEffect(() => {
        if (focusNodeId && focusNodeId !== lastFocusedRef.current) {
            const nodeExists = nodesRef.current.some(n => n.id === focusNodeId);

            if (nodeExists) {
                console.debug('[Board] Focusing node:', focusNodeId);
                lastFocusedRef.current = focusNodeId;

                // Close any open side panels (intel reports) to show the node clearly
                setSelectedContent(null);

                // Center and zoom in slightly on the node
                fitView({ nodes: [{ id: focusNodeId }], duration: 800, padding: 0.32, minZoom: 1, maxZoom: 1.12 });

                // Visually select it
                setNodes(nds => nds.map(n => ({
                    ...n,
                    selected: n.id === focusNodeId
                })));
            }
        } else if (!focusNodeId) {
            lastFocusedRef.current = null;
        }
    }, [focusNodeId, fitView]);

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
        const button = boardControlsButtonRef.current;
        if (!container || !button) {
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const availableWidth = Math.max(280, Math.min(BOARD_CONTROLS_PANEL_MAX_WIDTH, containerRect.width - (BOARD_CONTROLS_PANEL_MARGIN * 2)));
        const unclampedLeft = buttonRect.right - containerRect.left - availableWidth;
        const maxLeft = Math.max(BOARD_CONTROLS_PANEL_MARGIN, containerRect.width - availableWidth - BOARD_CONTROLS_PANEL_MARGIN);
        const nextLeft = Math.min(Math.max(unclampedLeft - 85, BOARD_CONTROLS_PANEL_MARGIN), maxLeft);
        const nextTop = buttonRect.bottom - containerRect.top + 12;

        setBoardControlsPosition({
            top: nextTop,
            left: nextLeft,
            width: availableWidth,
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
        fitView({
            ...BOARD_FIT_VIEW_OPTIONS,
            duration: 220,
        });
    }, [fitView]);

    const toggleDiscoveryWorkspacePanel = useCallback(() => {
        emitBoardWorkspaceEvent(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT);
    }, []);

    const toggleSynthesisWorkspacePanel = useCallback(() => {
        emitBoardWorkspaceEvent(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT);
    }, []);

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
        setAnalysisMode(null);
        setImageLightbox(null);
    }, [investigationId]);

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
        const edgeTags = edges
            .map((edge) => normalizeRelationshipTag(edge.label as string))
            .filter(Boolean);

        if (edgeTags.length > 0) {
            ensureTagStyles(edgeTags);
        }
    }, [edges, ensureTagStyles]);

    // Effect to update edge styles dynamically when tagStyles change
    useEffect(() => {
        setEdges(eds => eds.map(e => {
            const tag = normalizeRelationshipTag(typeof e.label === 'string' ? e.label : e.data?.tag);
            const styleDef = tagStyles[tag];
            if (!styleDef) return e;
            const edgeVisuals = getRelationshipEdgeVisuals(styleDef.pattern, styleDef.shape);

            return {
                ...e,
                type: 'customEdge',
                style: {
                    ...e.style,
                    stroke: styleDef.color,
                    strokeDasharray: edgeVisuals.strokeDasharray,
                    strokeLinecap: edgeVisuals.strokeLinecap,
                    strokeWidth: edgeVisuals.strokeWidth ?? e.style?.strokeWidth,
                },
                animated: edgeVisuals.animated,
                data: { ...e.data, color: styleDef.color, pattern: styleDef.pattern, shape: styleDef.shape },
                labelStyle: { ...e.labelStyle, fill: styleDef.color },
                labelBgStyle: { ...e.labelBgStyle, stroke: styleDef.color },
            };
        }));
    }, [tagStyles]);

    // Persist per investigation
    useEffect(() => {
        if (!investigationId || loadedInvestigationId === investigationId) return;

        console.debug('[DetectiveBoard] Loading investigation:', investigationId);
        let cancelled = false;

        const applyBoardState = (savedState: PersistedBoardState | null) => {
            if (cancelled) {
                return;
            }
            if (savedState) {
                const savedMode = savedState.mode === 'strict-grid' ? 'strict-grid' : 'legacy';
                const savedNodes = savedState.nodes.filter((node: Node) => node.data?.nodeKind !== 'discovery');
                const savedEdges = savedState.edges.filter((edge: Edge) => edge.data?.generatedBy !== 'discovery');
                const savedNodeIdSet = new Set(savedNodes.map((node: Node) => node.id));
                const restoredPendingIntegrationNodeIds = (savedState.pendingIntegrationNodeIds || [])
                    .filter((nodeId) => savedNodeIdSet.has(nodeId));
                const restoredNodes = savedNodes.map((n: Node) => {
                    const autoFrame = calculateNodeFrame(
                        n.data?.summary || '',
                        n.data?.fullText || '',
                        Boolean(n.data?.expanded),
                        nodeHasImages(n.data?.images)
                    );
                    const persistedWidth = typeof n.style?.width === 'number' ? n.style.width : 288;
                    const persistedHeight = typeof n.style?.height === 'number' ? n.style.height : 192;
                    const normalizedFrame = normalizeNodeFrame(
                        Math.max(persistedWidth, autoFrame.width),
                        Math.max(persistedHeight, autoFrame.height)
                    );

                    return {
                        ...n,
                        style: {
                            ...n.style,
                            ...normalizedFrame,
                        },
                        data: {
                            ...n.data,
                            onReadFull: () => setSelectedContent(n.data.fullText),
                            onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                            onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                            onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                            onDelete: (id: string) => handleDeleteNode(id),
                            onUpdate: (id: string, data: any) => handleUpdateNode(id, data),
                            onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                            onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                            onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                            onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                            isDeepDiveSource: !!n.data?.isDeepDiveSource,
                            isRecentlyImported: false,
                            boardMode: savedMode,
                        }
                    };
                });
                const restoredEdges = savedEdges.map((e: Edge) => ({
                    ...e,
                    type: 'customEdge',
                    updatable: true,
                    interactionWidth: 20,
                    data: { ...e.data, snapEnabled: snapConnectionLabels, boardMode: savedMode }
                }));

                setBoardMode(savedMode);
                if (savedMode === 'strict-grid') {
                    syncStrictGridEdgesToNodes(restoredEdges, restoredNodes);
                } else {
                    const { edges: finalEdges, handledNodes } = distributeEdges(restoredEdges, restoredNodes);
                    setNodes(handledNodes);
                    setEdges(finalEdges);
                }
                setPendingIntegrationNodeIds(restoredPendingIntegrationNodeIds);
                setHasConnectedDots(savedEdges.some((e: Edge) => e.data?.generatedBy === 'connectTheDots'));
            } else {
                setBoardMode('strict-grid');
                setNodes([]);
                setEdges([]);
                setPendingIntegrationNodeIds([]);
                setHasConnectedDots(false);
            }
            setLoadedInvestigationId(investigationId);
        };

        const immediateState = getCachedBoardStateForInvestigation(investigationId);
        applyBoardState(immediateState);

        void loadBoardStateForInvestigation(investigationId).then((backendState) => {
            if (backendState && backendState !== immediateState) {
                applyBoardState(backendState);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [handleAttachImage, handleDeleteNode, handleNodeExpand, handleRemoveImage, handleUpdateNode, investigationId, onDeepDiveNode, onNavigateToChild, openImageLightbox, snapConnectionLabels, syncStrictGridEdgesToNodes]); // Only run when investigationId changes

    useEffect(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) return;
        if (nodes.length === 0 && edges.length === 0) return;
        if (isDraggingNodeRef.current) return;

        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current);
        }

        persistTimerRef.current = window.setTimeout(() => {
            const existingState = getCachedBoardStateForInvestigation(investigationId);
            void saveBoardStateForInvestigation(investigationId, {
                mode: boardMode,
                nodes: sanitizeNodesForPersistence(nodes),
                edges,
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
            edges: edgesRef.current,
            pendingIntegrationNodeIds: pendingIntegrationNodeIdsRef.current,
            synthesisAlerts: existingState?.synthesisAlerts || [],
        });
    }, [boardMode, investigationId, loadedInvestigationId]);

    useEffect(() => () => {
        recentImportTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
        recentImportTimeoutsRef.current.clear();
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
                    window.requestAnimationFrame(() => {
                        updateStrictGridDragRoutes(
                            dimensionChanges.map((change) => change.id),
                            nextNodesSnapshot.length > 0 ? nextNodesSnapshot : nodesRef.current
                        );
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
        const currentNodes = nodesRef.current;
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

        const newEdges: Edge[] = validConnections.map((c: any) => {
            const visuals = buildEdgeVisuals(c.tag, nextStyles);

            return {
                id: `e-${c.source}-${c.target}-${c.tag}`,
                source: c.source,
                target: c.target,
                type: 'customEdge',
                label: visuals.tag,
                zIndex: STRICT_GRID_EDGE_Z_INDEX,
                updatable: true,
                interactionWidth: 20,
                animated: visuals.animated,
                data: {
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

        if (boardMode === 'strict-grid') {
            const combinedEdges = activeAnalysisMode === 'incremental'
                ? mergeIncrementalEvidenceEdges(edgesRef.current, newEdges, activePendingNodeIds)
                : mergeEvidenceEdges(edgesRef.current, newEdges);

            window.requestAnimationFrame(() => {
                const layoutedNodes = getStrictGridLayoutedNodes(currentNodes, combinedEdges);
                syncStrictGridEdgesToNodes(combinedEdges, layoutedNodes);
                setTimeout(() => fitView({ duration: 800, ...BOARD_FIT_VIEW_OPTIONS }), 100);
            });

            if (activeAnalysisMode === 'incremental') {
                clearPendingIntegrationNodeIds();
            }
            setHasConnectedDots(true);
            setIsAnalyzing(false);
            setAnalysisMode(null);
            return;
        }

        setEdges((eds) => {
            const combinedEdges = activeAnalysisMode === 'incremental'
                ? mergeIncrementalEvidenceEdges(eds, newEdges, activePendingNodeIds)
                : mergeEvidenceEdges(eds, newEdges);

            setNodes((currentNodes) => {
                const { edges: finalEdges, handledNodes } = distributeEdges(combinedEdges, currentNodes);
                const { nodes: layoutedNodes } = getLayoutedElements(handledNodes, finalEdges);

                // Update edges synchronously (outside setNodes if possible, but for simplicity here we return nodes and set edges separately)
                setEdges(finalEdges);
                setTimeout(() => fitView({ duration: 800, ...BOARD_FIT_VIEW_OPTIONS }), 100);
                return layoutedNodes;
            });

            // We calculate distributed edges against current nodes. 
            // Because React state updates are queued, we resolve them both cleanly in the node queue.
            // For edges state, we need to return the final array independently avoiding stale node reads
            return combinedEdges; // Temporary fallback. The node queue recalculates the real edges.
        });
        if (activeAnalysisMode === 'incremental') {
            clearPendingIntegrationNodeIds();
        }
        setHasConnectedDots(true);
        setIsAnalyzing(false);
        setAnalysisMode(null);
    }, [boardMode, buildEdgeVisuals, clearPendingIntegrationNodeIds, fitView, investigationId, persistTagStyles, snapConnectionLabels, syncStrictGridEdgesToNodes, tagStyles]);

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

                const newNode: Node = {
                    id: node.id,
                    type: 'custom',
                    zIndex: targetBoardMode === 'strict-grid' ? STRICT_GRID_NODE_Z_INDEX : undefined,
                    style: frame,
                    data: {
                        ...node,
                        onReadFull: () => setSelectedContent(node.fullText),
                        onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                        onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                        onExpand: (id: string, expanded: boolean) => handleNodeExpand(id, expanded),
                        onDelete: (id: string) => handleDeleteNode(id),
                        onUpdate: (id: string, data: any) => handleUpdateNode(id, data),
                        onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                        onSetEditing: (id: string | null) => handleSetEditing(id),
                        onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                        onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                        onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
                        isDeepDiveSource: false,
                        isRecentlyImported: isImported,
                        expanded: false,
                        boardMode: targetBoardMode,
                    },
                    position: getViewportCenteredNodePosition(frame, targetBoardMode),
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left
                };

                // Check if this node is meant for a different investigation (Pull Node flow)
                if (vaultId && vaultId !== investigationId) {
                    console.debug(`[Board] Routing node ${node.id} to target vault: ${vaultId}`);
                    const savedState = getCachedBoardStateForInvestigation(vaultId);
                    let vaultData: PersistedBoardState = savedState || { mode: targetBoardMode, nodes: [], edges: [], pendingIntegrationNodeIds: [] };

                    const nodeExists = (vaultData.nodes || []).some((n: any) => n.id === node.id);
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
                if (isImported) {
                    markNodeAsRecentlyImported(node.id);
                }
                if (append && vaultId === investigationId) {
                    addPendingIntegrationNodeId(node.id);
                }
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
                    setNodes((nds) => {
                        console.debug('[PERSONA_INSIGHTS] Current nodes:', nds.map(n => ({ id: n.id, title: n.data.title })));
                        return nds.map(node => {
                            // Find personas that contributed to this specific node
                            const nodeInsights = insights.filter(insight =>
                                insight.nodeIDs && insight.nodeIDs.includes(node.id)
                            );
                            console.debug(`[PERSONA_INSIGHTS] Node ${node.id}: matched ${nodeInsights.length} insights, all nodeIDs:`, insights.map(i => i.nodeIDs));
                            return {
                                ...node,
                                data: {
                                    ...node.data,
                                    personaInsights: nodeInsights // Full insight objects
                                }
                            };
                        });
                    });
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
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                const explicitVaultId = typeof msg.payload?.vaultId === 'string'
                    ? msg.payload.vaultId.trim()
                    : '';
                const vaultId = explicitVaultId || investigationId;
                const isAppendResult = Boolean(msg.payload?.append);

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

                if (typeof msg.payload?.runId === 'string' && msg.payload.runId.trim()) {
                    latestPipelineRunIdRef.current = msg.payload.runId;
                }

                if (isAppendResult) {
                    return;
                }
                // Trigger auto connect dots for full new-investigation crawls
                setTimeout(() => {
                    const btn = document.getElementById('connect-dots-btn');
                    if (btn) btn.click();
                }, 500);
            } else if (msg.type === 'ERROR') {
                console.error('[Board] System Error:', msg.payload);
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
    }, [boardMode, sharedSocket, getViewportCenteredNodePosition, handleAttachImage, handleNewConnections, handleDeleteNode, handleNodeExpand, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, markNodeAsRecentlyImported, onDeepDiveNode, onNavigateToChild, isGathering, investigationId, openImageLightbox]);

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
                onReadFull: () => setSelectedContent(''),
                onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                onNavigateToChild: (id: string, parentId?: string) => onNavigateToChild(id, parentId),
                onExpand: (nodeId: string, expanded: boolean) => handleNodeExpand(nodeId, expanded),
                onDelete: (id: string) => handleDeleteNode(id),
                onUpdate: (id: string, d: any) => handleUpdateNode(id, d),
                onSave: (nodeId: string, title: string, text: string, mode: NodeSaveMode) => handleSaveNode(nodeId, title, text, mode),
                onViewImages: (images: NodeImageAsset[], initialIndex: number, nodeTitle?: string, nodeId?: string) => openImageLightbox(images, initialIndex, nodeTitle, nodeId),
                onAttachImage: (nodeId: string, file: File) => handleAttachImage(nodeId, file),
                onRemoveImage: (nodeId: string, imageId: string) => handleRemoveImage(nodeId, imageId),
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
    }, [getViewportCenteredNodePosition, handleAttachImage, handleDeleteNode, handleNodeExpand, handleRemoveImage, handleSaveNode, handleSetEditing, handleUpdateNode, onDeepDiveNode, onNavigateToChild, openImageLightbox, setNodes, setEditingNodeId]);

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



    const connectTheDots = () => {
        const evidenceNodes = nodes.filter((node) => node.data?.nodeKind !== 'discovery');
        const incrementalNodeIds = pendingIntegrationNodeIds.filter((nodeId) => evidenceNodes.some((node) => node.id === nodeId));

        if (evidenceNodes.length < 2) {
            alert("Need at least 2 nodes!");
            return;
        }
        if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
            alert("Connection lost. Please wait for reconnect.");
            return;
        }

        console.debug('[Board] Dispatching CONNECT_DOTS...');
        setIsAnalyzing(true);
        setAnalysisMode(incrementalNodeIds.length > 0 ? 'incremental' : 'full');
        setEdgeReasoning(null);
        setNodes((nds) => nds.filter(node => node.data?.nodeKind !== 'discovery'));
        setEdges((eds) => eds.filter((edge) => {
            if (edge.data?.generatedBy === 'discovery') {
                return false;
            }

            if (incrementalNodeIds.length === 0 && edge.data?.generatedBy === 'connectTheDots') {
                return false;
            }

            return true;
        }));
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
            return;
        }

        sharedSocket.send(JSON.stringify({
            type: 'CONNECT_DOTS',
            payload: nodeData,
            vaultId: investigationId,
            runId: latestPipelineRunIdRef.current || undefined,
        }));
    };

    const clearBoard = () => {
        if (window.confirm("Clear board?")) {
            setBoardMode('strict-grid');
            setPendingIntegrationNodeIds([]);
            setAnalysisMode(null);
            setNodes([]);
            setEdges([]);
            setEdgeReasoning(null);
            setSelectedContent(null);
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
                        fitView({ duration: 800, ...BOARD_FIT_VIEW_OPTIONS });
                        setTimeout(() => {
                            setIsReorganizing(false);
                            console.debug('[TidyUp] Reorganization cycle complete.');
                        }, 850);
                    }, 850);
                    return;
                }

                // Reset handles and distribution
                console.debug('[TidyUp] Distributing edges...');
                const { edges: finalEdges, handledNodes } = distributeEdges(edges, nodes);

                // Compute new layout positions
                console.debug('[TidyUp] Running Dagre layout...');
                const { nodes: layoutedNodes } = getLayoutedElements(handledNodes, finalEdges);

                console.debug('[TidyUp] Setting state with layouted nodes...');

                // Set both at once. The CSS transition in index.css will handle the motion.
                setNodes(layoutedNodes);
                setEdges(finalEdges);

                // Wait for the SLIDE transition to complete (0.8s) before fitting view
                setTimeout(() => {
                    console.debug('[TidyUp] Triggering fitView...');
                    fitView({ duration: 800, ...BOARD_FIT_VIEW_OPTIONS });

                    // Final finish after animation
                    setTimeout(() => {
                        setIsReorganizing(false);
                        console.debug('[TidyUp] Reorganization cycle complete.');
                    }, 850);
                }, 850); // Matches the CSS transition duration
            } catch (err) {
                console.error('[TidyUp] Error during reorganization:', err);
                setIsReorganizing(false);
            }
        }, 100);
    }, [boardMode, edges, fitView, nodes, syncStrictGridEdgesToNodes]);

    const onEdgeClick = (_: React.MouseEvent, edge: Edge) => {
        if (edge.data?.reasoning) {
            setEdgeReasoning({
                tag: edge.label as string,
                text: edge.data.reasoning,
                color: edge.data.color || '#bc13fe',
                personas: edge.data.supportingPersonas || [],
                qualityScore: edge.data.qualityScore,
                evidenceNodeIDs: edge.data.evidenceNodeIDs || [],
            });
        }
    };

    const activeTags = new Set(edges.map(e => (e.label as string)?.toUpperCase() || 'UNKNOWN'));
    const visibleStyles = Object.entries(tagStyles).filter(([tag]) => activeTags.has(tag));

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
                .find((i: any) => i.id === investigationId);

            const saved = investigationId ? getCachedBoardStateForInvestigation(investigationId) : null;
            let nodesData: Array<{ title: string; summary: string; sourceURL: string }> = [];
            if (saved) {
                const { nodes: savedNodes } = saved;
                nodesData = savedNodes.map((n: any) => ({
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


    return (
        <div ref={boardContainerRef} className="forensic-board-root relative h-full w-full overflow-hidden" id="detective-board-container">
            <div
                className="absolute top-4 z-20 flex flex-col items-stretch gap-3 px-0"
                style={toolbarPosition}
            >
                <div className="flex w-full justify-center">
                    {(isGathering || isReorganizing) && (
                        <div className="forensic-busy-pill flex items-center gap-2 rounded-full px-5 py-2 text-[11px] font-black uppercase tracking-[0.24em] backdrop-blur-md animate-pulse">
                            {isReorganizing ? 'Reorganizing Neural Pathways...' : (deepDiveTopic ? `Deep Diving: ${deepDiveTopic}` : 'Gathering Intel...')} {isReorganizing ? '' : `${nodes.length}/8`}
                        </div>
                    )}
                </div>

                <div className="flex w-full justify-center">
                    <div data-testid="board-action-bar" className="forensic-action-bar forensic-toolbar-shell flex w-full max-w-full items-center gap-3 overflow-x-auto rounded-[1.45rem] p-2.5 backdrop-blur-xl">
                        <div className="forensic-toolbar-cluster flex min-w-0 flex-1 items-center gap-2 md:flex-none">
                            <div className="forensic-search-shell flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 md:min-w-[19rem] md:max-w-[27rem] md:flex-none">
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

                        <div className="forensic-toolbar-cluster flex items-center gap-2">
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
                                className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-[11px] font-black tracking-[0.18em] transition-all ${canConnectDots
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
                                className="flex min-h-11 items-center gap-2 rounded-xl border border-fuchsia-300/32 bg-fuchsia-300/12 px-4 py-2 text-[11px] font-black tracking-[0.18em] text-fuchsia-100 transition-all hover:border-fuchsia-200/48 hover:bg-fuchsia-300/20 hover:text-white"
                            >
                                <ArrowLeft size={15} />
                                Return To Parent
                            </button>
                        )}

                        <div className="forensic-toolbar-cluster flex items-center gap-2">
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
                        className="forensic-board-dialog absolute z-30 rounded-[1.5rem] p-4 backdrop-blur-xl"
                        style={{
                            top: `${boardControlsPosition.top}px`,
                            left: `${boardControlsPosition.left}px`,
                            width: `${boardControlsPosition.width}px`,
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

                        <div className="custom-scrollbar max-h-[min(34rem,65vh)] overflow-y-auto pr-1">
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
                className="relative w-full h-full"
                id="detective-board-flow"
                onPointerDown={onPanePointerDown}
                onPointerMove={onPanePointerMove}
                onPointerUp={onPanePointerUp}
            >
                <ReactFlow
                    nodes={nodes}
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
                    snapToGrid={boardMode === 'strict-grid' || snapNodes}
                    snapGrid={[BOARD_GRID_SIZE, BOARD_GRID_SIZE]}
                    fitView
                    fitViewOptions={BOARD_FIT_VIEW_OPTIONS}
                    defaultViewport={BOARD_DEFAULT_VIEWPORT}
                    minZoom={0.68}
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
                    <MiniMap
                        position="top-left"
                        onClick={handleMiniMapClick}
                        pannable
                        zoomable={false}
                        maskStrokeColor={MINIMAP_MASK_STROKE}
                        maskStrokeWidth={MINIMAP_MASK_STROKE_WIDTH}
                        nodeColor={getMiniMapNodeColor}
                        nodeStrokeColor={MINIMAP_NODE_STROKE}
                        nodeStrokeWidth={2}
                        nodeBorderRadius={6}
                        maskColor={MINIMAP_MASK_FILL}
                        offsetScale={MINIMAP_OFFSET_SCALE}
                        data-testid="reactflow-minimap"
                        style={{
                            width: minimapLayout.map.width,
                            height: minimapLayout.map.height,
                            top: minimapMapPosition.top,
                            left: minimapMapPosition.left,
                            margin: 0,
                            zIndex: 25,
                            background: 'rgba(4, 8, 12, 0.96)',
                            border: '1px solid rgba(0, 243, 255, 0.18)',
                            borderRadius: 14,
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02), 0 0 16px rgba(0,243,255,0.08), 0 0 0 1px rgba(120,255,255,0.08)',
                        }}
                    />
                </ReactFlow>
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
                                {nodes.length} nodes
                            </div>
                        </div>
                        <div
                            className="forensic-minimap-map-slot rounded-xl"
                            style={{ height: minimapLayout.map.height }}
                        />
                        <div className="forensic-minimap-footer flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={recenterBoardViewport}
                                aria-label="Center board from minimap"
                                className="forensic-minimap-frame pointer-events-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] text-[var(--forensic-accent-muted)] transition-colors hover:border-[rgba(129,227,255,0.36)] hover:text-[var(--forensic-accent)]"
                            >
                                <Crosshair size={11} />
                                Center
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsMiniMapExpanded((current) => !current)}
                                aria-label={isMiniMapExpanded ? 'Shrink minimap' : 'Enlarge minimap'}
                                className="forensic-minimap-frame pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--forensic-accent-muted)] transition-colors hover:border-[rgba(129,227,255,0.36)] hover:text-[var(--forensic-accent)]"
                            >
                                {isMiniMapExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
                            </button>
                        </div>
                    </div>
                </div>
                <div
                    data-testid="board-utility-rail"
                    className="forensic-utility-rail absolute right-5 top-24 z-20 flex flex-col items-center gap-2"
                >
                    <button
                        type="button"
                        onClick={toggleSynthesisWorkspacePanel}
                        aria-label="Toggle synthesis panel"
                        title="Toggle synthesis panel"
                        className="forensic-utility-button"
                    >
                        <Network size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={toggleDiscoveryWorkspacePanel}
                        aria-label="Toggle discoveries panel"
                        title="Toggle discoveries panel"
                        className="forensic-utility-button"
                    >
                        <Lightbulb size={16} />
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
                    <button
                        type="button"
                        onClick={recenterBoardViewport}
                        aria-label="Recenter board viewport"
                        title="Recenter board viewport"
                        className="forensic-utility-button"
                    >
                        <Target size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={toggleBoardControlsPanel}
                        aria-label="Open advanced controls"
                        title="Open advanced controls"
                        className={`forensic-utility-button ${showBoardControls ? 'forensic-utility-button-active' : ''}`}
                    >
                        <PanelRightOpen size={16} />
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

            {edgeReasoning && (
                <div className="forensic-board-dialog absolute bottom-10 left-10 z-40 w-80 p-4 backdrop-blur-md" style={{ borderColor: edgeReasoning.color, boxShadow: `0 24px 44px rgba(0,0,0,0.45), 0 0 20px ${edgeReasoning.color}33` }}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[10px] font-black tracking-tighter uppercase" style={{ color: edgeReasoning.color }}><Info size={12} /> Connection logic: {edgeReasoning.tag}</div>
                        <button onClick={() => setEdgeReasoning(null)} className="text-gray-500 hover:text-white text-xs">×</button>
                    </div>
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
                        {visibleStyles.length === 0 && (
                            <div className="text-[10px] italic text-[var(--forensic-text-faint)]">No connections yet. Dynamic tags will appear here.</div>
                        )}
                        {visibleStyles.map(([tag, style]) => (
                            <div
                                key={tag}
                                onClick={() => setEditingTag(editingTag === tag ? null : tag)}
                                className={`group -ml-1 flex cursor-pointer items-center gap-2 rounded p-1 transition-colors ${editingTag === tag ? 'border border-[rgba(129,227,255,0.5)] bg-[rgba(129,227,255,0.16)]' : 'border border-transparent hover:bg-white/5'}`}
                            >
                                <div className="w-3 h-3 rounded-full border border-black shadow-sm shrink-0" style={{ backgroundColor: style.color }}></div>
                                <span className="truncate text-[10px] font-bold tracking-wider text-[var(--forensic-text-muted)]" title={tag}>{tag}</span>
                                <Edit2 size={10} className="ml-auto text-[var(--forensic-text-faint)] opacity-0 group-hover:opacity-100" />
                            </div>
                        ))}
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

            {selectedContent && (
                <div className="forensic-overlay-panel absolute right-0 top-0 z-30 h-full w-1/3 overflow-y-auto border-l p-8 backdrop-blur-md">
                    <button onClick={() => setSelectedContent(null)} className="mb-6 border border-[rgba(129,227,255,0.28)] px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--forensic-accent-muted)] transition-colors hover:bg-[rgba(129,227,255,0.14)] hover:text-white">[ CLOSE TERMINAL ]</button>
                    <h2 className="mb-6 text-xl font-black text-[var(--forensic-accent)] underline decoration-[rgba(170,212,255,0.55)] underline-offset-8">INTEL_REPORT_FULL</h2>
                    <div className="whitespace-pre-wrap font-mono text-sm leading-loose text-gray-300">{selectedContent}</div>
                </div>
            )}
        </div>
    );
};

const DetectiveBoard: React.FC<DetectiveBoardProps> = (props) => (
    <ReactFlowProvider><DetectiveBoardContent {...props} /></ReactFlowProvider>
);

export default DetectiveBoard;
