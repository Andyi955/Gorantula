import React, { useCallback, useMemo, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useReactFlow } from 'reactflow';
import { Pencil, Unlink2 } from 'lucide-react';
import { BOARD_GRID_SIZE, snapCoordinateToGrid } from './boardGeometry';
import type { BoardMode, PortSide, StrictGridPoint } from './boardGeometry';

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

const buildLegacyRouteState = (
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

const buildLegacyRoutePath = (
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

const buildPolylinePath = (points: StrictGridPoint[]) =>
    points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

const compactPolylinePoints = (points: StrictGridPoint[]) => {
    const compacted: StrictGridPoint[] = [];

    points.forEach((point) => {
        const lastPoint = compacted[compacted.length - 1];
        if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) {
            return;
        }

        const previousPoint = compacted[compacted.length - 2];
        if (previousPoint && lastPoint) {
            const sameVertical = previousPoint.x === lastPoint.x && lastPoint.x === point.x;
            const sameHorizontal = previousPoint.y === lastPoint.y && lastPoint.y === point.y;

            if (sameVertical || sameHorizontal) {
                compacted[compacted.length - 1] = point;
                return;
            }
        }

        compacted.push(point);
    });

    return compacted;
};

const getPolylineMidpoint = (points: StrictGridPoint[]) => {
    if (points.length < 2) {
        return { x: points[0]?.x || 0, y: points[0]?.y || 0 };
    }

    const segments = points.slice(1).map((point, index) => {
        const start = points[index];
        const length = Math.abs(point.x - start.x) + Math.abs(point.y - start.y);
        return { start, end: point, length };
    });

    const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
    const halfLength = totalLength / 2;
    let traversed = 0;

    for (const segment of segments) {
        if (traversed + segment.length >= halfLength) {
            const remaining = halfLength - traversed;
            if (segment.start.x === segment.end.x) {
                const direction = segment.end.y >= segment.start.y ? 1 : -1;
                return { x: segment.start.x, y: segment.start.y + (remaining * direction) };
            }

            const direction = segment.end.x >= segment.start.x ? 1 : -1;
            return { x: segment.start.x + (remaining * direction), y: segment.start.y };
        }
        traversed += segment.length;
    }

    return points[Math.floor(points.length / 2)];
};

const getSegmentMidpoint = (start: StrictGridPoint, end: StrictGridPoint) => ({
    x: start.x === end.x ? start.x : start.x + ((end.x - start.x) / 2),
    y: start.y === end.y ? start.y : start.y + ((end.y - start.y) / 2),
});

const getBestStrictLabelPoint = (points: StrictGridPoint[]) => {
    if (points.length < 2) {
        return { x: points[0]?.x || 0, y: points[0]?.y || 0 };
    }

    const segments = points.slice(1).map((point, index) => {
        const start = points[index];
        const length = Math.abs(point.x - start.x) + Math.abs(point.y - start.y);
        return { start, end: point, length, index };
    });

    const interiorSegments = segments.filter((segment) =>
        segment.index > 0 &&
        segment.index < segments.length - 1 &&
        segment.length >= BOARD_GRID_SIZE * 2
    );

    const bestSegment = [...interiorSegments, ...segments]
        .sort((left, right) => right.length - left.length)[0];

    return bestSegment
        ? getSegmentMidpoint(bestSegment.start, bestSegment.end)
        : getPolylineMidpoint(points);
};

const buildStrictRoutePointsFromAnchor = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    anchorX: number,
    anchorY: number,
) => compactPolylinePoints([
    { x: sourceX, y: sourceY },
    { x: anchorX, y: sourceY },
    { x: anchorX, y: anchorY },
    { x: targetX, y: anchorY },
    { x: targetX, y: targetY },
]);

const alignRouteEndpoint = (
    anchor: StrictGridPoint,
    side: PortSide | undefined,
    routePoint: StrictGridPoint,
) => {
    if (!side) {
        return routePoint;
    }

    if (side === 'left' || side === 'right') {
        return { x: routePoint.x, y: anchor.y };
    }

    return { x: anchor.x, y: routePoint.y };
};

