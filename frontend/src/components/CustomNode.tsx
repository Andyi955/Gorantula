import { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { NodeResizer } from '@reactflow/node-resizer';
import '@reactflow/node-resizer/dist/style.css';
import { ExternalLink, BookOpen, Search, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';

export interface NodeData {
    id?: string;
    title?: string;
    summary?: string;
    fullText?: string;
    sourceURL?: string;
    isDeepDiveSource?: boolean;
    linkedInvestigationId?: string;
    personaInsights?: string[]; // Insights from persona analysis
    onReadFull: () => void;
    onDeepDive?: (prompt: string, titleStr: string, sourceId: string) => void;
    onNavigateToChild?: (id: string) => void;
    onExpand?: (nodeId: string, expanded: boolean) => void;
    expanded?: boolean;
}

const escapeHTML = (text: string) => {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const parseHighlightedText = (text: string) => {
    if (!text) return 'Awaiting further analysis...';
    let safeText = escapeHTML(text);
    let parsed = safeText.replace(/\*\*(.*?)\*\*/g, '<span class="text-cyber-green font-bold">$1</span>');
    parsed = parsed.replace(/\[PERSON:(.*?)\]/gi, '<span class="text-cyber-purple font-bold bg-cyber-purple/20 px-1 rounded border border-cyber-purple/50">$1</span>');
    parsed = parsed.replace(/\[ORG:(.*?)\]/gi, '<span class="text-cyber-cyan font-bold bg-cyber-cyan/20 px-1 rounded border border-cyber-cyan/50">$1</span>');
    parsed = parsed.replace(/\[LOC:(.*?)\]/gi, '<span class="text-orange-400 font-bold bg-orange-400/20 px-1 rounded border border-orange-400/50">$1</span>');
    parsed = parsed.replace(/\[DATE:(.*?)\]/gi, '<span class="text-yellow-400 font-bold bg-yellow-400/20 px-1 rounded border border-yellow-400/50">$1</span>');
    parsed = parsed.replace(/\[TIME:(.*?)\]/gi, '<span class="text-yellow-400 font-bold bg-yellow-400/20 px-1 rounded border border-yellow-400/50">$1</span>');
    return parsed;
};

// Calculate appropriate card size based on content
const calculateCardSize = (summary: string, fullText: string, isExpanded: boolean) => {
    const content = isExpanded ? (fullText || summary) : summary;
    const charCount = content.length;

    // Base dimensions
    let width = 320;
    let height = 180;

    // Calculate based on content length
    // Roughly 40 chars per line, ~20 lines max before expansion
    const lines = Math.ceil(charCount / 40);
    const estimatedLines = Math.min(lines, isExpanded ? 30 : 8);

    // Height grows with content, but capped
    height = Math.max(180, 100 + estimatedLines * 18);

    // Width grows for longer content (horizontal extension)
    if (charCount > 300) {
        width = Math.min(500, 320 + Math.min(charCount - 300, 180));
    }

    return { width, height };
};

const CustomNode = ({ data, selected }: NodeProps<NodeData>) => {
    const [isExpanded, setIsExpanded] = useState(data.expanded || false);
    const contentRef = useRef<HTMLDivElement>(null);

    // Calculate size based on content
    const { width, height } = calculateCardSize(
        data.summary || '',
        data.fullText || '',
        isExpanded
    );

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
    const hasFullText = !!data.fullText && data.fullText !== data.summary;

    return (
        <div
            className={`bg-cyber-gray/95 border-2 flex flex-col w-full h-full min-w-[288px] ${data.isDeepDiveSource ? 'border-cyber-green shadow-[0_0_30px_#10b98155]' : 'border-cyber-cyan shadow-[0_0_25px_rgba(0,243,255,0.15)]'} rounded-none p-4 transition-all duration-300 group backdrop-blur-sm relative overflow-visible`}
            style={{
                minHeight: height,
            }}
        >
            <NodeResizer
                minWidth={288}
                minHeight={160}
                isVisible={selected}
                color="#00f3ff"
                handleStyle={{ width: 16, height: 16, borderRadius: 0, backgroundColor: '#00f3ff', border: '2px solid black' }}
                lineStyle={{ borderWidth: 2 }}
            />
            {data.isDeepDiveSource && (
                <div className="absolute inset-0 bg-cyber-green/5 animate-pulse pointer-events-none" />
            )}
            {/* Connection Handles - Flow Left-to-Right */}
            <Handle type="target" id="t-top" position={Position.Top} className="!bg-cyber-cyan w-2 h-2 border border-black !rounded-none" />
            <Handle type="target" id="t-bottom" position={Position.Bottom} className="!bg-cyber-cyan w-2 h-2 border border-black !rounded-none" />
            <Handle type="target" id="t-left" position={Position.Left} className="!bg-cyber-cyan w-2 h-2 border border-black !rounded-none" />

            <Handle type="source" id="s-right" position={Position.Right} className="!bg-cyber-purple w-2 h-2 border border-black !rounded-none" />
            <Handle type="source" id="s-top" position={Position.Top} className="!bg-cyber-purple w-2 h-2 border border-black !rounded-none" />
            <Handle type="source" id="s-bottom" position={Position.Bottom} className="!bg-cyber-purple w-2 h-2 border border-black !rounded-none" />

            {/* Corner Accents */}
            <div className="absolute -top-1 -left-1 w-2 h-2 border-t-2 border-l-2 border-cyber-cyan" />
            <div className="absolute -bottom-1 -right-1 w-2 h-2 border-b-2 border-r-2 border-cyber-purple" />

            <div className="flex flex-col flex-1 gap-2 min-h-0">
                {/* Header with Expand Button */}
                <div className="flex items-center justify-between border-b border-cyber-cyan/30 pb-2 shrink-0">
                    <div className="text-cyber-cyan font-black text-[10px] uppercase tracking-[0.2em] truncate flex-1 leading-none">
                        {data.title || 'ARCHIVED_INTEL'}
                    </div>
                    {hasFullText && (
                        <button
                            onClick={handleExpand}
                            className="ml-2 flex items-center gap-1 text-[8px] font-bold text-cyber-cyan hover:text-white transition-colors"
                            title={isExpanded ? 'Collapse' : 'Expand'}
                        >
                            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    )}
                </div>

                {/* Summary with Auto Flex */}
                <div
                    ref={contentRef}
                    className={`relative group/text flex-1 min-h-0 flex flex-col pr-1 transition-all duration-300 ${isExpanded ? 'overflow-y-auto' : ''}`}
                    style={{ maxHeight: isExpanded ? '400px' : '200px' }}
                >
                    <div
                        className="text-white text-[11px] leading-relaxed font-mono whitespace-pre-wrap flex-1 overflow-y-auto pr-2 custom-scrollbar"
                        dangerouslySetInnerHTML={{
                            __html: parseHighlightedText(displayContent || '')
                        }}
                    />
                </div>

                {/* Persona Insights Badge */}
                {data.personaInsights && data.personaInsights.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1 shrink-0">
                        {data.personaInsights.map((insight, idx) => (
                            <span
                                key={idx}
                                className="text-[7px] px-1.5 py-0.5 bg-cyber-purple/20 border border-cyber-purple/50 text-cyber-purple rounded"
                            >
                                {insight}
                            </span>
                        ))}
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

                    {data.sourceURL && (
                        <a
                            href={data.sourceURL?.split(',')[0].trim()}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-gray-600 hover:text-cyber-cyan transition-colors"
                            title="Verify Source"
                        >
                            <ExternalLink size={12} />
                        </a>
                    )}
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
