import type { Edge, Node } from 'reactflow';

export type BoardMode = 'legacy' | 'strict-grid';
export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface StrictGridPoint {
    x: number;
    y: number;
}

export interface StrictGridPortSlot {
    id: string;
    side: PortSide;
    slotIndex: number;
    offset: number;
}

export interface StrictGridRoute {
    sourcePortId: string;
    targetPortId: string;
    sourceSide: PortSide;
    targetSide: PortSide;
    points: StrictGridPoint[];
}

interface StrictGridPortAssignment {
    route: StrictGridRoute;
}

type StrictGridPortPair = {
    source: StrictGridPortSlot & StrictGridPoint;
    target: StrictGridPortSlot & StrictGridPoint;
    score: number;
};

export const BOARD_GRID_SIZE = 24;
export const NODE_FRAME_GRID_SIZE = BOARD_GRID_SIZE * 2;
export const MIN_NODE_WIDTH = 288;
export const MIN_NODE_HEIGHT = 192;
const PORT_MARGIN = BOARD_GRID_SIZE;

export const snapCoordinateToGrid = (value: number, gridSize = BOARD_GRID_SIZE) =>
    Math.round(value / gridSize) * gridSize;

export const snapNodeFrameSize = (value: number, minimum: number) =>
    Math.max(minimum, Math.ceil(value / NODE_FRAME_GRID_SIZE) * NODE_FRAME_GRID_SIZE);

export const normalizeNodeFrame = (width: number, height: number) => ({
    width: snapNodeFrameSize(width, MIN_NODE_WIDTH),
    height: snapNodeFrameSize(height, MIN_NODE_HEIGHT),
});

export const calculateNodeFrame = (summary: string, fullText: string, isExpanded: boolean) => {
    const content = isExpanded ? (fullText || summary) : summary;
    const charCount = content.length;

    let width = 320;
    let height = 180;

    const lines = Math.ceil(charCount / 40);
    const estimatedLines = Math.min(lines, isExpanded ? 30 : 8);

    height = Math.max(180, 100 + estimatedLines * 18);

    if (charCount > 300) {
        width = Math.min(500, 320 + Math.min(charCount - 300, 180));
    }

    return normalizeNodeFrame(width, height);
};

const clampPortOffset = (offset: number, length: number) =>
    Math.max(PORT_MARGIN, Math.min(length - PORT_MARGIN, offset));

const getAxisSlots = (length: number) => {
    if (length <= PORT_MARGIN * 2) {
        return [snapCoordinateToGrid(length / 2)];
    }

    const slots: number[] = [];
    for (let offset = PORT_MARGIN; offset <= length - PORT_MARGIN; offset += BOARD_GRID_SIZE) {
        slots.push(clampPortOffset(offset, length));
    }

    if (slots.length === 0) {
        return [snapCoordinateToGrid(length / 2)];
    }

    return Array.from(new Set(slots));
};

export const getPortSlotsForDimensions = (width: number, height: number): Record<PortSide, StrictGridPortSlot[]> => {
    const topBottomSlots = getAxisSlots(width);
    const leftRightSlots = getAxisSlots(height);

    return {
        top: topBottomSlots.map((offset, slotIndex) => ({ id: `port-top-${slotIndex}`, side: 'top', slotIndex, offset })),
        bottom: topBottomSlots.map((offset, slotIndex) => ({ id: `port-bottom-${slotIndex}`, side: 'bottom', slotIndex, offset })),
        left: leftRightSlots.map((offset, slotIndex) => ({ id: `port-left-${slotIndex}`, side: 'left', slotIndex, offset })),
        right: leftRightSlots.map((offset, slotIndex) => ({ id: `port-right-${slotIndex}`, side: 'right', slotIndex, offset })),
    };
};

export const getNodeDimensions = (node: Node): { width: number; height: number } => {
    const style = node.style || {};
    const width = (style.width as number) || 320;
    const height = (style.height as number) || 180;
    return normalizeNodeFrame(width, height);
};

export const getNodeCenter = (node: Node) => {
    const { width, height } = getNodeDimensions(node);

    return {
        x: node.position.x + width / 2,
        y: node.position.y + height / 2,
    };
};

