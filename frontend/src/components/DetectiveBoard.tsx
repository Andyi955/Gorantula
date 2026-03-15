import React, { useCallback, useEffect, useState, useRef } from 'react';
import ReactFlow, {
    Background,
    Controls,
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
    OnConnect
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';

import { Zap, Info, Trash2, Edit2, Download, ChevronDown, FileText, Image as ImageIcon, Box, PlusSquare } from 'lucide-react';
import dagre from 'dagre';
import { exportAsPng, exportAsSvg, exportAsPdf } from '../utils/ExportUtils';

export interface TagStyle {
    color: string;
    pattern: 'solid' | 'dashed' | 'dotted';
}

// Calculate dynamic node dimensions based on content
const getNodeDimensions = (node: Node): { width: number; height: number } => {
    // Use style dimensions if available, otherwise use defaults
    const style = node.style || {};
    const width = (style.width as number) || 320;
    const height = (style.height as number) || 180;
    return { width, height };
};

// Enhanced layout function with smart rectangle formation
const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    console.log('[Layout] Executing Dagre with', nodes.length, 'nodes and', edges.length, 'edges');
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    // Detect dense graphs for vertical layout
    const edgeToNodeRatio = nodes.length > 0 ? edges.length / nodes.length : 0;
    const isDenseGraph = edgeToNodeRatio > 1.5;
    const rankdir = nodes.length <= 6 || isDenseGraph ? 'TB' : 'LR';

    dagreGraph.setGraph({
        rankdir,
        nodesep: 100,
        ranksep: 200,
        marginx: 50,
        marginy: 50
    });

    nodes.forEach((node) => {
        const dim = getNodeDimensions(node);
        dagreGraph.setNode(node.id, { width: dim.width, height: dim.height });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const dim = getNodeDimensions(node);

        const newPos = {
            x: nodeWithPosition.x - dim.width / 2,
            y: nodeWithPosition.y - dim.height / 2,
        };

        console.log(`[Layout] Node ${node.id}: (${Math.round(node.position.x)}, ${Math.round(node.position.y)}) -> (${Math.round(newPos.x)}, ${Math.round(newPos.y)})`);

        return {
            ...node,
            position: newPos,
            targetPosition: rankdir === 'LR' ? Position.Left : Position.Top,
            sourcePosition: rankdir === 'LR' ? Position.Right : Position.Bottom,
            style: {
                ...node.style,
                width: dim.width,
                height: dim.height
            }
        };
    });

    return {
        nodes: layoutedNodes.map(n => ({ ...n, position: { ...n.position } })),
        edges: [...edges]
    };
};

interface DetectiveBoardProps {
    investigationId: string | null;
    returnVaultId?: string | null;
    sharedSocket: WebSocket | null;
    onDeepDiveNode: (prompt: string, titleStr: string, sourceNodeId: string) => void;
    onNavigateToChild: (id: string) => void;
    focusNodeId?: string | null;
}

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

