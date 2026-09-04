import type { Edge, Node } from 'reactflow';
import { ENTITY_TAG_PATTERN } from '../utils/entityTags';

export type BoardMode = 'legacy' | 'strict-grid';
export type PortSide = 'top' | 'right' | 'bottom' | 'left';

export interface StrictGridPoint {
    x: number;
    y: number;
}

export interface StrictGridRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export type StrictGridRouteStrategy = 'direct' | 'maze';

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
    strategy: StrictGridRouteStrategy;
    labelPoint?: StrictGridPoint;
    labelRect?: StrictGridRect;
}

interface StrictGridPortAssignment {
    route: StrictGridRoute;
}

interface StrictGridRouteSegment {
    axis: 'horizontal' | 'vertical';
    lane: number;
    start: number;
    end: number;
}

export const BOARD_GRID_SIZE = 24;
export const NODE_FRAME_GRID_SIZE = BOARD_GRID_SIZE * 2;
export const MIN_NODE_WIDTH = 288;
export const MIN_NODE_HEIGHT = 192;
// Edit mode borrows room for the image panel, textarea, and action footer;
// a node entering edit never stays smaller than this frame.
export const MIN_NODE_EDIT_WIDTH = 336;
export const MIN_NODE_EDIT_HEIGHT = 432;
export const NODE_IMAGE_PREVIEW_HEIGHT = 96;
const PORT_MARGIN = BOARD_GRID_SIZE;
const NODE_TEXT_HORIZONTAL_CHROME = 72;
const NODE_TEXT_AVERAGE_CHAR_WIDTH = 6.8;
const NODE_COLLAPSED_TARGET_LINES = 5.6;
const NODE_COLLAPSED_FIT_MAX_WIDTH = 480;
export const NODE_AUTO_MAX_WIDTH = 576;
const HIGHLIGHT_TOKEN_PATTERN = ENTITY_TAG_PATTERN;
const ROUTE_OBSTACLE_PADDING = BOARD_GRID_SIZE;
const ROUTE_SEARCH_MARGIN = BOARD_GRID_SIZE * 6;
const ROUTE_TURN_PENALTY = BOARD_GRID_SIZE * 2;
const ROUTE_OBSTACLE_PENALTY = BOARD_GRID_SIZE * 1200;
const ROUTE_LABEL_COLLISION_PENALTY = BOARD_GRID_SIZE * 600;
const ROUTE_REUSED_LANE_PENALTY = BOARD_GRID_SIZE * 18;
const ROUTE_LANE_OVERLAP_PENALTY = BOARD_GRID_SIZE * 900;
const ROUTE_NEAR_LANE_PENALTY = BOARD_GRID_SIZE * 180;
const ROUTE_LANE_CLEARANCE = BOARD_GRID_SIZE;
const ROUTE_STALE_HANDLE_PENALTY = BOARD_GRID_SIZE * 900;
const ROUTE_LABEL_WIDTH = BOARD_GRID_SIZE * 5;
const ROUTE_LABEL_HEIGHT = BOARD_GRID_SIZE * 2;
const ROUTE_LABEL_CLEARANCE = BOARD_GRID_SIZE;
const ROUTE_MAX_MAZE_ITERATIONS = 6000;
const ROUTE_CORRIDOR_OFFSETS = [
    0,
    -ROUTE_LANE_CLEARANCE,
    ROUTE_LANE_CLEARANCE,
    -ROUTE_LANE_CLEARANCE * 2,
    ROUTE_LANE_CLEARANCE * 2,
    -ROUTE_LANE_CLEARANCE * 3,
    ROUTE_LANE_CLEARANCE * 3,
];

export const snapCoordinateToGrid = (value: number, gridSize = BOARD_GRID_SIZE) =>
    Math.round(value / gridSize) * gridSize;

export const snapNodeFrameSize = (value: number, minimum: number) =>
    Math.max(minimum, Math.ceil(value / NODE_FRAME_GRID_SIZE) * NODE_FRAME_GRID_SIZE);

export const normalizeNodeFrame = (width: number, height: number) => ({
    width: snapNodeFrameSize(width, MIN_NODE_WIDTH),
    height: snapNodeFrameSize(height, MIN_NODE_HEIGHT),
});

const estimateNodeTextUnits = (content: string, highlightTokenCount: number) => {
    const readableContent = content.replace(HIGHLIGHT_TOKEN_PATTERN, '$2');
    const longestWordLength = readableContent
        .split(/\s+/)
        .reduce((longest, word) => Math.max(longest, word.length), 0);
    const longWordPressure = Math.max(0, longestWordLength - 18) * 0.7;

    return readableContent.length + (highlightTokenCount * 14) + longWordPressure;
};