export const getAbsolutePortSlots = (node: Node): Record<PortSide, Array<StrictGridPortSlot & StrictGridPoint>> => {
    const { width, height } = getNodeDimensions(node);
    const slots = getPortSlotsForDimensions(width, height);

    return {
        top: slots.top.map((slot) => ({ ...slot, x: node.position.x + slot.offset, y: node.position.y })),
        bottom: slots.bottom.map((slot) => ({ ...slot, x: node.position.x + slot.offset, y: node.position.y + height })),
        left: slots.left.map((slot) => ({ ...slot, x: node.position.x, y: node.position.y + slot.offset })),
        right: slots.right.map((slot) => ({ ...slot, x: node.position.x + width, y: node.position.y + slot.offset })),
    };
};

export const flattenPortSlots = (slots: Record<PortSide, Array<StrictGridPortSlot & StrictGridPoint>>) =>
    [...slots.top, ...slots.right, ...slots.bottom, ...slots.left];

export const getPortById = (node: Node, portId?: string | null) => {
    if (!portId) {
        return null;
    }

    return flattenPortSlots(getAbsolutePortSlots(node)).find((slot) => slot.id === portId) || null;
};

const movePoint = (point: StrictGridPoint, side: PortSide, distance = BOARD_GRID_SIZE): StrictGridPoint => {
    switch (side) {
        case 'top':
            return { x: point.x, y: point.y - distance };
        case 'bottom':
            return { x: point.x, y: point.y + distance };
        case 'left':
            return { x: point.x - distance, y: point.y };
        case 'right':
            return { x: point.x + distance, y: point.y };
    }
};

const getPreferredSides = (from: StrictGridPoint, to: StrictGridPoint, outgoing: boolean): PortSide[] => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const horizontalDominant = Math.abs(dx) >= Math.abs(dy);

    if (horizontalDominant) {
        if (outgoing) {
            return dx >= 0 ? ['right', 'top', 'bottom', 'left'] : ['left', 'top', 'bottom', 'right'];
        }

        return dx >= 0 ? ['left', 'top', 'bottom', 'right'] : ['right', 'top', 'bottom', 'left'];
    }

    if (outgoing) {
        return dy >= 0 ? ['bottom', 'right', 'left', 'top'] : ['top', 'right', 'left', 'bottom'];
    }

    return dy >= 0 ? ['top', 'left', 'right', 'bottom'] : ['bottom', 'left', 'right', 'top'];
};

const getSidePenalty = (side: PortSide, preferredSides: PortSide[]) => {
    const index = preferredSides.indexOf(side);
    return index === -1 ? BOARD_GRID_SIZE * 20 : index * BOARD_GRID_SIZE * 6;
};

const getPreferredSidePairs = (sourceNode: Node, targetNode: Node): Array<[PortSide, PortSide]> => {
    const sourceDimensions = getNodeDimensions(sourceNode);
    const targetDimensions = getNodeDimensions(targetNode);

    const sourceLeft = sourceNode.position.x;
    const sourceRight = sourceNode.position.x + sourceDimensions.width;
    const sourceTop = sourceNode.position.y;
    const sourceBottom = sourceNode.position.y + sourceDimensions.height;

    const targetLeft = targetNode.position.x;
    const targetRight = targetNode.position.x + targetDimensions.width;
    const targetTop = targetNode.position.y;
    const targetBottom = targetNode.position.y + targetDimensions.height;

    const horizontalGap = targetLeft >= sourceRight
        ? targetLeft - sourceRight
        : (sourceLeft >= targetRight ? sourceLeft - targetRight : -Math.min(sourceRight, targetRight) + Math.max(sourceLeft, targetLeft));
    const verticalGap = targetTop >= sourceBottom
        ? targetTop - sourceBottom
        : (sourceTop >= targetBottom ? sourceTop - targetBottom : -Math.min(sourceBottom, targetBottom) + Math.max(sourceTop, targetTop));

    const sourceCenter = getNodeCenter(sourceNode);
    const targetCenter = getNodeCenter(targetNode);
    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;

    const horizontalPair: [PortSide, PortSide] = dx >= 0 ? ['right', 'left'] : ['left', 'right'];
    const verticalPair: [PortSide, PortSide] = dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];

    if (horizontalGap >= 0 && verticalGap >= 0) {
        return horizontalGap >= verticalGap
            ? [horizontalPair, verticalPair]
            : [verticalPair, horizontalPair];
    }

    if (horizontalGap >= 0) {
        return [horizontalPair, verticalPair];
    }

    if (verticalGap >= 0) {
        return [verticalPair, horizontalPair];
    }

    return Math.abs(dx) >= Math.abs(dy)
        ? [horizontalPair, verticalPair]
        : [verticalPair, horizontalPair];
};

