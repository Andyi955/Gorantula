import { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import { ExternalLink, BookOpen, Search, ArrowRight, ChevronDown, ChevronUp, MessageCircle, X, ArrowRightToLine, CheckCircle, Trash2, Edit2, Save } from 'lucide-react';
import { BOARD_GRID_SIZE, MIN_NODE_HEIGHT, MIN_NODE_WIDTH, calculateNodeFrame } from './boardGeometry';

// Persona insight type
export interface PersonaInsight {
    personaName: string;
    perspective: string;
    keyFindings: string[];
    connections: string[];
    questions: string[];
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
    isDeepDiveSource?: boolean;
    linkedInvestigationId?: string;
    personaInsights?: PersonaInsight[]; // Full insight objects
    handleCounts?: {
        left: number;
        right: number;
        top: number;
        bottom: number;
    };
    onReadFull: () => void;
    onDeepDive?: (prompt: string, titleStr: string, sourceId: string) => void;
    onNavigateToChild?: (id: string) => void;
    onExpand?: (nodeId: string, expanded: boolean) => void;
    onDelete?: (nodeId: string) => void;
    onUpdate?: (nodeId: string, data: any) => void;
    expanded?: boolean;
    returnVaultId?: string | null;
    currentInvestigationId?: string | null;
    sharedSocket?: WebSocket | null;
    onSetEditing?: (id: string | null) => void;
    isEditing?: boolean;
    isAnalyzing?: boolean;
}

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
    let safeText = escapeHTML(text);
    // Bold highlights
    let parsed = safeText.replace(/\*\*(.*?)\*\*/g, '<span class="text-cyber-green font-bold glow-sm">$1</span>');
    
    // Entity tags with premium military styling
    parsed = parsed.replace(/\[PERSON:(.*?)\]/gi, '<span class="text-white font-black bg-cyber-purple/30 px-1.5 py-0.5 rounded border border-cyber-purple/50 shadow-[0_0_8px_rgba(168,85,247,0.2)] text-[10px] uppercase tracking-tighter">$1</span>');
    parsed = parsed.replace(/\[ORG:(.*?)\]/gi, '<span class="text-white font-black bg-cyber-cyan/30 px-1.5 py-0.5 rounded border border-cyber-cyan/50 shadow-[0_0_8px_rgba(0,255,255,0.2)] text-[10px] uppercase tracking-tighter">$1</span>');
    parsed = parsed.replace(/\[LOC:(.*?)\]/gi, '<span class="text-white font-black bg-orange-500/30 px-1.5 py-0.5 rounded border border-orange-500/50 shadow-[0_0_8px_rgba(249,115,22,0.2)] text-[10px] uppercase tracking-tighter">$1</span>');
    parsed = parsed.replace(/\[DATE:(.*?)\]/gi, '<span class="text-white font-black bg-yellow-500/30 px-1.5 py-0.5 rounded border border-yellow-500/50 shadow-[0_0_8px_rgba(234,179,8,0.2)] text-[10px] uppercase tracking-tighter">$1</span>');
    parsed = parsed.replace(/\[TIME:(.*?)\]/gi, '<span class="text-white font-black bg-yellow-400/30 px-1.5 py-0.5 rounded border border-yellow-400/50 shadow-[0_0_8px_rgba(250,204,21,0.2)] text-[10px] uppercase tracking-tighter">$1</span>');
    
    return parsed;
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

const CustomNode = ({ data, selected, ...props }: NodeProps<NodeData> & { 
    returnVaultId?: string | null, 
    currentInvestigationId?: string | null, 
    sharedSocket?: WebSocket | null,
    onDeleteNode?: (id: string) => void,
    onUpdateNode?: (id: string, data: any) => void,
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
    const onUpdateNode = props.onUpdateNode ?? data.onUpdate;
    const isEditing = props.isEditing ?? data.isEditing;
    const onSetEditing = props.onSetEditing ?? data.onSetEditing;

    const [isExpanded, setIsExpanded] = useState(data.expanded || false);
    const [showChat, setShowChat] = useState(false);
    const [hasPulled, setHasPulled] = useState(false);
    const [editText, setEditText] = useState(data.fullText || data.summary || '');
    const [editTitle, setEditTitle] = useState(data.title || '');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const chatContentRef = useRef<HTMLDivElement>(null);

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

    // Sync edit state when entering edit mode or data updates
    useEffect(() => {
        if (isEditing) {
            setEditText(data.fullText || data.summary || '');
            setEditTitle(data.title || '');
        }
    }, [isEditing, data.fullText, data.summary, data.title]);

    const fallbackFrame = calculateNodeFrame(
        data.summary || '',
        data.fullText || '',
        isExpanded
    );
    const frameWidth = typeof props.width === 'number' ? props.width : fallbackFrame.width;
    const frameHeight = typeof props.height === 'number' ? props.height : fallbackFrame.height;
    const topHandleOffsets = getGridAlignedHandleOffsets(data.handleCounts?.top || 0, frameWidth);
    const bottomHandleOffsets = getGridAlignedHandleOffsets(data.handleCounts?.bottom || 0, frameWidth);
    const leftHandleOffsets = getGridAlignedHandleOffsets(data.handleCounts?.left || 0, frameHeight);
    const rightHandleOffsets = getGridAlignedHandleOffsets(data.handleCounts?.right || 0, frameHeight);

    const handleExpand = () => {
        const newExpanded = !isExpanded;
        setIsExpanded(newExpanded);
        // Call the expand callback if provided
        if (data.onExpand && data.id) {
            data.onExpand(data.id, newExpanded);
        }
    };

    // Show expanded content when isExpanded is true
    const displayContent = isExpanded && data.fullText ? data.fullText : data.summary;
    const isImported = data.title?.includes("[IMPORTED]") || data.id?.startsWith("imported-");

    const onSave = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        console.log(`[CustomNode] Saving node ${data.id}`, { editTitle, editText });
        if (onUpdateNode && data.id) {
            onUpdateNode(data.id, { 
                title: editTitle, 
                fullText: editText,
                summary: editText 
            });
        }
        if (onSetEditing) onSetEditing(null);
    };

    const onCancel = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        console.log("[CustomNode] Editor cancel clicked");
        setEditText(data.fullText || data.summary || '');
        setEditTitle(data.title || '');
        if (onSetEditing) onSetEditing(null);
    };

    return (
        <div
            className={`bg-cyber-gray/95 border-2 flex flex-col w-full h-full min-w-[288px] ${data.isDeepDiveSource ? 'border-cyber-green shadow-[0_0_30px_#10b98155]' : (isImported ? 'border-amber-500 shadow-[0_0_20px_#f59e0b55]' : 'border-cyber-cyan shadow-[0_0_25px_rgba(0,243,255,0.15)]')} rounded-none p-4 transition-colors duration-300 group backdrop-blur-sm relative overflow-visible`}
            style={{
                width: frameWidth,
                height: frameHeight,
                minWidth: frameWidth,
                minHeight: frameHeight,
                willChange: 'transform',
            }}
        >
            <NodeResizer
                minWidth={MIN_NODE_WIDTH}
                minHeight={MIN_NODE_HEIGHT}
                isVisible={selected}
                color="#00f3ff"
                handleStyle={{ width: 16, height: 16, borderRadius: 0, backgroundColor: '#00f3ff', border: '2px solid black' }}
                lineStyle={{ borderWidth: 2 }}
            />
            {isImported && (
                <div className="absolute -top-2 -left-2 bg-amber-500 text-black text-[8px] font-black px-2 py-0.5 z-50 shadow-lg border border-black/10 uppercase tracking-widest">
                    IMPORTED
                </div>
            )}
            {data.isDeepDiveSource && (
                <div className="absolute inset-0 bg-cyber-green/5 animate-pulse pointer-events-none" />
            )}

            {/* Professional Delete Confirmation Overlay */}
            {showDeleteConfirm && (
                <div 
                    className="absolute inset-0 z-[100] bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center p-4 border-2 border-red-500 animate-in fade-in zoom-in duration-200 nodrag nowheel"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                >
                    <Trash2 size={32} className="text-red-500 mb-2 animate-pulse" />
                    <h3 className="text-white font-black text-[10px] uppercase tracking-widest mb-4 text-center">Permanently Erase Evidence?</h3>
                    <div className="flex gap-3">
                        <button 
                            type="button"
                            onClick={(e) => { 
                                console.log("[CustomNode] Cancel delete clicked");
                                e.stopPropagation(); 
                                e.preventDefault();
                                setShowDeleteConfirm(false); 
                            }}
                            className="px-3 py-1.5 border border-white/50 text-white text-[9px] font-black hover:bg-white hover:text-black transition-all uppercase tracking-tighter"
                        >
                            CANCEL
                        </button>
                        <button 
                            type="button"
                            onClick={(e) => { 
                                console.log("[CustomNode] Confirm delete clicked");
                                e.stopPropagation();
                                e.preventDefault(); 
                                if(onDeleteNode && data.id) {
                                    onDeleteNode(data.id); 
                                    setShowDeleteConfirm(false);
                                }
                            }}
                            className="px-3 py-1.5 bg-red-600 text-white text-[9px] font-black hover:bg-red-500 transition-all shadow-[0_0_15px_rgba(220,38,38,0.5)] uppercase tracking-tighter"
                        >
                            CONFIRM ERASE
                        </button>
                    </div>
                </div>
            )}
            {/* Dynamic Connection Handles - offset so they don't overlap z-indexes restricting drops */}

            {/* Top Handles */}
            {topHandleOffsets.map((offset, i) => {
                return (
                    <Handle key={`top-${i}`} type="source" id={`port-top-${i}`} position={Position.Top} style={{ left: offset }} className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair" />
                );
            })}

            {/* Bottom Handles */}
            {bottomHandleOffsets.map((offset, i) => {
                return (
                    <Handle key={`bot-${i}`} type="source" id={`port-bot-${i}`} position={Position.Bottom} style={{ left: offset }} className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair" />
                );
            })}

            {/* Left Handles */}
            {leftHandleOffsets.map((offset, i) => {
                return (
                    <Handle key={`left-${i}`} type="source" id={`port-left-${i}`} position={Position.Left} style={{ top: offset }} className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair" />
                );
            })}

            {/* Right Handles */}
            {rightHandleOffsets.map((offset, i) => {
                return (
                    <Handle key={`right-${i}`} type="source" id={`port-right-${i}`} position={Position.Right} style={{ top: offset }} className="!bg-cyber-purple w-3 h-3 border-2 border-black !rounded-none transition-transform hover:scale-[2] z-50 cursor-crosshair" />
                );
            })}

            {/* Corner Accents */}
            <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-cyber-cyan" />
            <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-cyber-purple" />

            <div className="flex flex-col flex-1 gap-2 min-h-0">
                {/* Header with Expand Button */}
                <div className="flex items-center justify-between border-b border-cyber-cyan/30 pb-2 shrink-0">
                    <div className="text-cyber-cyan font-black text-[10px] uppercase tracking-[0.2em] truncate flex-1 leading-none">
                        {isEditing ? (
                            <input
                                autoFocus
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                onKeyDown={(e) => e.stopPropagation()}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-black/50 border border-cyber-cyan/30 text-cyber-cyan p-1 w-full outline-none"
                            />
                        ) : (data.title || 'ARCHIVED_INTEL')}
                    </div>
                    <div className="flex items-center gap-1.5 ml-2">
                        {!isEditing && (
                            <>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        console.log("[CustomNode] Edit clicked", data.id);
                                        if (onSetEditing) onSetEditing(data.id || null);
                                    }}
                                    className="text-white/40 hover:text-cyber-cyan transition-colors p-1 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded"
                                    title="Edit Evidence"
                                >
                                    <Edit2 size={12} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                        console.log("[CustomNode] Delete clicked", data.id);
                                        setShowDeleteConfirm(true);
                                    }}
                                    className="text-white/40 hover:text-red-500 transition-colors p-1 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded"
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
                            className={`p-1 transition-all ${
                                hasPulled 
                                    ? 'text-cyber-green' 
                                    : 'text-cyber-green/80 hover:text-cyber-green animate-pulse-glow'
                            }`}
                        >
                            {hasPulled ? <CheckCircle size={16} /> : <ArrowRightToLine size={16} />}
                        </button>
                    )}

                    <button
                        onClick={handleExpand}
                        className="text-cyber-purple hover:text-white transition-colors p-1"
                        title={isExpanded ? "Collapse" : "Expand"}
                    >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                </div>
            </div>

            {/* Summary with Auto Flex */}
                <div
                    ref={contentRef}
                    className={`relative group/text flex-1 min-h-0 flex flex-col pr-1 transition-all duration-300 ${isExpanded || isEditing ? 'overflow-y-auto' : ''}`}
                    style={{ maxHeight: isExpanded || isEditing ? '400px' : '200px' }}
                >
                    <div className="flex-1 min-h-0 flex flex-col relative">
                        {isEditing ? (
                            <div className="flex flex-col gap-2 h-full">
                                <textarea
                                    autoFocus
                                    value={editText}
                                    onChange={(e) => setEditText(e.target.value)}
                                    onKeyDown={(e) => e.stopPropagation()}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-black/40 border border-cyber-cyan/20 text-white p-3 w-full flex-1 outline-none font-mono text-[11px] custom-scrollbar nodrag nowheel min-h-[200px] focus:border-cyber-cyan/50 transition-colors"
                                    placeholder="Enter evidence details..."
                                />
                            </div>
                        ) : (
                            <div className="relative flex-1 flex flex-col min-h-0">
                                {data.isAnalyzing && (
                                    <div className="absolute inset-0 bg-black/40 z-10 flex flex-col items-center justify-center gap-3 backdrop-blur-[1px] overflow-hidden">
                                    <div className="absolute top-0 left-0 w-full h-[2px] bg-cyber-cyan shadow-[0_0_10px_#00f3ff] animate-scan z-20" />
                                    <div className="flex items-center gap-2 text-cyber-cyan text-[10px] font-black animate-pulse">
                                            <div className="w-1 h-1 bg-cyber-cyan rounded-full" />
                                            IDENTIFYING ENTITIES...
                                        </div>
                                    </div>
                                )}
                                <div
                                    className={`text-white text-[11px] leading-relaxed font-mono whitespace-pre-wrap flex-1 overflow-y-auto pr-2 custom-scrollbar ${data.isAnalyzing ? 'opacity-30' : ''}`}
                                    dangerouslySetInnerHTML={{
                                        __html: parseHighlightedText(displayContent || '')
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Persona Chat Icon - shows who discussed this card */}
                {data.personaInsights && data.personaInsights.length > 0 && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowChat(true);
                        }}
                        className="mt-1 w-5 h-5 flex items-center justify-center bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/50 hover:text-amber-200 transition-all duration-300 shadow-[0_0_8px_rgba(245,158,11,0.1)] group/insight"
                        title="Review Specialist Insights"
                    >
                        <MessageCircle className="w-3 h-3 group-hover/insight:scale-110 transition-transform" />
                    </button>
                )}

                {/* Chat Modal */}
                {showChat && data.personaInsights && data.personaInsights.length > 0 && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowChat(false)}>
                        <div
                            className="bg-gray-900 border border-white/20 rounded-lg max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
                                <h3 className="text-lg font-bold text-white">Persona Discussion</h3>
                                <button onClick={() => setShowChat(false)} className="text-gray-400 hover:text-white">
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
                                        className={`p-4 rounded-lg border ${insight.personaName === 'Skeptic' ? 'bg-red-500/10 border-red-400/30' :
                                            insight.personaName === 'Connector' ? 'bg-purple-500/10 border-purple-400/30' :
                                                insight.personaName === 'Timeline Analyst' ? 'bg-cyan-500/10 border-cyan-400/30' :
                                                    insight.personaName === 'Entity Hunter' ? 'bg-green-500/10 border-green-400/30' :
                                                        insight.personaName === 'Context Provider' ? 'bg-amber-500/10 border-amber-400/30' :
                                                            insight.personaName === 'Implications Mapper' ? 'bg-pink-500/10 border-pink-400/30' :
                                                                'bg-cyber-purple/10 border-cyber-purple/30'
                                            }`}
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
                <div className="flex items-center justify-between mt-auto pt-3 border-t border-white/5 shrink-0">
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                data.onReadFull();
                            }}
                            className="flex items-center gap-1.5 text-[9px] font-black text-cyber-purple hover:text-white transition-all uppercase tracking-tighter"
                            title="Open Dossier"
                        >
                            <BookOpen size={12} />
                            DOSSIER
                        </button>

                        {data.linkedInvestigationId ? (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (data.onNavigateToChild) data.onNavigateToChild(data.linkedInvestigationId!);
                                }}
                                className="flex items-center gap-1.5 text-[9px] font-black text-cyber-cyan hover:text-white transition-all uppercase tracking-tighter bg-cyber-cyan/10 px-2 py-1 rounded"
                                title="Go to detailed canvas"
                            >
                                <ArrowRight size={12} />
                                OPEN SUB-FILE
                            </button>
                        ) : (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (data.onDeepDive && data.id) {
                                        data.onDeepDive(data.fullText || data.summary || data.title || '', data.title || 'Unknown Entity', data.id);
                                    }
                                }}
                                disabled={data.isDeepDiveSource}
                                className={`flex items-center gap-1.5 text-[9px] font-black ${data.isDeepDiveSource ? 'text-gray-500' : 'text-cyber-green hover:text-white'} transition-all uppercase tracking-tighter`}
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
                                    className="px-2 py-1 border border-white/20 text-white/50 text-[8px] font-black hover:bg-white/10 hover:text-white transition-all uppercase tracking-tighter"
                                >
                                    CANCEL
                                </button>
                                <button
                                    onClick={onSave}
                                    className="px-2 py-1 bg-cyber-green/20 border border-cyber-green text-cyber-green text-[8px] font-black hover:bg-cyber-green hover:text-white transition-all shadow-[0_0_10px_rgba(0,255,65,0.1)] uppercase tracking-tighter flex items-center gap-1"
                                >
                                    <Save size={10} />
                                    SAVE
                                </button>
                            </>
                        )}
                        {data.sourceURL && (
                            <a
                                href={data.sourceURL?.split(',')[0].trim()}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-gray-600 hover:text-cyber-cyan transition-colors ml-1"
                                title="Verify Source"
                            >
                                <ExternalLink size={12} />
                            </a>
                        )}
                    </div>
                </div>
            </div>


            {/* Status Indicator */}
            <div className="absolute -top-2 -right-2 bg-black border border-cyber-cyan px-1 py-0.5 flex items-center gap-1 shadow-lg">
                <div className="w-1 h-1 rounded-full bg-cyber-green animate-pulse" />
                <span className="text-[7px] text-cyber-cyan font-bold">VERIFIED</span>
            </div>
        </div>
    );
};

export default memo(CustomNode);