const DetectiveBoardContent: React.FC<DetectiveBoardProps> = ({ investigationId, returnVaultId, sharedSocket, onDeepDiveNode, onNavigateToChild, focusNodeId }) => {
    const { fitView } = useReactFlow();
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);

    const nodeTypes = React.useMemo(() => ({
        custom: (props: any) => (
            <CustomNode
                {...props}
                returnVaultId={returnVaultId}
                currentInvestigationId={investigationId}
                sharedSocket={sharedSocket}
                onDeleteNode={handleDeleteNode}
                onUpdateNode={handleUpdateNode}
                isEditing={editingNodeId === props.id}
                onSetEditing={(id: string | null) => setEditingNodeId(id)}
            />
        )
    }), [returnVaultId, investigationId, sharedSocket]);
    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [edgeReasoning, setEdgeReasoning] = useState<{ tag: string, text: string, color: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGathering, setIsGathering] = useState(false);
    const [isReorganizing, setIsReorganizing] = useState(false);
    const [deepDiveTopic, setDeepDiveTopic] = useState<string | null>(null);
    const [loadedInvestigationId, setLoadedInvestigationId] = useState<string | null>(null);
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const exportMenuRef = useRef<HTMLDivElement>(null);

    // Track node transitions for debugging
    useEffect(() => {
        if (nodes.length > 0) {
            console.log('[Board] Nodes state sync. First node:', nodes[0].id, 'pos:', nodes[0].position);
        }
    }, [nodes]);

    const lastFocusedRef = useRef<string | null>(null);

    // Handle node focusing from props (e.g. from Timeline)
    useEffect(() => {
        if (focusNodeId && focusNodeId !== lastFocusedRef.current && nodes.length > 0) {
            const nodeExists = nodes.some(n => n.id === focusNodeId);

            if (nodeExists) {
                console.log('[Board] Focusing node:', focusNodeId);
                lastFocusedRef.current = focusNodeId;

                // Close any open side panels (intel reports) to show the node clearly
                setSelectedContent(null);

                // Center and zoom in slightly on the node
                fitView({ nodes: [{ id: focusNodeId }], duration: 800, padding: 0.5 });

                // Visually select it
                setNodes(nds => nds.map(n => ({
                    ...n,
                    selected: n.id === focusNodeId
                })));
            }
        } else if (!focusNodeId) {
            lastFocusedRef.current = null;
        }
    }, [focusNodeId, nodes, fitView]);

    // NODE_TYPES and EDGE_TYPES are now defined outside the component

    // Dynamic tag styles
    const [tagStyles, setTagStyles] = useState<Record<string, TagStyle>>({});
    const [editingTag, setEditingTag] = useState<string | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as unknown as globalThis.Node)) {
                setShowExportMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Load tag styles on mount
    useEffect(() => {
        const saved = localStorage.getItem('board_tag_styles');
        if (saved) {
            try {
                setTagStyles(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse tag styles", e);
            }
        }
    }, []);

    // Effect to update edge styles dynamically when tagStyles change
    useEffect(() => {
        setEdges(eds => eds.map(e => {
            const tag = (e.label as string)?.toUpperCase() || 'UNKNOWN';
            const styleDef = tagStyles[tag];
            if (!styleDef) return e;

            let strokeDasharray = undefined;
            let animated = false;
            if (styleDef.pattern === 'dashed') {
                strokeDasharray = '6,4';
                animated = true;
            } else if (styleDef.pattern === 'dotted') {
                strokeDasharray = '2,4';
                animated = true;
            }

            return {
                ...e,
                type: 'customEdge',
                style: { ...e.style, stroke: styleDef.color, strokeDasharray },
                animated,
                data: { ...e.data, color: styleDef.color },
                labelStyle: { ...e.labelStyle, fill: styleDef.color },
                labelBgStyle: { ...e.labelBgStyle, stroke: styleDef.color },
            };
        }));
    }, [tagStyles]);

    // Persist per investigation
    useEffect(() => {
        if (!investigationId || loadedInvestigationId === investigationId) return;

        console.log('[DetectiveBoard] Loading investigation:', investigationId);
        const saved = localStorage.getItem(`inv_data_${investigationId}`);
        if (saved) {
            const { nodes: savedNodes, edges: savedEdges } = JSON.parse(saved);
            const restoredNodes = savedNodes.map((n: Node) => ({
                ...n,
                style: { width: 288, height: 160, ...n.style },
                data: {
                    ...n.data,
                    onReadFull: () => setSelectedContent(n.data.fullText),
                    onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                    onNavigateToChild: (id: string) => onNavigateToChild(id),
                    onDelete: (id: string) => handleDeleteNode(id),
                    onUpdate: (id: string, data: any) => handleUpdateNode(id, data),
                    isDeepDiveSource: !!n.data?.isDeepDiveSource
                }
            }));
            const { edges: finalEdges, handledNodes } = distributeEdges(
                savedEdges.map((e: Edge) => ({ ...e, type: 'customEdge', updatable: true, interactionWidth: 20 })),
                restoredNodes
            );
            setNodes(handledNodes);
            setEdges(finalEdges);
        } else {
            setNodes([]);
            setEdges([]);
        }
        setLoadedInvestigationId(investigationId);
    }, [investigationId]); // Only run when investigationId changes

    useEffect(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) return;
        if (nodes.length === 0 && edges.length === 0) return;
        localStorage.setItem(`inv_data_${investigationId}`, JSON.stringify({ nodes, edges }));
    }, [nodes, edges, investigationId, loadedInvestigationId]);

    const onNodesChange: OnNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
        []
    );
    const onEdgesChange: OnEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        []
    );
    const onConnect: OnConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge({ ...params, sourceHandle: params.sourceHandle || 'port-right-0', targetHandle: params.targetHandle || 'port-left-0' }, eds)),
        []
    );
    const onReconnect = useCallback(
        (oldEdge: Edge, newConnection: Connection) => setEdges((els) => reconnectEdge(oldEdge, newConnection, els)),
        []
    );

    const handleNewConnections = useCallback((connections: any[]) => {
        console.log('[Board] Received connections:', connections);
        console.log('[Board] Current nodes:', nodes.map(n => ({ id: n.id, title: n.data.title })));

        // Filter connections to only include those where source and target exist
        const nodeIds = new Set(nodes.map(n => n.id));
        const validConnections = connections.filter(c => {
            const sourceExists = nodeIds.has(c.source);
            const targetExists = nodeIds.has(c.target);
            if (!sourceExists || !targetExists) {
                console.log('[Board] Skipping invalid connection:', c.source, '->', c.target, '| Valid:', sourceExists, targetExists);
            }
            return sourceExists && targetExists;
        });

        console.log('[Board] Valid connections:', validConnections.length, 'of', connections.length);

        const nextStyles = { ...tagStyles };
        let stylesUpdated = false;

        validConnections.forEach(c => {
            const tag = c.tag?.toUpperCase() || 'UNKNOWN';
            if (!nextStyles[tag]) {
                let hash = 0;
                for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);

                const r = (Math.abs(hash) % 156) + 100;
                const g = (Math.abs(hash * 3) % 156) + 100;
                const b = (Math.abs(hash * 7) % 156) + 100;
                const hexColor = `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;

                const patterns: ('solid' | 'dashed' | 'dotted')[] = ['solid', 'dashed', 'dotted'];
                nextStyles[tag] = {
                    color: hexColor,
                    pattern: patterns[Math.abs(hash) % 3] as any
                };
                stylesUpdated = true;
            }
        });

        if (stylesUpdated) {
            setTagStyles(nextStyles);
            localStorage.setItem('board_tag_styles', JSON.stringify(nextStyles));
        }

        const newEdges: Edge[] = validConnections.map((c: any) => {
            const tag = c.tag?.toUpperCase() || 'UNKNOWN';
            const styleDef = nextStyles[tag] || { color: '#bc13fe', pattern: 'solid' };
            const edgeColor = styleDef.color;
            let strokeDasharray = undefined;
            let animated = false;

            if (styleDef.pattern === 'dashed') {
                strokeDasharray = '6,4';
                animated = true;
            } else if (styleDef.pattern === 'dotted') {
                strokeDasharray = '2,4';
                animated = true;
            }

            return {
                id: `e-${c.source}-${c.target}-${c.tag}`,
                source: c.source,
                target: c.target,
                type: 'customEdge',
                label: tag,
                zIndex: 10,
                updatable: true,
                interactionWidth: 20,
                animated,
                data: { reasoning: c.reasoning, color: edgeColor },
                style: { stroke: edgeColor, strokeWidth: 2, strokeDasharray },
                labelStyle: { fill: edgeColor, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: edgeColor, strokeWidth: 1 },
                labelBgPadding: [8, 4],
                labelBgBorderRadius: 2,
            };
        });

        setEdges((eds) => {
            const existingIds = new Set(eds.map(e => e.id));
            const filteredNew = newEdges.filter(e => !existingIds.has(e.id));
            const combinedEdges = [...eds, ...filteredNew];

            setNodes((currentNodes) => {
                const { edges: finalEdges, handledNodes } = distributeEdges(combinedEdges, currentNodes);
                const { nodes: layoutedNodes } = getLayoutedElements(handledNodes, finalEdges);

                // Update edges synchronously (outside setNodes if possible, but for simplicity here we return nodes and set edges separately)
                setEdges(finalEdges);
                setTimeout(() => fitView({ duration: 800 }), 100);
                return layoutedNodes;
            });

            // We calculate distributed edges against current nodes. 
            // Because React state updates are queued, we resolve them both cleanly in the node queue.
            // For edges state, we need to return the final array independently avoiding stale node reads
            return combinedEdges; // Temporary fallback. The node queue recalculates the real edges.
        });
        setIsAnalyzing(false);
    }, [nodes, fitView]);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            console.log('[Board] Received:', msg.type);

            if (msg.type === 'MEMORY_NODE_GATHERED') {
                const { node, vaultId } = msg.payload;

                // Calculate dimensions based on content length
                const summary = node.summary || '';
                const fullText = node.fullText || '';
                const charCount = Math.max(summary.length, fullText.length);

                let width = 320;
                let height = 180;

                // Width grows for longer content
                if (charCount > 300) {
                    width = Math.min(500, 320 + Math.min(charCount - 300, 180));
                }
                // Height grows with content
                const estimatedLines = Math.ceil(charCount / 40);
                height = Math.max(180, 100 + Math.min(estimatedLines, 12) * 18);

                const newNode: Node = {
                    id: node.id,
                    type: 'custom',
                    style: { width, height },
                    data: {
                        ...node,
                        onReadFull: () => setSelectedContent(node.fullText),
                        onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                        onNavigateToChild: (id: string) => onNavigateToChild(id),
                        onDelete: (id: string) => handleDeleteNode(id),
                        onUpdate: (id: string, data: any) => handleUpdateNode(id, data),
                        isDeepDiveSource: false,
                        expanded: false,
                    },
                    position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left
                };

                // Check if this node is meant for a different investigation (Pull Node flow)
                if (vaultId && vaultId !== investigationId) {
                    console.log(`[Board] Routing node ${node.id} to target vault: ${vaultId}`);
                    const saved = localStorage.getItem(`inv_data_${vaultId}`);
                    let vaultData: { nodes: any[], edges: any[] } = { nodes: [], edges: [] };
                    
                    if (saved) {
                        try {
                            vaultData = JSON.parse(saved);
                        } catch (e) {
                            console.error(`[Board] Failed to parse data for vault ${vaultId}`, e);
                        }
                    }

                    const nodeExists = (vaultData.nodes || []).some((n: any) => n.id === node.id);
                    if (!nodeExists) {
                        vaultData.nodes = [...(vaultData.nodes || []), newNode];
                        localStorage.setItem(`inv_data_${vaultId}`, JSON.stringify(vaultData));
                        console.log(`[Board] Node ${node.id} successfully persisted to target vault ${vaultId}`);
                    }
                    return; // Don't add to the currently visible board (which is likely the source/historical vault)
                }

                setNodes((nds) => {
                    if (nds.find(n => n.id === node.id)) return nds;
                    return [...nds, newNode];
                });
            } else if (msg.type === 'PERSONA_INSIGHTS') {
                // Handle full persona insights with chat data
                const insights = msg.payload as Array<{
                    personaName: string;
                    perspective: string;
                    keyFindings: string[];
                    connections: string[];
                    questions: string[];
                    confidence: number;
                    fullAnalysis: string;
                    nodeIDs: string[];
                }>;
                console.log('[PERSONA_INSIGHTS] Received insights:', insights);
                if (insights && Array.isArray(insights)) {
                    setNodes((nds) => {
                        console.log('[PERSONA_INSIGHTS] Current nodes:', nds.map(n => ({ id: n.id, title: n.data.title })));
                        return nds.map(node => {
                            // Find personas that contributed to this specific node
                            const nodeInsights = insights.filter(insight =>
                                insight.nodeIDs && insight.nodeIDs.includes(node.id)
                            );
                            console.log(`[PERSONA_INSIGHTS] Node ${node.id}: matched ${nodeInsights.length} insights, all nodeIDs:`, insights.map(i => i.nodeIDs));
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
                setIsGathering(false);
                setDeepDiveTopic(null);
                // Save synthesis result for reporting
                localStorage.setItem(`vault_result_${investigationId}`, JSON.stringify(msg.payload));
                // Trigger auto connect dots
                setTimeout(() => {
                    const btn = document.getElementById('connect-dots-btn');
                    if (btn) btn.click();
                }, 500);
            } else if (msg.type === 'ERROR') {
                console.error('[Board] System Error:', msg.payload);
                setIsAnalyzing(false);
                setIsGathering(false);
                setDeepDiveTopic(null);
                alert(`System Error: ${msg.payload}`);
            } else if (msg.type === 'MANUAL_NODE_PROCESSED') {
                const { nodeId, text } = msg.payload;
                setNodes(nds => nds.map(n => {
                    if (n.id === nodeId) {
                        return {
                            ...n,
                            data: {
                                ...n.data,
                                summary: text,
                                fullText: text,
                                title: n.data.title === 'NEW_EVIDENCE' ? (text.slice(0, 30) + '...') : n.data.title
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
    }, [sharedSocket, handleNewConnections, onDeepDiveNode, onNavigateToChild, isGathering, investigationId]);

    const addManualNode = () => {
        const id = `manual-${Date.now()}`;
        const newNode: Node = {
            id,
            type: 'custom',
            position: { x: 100, y: 100 },
            data: {
                id,
                title: 'NEW_EVIDENCE',
                summary: '',
                fullText: '',
                onReadFull: () => setSelectedContent(''),
                onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                onNavigateToChild: (id: string) => onNavigateToChild(id),
                onDelete: (id: string) => handleDeleteNode(id),
                onUpdate: (id: string, d: any) => handleUpdateNode(id, d),
                isDeepDiveSource: false,
                expanded: true,
            },
        };

        setNodes(nds => [...nds, newNode]);
        setEditingNodeId(id);
    };

    const handleDeleteNode = (id: string) => {
        if (window.confirm("Delete this evidence?")) {
            setNodes(nds => nds.filter(n => n.id !== id));
            setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
        }
    };

    const handleUpdateNode = (id: string, data: any) => {
        setNodes(nds => nds.map(n => {
            if (n.id === id) {
                return { ...n, data: { ...n.data, ...data } };
            }
            return n;
        }));

        // If saving text, trigger LLM processing
        if (data.fullText && sharedSocket && sharedSocket.readyState === WebSocket.OPEN) {
            sharedSocket.send(JSON.stringify({
                type: 'PROCESS_MANUAL_NODE',
                payload: {
                    nodeId: id,
                    text: data.fullText
                }
            }));
        }
    };



    const connectTheDots = () => {
        if (nodes.length < 2) {
            alert("Need at least 2 nodes!");
            return;
        }
        if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
            alert("Connection lost. Please wait for reconnect.");
            return;
        }

        console.log('[Board] Dispatching CONNECT_DOTS...');
        setIsAnalyzing(true);
        const nodeData = nodes.map(n => ({
            id: n.id,
            title: n.data.title,
            summary: n.data.summary,
            fullText: n.data.fullText
        }));

        sharedSocket.send(JSON.stringify({ 
            type: 'CONNECT_DOTS', 
            payload: nodeData,
            vaultId: investigationId
        }));
    };

    const clearBoard = () => {
        if (window.confirm("Clear board?")) {
            setNodes([]);
            setEdges([]);
            setEdgeReasoning(null);
            setSelectedContent(null);
        }
    };

    const handleReorganize = useCallback(() => {
        console.log('[TidyUp] Clicked. Current nodes:', nodes.length, 'Current edges:', edges.length);
        if (nodes.length === 0) {
            console.log('[TidyUp] No nodes to organize.');
            return;
        }

        setIsReorganizing(true);

        // Run calculation after a short timeout to allow UI to show loading state
        setTimeout(() => {
            try {
                // Reset handles and distribution
                console.log('[TidyUp] Distributing edges...');
                const { edges: finalEdges, handledNodes } = distributeEdges(edges, nodes);

                // Compute new layout positions
                console.log('[TidyUp] Running Dagre layout...');
                const { nodes: layoutedNodes } = getLayoutedElements(handledNodes, finalEdges);

                console.log('[TidyUp] Setting state with layouted nodes...');

                // Set both at once. The CSS transition in index.css will handle the motion.
                setNodes(layoutedNodes);
                setEdges(finalEdges);

                // Wait for the SLIDE transition to complete (0.8s) before fitting view
                setTimeout(() => {
                    console.log('[TidyUp] Triggering fitView...');
                    fitView({ duration: 800, padding: 0.2 });

                    // Final finish after animation
                    setTimeout(() => {
                        setIsReorganizing(false);
                        console.log('[TidyUp] Reorganization cycle complete.');
                    }, 850);
                }, 850); // Matches the CSS transition duration
            } catch (err) {
                console.error('[TidyUp] Error during reorganization:', err);
                setIsReorganizing(false);
            }
        }, 100);
    }, [nodes, edges, fitView]);

    const onEdgeClick = (_: React.MouseEvent, edge: Edge) => {
        if (edge.data?.reasoning) {
            setEdgeReasoning({ tag: edge.label as string, text: edge.data.reasoning, color: edge.data.color || '#bc13fe' });
        }
    };

    const activeTags = new Set(edges.map(e => (e.label as string)?.toUpperCase() || 'UNKNOWN'));
    const visibleStyles = Object.entries(tagStyles).filter(([tag]) => activeTags.has(tag));

    const handleExport = async (type: 'png' | 'svg' | 'pdf') => {
        setShowExportMenu(false);
        const boardElementId = 'detective-board-flow';

        if (type === 'png') {
            await exportAsPng(boardElementId);
        } else if (type === 'svg') {
            await exportAsSvg(boardElementId);
        } else if (type === 'pdf') {
            const currentInv = JSON.parse(localStorage.getItem('gorantula_investigations') || '[]')
                .find((i: any) => i.id === investigationId);

            const saved = localStorage.getItem(`inv_data_${investigationId}`);
            let nodesData = [];
            if (saved) {
                const { nodes: savedNodes } = JSON.parse(saved);
                nodesData = savedNodes.map((n: any) => ({
                    title: n.data.title,
                    summary: n.data.summary,
                    sourceURL: n.data.sourceURL
                }));
            }

            const vaultSaved = localStorage.getItem(`vault_result_${investigationId}`);
            const finalSynthesis = vaultSaved ? JSON.parse(vaultSaved).result : "No synthesis available for this investigation.";

            await exportAsPdf({
                topic: currentInv?.topic || 'Unknown Investigation',
                finalSynthesis: finalSynthesis,
                nodes: nodesData
            });
        }
    };

    return (
        <div className="w-full h-full relative bg-cyber-black" id="detective-board-container">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
                <div className="flex gap-2">
                    {(isGathering || isReorganizing) && (
                        <div className="flex items-center gap-2 px-6 py-2 bg-black border border-cyber-cyan text-cyber-cyan font-black uppercase tracking-widest text-xs animate-pulse shadow-[0_0_15px_rgba(0,243,255,0.3)]">
                            {isReorganizing ? 'Reorganizing Neural Pathways...' : (deepDiveTopic ? `Deep Diving: ${deepDiveTopic}` : 'Gathering Intel...')} {isReorganizing ? '' : `${nodes.length}/8`}
                        </div>
                    )}
                    <button
                        onClick={addManualNode}
                        className="flex items-center gap-2 px-6 py-2 bg-black border border-cyber-green text-cyber-green font-black shadow-[0_0_15px_rgba(0,255,65,0.2)] transition-all uppercase tracking-widest text-xs hover:bg-cyber-green hover:text-black animate-gloss"
                    >
                        <PlusSquare size={14} />
                        ADD EVIDENCE
                    </button>

                    <button
                        id="connect-dots-btn"
                        onClick={connectTheDots}
                        disabled={isAnalyzing || nodes.length < 2 || isGathering || isReorganizing}
                        className={`flex items-center gap-2 px-6 py-2 bg-black border border-cyber-purple text-cyber-purple font-black shadow-[0_0_15px_rgba(188,19,254,0.3)] transition-all uppercase tracking-widest text-xs ${(isAnalyzing || isGathering || isReorganizing) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-cyber-purple hover:text-white'}`}
                    >
                        <Zap size={14} className={isAnalyzing ? 'animate-spin' : ''} />
                        {isAnalyzing ? 'Analyzing Patterns...' : 'Connect The Dots'}
                    </button>

                    <div className="relative" ref={exportMenuRef}>
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            disabled={nodes.length === 0 || isReorganizing}
                            className={`flex items-center gap-2 px-6 py-2 bg-black border border-white/20 text-white font-black shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-all uppercase tracking-widest text-xs ${(nodes.length === 0 || isReorganizing) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-white hover:text-black'}`}
                        >
                            <Download size={14} />
                            EXPORT
                            <ChevronDown size={14} className={`transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
                        </button>

                        {showExportMenu && (
                            <div className="absolute top-12 left-0 w-48 bg-cyber-black border border-white/20 shadow-2xl z-50 overflow-hidden backdrop-blur-xl">
                                <button
                                    onClick={() => handleExport('png')}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-[10px] font-bold text-gray-300 hover:bg-white/10 hover:text-white transition-colors border-b border-white/5"
                                >
                                    <ImageIcon size={14} className="text-cyber-cyan" /> SNAPSHOT (PNG)
                                </button>
                                <button
                                    onClick={() => handleExport('svg')}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-[10px] font-bold text-gray-300 hover:bg-white/10 hover:text-white transition-colors border-b border-white/5"
                                >
                                    <Box size={14} className="text-cyber-green" /> VECTOR (SVG)
                                </button>
                                <button
                                    onClick={() => handleExport('pdf')}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-[10px] font-bold text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                                >
                                    <FileText size={14} className="text-cyber-purple" /> FULL REPORT (PDF)
                                </button>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleReorganize}
                        disabled={nodes.length === 0 || isAnalyzing || isGathering || isReorganizing}
                        className={`flex items-center gap-2 px-6 py-2 bg-black border border-cyber-cyan text-cyber-cyan font-black shadow-[0_0_15px_rgba(0,243,255,0.2)] transition-all uppercase tracking-widest text-xs ${(nodes.length === 0 || isAnalyzing || isGathering || isReorganizing) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-cyber-cyan hover:text-white'}`}
                    >
                        <Edit2 size={14} className={isReorganizing ? 'animate-bounce' : ''} />
                        {isReorganizing ? 'Tidying...' : 'Tidy Up'}
                    </button>
                    <button
                        onClick={clearBoard}
                        disabled={nodes.length === 0}
                        className={`flex items-center gap-2 px-6 py-2 bg-black border border-red-500 text-red-500 font-black shadow-[0_0_15px_rgba(239,68,68,0.2)] transition-all uppercase tracking-widest text-xs ${nodes.length === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-500 hover:text-white'}`}
                    >
                        <Trash2 size={14} />
                        Clear Board
                    </button>
                </div>
            </div>

            <div className="w-full h-full" id="detective-board-flow">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onReconnect={onReconnect}
                    onEdgeClick={onEdgeClick}
                    nodeTypes={nodeTypes}
                    edgeTypes={EDGE_TYPES}
                    connectionMode={ConnectionMode.Loose}
                    fitView
                >
                    <Background color="#111" gap={15} />
                    <Controls />
                </ReactFlow>
            </div>

            {edgeReasoning && (
                <div className="absolute bottom-10 left-10 w-80 bg-cyber-black/90 border p-4 z-40 shadow-2xl backdrop-blur-md" style={{ borderColor: edgeReasoning.color, boxShadow: `0 0 20px ${edgeReasoning.color}33` }}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[10px] font-black tracking-tighter uppercase" style={{ color: edgeReasoning.color }}><Info size={12} /> Connection logic: {edgeReasoning.tag}</div>
                        <button onClick={() => setEdgeReasoning(null)} className="text-gray-500 hover:text-white text-xs">×</button>
                    </div>
                    <div className="text-white text-[11px] leading-relaxed italic">{edgeReasoning.text}</div>
                </div>
            )}

            <div className="absolute bottom-10 right-10 w-64 bg-cyber-black/90 border border-cyber-cyan p-4 z-40 shadow-[0_0_20px_rgba(0,243,255,0.1)] backdrop-blur-md max-h-[50vh] flex flex-col">
                <h3 className="text-cyber-cyan text-xs font-black mb-3 tracking-widest border-b border-cyber-cyan/30 pb-2">RELATIONSHIPS</h3>
                <div className="flex-1 overflow-y-auto flex flex-col gap-2 pr-1 custom-scrollbar">
                    {visibleStyles.length === 0 && (
                        <div className="text-[10px] text-gray-500 italic">No connections yet. Dynamic tags will appear here.</div>
                    )}
                    {visibleStyles.map(([tag, style]) => (
                        <div
                            key={tag}
                            onClick={() => setEditingTag(editingTag === tag ? null : tag)}
                            className={`flex items-center gap-2 cursor-pointer p-1 -ml-1 rounded transition-colors group ${editingTag === tag ? 'bg-cyber-cyan/20 border border-cyber-cyan/50' : 'hover:bg-white/5 border border-transparent'}`}
                        >
                            <div className="w-3 h-3 rounded-full border border-black shadow-sm shrink-0" style={{ backgroundColor: style.color }}></div>
                            <span className="text-[10px] font-bold tracking-wider text-gray-300 truncate" title={tag}>{tag}</span>
                            <Edit2 size={10} className="ml-auto text-gray-500 opacity-0 group-hover:opacity-100" />
                        </div>
                    ))}
                </div>
            </div>

            {editingTag && tagStyles[editingTag] && (
                <div className="absolute bottom-10 right-[320px] w-64 bg-cyber-black/95 border border-cyber-purple p-4 z-50 shadow-[0_0_25px_rgba(188,19,254,0.2)] backdrop-blur-md">
                    <div className="flex justify-between items-center mb-4 border-b border-cyber-purple/30 pb-2">
                        <h3 className="text-cyber-purple text-xs font-black tracking-widest truncate max-w-[150px]">EDIT: {editingTag}</h3>
                        <button onClick={() => setEditingTag(null)} className="text-gray-400 hover:text-white">✕</button>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-2 tracking-wider">COLOR</label>
                            <input
                                type="color"
                                value={tagStyles[editingTag].color || '#bc13fe'}
                                onChange={(e) => {
                                    const newStyles = { ...tagStyles, [editingTag]: { ...tagStyles[editingTag], color: e.target.value } };
                                    setTagStyles(newStyles);
                                    localStorage.setItem('board_tag_styles', JSON.stringify(newStyles));
                                }}
                                className="w-full h-8 bg-black border border-gray-700 cursor-pointer"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 mb-2 tracking-wider">LINE PATTERN</label>
                            <div className="flex gap-2 text-[10px]">
                                {['solid', 'dashed', 'dotted'].map(pat => (
                                    <button
                                        key={pat}
                                        onClick={() => {
                                            const newStyles = { ...tagStyles, [editingTag]: { ...tagStyles[editingTag], pattern: pat as any } };
                                            setTagStyles(newStyles);
                                            localStorage.setItem('board_tag_styles', JSON.stringify(newStyles));
                                        }}
                                        className={`flex-1 py-1 px-2 border uppercase tracking-wider ${tagStyles[editingTag].pattern === pat ? 'border-cyber-cyan text-cyber-cyan bg-cyber-cyan/10' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}
                                    >
                                        {pat}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {selectedContent && (
                <div className="absolute right-0 top-0 w-1/3 h-full bg-cyber-gray border-l border-cyber-cyan p-8 overflow-y-auto z-30 shadow-2xl backdrop-blur-md bg-opacity-95">
                    <button onClick={() => setSelectedContent(null)} className="mb-6 text-cyber-purple border border-cyber-purple px-4 py-1 hover:bg-cyber-purple hover:text-white transition-colors uppercase text-[10px] font-bold tracking-widest">[ CLOSE TERMINAL ]</button>
                    <h2 className="text-cyber-cyan text-xl font-black mb-6 underline decoration-cyber-purple underline-offset-8">INTEL_REPORT_FULL</h2>
                    <div className="text-gray-300 text-sm whitespace-pre-wrap leading-loose font-mono">{selectedContent}</div>
                </div>
            )}
        </div>
    );
};

const DetectiveBoard: React.FC<DetectiveBoardProps> = (props) => (
    <ReactFlowProvider><DetectiveBoardContent {...props} /></ReactFlowProvider>
);

export default DetectiveBoard;