const getPairPenalty = (
    sourceSide: PortSide,
    targetSide: PortSide,
    preferredPairs: Array<[PortSide, PortSide]>,
) => {
    const pairIndex = preferredPairs.findIndex(([preferredSourceSide, preferredTargetSide]) =>
        preferredSourceSide === sourceSide && preferredTargetSide === targetSide
    );

    if (pairIndex === 0) {
        return 0;
    }

    if (pairIndex === 1) {
        return BOARD_GRID_SIZE * 8;
    }

    const isOpposingPair =
        (sourceSide === 'left' && targetSide === 'right') ||
        (sourceSide === 'right' && targetSide === 'left') ||
        (sourceSide === 'top' && targetSide === 'bottom') ||
        (sourceSide === 'bottom' && targetSide === 'top');

    return isOpposingPair ? BOARD_GRID_SIZE * 18 : BOARD_GRID_SIZE * 30;
};

const getCenterSlotPenalty = (slotIndex: number, totalSlots: number) => {
    if (totalSlots <= 1) {
        return 0;
    }

    const centerIndex = (totalSlots - 1) / 2;
    return Math.round(Math.abs(slotIndex - centerIndex)) * BOARD_GRID_SIZE * 2;
};

const getOverflowSlotPenalty = (slotIndex: number, totalSlots: number) => {
    if (totalSlots <= 3) {
        return 0;
    }

    const distanceToEdge = Math.min(slotIndex, totalSlots - 1 - slotIndex);
    if (distanceToEdge === 0) {
        return BOARD_GRID_SIZE * 8;
    }

    if (distanceToEdge === 1 && totalSlots >= 6) {
        return BOARD_GRID_SIZE * 2;
    }

    return 0;
};

const getAlignmentPenalty = (
    slot: StrictGridPortSlot & StrictGridPoint,
    node: Node,
    targetPoint: StrictGridPoint,
) => {
    const { width, height } = getNodeDimensions(node);
    const desiredOffset = slot.side === 'left' || slot.side === 'right'
        ? clampPortOffset(targetPoint.y - node.position.y, height)
        : clampPortOffset(targetPoint.x - node.position.x, width);

    return Math.round(Math.abs(slot.offset - desiredOffset) / BOARD_GRID_SIZE) * (BOARD_GRID_SIZE / 2);
};

const compactRoutePoints = (points: StrictGridPoint[]) => {
    const compacted: StrictGridPoint[] = [];

    points.forEach((point) => {
        const snappedPoint = { x: snapCoordinateToGrid(point.x), y: snapCoordinateToGrid(point.y) };
        const last = compacted[compacted.length - 1];
        if (last && last.x === snappedPoint.x && last.y === snappedPoint.y) {
            return;
        }

        compacted.push(snappedPoint);
    });

    return compacted.filter((point, index, arr) => {
        const prev = arr[index - 1];
        const next = arr[index + 1];
        if (!prev || !next) {
            return true;
        }

        const sameVertical = prev.x === point.x && point.x === next.x;
        const sameHorizontal = prev.y === point.y && point.y === next.y;
        return !sameVertical && !sameHorizontal;
    });
};

