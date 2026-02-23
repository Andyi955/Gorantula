import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { ExternalLink, BookOpen } from 'lucide-react';

const CustomNode = ({ data }: NodeProps) => {
    return (
        <div className="bg-cyber-gray border border-cyber-cyan rounded-sm p-4 w-64 shadow-[0_0_15px_rgba(0,243,255,0.1)] group">
            {/* Target Handles */}
            <Handle type="target" position={Position.Top} className="!bg-cyber-cyan w-3 h-3 border-2 border-black" />

            <div className="flex flex-col gap-2">
                <div className="text-cyber-cyan font-black text-xs uppercase tracking-widest border-b border-cyber-cyan/30 pb-2 mb-1 text-center">
                    {data.title || 'ARCHIVED INTEL'}
                </div>

                <div className="text-white text-[11px] leading-relaxed italic line-clamp-3">
                    {data.summary || 'Awaiting further analysis...'}
                </div>

                <div className="flex justify-between items-center mt-3 pt-2 border-t border-cyber-cyan/10">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            data.onReadFull();
                        }}
                        className="flex items-center gap-1 text-[10px] text-cyber-purple hover:text-white transition-colors"
                    >
                        <BookOpen size={10} />
                        READ FULL
                    </button>

                    {data.sourceURL && (
                        <a
                            href={data.sourceURL}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-gray-500 hover:text-cyber-green transition-colors"
                        >
                            <ExternalLink size={10} />
                        </a>
                    )}
                </div>
            </div>

            {/* Source Handles */}
            <Handle type="source" position={Position.Bottom} className="!bg-cyber-purple w-3 h-3 border-2 border-black" />
        </div>
    );
};

export default memo(CustomNode);