const getStrictRouteData = (data: any, sourceX: number, sourceY: number, targetX: number, targetY: number) => {
    const hasRouteAnchor = typeof data?.routeAnchorX === 'number' && typeof data?.routeAnchorY === 'number';
    const sourcePoint = { x: sourceX, y: sourceY };
    const targetPoint = { x: targetX, y: targetY };
    const rawPathPoints: StrictGridPoint[] = hasRouteAnchor
        ? buildStrictRoutePointsFromAnchor(sourceX, sourceY, targetX, targetY, data.routeAnchorX, data.routeAnchorY)
        : [
            sourcePoint,
            ...(Array.isArray(data?.routePoints) ? data.routePoints : []),
            targetPoint,
        ];
    const pathPoints = rawPathPoints.map((point, index) => {
        if (index === 1) {
            return alignRouteEndpoint(sourcePoint, data?.sourcePortSide as PortSide | undefined, point);
        }

        if (index === rawPathPoints.length - 2) {
            return alignRouteEndpoint(targetPoint, data?.targetPortSide as PortSide | undefined, point);
        }

        return point;
    });
    const labelPoint = (typeof data?.labelX === 'number' && typeof data?.labelY === 'number')
        ? { x: data.labelX, y: data.labelY }
        : getBestStrictLabelPoint(pathPoints);

    return {
        pathPoints,
        edgePath: buildPolylinePath(pathPoints),
        labelPoint,
    };
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
    const boardMode = data?.boardMode as BoardMode | undefined;
    const isStrictGrid = boardMode === 'strict-grid';

    const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 20,
    });

    const strictRoute = useMemo(
        () => getStrictRouteData(data, sourceX, sourceY, targetX, targetY),
        [data, sourceX, sourceY, targetX, targetY]
    );

    const hasCustomPosition = data?.customX !== undefined && data?.customY !== undefined;
    const routeMode = data?.routeMode as RouteMode | undefined;
    const routeOffsetX = typeof data?.routeOffsetX === 'number' ? data.routeOffsetX : 0;
    const routeOffsetY = typeof data?.routeOffsetY === 'number' ? data.routeOffsetY : 0;
    const legacyLabelPoint = resolveRoutePoint(
        routeMode,
        routeOffsetX,
        routeOffsetY,
        sourceX,
        sourceY,
        targetX,
        targetY,
        hasCustomPosition ? data.customX : smoothLabelX,
        hasCustomPosition ? data.customY : smoothLabelY,
    );

    const edgePath = isStrictGrid ? strictRoute.edgePath : (buildLegacyRoutePath(routeMode, legacyLabelPoint.x, legacyLabelPoint.y, sourceX, sourceY, targetX, targetY) || smoothPath);
    const currentLabelPoint = isStrictGrid ? strictRoute.labelPoint : legacyLabelPoint;

    const onMouseDown = useCallback(
        (evt: React.MouseEvent) => {
            evt.stopPropagation();
            const startX = evt.clientX;
            const startY = evt.clientY;
            const initialLabelX = currentLabelPoint.x;
            const initialLabelY = currentLabelPoint.y;

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
                        snapCoordinateToGrid(nextX),
                    ];
                    const yCandidates = [
                        sourceY,
                        targetY,
                        (sourceY + targetY) / 2,
                        snapCoordinateToGrid(nextY),
                    ];

                    nextX = snapToCandidates(nextX, xCandidates);
                    nextY = snapToCandidates(nextY, yCandidates);
                }

                setEdges((eds) =>
                    eds.map((e) => {
                        if (e.id !== id) {
                            return e;
                        }

                        if (isStrictGrid) {
                            return {
                                ...e,
                                data: {
                                    ...e.data,
                                    routeAnchorX: nextX,
                                    routeAnchorY: nextY,
                                    labelX: nextX,
                                    labelY: nextY,
                                },
                            };
                        }

                        const routeState = buildLegacyRouteState(nextX, nextY, sourceX, sourceY, targetX, targetY);
                        return {
                            ...e,
                            data: {
                                ...e.data,
                                ...routeState,
                                customX: nextX,
                                customY: nextY,
                            },
                        };
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
        [id, currentLabelPoint.x, currentLabelPoint.y, data?.snapEnabled, getViewport, setEdges, sourceX, sourceY, targetX, targetY, isStrictGrid]
    );

    const onDoubleClick = (evt: React.MouseEvent) => {
        evt.stopPropagation();
        setEdges((eds) =>
            eds.map((e) => {
                if (e.id !== id) {
                    return e;
                }

                const nextData = { ...e.data };
                delete nextData.labelX;
                delete nextData.labelY;
                delete nextData.routeAnchorX;
                delete nextData.routeAnchorY;

                if (!isStrictGrid) {
                    delete nextData.routeMode;
                    delete nextData.routeOffsetX;
                    delete nextData.routeOffsetY;
                    delete nextData.customX;
                    delete nextData.customY;
                }

                return { ...e, data: nextData };
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
            <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} interactionWidth={interactionWidth} />

            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${currentLabelPoint.x}px, ${currentLabelPoint.y}px)`,
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
                        title={isStrictGrid
                            ? (data?.snapEnabled
                                ? 'Drag to reposition the relationship label on the grid. Double-click to reset it.'
                                : 'Drag to reposition the relationship label. Double-click to reset it.')
                            : (data?.snapEnabled
                                ? 'Drag to reroute line with snapping and smart routing. Double-click to reset label position.'
                                : 'Drag to reroute line with smart routing. Double-click to reset label position.')}
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