const buildOrthogonalPoints = (
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
): StrictGridPoint[] => {
    const startStub = movePoint(sourcePort, sourcePort.side);
    const endStub = movePoint(targetPort, targetPort.side);
    const points: StrictGridPoint[] = [startStub];

    if (startStub.x === endStub.x || startStub.y === endStub.y) {
        points.push(endStub);
        return compactRoutePoints(points);
    }

    if ((sourcePort.side === 'left' || sourcePort.side === 'right') &&
        (targetPort.side === 'left' || targetPort.side === 'right')) {
        const midX = snapCoordinateToGrid((startStub.x + endStub.x) / 2);
        points.push({ x: midX, y: startStub.y }, { x: midX, y: endStub.y }, endStub);
        return compactRoutePoints(points);
    }

    if ((sourcePort.side === 'top' || sourcePort.side === 'bottom') &&
        (targetPort.side === 'top' || targetPort.side === 'bottom')) {
        const midY = snapCoordinateToGrid((startStub.y + endStub.y) / 2);
        points.push({ x: startStub.x, y: midY }, { x: endStub.x, y: midY }, endStub);
        return compactRoutePoints(points);
    }

    if (sourcePort.side === 'left' || sourcePort.side === 'right') {
        points.push({ x: endStub.x, y: startStub.y }, endStub);
        return compactRoutePoints(points);
    }

    points.push({ x: startStub.x, y: endStub.y }, endStub);
    return compactRoutePoints(points);
};

const getNodeBounds = (node: Node) => {
    const { width, height } = getNodeDimensions(node);
    return {
        left: node.position.x,
        right: node.position.x + width,
        top: node.position.y,
        bottom: node.position.y + height,
    };
};

const buildFallbackFacingRoute = (
    sourceNode: Node,
    targetNode: Node,
    preferredPairs: Array<[PortSide, PortSide]>,
): StrictGridRoute | null => {
    const primaryPair = preferredPairs[0];
    if (!primaryPair) {
        return null;
    }

    const sourcePortsBySide = getAbsolutePortSlots(sourceNode);
    const targetPortsBySide = getAbsolutePortSlots(targetNode);
    const sourcePorts = sourcePortsBySide[primaryPair[0]];
    const targetPorts = targetPortsBySide[primaryPair[1]];
    if (sourcePorts.length === 0 || targetPorts.length === 0) {
        return null;
    }

    const sourcePort = sourcePorts[Math.floor(sourcePorts.length / 2)];
    const targetPort = targetPorts[Math.floor(targetPorts.length / 2)];
    const sourceBounds = getNodeBounds(sourceNode);
    const targetBounds = getNodeBounds(targetNode);
    const points: StrictGridPoint[] = [];

    if (
        (primaryPair[0] === 'right' && primaryPair[1] === 'left') ||
        (primaryPair[0] === 'left' && primaryPair[1] === 'right')
    ) {
        const corridorX = primaryPair[0] === 'right'
            ? snapCoordinateToGrid((sourceBounds.right + targetBounds.left) / 2)
            : snapCoordinateToGrid((sourceBounds.left + targetBounds.right) / 2);
        points.push(
            movePoint(sourcePort, sourcePort.side),
            { x: corridorX, y: movePoint(sourcePort, sourcePort.side).y },
            { x: corridorX, y: movePoint(targetPort, targetPort.side).y },
            movePoint(targetPort, targetPort.side),
        );
    } else if (
        (primaryPair[0] === 'bottom' && primaryPair[1] === 'top') ||
        (primaryPair[0] === 'top' && primaryPair[1] === 'bottom')
    ) {
        const corridorY = primaryPair[0] === 'bottom'
            ? snapCoordinateToGrid((sourceBounds.bottom + targetBounds.top) / 2)
            : snapCoordinateToGrid((sourceBounds.top + targetBounds.bottom) / 2);
        points.push(
            movePoint(sourcePort, sourcePort.side),
            { x: movePoint(sourcePort, sourcePort.side).x, y: corridorY },
            { x: movePoint(targetPort, targetPort.side).x, y: corridorY },
            movePoint(targetPort, targetPort.side),
        );
    } else {
        return null;
    }

    return {
        sourcePortId: sourcePort.id,
        targetPortId: targetPort.id,
        sourceSide: sourcePort.side,
        targetSide: targetPort.side,
        points: compactRoutePoints(points),
    };
};

