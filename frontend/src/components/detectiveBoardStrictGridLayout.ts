import { Position } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import { getLayoutedElements } from './detectiveBoardLayout';
import {
    BOARD_GRID_SIZE,
    getNodeDimensions,
    normalizeNodeFrame,
    snapCoordinateToGrid,
} from './boardGeometry';
import type { BoardMode } from './boardGeometry';

export const STRICT_GRID_EDGE_Z_INDEX = 0;
export const STRICT_GRID_NODE_Z_INDEX = 100;
export const STRICT_GRID_EXPANDED_NODE_Z_INDEX = STRICT_GRID_NODE_Z_INDEX + 500;

const STRICT_GRID_ROW_GAP = BOARD_GRID_SIZE * 6;
const STRICT_GRID_COLUMN_GAP = BOARD_GRID_SIZE * 8;

export const normalizeStrictGridNodes = (nodes: Node[]) => nodes.map((node) => {
    const dimensions = getNodeDimensions(node);

    return {
        ...node,
        zIndex: node.data?.expanded ? STRICT_GRID_EXPANDED_NODE_Z_INDEX : STRICT_GRID_NODE_Z_INDEX,
        position: {
            x: snapCoordinateToGrid(node.position.x),
            y: snapCoordinateToGrid(node.position.y),
        },
        style: {
            ...node.style,
            ...normalizeNodeFrame(dimensions.width, dimensions.height),
        },
        data: {
            ...node.data,
            boardMode: 'strict-grid' as BoardMode,
        }
    };
});

const getStrictGridBoardOrderedNodes = (nodes: Node[], edges: Edge[]) => {
    const { nodes: layoutedNodes } = getLayoutedElements(nodes, edges);

    return [...layoutedNodes].sort((left, right) => {
        const yDelta = left.position.y - right.position.y;
        if (Math.abs(yDelta) > BOARD_GRID_SIZE * 2) {
            return yDelta;
        }

        return left.position.x - right.position.x;
    });
};

const buildStrictGridRows = (orderedNodes: Node[], columnCount: number) => {
    const rows: Node[][] = [];

    for (let index = 0; index < orderedNodes.length; index += columnCount) {
        rows.push(orderedNodes.slice(index, index + columnCount));
    }

    return rows;
};

export const getStrictGridLayoutedNodes = (nodes: Node[], edges: Edge[]) => {
    const orderedNodes = getStrictGridBoardOrderedNodes(nodes, edges);
    const columnCount = Math.max(2, Math.ceil(Math.sqrt(Math.max(orderedNodes.length, 1))));
    const orderedNodeIds = new Set(orderedNodes.map((node) => node.id));
    const connectedNodeIds = new Set(
        edges
            .filter((edge) => orderedNodeIds.has(edge.source) && orderedNodeIds.has(edge.target))
            .flatMap((edge) => [edge.source, edge.target])
    );
    const disconnectedNodes = orderedNodes.filter((node) => !connectedNodeIds.has(node.id));
    const connectedNodes = orderedNodes.filter((node) => connectedNodeIds.has(node.id));
    const rows = [
        ...buildStrictGridRows(disconnectedNodes, columnCount),
        ...buildStrictGridRows(connectedNodes, columnCount),
    ];

    const rowWidths = rows.map((row) =>
        row.reduce((width, node, index) => {
            const dim = getNodeDimensions(node);
            return width + dim.width + (index > 0 ? STRICT_GRID_COLUMN_GAP : 0);
        }, 0)
    );
    const maxRowWidth = Math.max(...rowWidths, 0);

    let currentY = 0;
    const boardNodes = rows.flatMap((row, rowIndex) => {
        const rowHeight = Math.max(...row.map((node) => getNodeDimensions(node).height), 0);
        const rowWidth = rowWidths[rowIndex];
        let currentX = (maxRowWidth - rowWidth) / 2;

        const placedRow = row.map((node) => {
            const dim = getNodeDimensions(node);
            const nextNode = {
                ...node,
                position: {
                    x: currentX,
                    y: currentY,
                },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                style: {
                    ...node.style,
                    width: dim.width,
                    height: dim.height,
                }
            };

            currentX += dim.width + STRICT_GRID_COLUMN_GAP;
            return nextNode;
        });

        currentY += rowHeight + STRICT_GRID_ROW_GAP;
        return placedRow;
    });

    return normalizeStrictGridNodes(boardNodes);
};
