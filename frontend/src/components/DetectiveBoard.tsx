import React, { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    applyEdgeChanges,
    applyNodeChanges,
    addEdge,
    useReactFlow,
    ReactFlowProvider,
    Position
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
import { Zap, Info, Trash2 } from 'lucide-react';
import dagre from 'dagre';

const nodeWidth = 260;
const nodeHeight = 200;

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    dagreGraph.setGraph({ rankdir: 'LR', nodesep: 100, ranksep: 200 });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    nodes.forEach((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        node.position = {
            x: nodeWithPosition.x - nodeWidth / 2,
            y: nodeWithPosition.y - nodeHeight / 2,
        };
        node.targetPosition = Position.Left;
        node.sourcePosition = Position.Right;
    });

    return { nodes, edges };
};

interface DetectiveBoardProps {
    investigationId: string | null;
    sharedSocket: WebSocket | null;
    onDeepDiveNode: (prompt: string, titleStr: string, sourceNodeId: string) => void;
    onNavigateToChild: (id: string) => void;
}

const nodeTypes = {
    custom: CustomNode,
};

const DetectiveBoardContent: React.FC<DetectiveBoardProps> = ({ investigationId, sharedSocket, onDeepDiveNode, onNavigateToChild }) => {
    const { fitView } = useReactFlow();
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [edgeReasoning, setEdgeReasoning] = useState<{ tag: string, text: string, color: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGathering, setIsGathering] = useState(false);
    const [deepDiveTopic, setDeepDiveTopic] = useState<string | null>(null);
    const [loadedInvestigationId, setLoadedInvestigationId] = useState<string | null>(null);

    // Persist per investigation
    useEffect(() => {
        if (!investigationId) return;
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
                    isDeepDiveSource: n.id === n.data.deepDiveSourceId
                }
            }));
            setNodes(restoredNodes);
            setEdges(savedEdges);
        } else {
            setNodes([]);
            setEdges([]);
        }
        setLoadedInvestigationId(investigationId);
    }, [investigationId, onDeepDiveNode, onNavigateToChild]);

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
        (params: Connection) => setEdges((eds) => addEdge({ ...params, sourceHandle: params.sourceHandle || 's-right', targetHandle: params.targetHandle || 't-left' }, eds)),
        []
    );

    const handleNewConnections = useCallback((connections: any[]) => {
        console.log('[Board] Received connections:', connections);
        const getEdgeStyles = (tag: string) => {
            switch (tag?.toUpperCase()) {
                case 'SUPPORTS': return {
                    color: '#10b981', // Green
                    sourceHandle: 's-right',
                    targetHandle: 't-left',
                    style: { stroke: '#10b981', strokeWidth: 3 }, // Solid, thick, stable flow
                    animated: false,
                };
                case 'OPPOSES': return {
                    color: '#ef4444', // Red
                    sourceHandle: 's-bottom',
                    targetHandle: 't-bottom',
                    style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '5,5' }, // Undercutting dashed
                    animated: true,
                };
                case 'EXPANDS': return {
                    color: '#3b82f6', // Blue
                    sourceHandle: 's-top',
                    targetHandle: 't-top',
                    style: { stroke: '#3b82f6', strokeWidth: 2, strokeDasharray: '2,6' }, // Overarching dotted
                    animated: true,
                };
                case 'DEPENDS': return {
                    color: '#f97316', // Orange
                    sourceHandle: 's-right',
                    targetHandle: 't-top',
                    style: { stroke: '#f97316', strokeWidth: 2, strokeDasharray: '10,5' }, // Long dash structural tie
                    animated: true,
                };
                case 'RELATED':
                default: return {
                    color: '#bc13fe', // Purple
                    sourceHandle: 's-bottom',
                    targetHandle: 't-left',
                    style: { stroke: '#bc13fe', strokeWidth: 1.5, strokeDasharray: '4,4' }, // Generic neural link
                    animated: true,
                };
            }
        };

        const newEdges: Edge[] = connections.map((c: any) => {
            const edgeConfig = getEdgeStyles(c.tag);
            return {
                id: `e-${c.source}-${c.target}-${c.tag}`, // Added tag to edge ID in case of multiple different edges between same nodes
                source: c.source,
                target: c.target,
                label: c.tag,
                sourceHandle: edgeConfig.sourceHandle,
                targetHandle: edgeConfig.targetHandle,
                data: { reasoning: c.reasoning, color: edgeConfig.color },
                animated: edgeConfig.animated,
                style: edgeConfig.style,
                labelStyle: { fill: edgeConfig.color, fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
                labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: edgeConfig.color, strokeWidth: 1 },
                labelBgPadding: [8, 4],
                labelBgBorderRadius: 2,
            };
        });

        setEdges((eds) => {
            const existingIds = new Set(eds.map(e => e.id));
            const filteredNew = newEdges.filter(e => !existingIds.has(e.id));
            const combinedEdges = [...eds, ...filteredNew];
            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, combinedEdges);
            setNodes([...layoutedNodes]);
            setTimeout(() => fitView({ duration: 800 }), 100);
            return layoutedEdges;
        });
        setIsAnalyzing(false);
    }, [nodes, fitView]);

    useEffect(() => {
        if (!sharedSocket) return;

        const handleMessage = (event: MessageEvent) => {
            const msg = JSON.parse(event.data);
            console.log('[Board] Received:', msg.type);

            if (msg.type === 'MEMORY_NODE_GATHERED') {
                const { node } = msg.payload;
                const newNode: Node = {
                    id: node.id,
                    type: 'custom',
                    style: { width: 288, height: 160 },
                    data: {
                        ...node,
                        onReadFull: () => setSelectedContent(node.fullText),
                        onDeepDive: (prompt: string, titleStr: string, srcId: string) => onDeepDiveNode(prompt, titleStr, srcId),
                        onNavigateToChild: (id: string) => onNavigateToChild(id),
                        isDeepDiveSource: false
                    },
                    position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
                    sourcePosition: Position.Right,
                    targetPosition: Position.Left
                };
                setNodes((nds) => {
                    if (nds.find(n => n.id === node.id)) return nds;
                    return [...nds, newNode];
                });
            } else if (msg.type === 'CONNECTIONS_FOUND') {
                handleNewConnections(msg.payload);
            } else if (msg.type === 'BRAIN_STATE') {
                const state = msg.payload;
                if (state === 'Done' || state === 'Offline' || state === 'Disconnected') {
                    if (isGathering) {
                        setDeepDiveTopic(null);
                        // After deep dive gathering, wait a beat then connect dots
                        setTimeout(() => {
                            // Only trigger connect if we are still on the board and nodes > 1
                            setNodes(nds => {
                                if (nds.length > 1) {
                                    // Triggering from a closure. We'll use a ref or check state.
                                    // For now, let's just use the function directly.
                                }
                                return nds;
                            });
                        }, 1000);
                    }
                    setIsGathering(false);
                } else {
                    setIsGathering(true);
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                setIsGathering(false);
                setDeepDiveTopic(null);
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
            }
        };

        sharedSocket.addEventListener('message', handleMessage);
        return () => sharedSocket.removeEventListener('message', handleMessage);
    }, [sharedSocket, handleNewConnections]);



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

        sharedSocket.send(JSON.stringify({ type: 'CONNECT_DOTS', payload: nodeData }));
    };

    const clearBoard = () => {
        if (window.confirm("Clear board?")) {
            setNodes([]);
            setEdges([]);
            setEdgeReasoning(null);
            setSelectedContent(null);
        }
    };

    const onEdgeClick = (_: React.MouseEvent, edge: Edge) => {
        if (edge.data?.reasoning) {
            setEdgeReasoning({ tag: edge.label as string, text: edge.data.reasoning, color: edge.data.color || '#bc13fe' });
        }
    };

    return (
        <div className="w-full h-full relative bg-cyber-black">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
                <div className="flex gap-2">
                    {isGathering && (
                        <div className="flex items-center gap-2 px-6 py-2 bg-black border border-cyber-cyan text-cyber-cyan font-black uppercase tracking-widest text-xs animate-pulse shadow-[0_0_15px_rgba(0,243,255,0.3)]">
                            {deepDiveTopic ? `Deep Diving: ${deepDiveTopic}` : 'Gathering Intel...'} {nodes.length}/8
                        </div>
                    )}
                    <button
                        id="connect-dots-btn"
                        onClick={connectTheDots}
                        disabled={isAnalyzing || nodes.length < 2 || isGathering}
                        className={`flex items-center gap-2 px-6 py-2 bg-black border border-cyber-purple text-cyber-purple font-black shadow-[0_0_15px_rgba(188,19,254,0.3)] transition-all uppercase tracking-widest text-xs ${(isAnalyzing || isGathering) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-cyber-purple hover:text-white'}`}
                    >
                        <Zap size={14} />
                        {isAnalyzing ? 'Analyzing Patterns...' : 'Connect The Dots'}
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

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeClick={onEdgeClick}
                nodeTypes={nodeTypes}
                fitView
            >
                <Background color="#111" gap={15} />
                <Controls />
            </ReactFlow>

            {edgeReasoning && (
                <div className="absolute bottom-10 left-10 w-80 bg-cyber-black/90 border p-4 z-40 shadow-2xl backdrop-blur-md" style={{ borderColor: edgeReasoning.color, boxShadow: `0 0 20px ${edgeReasoning.color}33` }}>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-[10px] font-black tracking-tighter uppercase" style={{ color: edgeReasoning.color }}><Info size={12} /> Connection logic: {edgeReasoning.tag}</div>
                        <button onClick={() => setEdgeReasoning(null)} className="text-gray-500 hover:text-white text-xs">×</button>
                    </div>
                    <div className="text-white text-[11px] leading-relaxed italic">{edgeReasoning.text}</div>
                </div>
            )}

            <div className="absolute bottom-10 right-10 w-48 bg-cyber-black/90 border border-cyber-cyan p-4 z-40 shadow-[0_0_20px_rgba(0,243,255,0.1)] backdrop-blur-md">
                <h3 className="text-cyber-cyan text-xs font-black mb-3 tracking-widest border-b border-cyber-cyan/30 pb-2">RELATIONSHIPS</h3>
                <div className="flex flex-col gap-2">
                    {[{ label: 'SUPPORTS', color: '#10b981' }, { label: 'OPPOSES', color: '#ef4444' }, { label: 'EXPANDS', color: '#3b82f6' }, { label: 'DEPENDS', color: '#f97316' }, { label: 'RELATED', color: '#bc13fe' }].map(tag => (
                        <div key={tag.label} className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full border border-black shadow-sm" style={{ backgroundColor: tag.color }}></div>
                            <span className="text-[10px] font-bold tracking-wider text-gray-300">{tag.label}</span>
                        </div>
                    ))}
                </div>
            </div>

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