export const buildStrictGridRoute = (
    sourceNode: Node,
    targetNode: Node,
    preferredSourcePortId?: string | null,
    preferredTargetPortId?: string | null,
): StrictGridRoute => {
    const sourceCenter = getNodeCenter(sourceNode);
    const targetCenter = getNodeCenter(targetNode);
    const sourcePreferredSides = getPreferredSides(sourceCenter, targetCenter, true);
    const targetPreferredSides = getPreferredSides(targetCenter, sourceCenter, false);
    const preferredSidePairs = getPreferredSidePairs(sourceNode, targetNode);
    const sourceAbsoluteSlots = getAbsolutePortSlots(sourceNode);
    const targetAbsoluteSlots = getAbsolutePortSlots(targetNode);
    const sourcePorts = flattenPortSlots(sourceAbsoluteSlots);
    const targetPorts = flattenPortSlots(targetAbsoluteSlots);

    const preferredSourcePort = sourcePorts.find((slot) => slot.id === preferredSourcePortId);
    const preferredTargetPort = targetPorts.find((slot) => slot.id === preferredTargetPortId);

    const primaryPair = preferredSidePairs[0];
    const primarySourceSide = primaryPair?.[0];
    const primaryTargetSide = primaryPair?.[1];
    const sourceCandidates = preferredSourcePort
        ? [preferredSourcePort]
        : (primarySourceSide ? sourceAbsoluteSlots[primarySourceSide] : sourcePorts);
    const targetCandidates = preferredTargetPort
        ? [preferredTargetPort]
        : (primaryTargetSide ? targetAbsoluteSlots[primaryTargetSide] : targetPorts);

    let bestPair: { source: StrictGridPortSlot & StrictGridPoint; target: StrictGridPortSlot & StrictGridPoint; score: number } | null = null;

    sourceCandidates.forEach((sourcePort) => {
        targetCandidates.forEach((targetPort) => {
            const distance = Math.abs(targetPort.x - sourcePort.x) + Math.abs(targetPort.y - sourcePort.y);
            const sourceSideSlotCount = sourceAbsoluteSlots[sourcePort.side].length;
            const targetSideSlotCount = targetAbsoluteSlots[targetPort.side].length;
            const score =
                distance +
                getSidePenalty(sourcePort.side, sourcePreferredSides) +
                getSidePenalty(targetPort.side, targetPreferredSides) +
                getPairPenalty(sourcePort.side, targetPort.side, preferredSidePairs) +
                Math.abs(sourcePort.slotIndex - targetPort.slotIndex) * BOARD_GRID_SIZE +
                getCenterSlotPenalty(sourcePort.slotIndex, sourceSideSlotCount) +
                getCenterSlotPenalty(targetPort.slotIndex, targetSideSlotCount) +
                getOverflowSlotPenalty(sourcePort.slotIndex, sourceSideSlotCount) +
                getOverflowSlotPenalty(targetPort.slotIndex, targetSideSlotCount) +
                getAlignmentPenalty(sourcePort, sourceNode, targetCenter) +
                getAlignmentPenalty(targetPort, targetNode, sourceCenter);

            if (!bestPair || score < bestPair.score) {
                bestPair = { source: sourcePort, target: targetPort, score };
            }
        });
    });

    const fallbackSource = sourcePorts[0];
    const fallbackTarget = targetPorts[0];
    const secondaryPair = preferredSidePairs[1];
    const secondarySourceCandidates = !bestPair && !preferredSourcePort && secondaryPair
        ? sourceAbsoluteSlots[secondaryPair[0]]
        : [];
    const secondaryTargetCandidates = !bestPair && !preferredTargetPort && secondaryPair
        ? targetAbsoluteSlots[secondaryPair[1]]
        : [];

    secondarySourceCandidates.forEach((sourcePort) => {
        secondaryTargetCandidates.forEach((targetPort) => {
            const distance = Math.abs(targetPort.x - sourcePort.x) + Math.abs(targetPort.y - sourcePort.y);
            const sourceSideSlotCount = sourceAbsoluteSlots[sourcePort.side].length;
            const targetSideSlotCount = targetAbsoluteSlots[targetPort.side].length;
            const score =
                distance +
                getSidePenalty(sourcePort.side, sourcePreferredSides) +
                getSidePenalty(targetPort.side, targetPreferredSides) +
                getPairPenalty(sourcePort.side, targetPort.side, preferredSidePairs) +
                Math.abs(sourcePort.slotIndex - targetPort.slotIndex) * BOARD_GRID_SIZE +
                getCenterSlotPenalty(sourcePort.slotIndex, sourceSideSlotCount) +
                getCenterSlotPenalty(targetPort.slotIndex, targetSideSlotCount) +
                getOverflowSlotPenalty(sourcePort.slotIndex, sourceSideSlotCount) +
                getOverflowSlotPenalty(targetPort.slotIndex, targetSideSlotCount) +
                getAlignmentPenalty(sourcePort, sourceNode, targetCenter) +
                getAlignmentPenalty(targetPort, targetNode, sourceCenter);

            if (!bestPair || score < bestPair.score) {
                bestPair = { source: sourcePort, target: targetPort, score };
            }
        });
    });

    const resolvedPair = bestPair || {
        source: fallbackSource,
        target: fallbackTarget,
        score: 0,
    };

    const resolvedRoute = {
        sourcePortId: resolvedPair.source.id,
        targetPortId: resolvedPair.target.id,
        sourceSide: resolvedPair.source.side,
        targetSide: resolvedPair.target.side,
        points: buildOrthogonalPoints(resolvedPair.source, resolvedPair.target),
    };

    if (resolvedRoute.points.length < 2) {
        return buildFallbackFacingRoute(sourceNode, targetNode, preferredSidePairs) || resolvedRoute;
    }

    return resolvedRoute;
};