export const calculateNodeFrame = (summary: string, fullText: string, isExpanded: boolean, hasImages = false) => {
    const content = isExpanded ? (fullText || summary) : summary;
    const charCount = content.length;
    const estimatedLineHeight = 20;
    const highlightTokenCount = (content.match(HIGHLIGHT_TOKEN_PATTERN) || []).length;
    const estimatedTextUnits = estimateNodeTextUnits(content, highlightTokenCount);

    let width = 320;
    let height = 180;

    if (charCount > 300) {
        width = Math.min(500, 320 + Math.min(charCount - 300, 180));
    }

    if (!isExpanded && estimatedTextUnits > 0) {
        const widthToReduceCollapsedWraps =
            NODE_TEXT_HORIZONTAL_CHROME +
            ((estimatedTextUnits / NODE_COLLAPSED_TARGET_LINES) * NODE_TEXT_AVERAGE_CHAR_WIDTH);
        width = Math.max(width, Math.min(NODE_COLLAPSED_FIT_MAX_WIDTH, widthToReduceCollapsedWraps));
    }

    if (highlightTokenCount > 0) {
        width += Math.min(48, highlightTokenCount * 8);
    }

    width = Math.min(width, NODE_AUTO_MAX_WIDTH);

    const estimatedLineCapacity = Math.max(32, Math.floor((width - NODE_TEXT_HORIZONTAL_CHROME) / NODE_TEXT_AVERAGE_CHAR_WIDTH));
    const lines = isExpanded
        ? Math.ceil(charCount / 40)
        : Math.ceil(estimatedTextUnits / estimatedLineCapacity);
    const estimatedLines = Math.min(lines, isExpanded ? 30 : 8);

    height = Math.max(180, 104 + estimatedLines * estimatedLineHeight);

    if (hasImages) {
        height += NODE_IMAGE_PREVIEW_HEIGHT;
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

const isVerticalPortSide = (side: PortSide) => side === 'top' || side === 'bottom';
const isHorizontalPortSide = (side: PortSide) => side === 'left' || side === 'right';

const getAxisGap = (sourceNode: Node, targetNode: Node) => {
    const sourceBounds = getNodeBounds(sourceNode);
    const targetBounds = getNodeBounds(targetNode);
    const horizontalGap = targetBounds.left >= sourceBounds.right
        ? targetBounds.left - sourceBounds.right
        : (sourceBounds.left >= targetBounds.right ? sourceBounds.left - targetBounds.right : 0);
    const verticalGap = targetBounds.top >= sourceBounds.bottom
        ? targetBounds.top - sourceBounds.bottom
        : (sourceBounds.top >= targetBounds.bottom ? sourceBounds.top - targetBounds.bottom : 0);
    const horizontalOverlap = Math.min(sourceBounds.right, targetBounds.right) - Math.max(sourceBounds.left, targetBounds.left);
    const verticalOverlap = Math.min(sourceBounds.bottom, targetBounds.bottom) - Math.max(sourceBounds.top, targetBounds.top);

    return {
        horizontalGap,
        verticalGap,
        horizontalOverlap: Math.max(0, horizontalOverlap),
        verticalOverlap: Math.max(0, verticalOverlap),
    };
};

const getStrongAxisPreference = (sourceNode: Node, targetNode: Node): 'horizontal' | 'vertical' | null => {
    const { horizontalGap, verticalGap, horizontalOverlap, verticalOverlap } = getAxisGap(sourceNode, targetNode);
    const strongGap = BOARD_GRID_SIZE * 4;
    const meaningfulOverlap = BOARD_GRID_SIZE * 2;

    if (verticalGap >= strongGap && horizontalOverlap >= meaningfulOverlap) {
        return 'vertical';
    }

    if (horizontalGap >= strongGap && verticalOverlap >= meaningfulOverlap) {
        return 'horizontal';
    }

    if (verticalGap >= horizontalGap + strongGap) {
        return 'vertical';
    }

    if (horizontalGap >= verticalGap + strongGap) {
        return 'horizontal';
    }

    return null;
};

const routeUsesAxis = (route: Pick<StrictGridRoute, 'sourceSide' | 'targetSide'>, axis: 'horizontal' | 'vertical') =>
    axis === 'vertical'
        ? isVerticalPortSide(route.sourceSide) && isVerticalPortSide(route.targetSide)
        : isHorizontalPortSide(route.sourceSide) && isHorizontalPortSide(route.targetSide);

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
    stubDistance = BOARD_GRID_SIZE,
    corridorOffset = 0,
): StrictGridPoint[] => {
    const startStub = movePoint(sourcePort, sourcePort.side, stubDistance);
    const endStub = movePoint(targetPort, targetPort.side, stubDistance);
    const points: StrictGridPoint[] = [startStub];

    if (startStub.x === endStub.x || startStub.y === endStub.y) {
        points.push(endStub);
        return compactRoutePoints(points);
    }

    if ((sourcePort.side === 'left' || sourcePort.side === 'right') &&
        (targetPort.side === 'left' || targetPort.side === 'right')) {
        const midX = snapCoordinateToGrid(((startStub.x + endStub.x) / 2) + corridorOffset);
        points.push({ x: midX, y: startStub.y }, { x: midX, y: endStub.y }, endStub);
        return compactRoutePoints(points);
    }

    if ((sourcePort.side === 'top' || sourcePort.side === 'bottom') &&
        (targetPort.side === 'top' || targetPort.side === 'bottom')) {
        const midY = snapCoordinateToGrid(((startStub.y + endStub.y) / 2) + corridorOffset);
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

const padRect = (rect: StrictGridRect, padding: number): StrictGridRect => ({
    left: rect.left - padding,
    right: rect.right + padding,
    top: rect.top - padding,
    bottom: rect.bottom + padding,
});

const getPaddedNodeBounds = (node: Node, padding = ROUTE_OBSTACLE_PADDING) =>
    padRect(getNodeBounds(node), padding);

const rectsOverlap = (left: StrictGridRect, right: StrictGridRect) =>
    left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top;

const pointInRect = (point: StrictGridPoint, rect: StrictGridRect) =>
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom;

const rangesOverlap = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) =>
    Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd)) <=
    Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd));

