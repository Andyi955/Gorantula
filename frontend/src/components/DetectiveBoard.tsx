import React, { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    applyEdgeChanges,
    applyNodeChanges,
    addEdge,
    useReactFlow,
    ReactFlowProvider
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
import { Zap, Info } from 'lucide-react';
import dagre from 'dagre';

const nodeTypes = {
    custom: CustomNode,
};

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 260;
const nodeHeight = 200;

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
    dagreGraph.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 150 });

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
    });

    return { nodes, edges };
};

interface DetectiveBoardProps {
    investigationId: string | null;
}

const DetectiveBoardContent: React.FC<DetectiveBoardProps> = ({ investigationId }) => {
    const { fitView } = useReactFlow();
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedContent, setSelectedContent] = useState<string | null>(null);
    const [edgeReasoning, setEdgeReasoning] = useState<{ tag: string, text: string } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGathering, setIsGathering] = useState(false);

    // Persist per investigation
    useEffect(() => {
        if (!investigationId) return;
        const saved = localStorage.getItem(`inv_data_${investigationId}`);
        if (saved) {
            const { nodes: savedNodes, edges: savedEdges } = JSON.parse(saved);
            const restoredNodes = savedNodes.map((n: any) => ({
                ...n,
                data: {
                    ...n.data,
                    onReadFull: () => setSelectedContent(n.data.fullText)
                }
            }));
            setNodes(restoredNodes);
            setEdges(savedEdges);
        } else {
            setNodes([]);
            setEdges([]);
        }
    }, [investigationId]);

    useEffect(() => {
        if (!investigationId) return;
        if (nodes.length === 0 && edges.length === 0) return;
        localStorage.setItem(`inv_data_${investigationId}`, JSON.stringify({ nodes, edges }));
    }, [nodes, edges, investigationId]);

    const onNodesChange: OnNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
        []
    );
    const onEdgesChange: OnEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
        []
    );
    const onConnect: OnConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        []
    );

    const handleNewConnections = useCallback((connections: any[]) => {
        const newEdges: Edge[] = connections.map((c: any) => ({
            id: `e-${c.source}-${c.target}`,
            source: c.source,
            target: c.target,
            label: c.tag,
            data: { reasoning: c.reasoning },
            animated: true,
            style: { stroke: '#bc13fe', strokeWidth: 2, strokeDasharray: '5,5' },
            labelStyle: { fill: '#bc13fe', fontWeight: 900, fontSize: 10, letterSpacing: '0.1em' },
            labelBgStyle: { fill: '#050505', fillOpacity: 0.9, stroke: '#bc13fe', strokeWidth: 1 },
            labelBgPadding: [8, 4],
            labelBgBorderRadius: 2,
        }));

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
        const socket = new WebSocket('ws://localhost:8080/ws');

        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'MEMORY_NODE_GATHERED') {
                const { node } = msg.payload;
                const newNode: Node = {
                    id: node.id,
                    type: 'custom',
                    data: {
                        ...node,
                        onReadFull: () => setSelectedContent(node.fullText)
                    },
                    position: { x: Math.random() * 400 + 100, y: Math.random() * 400 + 100 },
                };
                setNodes((nds) => [...nds, newNode]);
            } else if (msg.type === 'CONNECTIONS_FOUND') {
                handleNewConnections(msg.payload);
            } else if (msg.type === 'BRAIN_STATE') {
                const state = msg.payload;
                if (state === 'Done' || state === 'Offline' || state === 'Disconnected') {
                    setIsGathering(false);
                } else {
                    setIsGathering(true);
                }
            } else if (msg.type === 'SYNTHESIS_COMPLETE') {
                setIsGathering(false);
            }
        };

        return () => socket.close();
    }, [handleNewConnections]);

    const connectTheDots = () => {
        if (nodes.length < 2) return;
        setIsAnalyzing(true);
        const socket = new WebSocket('ws://localhost:8080/ws');
        socket.onopen = () => {
            const nodeData = nodes.map(n => ({
                id: n.id,
                title: n.data.title,
                summary: n.data.summary,
                fullText: n.data.fullText
            }));
            socket.send(JSON.stringify({
                type: 'CONNECT_DOTS',
                payload: nodeData
            }));
        };
        socket.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'CONNECTIONS_FOUND') {
                handleNewConnections(msg.payload);
                socket.close();
            }
        };
    };

    const onEdgeClick = (_: React.MouseEvent, edge: Edge) => {
        if (edge.data?.reasoning) {
            setEdgeReasoning({ tag: edge.label as string, text: edge.data.reasoning });
        }
    };

    return (
        <div className="w-full h-full relative bg-cyber-black">
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex gap-2">
                {isGathering && (
                    <div className="flex items-center gap-2 px-6 py-2 bg-black border border-cyber-cyan text-cyber-cyan font-black shadow-[0_0_15px_rgba(0,243,255,0.3)] uppercase tracking-widest text-xs animate-pulse">
                        Gathering Intel... {nodes.length}/8
                    </div>
                )}
                <button
                    onClick={connectTheDots}
                    disabled={isAnalyzing || nodes.length < 2 || isGathering}
                    className={`flex items-center gap-2 px-6 py-2 bg-black border border-cyber-purple text-cyber-purple font-black shadow-[0_0_15px_rgba(188,19,254,0.3)] transition-all uppercase tracking-widest text-xs ${(isAnalyzing || isGathering) ? 'opacity-50 cursor-not-allowed' : 'hover:bg-cyber-purple hover:text-white'}`}
                >
                    <Zap size={14} />
                    {isAnalyzing ? 'Analyzing Patterns...' : 'Connect The Dots'}
                </button>
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onEdgeClick={onEdgeClick}
                nodeTypes={nodeTypes}
                snapToGrid
                snapGrid={[15, 15]}
                fitView
            >
                <Background color="#111" gap={15} />
                <Controls />
            </ReactFlow>

            {/* Edge Reasoning Tooltip */}
            {edgeReasoning && (
                <div className="absolute bottom-10 left-10 w-80 bg-cyber-black/90 border border-cyber-purple p-4 z-40 shadow-[0_0_20px_rgba(188,19,254,0.2)] backdrop-blur-md">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-cyber-purple text-[10px] font-black tracking-tighter uppercase">
                            <Info size={12} />
                            Connection logic: {edgeReasoning.tag}
                        </div>
                        <button onClick={() => setEdgeReasoning(null)} className="text-gray-500 hover:text-white text-xs">×</button>
                    </div>
                    <div className="text-white text-[11px] leading-relaxed italic">
                        {edgeReasoning.text}
                    </div>
                </div>
            )}

            {selectedContent && (
                <div className="absolute right-0 top-0 w-1/3 h-full bg-cyber-gray border-l border-cyber-cyan p-8 overflow-y-auto z-30 shadow-2xl backdrop-blur-md bg-opacity-95">
                    <button
                        onClick={() => setSelectedContent(null)}
                        className="mb-6 text-cyber-purple border border-cyber-purple px-4 py-1 hover:bg-cyber-purple hover:text-white transition-colors uppercase text-[10px] font-bold tracking-widest"
                    >
                        [ CLOSE TERMINAL ]
                    </button>
                    <h2 className="text-cyber-cyan text-xl font-black mb-6 underline decoration-cyber-purple underline-offset-8">INTEL_REPORT_FULL</h2>
                    <div className="text-gray-300 text-sm whitespace-pre-wrap leading-loose font-mono">
                        {selectedContent}
                    </div>
                </div>
            )}
        </div>
    );
};

const DetectiveBoard: React.FC<DetectiveBoardProps> = (props) => (
    <ReactFlowProvider>
        <DetectiveBoardContent {...props} />
    </ReactFlowProvider>
);

export default DetectiveBoard;