const getPortPairScore = (
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
    sourceNode: Node,
    targetNode: Node,
    preferredPairs: Array<[PortSide, PortSide]>,
    sourcePreferredSides: PortSide[],
    targetPreferredSides: PortSide[],
    sourceAbsoluteSlots: Record<PortSide, Array<StrictGridPortSlot & StrictGridPoint>>,
    targetAbsoluteSlots: Record<PortSide, Array<StrictGridPortSlot & StrictGridPoint>>,
    sourceOccupancy: Set<string>,
    targetOccupancy: Set<string>,
) => {
    const distance = Math.abs(targetPort.x - sourcePort.x) + Math.abs(targetPort.y - sourcePort.y);
    const sourceSideSlotCount = sourceAbsoluteSlots[sourcePort.side].length;
    const targetSideSlotCount = targetAbsoluteSlots[targetPort.side].length;

    return (
        distance +
        getSidePenalty(sourcePort.side, sourcePreferredSides) +
        getSidePenalty(targetPort.side, targetPreferredSides) +
        getPairPenalty(sourcePort.side, targetPort.side, preferredPairs) +
        Math.abs(sourcePort.slotIndex - targetPort.slotIndex) * BOARD_GRID_SIZE +
        getCenterSlotPenalty(sourcePort.slotIndex, sourceSideSlotCount) +
        getCenterSlotPenalty(targetPort.slotIndex, targetSideSlotCount) +
        getOverflowSlotPenalty(sourcePort.slotIndex, sourceSideSlotCount) +
        getOverflowSlotPenalty(targetPort.slotIndex, targetSideSlotCount) +
        getAlignmentPenalty(sourcePort, sourceNode, getNodeCenter(targetNode)) +
        getAlignmentPenalty(targetPort, targetNode, getNodeCenter(sourceNode)) +
        (sourceOccupancy.has(sourcePort.id) ? BOARD_GRID_SIZE * 24 : 0) +
        (targetOccupancy.has(targetPort.id) ? BOARD_GRID_SIZE * 24 : 0)
    );
};