const segmentIntersectsRect = (start: StrictGridPoint, end: StrictGridPoint, rect: StrictGridRect) => {
    if (start.x === end.x) {
        return start.x >= rect.left &&
            start.x <= rect.right &&
            rangesOverlap(start.y, end.y, rect.top, rect.bottom);
    }

    if (start.y === end.y) {
        return start.y >= rect.top &&
            start.y <= rect.bottom &&
            rangesOverlap(start.x, end.x, rect.left, rect.right);
    }

    return rectsOverlap(
        {
            left: Math.min(start.x, end.x),
            right: Math.max(start.x, end.x),
            top: Math.min(start.y, end.y),
            bottom: Math.max(start.y, end.y),
        },
        rect,
    );
};

const getPathObstacleHits = (path: StrictGridPoint[], obstacles: StrictGridRect[]) =>
    path.slice(1).reduce((hitCount, point, index) => {
        const start = path[index];
        const segmentHits = obstacles.reduce(
            (count, obstacle) => count + (segmentIntersectsRect(start, point, obstacle) ? 1 : 0),
            0,
        );

        return hitCount + segmentHits;
    }, 0);

const getPathLength = (path: StrictGridPoint[]) =>
    path.slice(1).reduce((sum, point, index) => {
        const start = path[index];
        return sum + Math.abs(point.x - start.x) + Math.abs(point.y - start.y);
    }, 0);

const getPathBendCount = (path: StrictGridPoint[]) => {
    let bends = 0;
    let previousDirection: 'horizontal' | 'vertical' | null = null;

    path.slice(1).forEach((point, index) => {
        const start = path[index];
        const direction = start.x === point.x ? 'vertical' : 'horizontal';
        if (previousDirection && previousDirection !== direction) {
            bends += 1;
        }
        previousDirection = direction;
    });

    return bends;
};

const getRoutePath = (
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
    routePoints: StrictGridPoint[],
) => compactRoutePoints([sourcePort, ...routePoints, targetPort]);

const getRouteSegments = (path: StrictGridPoint[]): StrictGridRouteSegment[] =>
    path.slice(1).reduce<StrictGridRouteSegment[]>((segments, point, index) => {
        const start = path[index];
        if (start.x === point.x) {
            segments.push({
                axis: 'vertical' as const,
                lane: start.x,
                start: Math.min(start.y, point.y),
                end: Math.max(start.y, point.y),
            });
            return segments;
        }

        if (start.y === point.y) {
            segments.push({
                axis: 'horizontal' as const,
                lane: start.y,
                start: Math.min(start.x, point.x),
                end: Math.max(start.x, point.x),
            });
        }

        return segments;
    }, []).filter((segment) => segment.end - segment.start >= BOARD_GRID_SIZE * 2);

const getSegmentOverlapLength = (left: StrictGridRouteSegment, right: StrictGridRouteSegment) => {
    if (left.axis !== right.axis) {
        return 0;
    }

    return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
};

const getRouteLanePenalty = (
    path: StrictGridPoint[],
    reservedRouteSegments: StrictGridRouteSegment[],
) => {
    if (reservedRouteSegments.length === 0) {
        return 0;
    }

    return getRouteSegments(path).reduce((totalPenalty, segment) => {
        const segmentPenalty = reservedRouteSegments.reduce((penalty, reservedSegment) => {
            const overlapLength = getSegmentOverlapLength(segment, reservedSegment);
            if (overlapLength <= 0) {
                return penalty;
            }

            const laneDistance = Math.abs(segment.lane - reservedSegment.lane);
            const overlapUnits = Math.max(1, overlapLength / BOARD_GRID_SIZE);
            if (laneDistance === 0) {
                return penalty + (ROUTE_LANE_OVERLAP_PENALTY * overlapUnits);
            }

            if (laneDistance < ROUTE_LANE_CLEARANCE) {
                const closeness = (ROUTE_LANE_CLEARANCE - laneDistance) / ROUTE_LANE_CLEARANCE;
                return penalty + (ROUTE_NEAR_LANE_PENALTY * closeness * overlapUnits);
            }

            return penalty;
        }, 0);

        return totalPenalty + segmentPenalty;
    }, 0);
};

const toLabelRect = (point: StrictGridPoint): StrictGridRect => ({
    left: point.x - (ROUTE_LABEL_WIDTH / 2),
    right: point.x + (ROUTE_LABEL_WIDTH / 2),
    top: point.y - (ROUTE_LABEL_HEIGHT / 2),
    bottom: point.y + (ROUTE_LABEL_HEIGHT / 2),
});

