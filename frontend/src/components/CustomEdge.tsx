import React, { useCallback, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from 'reactflow';
import { Pencil, Unlink2 } from 'lucide-react';
import { BOARD_GRID_SIZE } from './boardGeometry';

const SNAP_THRESHOLD = 18;
const AXIS_LOCK_THRESHOLD = 20;

type RouteMode = 'free' | 'vertical-lock' | 'horizontal-lock' | 'midpoint-offset';

const snapToCandidates = (value: number, candidates: number[]) => {
    let snappedValue = value;
    let bestDistance = SNAP_THRESHOLD + 1;

    candidates.forEach((candidate) => {
        const distance = Math.abs(value - candidate);
        if (distance < bestDistance) {
            snappedValue = candidate;
            bestDistance = distance;
        }
    });

    return bestDistance <= SNAP_THRESHOLD ? snappedValue : value;
};

const getMidpoint = (sourceX: number, sourceY: number, targetX: number, targetY: number) => ({
    x: (sourceX + targetX) / 2,
    y: (sourceY + targetY) / 2,
});

const resolveRoutePoint = (
    routeMode: RouteMode | undefined,
    routeOffsetX: number,
    routeOffsetY: number,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    fallbackX: number,
    fallbackY: number,
) => {
    const midpoint = getMidpoint(sourceX, sourceY, targetX, targetY);

    switch (routeMode) {
        case 'vertical-lock':
            return { x: midpoint.x, y: midpoint.y + routeOffsetY };
        case 'horizontal-lock':
            return { x: midpoint.x + routeOffsetX, y: midpoint.y };
        case 'midpoint-offset':
            return { x: midpoint.x + routeOffsetX, y: midpoint.y + routeOffsetY };
        case 'free':
            return { x: fallbackX, y: fallbackY };
        default:
            return { x: fallbackX, y: fallbackY };
    }
};

const buildRouteState = (
    nextX: number,
    nextY: number,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
): { routeMode: RouteMode; routeOffsetX: number; routeOffsetY: number; customX?: number; customY?: number } => {
    const midpoint = getMidpoint(sourceX, sourceY, targetX, targetY);
    const routeOffsetX = nextX - midpoint.x;
    const routeOffsetY = nextY - midpoint.y;
    const edgeSpanX = Math.abs(targetX - sourceX);
    const edgeSpanY = Math.abs(targetY - sourceY);

    const nearVerticalAxis = Math.abs(routeOffsetX) <= AXIS_LOCK_THRESHOLD;
    const nearHorizontalAxis = Math.abs(routeOffsetY) <= AXIS_LOCK_THRESHOLD;

    if (Math.abs(routeOffsetX) > Math.max(edgeSpanX, BOARD_GRID_SIZE * 3) &&
        Math.abs(routeOffsetY) > Math.max(edgeSpanY, BOARD_GRID_SIZE * 3)) {
        return {
            routeMode: 'free',
            routeOffsetX: 0,
            routeOffsetY: 0,
            customX: nextX,
            customY: nextY,
        };
    }

    if (nearVerticalAxis && Math.abs(routeOffsetY) >= Math.abs(routeOffsetX)) {
        return {
            routeMode: 'vertical-lock',
            routeOffsetX: 0,
            routeOffsetY,
        };
    }

    if (nearHorizontalAxis && Math.abs(routeOffsetX) >= Math.abs(routeOffsetY)) {
        return {
            routeMode: 'horizontal-lock',
            routeOffsetX,
            routeOffsetY: 0,
        };
    }

    return {
        routeMode: 'midpoint-offset',
        routeOffsetX,
        routeOffsetY,
    };
};

const buildRoutePath = (
    routeMode: RouteMode | undefined,
    currentX: number,
    currentY: number,
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
) => {
    switch (routeMode) {
        case 'vertical-lock':
            return `M ${sourceX} ${sourceY} L ${currentX} ${sourceY} L ${currentX} ${currentY} L ${currentX} ${targetY} L ${targetX} ${targetY}`;
        case 'horizontal-lock':
            return `M ${sourceX} ${sourceY} L ${sourceX} ${currentY} L ${currentX} ${currentY} L ${targetX} ${currentY} L ${targetX} ${targetY}`;
        case 'midpoint-offset':
        case 'free':
            return `M ${sourceX} ${sourceY} L ${currentX} ${currentY} L ${targetX} ${targetY}`;
        default:
            return null;
    }
};

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
    const routeMode = data?.routeMode as RouteMode | undefined;
    const routeOffsetX = typeof data?.routeOffsetX === 'number' ? data.routeOffsetX : 0;
    const routeOffsetY = typeof data?.routeOffsetY === 'number' ? data.routeOffsetY : 0;
    const { x: currentX, y: currentY } = resolveRoutePoint(
        routeMode,
        routeOffsetX,
        routeOffsetY,
        sourceX,
        sourceY,
        targetX,
        targetY,
        hasCustomPosition ? data.customX : labelX,
        hasCustomPosition ? data.customY : labelY,
    );

    // Calculate dynamic paths that visually adjust to the dragged label
    let finalPath = edgePath;
    const routedPath = buildRoutePath(routeMode, currentX, currentY, sourceX, sourceY, targetX, targetY);
    if (routedPath) {
        finalPath = routedPath;
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
                let nextX = initialLabelX + dx;
                let nextY = initialLabelY + dy;

                if (data?.snapEnabled) {
                    const xCandidates = [
                        sourceX,
                        targetX,
                        (sourceX + targetX) / 2,
                        Math.round(nextX / BOARD_GRID_SIZE) * BOARD_GRID_SIZE,
                    ];
                    const yCandidates = [
                        sourceY,
                        targetY,
                        (sourceY + targetY) / 2,
                        Math.round(nextY / BOARD_GRID_SIZE) * BOARD_GRID_SIZE,
                    ];

                    nextX = snapToCandidates(nextX, xCandidates);
                    nextY = snapToCandidates(nextY, yCandidates);
                }

                setEdges((eds) =>
                    eds.map((e) => {
                        if (e.id === id) {
                            const routeState = buildRouteState(nextX, nextY, sourceX, sourceY, targetX, targetY);
                            return {
                                ...e,
                                data: {
                                    ...e.data,
                                    ...routeState,
                                    customX: nextX,
                                    customY: nextY,
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
        [id, currentX, currentY, data?.snapEnabled, getViewport, setEdges, sourceX, sourceY, targetX, targetY]
    );

    const onDoubleClick = (evt: React.MouseEvent) => {
        evt.stopPropagation();
        // Reset position on double click
        setEdges((eds) =>
            eds.map((e) => {
                if (e.id === id) {
                    const newData = { ...e.data };
                    delete newData.routeMode;
                    delete newData.routeOffsetX;
                    delete newData.routeOffsetY;
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
                        title={data?.snapEnabled ? "Drag to reroute line with snapping and smart routing. Double-click to reset label position." : "Drag to reroute line with smart routing. Double-click to reset label position."}
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