export const assignStrictGridPorts = (
    edges: Edge[],
    nodes: Node[],
) => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const occupancy = new Map<string, Set<string>>();
    const assignments = new Map<string, StrictGridPortAssignment>();

    const sortedEdges = [...edges].sort((left, right) => {
        const leftSource = nodeMap.get(left.source);
        const leftTarget = nodeMap.get(left.target);
        const rightSource = nodeMap.get(right.source);
        const rightTarget = nodeMap.get(right.target);
        if (!leftSource || !leftTarget || !rightSource || !rightTarget) {
            return 0;
        }

        const leftDistance = Math.abs(getNodeCenter(leftSource).x - getNodeCenter(leftTarget).x) + Math.abs(getNodeCenter(leftSource).y - getNodeCenter(leftTarget).y);
        const rightDistance = Math.abs(getNodeCenter(rightSource).x - getNodeCenter(rightTarget).x) + Math.abs(getNodeCenter(rightSource).y - getNodeCenter(rightTarget).y);
        return leftDistance - rightDistance;
    });

    sortedEdges.forEach((edge) => {
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (!sourceNode || !targetNode) {
            return;
        }

        if (edge.sourceHandle && edge.targetHandle) {
            const lockedRoute = buildStrictGridRoute(sourceNode, targetNode, edge.sourceHandle, edge.targetHandle);
            assignments.set(edge.id, { route: lockedRoute });
            if (!occupancy.has(edge.source)) occupancy.set(edge.source, new Set<string>());
            if (!occupancy.has(edge.target)) occupancy.set(edge.target, new Set<string>());
            occupancy.get(edge.source)?.add(lockedRoute.sourcePortId);
            occupancy.get(edge.target)?.add(lockedRoute.targetPortId);
            return;
        }

        const sourceCenter = getNodeCenter(sourceNode);
        const targetCenter = getNodeCenter(targetNode);
        const sourcePreferredSides = getPreferredSides(sourceCenter, targetCenter, true);
        const targetPreferredSides = getPreferredSides(targetCenter, sourceCenter, false);
        const preferredPairs = getPreferredSidePairs(sourceNode, targetNode);
        const sourceAbsoluteSlots = getAbsolutePortSlots(sourceNode);
        const targetAbsoluteSlots = getAbsolutePortSlots(targetNode);
        const sourceOccupancy = occupancy.get(edge.source) || new Set<string>();
        const targetOccupancy = occupancy.get(edge.target) || new Set<string>();

        let best: StrictGridPortPair | null = null;

        const candidatePairs = preferredPairs.length > 0 ? preferredPairs : [['right', 'left'] as [PortSide, PortSide]];
        candidatePairs.forEach(([sourceSide, targetSide], pairIndex) => {
            sourceAbsoluteSlots[sourceSide].forEach((sourcePort) => {
                targetAbsoluteSlots[targetSide].forEach((targetPort) => {
                    const score = getPortPairScore(
                        sourcePort,
                        targetPort,
                        sourceNode,
                        targetNode,
                        preferredPairs,
                        sourcePreferredSides,
                        targetPreferredSides,
                        sourceAbsoluteSlots,
                        targetAbsoluteSlots,
                        sourceOccupancy,
                        targetOccupancy,
                    ) + pairIndex * BOARD_GRID_SIZE * 8;

                    if (!best || score < best.score) {
                        best = { source: sourcePort, target: targetPort, score };
                    }
                });
            });
        });

        let route: StrictGridRoute;
        if (best) {
            const resolvedBest = best as StrictGridPortPair;
            route = {
                sourcePortId: resolvedBest.source.id,
                targetPortId: resolvedBest.target.id,
                sourceSide: resolvedBest.source.side,
                targetSide: resolvedBest.target.side,
                points: buildOrthogonalPoints(resolvedBest.source, resolvedBest.target),
            };
        } else {
            route = buildStrictGridRoute(sourceNode, targetNode);
        }

        assignments.set(edge.id, { route });
        if (!occupancy.has(edge.source)) occupancy.set(edge.source, new Set<string>());
        if (!occupancy.has(edge.target)) occupancy.set(edge.target, new Set<string>());
        occupancy.get(edge.source)?.add(route.sourcePortId);
        occupancy.get(edge.target)?.add(route.targetPortId);
    });

    return assignments;
};