const getExpandedLabelRect = (point: StrictGridPoint) => padRect(toLabelRect(point), ROUTE_LABEL_CLEARANCE);

const getPolylineMidpoint = (path: StrictGridPoint[]) => {
    const length = getPathLength(path);
    if (path.length < 2 || length === 0) {
        return path[0] || { x: 0, y: 0 };
    }

    const halfway = length / 2;
    let travelled = 0;

    for (let index = 1; index < path.length; index += 1) {
        const start = path[index - 1];
        const end = path[index];
        const segmentLength = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
        if (travelled + segmentLength >= halfway) {
            const remaining = halfway - travelled;
            if (start.x === end.x) {
                return { x: start.x, y: start.y + (end.y >= start.y ? remaining : -remaining) };
            }

            return { x: start.x + (end.x >= start.x ? remaining : -remaining), y: start.y };
        }

        travelled += segmentLength;
    }

    return path[Math.floor(path.length / 2)];
};

const getSegmentMidpoint = (start: StrictGridPoint, end: StrictGridPoint) => ({
    x: start.x === end.x ? start.x : start.x + ((end.x - start.x) / 2),
    y: start.y === end.y ? start.y : start.y + ((end.y - start.y) / 2),
});

const dedupePoints = (points: StrictGridPoint[]) => {
    const seen = new Set<string>();

    return points.filter((point) => {
        const key = `${snapCoordinateToGrid(point.x)}:${snapCoordinateToGrid(point.y)}`;
        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
};

const getRouteLabelCandidates = (path: StrictGridPoint[]) => {
    const candidates: StrictGridPoint[] = [getPolylineMidpoint(path)];

    path.slice(1).forEach((point, index) => {
        const start = path[index];
        const length = Math.abs(point.x - start.x) + Math.abs(point.y - start.y);
        if (length < BOARD_GRID_SIZE * 2) {
            return;
        }

        const midpoint = getSegmentMidpoint(start, point);
        candidates.push(midpoint);

        if (length >= BOARD_GRID_SIZE * 3) {
            for (let distance = BOARD_GRID_SIZE; distance < length; distance += BOARD_GRID_SIZE) {
                const ratio = distance / length;
                candidates.push({
                    x: start.x + ((point.x - start.x) * ratio),
                    y: start.y + ((point.y - start.y) * ratio),
                });
            }
        }
    });

    return dedupePoints(candidates).map((point) => ({
        x: snapCoordinateToGrid(point.x),
        y: snapCoordinateToGrid(point.y),
    }));
};

const scoreLabelPoint = (
    point: StrictGridPoint,
    basePoint: StrictGridPoint,
    obstacles: StrictGridRect[],
    reservedLabelRects: StrictGridRect[],
) => {
    const labelRect = getExpandedLabelRect(point);
    const labelRectCollisions = obstacles.reduce(
        (count, obstacle) => count + (rectsOverlap(labelRect, obstacle) ? 1 : 0),
        0,
    );
    const pointCollisions = obstacles.reduce(
        (count, obstacle) => count + (pointInRect(point, obstacle) ? 1 : 0),
        0,
    );
    const reservedCollisions = reservedLabelRects.reduce(
        (count, reservedRect) => count + (rectsOverlap(labelRect, reservedRect) ? 1 : 0),
        0,
    );

    return {
        labelRect,
        score:
            (pointCollisions * ROUTE_LABEL_COLLISION_PENALTY * 4) +
            (labelRectCollisions * ROUTE_LABEL_COLLISION_PENALTY) +
            (reservedCollisions * ROUTE_LABEL_COLLISION_PENALTY) +
            Math.abs(point.x - basePoint.x) +
            Math.abs(point.y - basePoint.y),
    };
};

const pickRouteLabel = (
    path: StrictGridPoint[],
    obstacles: StrictGridRect[],
    reservedLabelRects: StrictGridRect[],
) => {
    const basePoint = getPolylineMidpoint(path);
    const candidates = getRouteLabelCandidates(path);
    const scoredCandidates = candidates.map((point) => ({
        point,
        ...scoreLabelPoint(point, basePoint, obstacles, reservedLabelRects),
    }));

    scoredCandidates.sort((left, right) => left.score - right.score);

    const best = scoredCandidates[0] || {
        point: basePoint,
        labelRect: getExpandedLabelRect(basePoint),
        score: 0,
    };

    return {
        point: best.point,
        rect: best.labelRect,
        score: best.score,
    };
};

const getSearchBounds = (
    sourceNode: Node,
    targetNode: Node,
    start: StrictGridPoint,
    end: StrictGridPoint,
    obstacles: StrictGridRect[],
) => {
    const sourceBounds = getNodeBounds(sourceNode);
    const targetBounds = getNodeBounds(targetNode);
    const rects = [sourceBounds, targetBounds, ...obstacles];
    const minX = Math.min(start.x, end.x, ...rects.map((rect) => rect.left)) - ROUTE_SEARCH_MARGIN;
    const maxX = Math.max(start.x, end.x, ...rects.map((rect) => rect.right)) + ROUTE_SEARCH_MARGIN;
    const minY = Math.min(start.y, end.y, ...rects.map((rect) => rect.top)) - ROUTE_SEARCH_MARGIN;
    const maxY = Math.max(start.y, end.y, ...rects.map((rect) => rect.bottom)) + ROUTE_SEARCH_MARGIN;

    return {
        left: Math.floor(minX / BOARD_GRID_SIZE) * BOARD_GRID_SIZE,
        right: Math.ceil(maxX / BOARD_GRID_SIZE) * BOARD_GRID_SIZE,
        top: Math.floor(minY / BOARD_GRID_SIZE) * BOARD_GRID_SIZE,
        bottom: Math.ceil(maxY / BOARD_GRID_SIZE) * BOARD_GRID_SIZE,
    };
};

const pointKey = (point: StrictGridPoint) => `${point.x}:${point.y}`;

const parsePointKey = (key: string): StrictGridPoint => {
    const [x, y] = key.split(':').map(Number);
    return { x, y };
};

const getDirectionKey = (from: StrictGridPoint, to: StrictGridPoint) =>
    from.x === to.x ? 'vertical' : 'horizontal';

const buildMazeRoutePoints = (
    sourceNode: Node,
    targetNode: Node,
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
    obstacles: StrictGridRect[],
) => {
    const start = movePoint(sourcePort, sourcePort.side);
    const end = movePoint(targetPort, targetPort.side);
    const searchBounds = getSearchBounds(sourceNode, targetNode, start, end, obstacles);
    const startKey = pointKey(start);
    const endKey = pointKey(end);
    const open: Array<{ key: string; point: StrictGridPoint; cost: number; priority: number; direction: string | null }> = [{
        key: startKey,
        point: start,
        cost: 0,
        priority: Math.abs(end.x - start.x) + Math.abs(end.y - start.y),
        direction: null,
    }];
    const cameFrom = new Map<string, string>();
    const costs = new Map<string, number>([[startKey, 0]]);
    const directions = new Map<string, string | null>([[startKey, null]]);

    let iterations = 0;
    while (open.length > 0 && iterations < ROUTE_MAX_MAZE_ITERATIONS) {
        iterations += 1;
        open.sort((left, right) => left.priority - right.priority);
        const current = open.shift();
        if (!current) {
            break;
        }

        if (current.key === endKey) {
            const keys = [endKey];
            let cursor = endKey;
            while (cameFrom.has(cursor)) {
                cursor = cameFrom.get(cursor) as string;
                keys.push(cursor);
            }

            return compactRoutePoints(keys.reverse().map(parsePointKey));
        }

        const neighbors = [
            { x: current.point.x + BOARD_GRID_SIZE, y: current.point.y },
            { x: current.point.x - BOARD_GRID_SIZE, y: current.point.y },
            { x: current.point.x, y: current.point.y + BOARD_GRID_SIZE },
            { x: current.point.x, y: current.point.y - BOARD_GRID_SIZE },
        ].filter((neighbor) =>
            neighbor.x >= searchBounds.left &&
            neighbor.x <= searchBounds.right &&
            neighbor.y >= searchBounds.top &&
            neighbor.y <= searchBounds.bottom
        );

        neighbors.forEach((neighbor) => {
            const neighborKey = pointKey(neighbor);
            const isEndpoint = neighborKey === endKey || neighborKey === startKey;
            if (!isEndpoint && obstacles.some((obstacle) => pointInRect(neighbor, obstacle))) {
                return;
            }

            if (obstacles.some((obstacle) => segmentIntersectsRect(current.point, neighbor, obstacle))) {
                return;
            }

            const direction = getDirectionKey(current.point, neighbor);
            const previousDirection = directions.get(current.key);
            const turnPenalty = previousDirection && previousDirection !== direction ? ROUTE_TURN_PENALTY : 0;
            const nextCost = current.cost + BOARD_GRID_SIZE + turnPenalty;
            if ((costs.get(neighborKey) ?? Number.POSITIVE_INFINITY) <= nextCost) {
                return;
            }

            cameFrom.set(neighborKey, current.key);
            costs.set(neighborKey, nextCost);
            directions.set(neighborKey, direction);
            open.push({
                key: neighborKey,
                point: neighbor,
                cost: nextCost,
                priority: nextCost + Math.abs(end.x - neighbor.x) + Math.abs(end.y - neighbor.y),
                direction,
            });
        });
    }

    return null;
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
        strategy: 'direct',
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
        strategy: 'direct' as const,
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

const allPortSides: PortSide[] = ['top', 'right', 'bottom', 'left'];

type StrictGridRouteCandidate = {
    source: StrictGridPortSlot & StrictGridPoint;
    target: StrictGridPortSlot & StrictGridPoint;
    route: StrictGridRoute;
    score: number;
};

const getCandidateSidePairs = (preferredPairs: Array<[PortSide, PortSide]>) => {
    const pairs: Array<[PortSide, PortSide]> = [...preferredPairs];

    allPortSides.forEach((sourceSide) => {
        allPortSides.forEach((targetSide) => {
            if (!pairs.some(([existingSourceSide, existingTargetSide]) =>
                existingSourceSide === sourceSide && existingTargetSide === targetSide
            )) {
                pairs.push([sourceSide, targetSide]);
            }
        });
    });

    return pairs;
};

const hasManualStrictGridPlacement = (edge: Edge) => {
    const data = edge.data as Record<string, unknown> | undefined;
    return (
        typeof data?.labelX === 'number' &&
        typeof data?.labelY === 'number'
    ) || (
        typeof data?.routeAnchorX === 'number' &&
        typeof data?.routeAnchorY === 'number'
    );
};

const applyRouteLabel = (
    route: StrictGridRoute,
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
    obstacles: StrictGridRect[],
    reservedLabelRects: StrictGridRect[],
) => {
    const path = getRoutePath(sourcePort, targetPort, route.points);
    const label = pickRouteLabel(path, obstacles, reservedLabelRects);

    return {
        ...route,
        labelPoint: label.point,
        labelRect: label.rect,
    };
};

const getDirectRoutePointVariants = (
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
    stubDistance = BOARD_GRID_SIZE,
) => {
    const supportsCorridorOffset = (
        ((sourcePort.side === 'left' || sourcePort.side === 'right') &&
            (targetPort.side === 'left' || targetPort.side === 'right')) ||
        ((sourcePort.side === 'top' || sourcePort.side === 'bottom') &&
            (targetPort.side === 'top' || targetPort.side === 'bottom'))
    );
    const offsets = supportsCorridorOffset ? ROUTE_CORRIDOR_OFFSETS : [0];
    const seen = new Set<string>();

    return offsets.flatMap((offset) => {
        const points = buildOrthogonalPoints(sourcePort, targetPort, stubDistance, offset);
        const key = points.map(pointKey).join('|');
        if (seen.has(key)) {
            return [];
        }

        seen.add(key);
        return [points];
    });
};

const buildScoredRouteCandidate = (
    sourceNode: Node,
    targetNode: Node,
    sourcePort: StrictGridPortSlot & StrictGridPoint,
    targetPort: StrictGridPortSlot & StrictGridPoint,
    baseScore: number,
    obstacles: StrictGridRect[],
    reservedLabelRects: StrictGridRect[],
    reservedRouteSegments: StrictGridRouteSegment[],
    allowMaze = true,
): StrictGridRouteCandidate => {
    const labelObstacles = [getPaddedNodeBounds(sourceNode), getPaddedNodeBounds(targetNode), ...obstacles];
    const directCandidates = getDirectRoutePointVariants(sourcePort, targetPort)
        .map((points) => {
            const path = getRoutePath(sourcePort, targetPort, points);
            const obstacleHits = getPathObstacleHits(path, obstacles);
            const label = pickRouteLabel(path, labelObstacles, reservedLabelRects);
            const score =
                baseScore +
                (obstacleHits * ROUTE_OBSTACLE_PENALTY) +
                getPathLength(path) +
                (getPathBendCount(path) * ROUTE_TURN_PENALTY) +
                getRouteLanePenalty(path, reservedRouteSegments) +
                label.score;

            return { points, path, obstacleHits, label, score };
        })
        .sort((left, right) => left.score - right.score);
    const directBest = directCandidates[0];
    let route: StrictGridRoute = {
        sourcePortId: sourcePort.id,
        targetPortId: targetPort.id,
        sourceSide: sourcePort.side,
        targetSide: targetPort.side,
        points: directBest?.points || buildOrthogonalPoints(sourcePort, targetPort),
        strategy: 'direct',
    };
    let path = directBest?.path || getRoutePath(sourcePort, targetPort, route.points);
    let obstacleHits = directBest?.obstacleHits ?? getPathObstacleHits(path, obstacles);
    let label = directBest?.label || pickRouteLabel(path, labelObstacles, reservedLabelRects);
    let routeScore = directBest?.score ?? (
        baseScore +
        (obstacleHits * ROUTE_OBSTACLE_PENALTY) +
        getPathLength(path) +
        (getPathBendCount(path) * ROUTE_TURN_PENALTY) +
        getRouteLanePenalty(path, reservedRouteSegments) +
        label.score
    );

    if (allowMaze && obstacleHits > 0) {
        const mazePoints = buildMazeRoutePoints(sourceNode, targetNode, sourcePort, targetPort, obstacles);
        if (mazePoints) {
            const mazePath = getRoutePath(sourcePort, targetPort, mazePoints);
            const mazeObstacleHits = getPathObstacleHits(mazePath, obstacles);
            const mazeLabel = pickRouteLabel(mazePath, labelObstacles, reservedLabelRects);
            const mazeScore =
                baseScore +
                (mazeObstacleHits * ROUTE_OBSTACLE_PENALTY) +
                getPathLength(mazePath) +
                (getPathBendCount(mazePath) * ROUTE_TURN_PENALTY) +
                getRouteLanePenalty(mazePath, reservedRouteSegments) +
                mazeLabel.score;
            if (mazeScore < routeScore) {
                route = {
                    ...route,
                    points: mazePoints,
                    strategy: 'maze',
                };
                path = mazePath;
                obstacleHits = mazeObstacleHits;
                label = mazeLabel;
                routeScore = mazeScore;
            }
        }
    }

    if (route.strategy === 'direct' && label.score >= ROUTE_LABEL_COLLISION_PENALTY) {
        [BOARD_GRID_SIZE * 3, BOARD_GRID_SIZE * 5].forEach((stubDistance) => {
            getDirectRoutePointVariants(sourcePort, targetPort, stubDistance).forEach((alternatePoints) => {
                const alternatePath = getRoutePath(sourcePort, targetPort, alternatePoints);
                const alternateObstacleHits = getPathObstacleHits(alternatePath, obstacles);
                const alternateLabel = pickRouteLabel(alternatePath, labelObstacles, reservedLabelRects);
                const alternateScore =
                    baseScore +
                    (alternateObstacleHits * ROUTE_OBSTACLE_PENALTY) +
                    getPathLength(alternatePath) +
                    (getPathBendCount(alternatePath) * ROUTE_TURN_PENALTY) +
                    getRouteLanePenalty(alternatePath, reservedRouteSegments) +
                    alternateLabel.score;

                if (alternateScore < routeScore) {
                    route = {
                        ...route,
                        points: alternatePoints,
                    };
                    path = alternatePath;
                    obstacleHits = alternateObstacleHits;
                    label = alternateLabel;
                    routeScore = alternateScore;
                }
            });
        });
    }

    route = {
        ...route,
        labelPoint: label.point,
        labelRect: label.rect,
    };

    return {
        source: sourcePort,
        target: targetPort,
        route,
        score: routeScore,
    };
};

const selectCandidatePorts = (
    ports: Array<StrictGridPortSlot & StrictGridPoint>,
    node: Node,
    targetPoint: StrictGridPoint,
    occupancy: Set<string>,
    lockedPortId?: string | null,
) => {
    const selected = ports
        .map((port) => ({
            port,
            score:
                getAlignmentPenalty(port, node, targetPoint) +
                getCenterSlotPenalty(port.slotIndex, ports.length) +
                (occupancy.has(port.id) ? ROUTE_REUSED_LANE_PENALTY : 0),
        }))
        .sort((left, right) => left.score - right.score)
        .slice(0, 5)
        .map(({ port }) => port);

    const lockedPort = lockedPortId ? ports.find((port) => port.id === lockedPortId) : null;
    if (lockedPort && !selected.some((port) => port.id === lockedPort.id)) {
        selected.push(lockedPort);
    }

    return selected;
};

export const assignStrictGridPorts = (
    edges: Edge[],
    nodes: Node[],
) => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const occupancy = new Map<string, Set<string>>();
    const reservedLabelRects: StrictGridRect[] = [];
    const reservedRouteSegments: StrictGridRouteSegment[] = [];
    const assignments = new Map<string, StrictGridPortAssignment>();
    const reserveRouteSegments = (route: StrictGridRoute, sourceNode: Node, targetNode: Node) => {
        const sourcePort = getPortById(sourceNode, route.sourcePortId);
        const targetPort = getPortById(targetNode, route.targetPortId);
        if (!sourcePort || !targetPort) {
            return;
        }

        reservedRouteSegments.push(...getRouteSegments(getRoutePath(sourcePort, targetPort, route.points)));
    };

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

        const sourceAbsoluteSlots = getAbsolutePortSlots(sourceNode);
        const targetAbsoluteSlots = getAbsolutePortSlots(targetNode);
        const obstacles = nodes
            .filter((node) => node.id !== sourceNode.id && node.id !== targetNode.id)
            .map((node) => getPaddedNodeBounds(node));
        const hasLockedSourcePort = Boolean(edge.sourceHandle) && allPortSides.some((side) =>
            sourceAbsoluteSlots[side].some((port) => port.id === edge.sourceHandle),
        );
        const hasLockedTargetPort = Boolean(edge.targetHandle) && allPortSides.some((side) =>
            targetAbsoluteSlots[side].some((port) => port.id === edge.targetHandle),
        );
        const hasLockedPorts = hasLockedSourcePort && hasLockedTargetPort;
        const hasManualPlacement = hasManualStrictGridPlacement(edge);

        if (hasLockedPorts && hasManualPlacement) {
            const sourcePort = getPortById(sourceNode, edge.sourceHandle);
            const targetPort = getPortById(targetNode, edge.targetHandle);
            const lockedRoute = buildStrictGridRoute(sourceNode, targetNode, edge.sourceHandle, edge.targetHandle);
            const labelObstacles = [getPaddedNodeBounds(sourceNode), getPaddedNodeBounds(targetNode), ...obstacles];
            const labelledRoute = sourcePort && targetPort
                ? applyRouteLabel(lockedRoute, sourcePort, targetPort, labelObstacles, reservedLabelRects)
                : lockedRoute;
            assignments.set(edge.id, { route: labelledRoute });
            if (labelledRoute.labelRect) {
                reservedLabelRects.push(labelledRoute.labelRect);
            }
            reserveRouteSegments(labelledRoute, sourceNode, targetNode);
            if (!occupancy.has(edge.source)) occupancy.set(edge.source, new Set<string>());
            if (!occupancy.has(edge.target)) occupancy.set(edge.target, new Set<string>());
            occupancy.get(edge.source)?.add(labelledRoute.sourcePortId);
            occupancy.get(edge.target)?.add(labelledRoute.targetPortId);
            return;
        }

        const sourceCenter = getNodeCenter(sourceNode);
        const targetCenter = getNodeCenter(targetNode);
        const sourcePreferredSides = getPreferredSides(sourceCenter, targetCenter, true);
        const targetPreferredSides = getPreferredSides(targetCenter, sourceCenter, false);
        const preferredPairs = getPreferredSidePairs(sourceNode, targetNode);
        const sourceOccupancy = occupancy.get(edge.source) || new Set<string>();
        const targetOccupancy = occupancy.get(edge.target) || new Set<string>();

        let best: StrictGridRouteCandidate | null = null;
        const lockedRoute = hasLockedPorts
            ? buildStrictGridRoute(sourceNode, targetNode, edge.sourceHandle, edge.targetHandle)
            : null;
        const lockedSourcePort = lockedRoute ? getPortById(sourceNode, lockedRoute.sourcePortId) : null;
        const lockedTargetPort = lockedRoute ? getPortById(targetNode, lockedRoute.targetPortId) : null;
        const strongAxisPreference = getStrongAxisPreference(sourceNode, targetNode);
        const lockedRouteIsBad = Boolean(
            lockedRoute &&
            lockedSourcePort &&
            lockedTargetPort &&
            (
                getPathObstacleHits(getRoutePath(lockedSourcePort, lockedTargetPort, lockedRoute.points), obstacles) > 0 ||
                (strongAxisPreference !== null && !routeUsesAxis(lockedRoute, strongAxisPreference))
            )
        );

        if (lockedRoute && lockedSourcePort && lockedTargetPort && !lockedRouteIsBad) {
            const labelObstacles = [getPaddedNodeBounds(sourceNode), getPaddedNodeBounds(targetNode), ...obstacles];
            const stableRoute = applyRouteLabel(lockedRoute, lockedSourcePort, lockedTargetPort, labelObstacles, reservedLabelRects);
            assignments.set(edge.id, { route: stableRoute });
            if (stableRoute.labelRect) {
                reservedLabelRects.push(stableRoute.labelRect);
            }
            reserveRouteSegments(stableRoute, sourceNode, targetNode);
            if (!occupancy.has(edge.source)) occupancy.set(edge.source, new Set<string>());
            if (!occupancy.has(edge.target)) occupancy.set(edge.target, new Set<string>());
            occupancy.get(edge.source)?.add(stableRoute.sourcePortId);
            occupancy.get(edge.target)?.add(stableRoute.targetPortId);
            return;
        }

        const candidatePairs = getCandidateSidePairs(preferredPairs);
        candidatePairs.forEach(([sourceSide, targetSide], pairIndex) => {
            const sourcePorts = selectCandidatePorts(
                sourceAbsoluteSlots[sourceSide],
                sourceNode,
                targetCenter,
                sourceOccupancy,
                edge.sourceHandle,
            );
            const targetPorts = selectCandidatePorts(
                targetAbsoluteSlots[targetSide],
                targetNode,
                sourceCenter,
                targetOccupancy,
                edge.targetHandle,
            );

            sourcePorts.forEach((sourcePort) => {
                targetPorts.forEach((targetPort) => {
                    const lockedHandlePenalty = lockedRouteIsBad &&
                        sourcePort.id === edge.sourceHandle &&
                        targetPort.id === edge.targetHandle
                        ? ROUTE_STALE_HANDLE_PENALTY
                        : 0;
                    const sameSideCrowdingPenalty =
                        (sourceOccupancy.has(sourcePort.id) ? ROUTE_REUSED_LANE_PENALTY : 0) +
                        (targetOccupancy.has(targetPort.id) ? ROUTE_REUSED_LANE_PENALTY : 0);
                    const baseScore = getPortPairScore(
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
                    ) + pairIndex * BOARD_GRID_SIZE * 8 + lockedHandlePenalty + sameSideCrowdingPenalty;
                    const candidate = buildScoredRouteCandidate(
                        sourceNode,
                        targetNode,
                        sourcePort,
                        targetPort,
                        baseScore,
                        obstacles,
                        reservedLabelRects,
                        reservedRouteSegments,
                        pairIndex < 2,
                    );

                    if (!best || candidate.score < best.score) {
                        best = candidate;
                    }
                });
            });
        });

        const resolvedBest = best as StrictGridRouteCandidate | null;
        let route: StrictGridRoute;
        if (resolvedBest) {
            route = resolvedBest.route;
        } else {
            route = buildStrictGridRoute(sourceNode, targetNode);
        }

        assignments.set(edge.id, { route });
        if (route.labelRect) {
            reservedLabelRects.push(route.labelRect);
        }
        reserveRouteSegments(route, sourceNode, targetNode);
        if (!occupancy.has(edge.source)) occupancy.set(edge.source, new Set<string>());
        if (!occupancy.has(edge.target)) occupancy.set(edge.target, new Set<string>());
        occupancy.get(edge.source)?.add(route.sourcePortId);
        occupancy.get(edge.target)?.add(route.targetPortId);
    });

    return assignments;
};
