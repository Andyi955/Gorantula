import dagre from 'dagre';
import { Position } from 'reactflow';
import type { Edge, Node } from 'reactflow';
import { BOARD_GRID_SIZE, getNodeDimensions } from './boardGeometry';

const LAYOUT_NODE_SEPARATION = 100;
const LAYOUT_RANK_SEPARATION = 200;
const LAYOUT_MARGIN_X = 50;
const LAYOUT_MARGIN_Y = 50;
const ORPHAN_LANE_GAP = BOARD_GRID_SIZE * 8;

interface LayoutPartition {
  connectedNodes: Node[];
  disconnectedNodes: Node[];
  connectedEdges: Edge[];
}

interface LayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const getRankDirection = (nodeCount: number, edgeCount: number): 'LR' | 'TB' => {
  const edgeToNodeRatio = nodeCount > 0 ? edgeCount / nodeCount : 0;
  const isVeryDenseGraph = edgeToNodeRatio > 2.25;
  return nodeCount >= 8 && isVeryDenseGraph ? 'TB' : 'LR';
};

const partitionLayoutNodes = (nodes: Node[], edges: Edge[]): LayoutPartition => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const connectedEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const connectedNodeIds = new Set<string>();

  connectedEdges.forEach((edge) => {
    connectedNodeIds.add(edge.source);
    connectedNodeIds.add(edge.target);
  });

  const connectedNodes: Node[] = [];
  const disconnectedNodes: Node[] = [];

  nodes.forEach((node) => {
    if (connectedNodeIds.has(node.id)) {
      connectedNodes.push(node);
      return;
    }

    disconnectedNodes.push(node);
  });

  return {
    connectedNodes,
    disconnectedNodes,
    connectedEdges,
  };
};

const getNodeBounds = (nodes: Node[]): LayoutBounds | null => {
  if (nodes.length === 0) {
    return null;
  }

  return nodes.reduce<LayoutBounds>((bounds, node) => {
    const dim = getNodeDimensions(node);
    const nodeMinX = node.position.x;
    const nodeMaxX = node.position.x + dim.width;
    const nodeMinY = node.position.y;
    const nodeMaxY = node.position.y + dim.height;

    return {
      minX: Math.min(bounds.minX, nodeMinX),
      maxX: Math.max(bounds.maxX, nodeMaxX),
      minY: Math.min(bounds.minY, nodeMinY),
      maxY: Math.max(bounds.maxY, nodeMaxY),
    };
  }, {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
};

const layoutConnectedNodes = (nodes: Node[], edges: Edge[]) => {
  if (nodes.length === 0) {
    return {
      nodes: [] as Node[],
      rankdir: 'LR' as 'LR' | 'TB',
    };
  }

  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  const rankdir = getRankDirection(nodes.length, edges.length);
  dagreGraph.setGraph({
    rankdir,
    nodesep: LAYOUT_NODE_SEPARATION,
    ranksep: LAYOUT_RANK_SEPARATION,
    marginx: LAYOUT_MARGIN_X,
    marginy: LAYOUT_MARGIN_Y,
  });

  nodes.forEach((node) => {
    const dim = getNodeDimensions(node);
    dagreGraph.setNode(node.id, { width: dim.width, height: dim.height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  return {
    rankdir,
    nodes: nodes.map((node) => {
      const nodeWithPosition = dagreGraph.node(node.id);
      const dim = getNodeDimensions(node);

      return {
        ...node,
        position: {
          x: nodeWithPosition.x - dim.width / 2,
          y: nodeWithPosition.y - dim.height / 2,
        },
        targetPosition: rankdir === 'LR' ? Position.Left : Position.Top,
        sourcePosition: rankdir === 'LR' ? Position.Right : Position.Bottom,
        style: {
          ...node.style,
          width: dim.width,
          height: dim.height,
        },
      };
    }),
  };
};

const layoutDisconnectedNodes = (
  nodes: Node[],
  connectedBounds: LayoutBounds | null,
  rankdir: 'LR' | 'TB',
) => {
  if (nodes.length === 0) {
    return [] as Node[];
  }

  const laneWidth = nodes.reduce((width, node, index) => {
    const dim = getNodeDimensions(node);
    return width + dim.width + (index > 0 ? LAYOUT_NODE_SEPARATION : 0);
  }, 0);

  const anchorMinX = connectedBounds ? connectedBounds.minX : 0;
  const anchorWidth = connectedBounds ? connectedBounds.maxX - connectedBounds.minX : laneWidth;
  let currentX = anchorMinX + Math.max((anchorWidth - laneWidth) / 2, 0);
  const laneHeight = Math.max(...nodes.map((node) => getNodeDimensions(node).height), 0);
  const baseY = connectedBounds
    ? connectedBounds.minY - ORPHAN_LANE_GAP - laneHeight
    : 0;

  return nodes.map((node) => {
    const dim = getNodeDimensions(node);
    const nextNode = {
      ...node,
      position: {
        x: currentX,
        y: baseY + Math.max((laneHeight - dim.height) / 2, 0),
      },
      targetPosition: rankdir === 'LR' ? Position.Left : Position.Top,
      sourcePosition: rankdir === 'LR' ? Position.Right : Position.Bottom,
      style: {
        ...node.style,
        width: dim.width,
        height: dim.height,
      },
    };

    currentX += dim.width + LAYOUT_NODE_SEPARATION;
    return nextNode;
  });
};

// Keep disconnected evidence visible while reserving Dagre for the graph that actually has edges.
export const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const { connectedNodes, disconnectedNodes, connectedEdges } = partitionLayoutNodes(nodes, edges);
  const connectedLayout = layoutConnectedNodes(connectedNodes, connectedEdges);
  const connectedBounds = getNodeBounds(connectedLayout.nodes);
  const disconnectedLayout = layoutDisconnectedNodes(disconnectedNodes, connectedBounds, connectedLayout.rankdir);

  const nodesById = new Map<string, Node>(
    [...connectedLayout.nodes, ...disconnectedLayout].map((node) => [
      node.id,
      {
        ...node,
        position: { ...node.position },
      },
    ]),
  );

  return {
    nodes: nodes.map((node) => nodesById.get(node.id) ?? { ...node, position: { ...node.position } }),
    edges: [...edges],
  };
};

export const detectiveBoardLayoutTestUtils = {
  getLayoutedElements,
};
