import React, { useCallback, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from 'reactflow';
import { Pencil, Unlink2 } from 'lucide-react';

export default function CustomEdge({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    label,
    data,
    labelStyle,
    labelBgStyle,
    interactionWidth,
}: any) {
    const { setEdges, getViewport } = useReactFlow();
    const [isHovered, setIsHovered] = useState(false);

    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 20,
    });

    const hasCustomPosition = data?.customX !== undefined && data?.customY !== undefined;
    const currentX = hasCustomPosition ? data.customX : labelX;
    const currentY = hasCustomPosition ? data.customY : labelY;

    // Calculate dynamic paths that visually adjust to the dragged label
    let finalPath = edgePath;
    if (hasCustomPosition) {
        // Draw a neat bent path that explicitly passes right behind the current label
        // Using straight lines for explicit user-directed routing
        finalPath = `M ${sourceX} ${sourceY} L ${currentX} ${currentY} L ${targetX} ${targetY}`;
    }

    const onMouseDown = useCallback(
        (evt: React.MouseEvent) => {
            evt.stopPropagation();
            const startX = evt.clientX;
            const startY = evt.clientY;
            const initialLabelX = currentX;
            const initialLabelY = currentY;

            const onMouseMove = (moveEvt: MouseEvent) => {
                const { zoom } = getViewport();
                const dx = (moveEvt.clientX - startX) / zoom;
                const dy = (moveEvt.clientY - startY) / zoom;

                setEdges((eds) =>
                    eds.map((e) => {
                        if (e.id === id) {
                            return {
                                ...e,
                                data: {
                                    ...e.data,
                                    customX: initialLabelX + dx,
                                    customY: initialLabelY + dy,
                                },
                            };
                        }
                        return e;
                    })
                );
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        },
        [id, currentX, currentY, getViewport, setEdges]
    );

    const onDoubleClick = (evt: React.MouseEvent) => {
        evt.stopPropagation();
        // Reset position on double click
        setEdges((eds) =>
            eds.map((e) => {
                if (e.id === id) {
                    const newData = { ...e.data };
                    delete newData.customX;
                    delete newData.customY;
                    return { ...e, data: newData };
                }
                return e;
            })
        );
    };

    const onRename = (evt: React.MouseEvent) => {
        evt.stopPropagation();
        data?.onRename?.(id);
    };

    const onDelete = (evt: React.MouseEvent) => {
        evt.stopPropagation();
        data?.onDelete?.(id);
    };

    return (
        <>
            {/* The main connecting line */}
            <BaseEdge id={id} path={finalPath} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />

            {/* The draggable Label */}
            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${currentX}px, ${currentY}px)`,
                        pointerEvents: 'all',
                        zIndex: 15,
                    }}
                    className="nodrag nopan"
                >
                    <div
                        style={{
                            cursor: 'grab',
                            background: labelBgStyle?.fill || '#050505',
                            border: `1px solid ${labelBgStyle?.stroke || '#bc13fe'}`,
                            padding: '4px 8px',
                            borderRadius: '4px',
                            color: labelStyle?.fill || '#bc13fe',
                            fontWeight: labelStyle?.fontWeight || 900,
                            fontSize: labelStyle?.fontSize || 10,
                            letterSpacing: labelStyle?.letterSpacing || '0.1em',
                            userSelect: 'none',
                            boxShadow: `0 0 10px ${labelBgStyle?.stroke || '#bc13fe'}33`
                        }}
                        onMouseDown={onMouseDown}
                        onDoubleClick={onDoubleClick}
                        onMouseEnter={() => setIsHovered(true)}
                        onMouseLeave={() => setIsHovered(false)}
                        className="transition-all hover:bg-[#111] hover:scale-110 active:scale-95 active:cursor-grabbing"
                        title="Drag to reroute line. Double-click to reset label position."
                    >
                        <div className="flex items-center gap-2">
                            <span>{label}</span>
                            {isHovered && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onMouseDown={(evt) => {
                                            evt.stopPropagation();
                                            evt.preventDefault();
                                        }}
                                        onClick={onRename}
                                        className="flex h-4 w-4 items-center justify-center rounded border border-current/30 hover:bg-white/10"
                                        title="Rename relationship"
                                    >
                                        <Pencil size={10} />
                                    </button>
                                    <button
                                        type="button"
                                        onMouseDown={(evt) => {
                                            evt.stopPropagation();
                                            evt.preventDefault();
                                        }}
                                        onClick={onDelete}
                                        className="flex h-4 w-4 items-center justify-center rounded border border-current/30 hover:bg-red-500/20"
                                        title="Detach connection"
                                    >
                                        <Unlink2 size={10} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </EdgeLabelRenderer>
        </>
    );
}
