import type { Edge, Node } from 'reactflow';
import { calculateNodeFrame } from '../components/boardGeometry';
import type { BoardMode } from '../components/boardGeometry';
import type { InvestigationRecord } from './investigations';

export interface PersistedBoardState {
  mode?: BoardMode;
  nodes: Node[];
  edges: Edge[];
}

export interface MergeSourceBoard {
  investigation: InvestigationRecord;
  board: PersistedBoardState;
}

export interface RelevantMergeNode {
  vaultId: string;
  nodeId: string;
}

export interface MergeNodePayload {
  id: string;
  title: string;
  summary: string;
  fullText: string;
  sourceURL: string;
  sourceVaultId: string;
  sourceNodeId: string;
  derivedFromMerge: boolean;
}

export interface MergeEdgePayload {
  id: string;
  source: string;
  target: string;
  tag: string;
  reasoning: string;
}

export interface MergedChildBoardResult {
  childBoard: PersistedBoardState;
  updatedParentBoards: Record<string, PersistedBoardState>;
  payloadNodes: MergeNodePayload[];
  payloadEdges: MergeEdgePayload[];
}

const PORTAL_NODE_HEIGHT = 192;
const PORTAL_NODE_WIDTH = 288;
const BOARD_BASE_X = 96;
const BOARD_BASE_Y = 96;
const BOARD_ROW_GAP = 224;
const BOARD_PARENT_COLUMN_GAP = 400;

export const parsePersistedBoardState = (raw: string | null): PersistedBoardState | null => {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)) {
      return {
        mode: parsed.mode === 'legacy' ? 'legacy' : 'strict-grid',
        nodes: parsed.nodes,
        edges: parsed.edges,
      };
    }
  } catch (error) {
    console.error('[HierarchicalCanvas] Failed to parse persisted board state:', error);
  }

  return null;
};

const sanitizeText = (value: unknown): string => typeof value === 'string' ? value : '';

const buildPortalNodeId = (parentId: string, childId: string) => `portal-${parentId}-${childId}`;

const buildMergedNodeId = (childId: string, sourceVaultId: string, sourceNodeId: string) =>
  `merged-${childId}-${sourceVaultId}-${sourceNodeId}`.replace(/[^a-zA-Z0-9_-]/g, '-');

const createPortalNode = (
  parentId: string,
  childId: string,
  childTopic: string,
  parentTopic: string,
  mergeEntity: string,
  siblingCount: number,
): Node => ({
  id: buildPortalNodeId(parentId, childId),
  type: 'custom',
  position: {
    x: BOARD_BASE_X + (siblingCount * (PORTAL_NODE_WIDTH + 48)),
    y: BOARD_BASE_Y,
  },
  style: {
    width: PORTAL_NODE_WIDTH,
    height: PORTAL_NODE_HEIGHT,
  },
  data: {
    id: buildPortalNodeId(parentId, childId),
    title: 'MERGE_PORTAL',
    summary: `Portal into ${childTopic}. This merged canvas combines overlapping evidence discovered between ${parentTopic} and related investigations around ${mergeEntity}.`,
    fullText: `Portal into ${childTopic}\n\nThis child canvas was created from overlapping investigations around ${mergeEntity}. Use this portal to review the combined evidence without altering the original boards.`,
    linkedInvestigationId: childId,
    portalKind: 'merged-child',
    parentInvestigationId: parentId,
    derivedFromMerge: true,
  },
});

export const createMergedChildBoard = (
  childId: string,
  childTopic: string,
  parentBoards: MergeSourceBoard[],
  primaryParentId: string,
  mergeEntity: string,
  relevantNodes: RelevantMergeNode[],
): MergedChildBoardResult => {
  const childNodes: Node[] = [];
  const childEdges: Edge[] = [];
  const payloadNodes: MergeNodePayload[] = [];
  const payloadEdges: MergeEdgePayload[] = [];
  const nodeIdMap = new Map<string, string>();
  const updatedParentBoards: Record<string, PersistedBoardState> = {};
  const relevantNodeKeys = new Set(relevantNodes.map((node) => `${node.vaultId}:${node.nodeId}`));

  parentBoards.forEach(({ investigation, board }, parentIndex) => {
    const eligibleNodes = board.nodes.filter((node) => {
      if (node.data?.portalKind) {
        return false;
      }

      return relevantNodeKeys.has(`${investigation.id}:${node.id}`);
    });

    eligibleNodes.forEach((node, nodeIndex) => {
      const mergedNodeId = buildMergedNodeId(childId, investigation.id, node.id);
      nodeIdMap.set(`${investigation.id}:${node.id}`, mergedNodeId);

      const title = sanitizeText(node.data?.title) || 'ARCHIVED_INTEL';
      const summary = sanitizeText(node.data?.summary);
      const fullText = sanitizeText(node.data?.fullText) || summary;
      const sourceURL = sanitizeText(node.data?.sourceURL);
      const frame = calculateNodeFrame(summary, fullText, Boolean(node.data?.expanded));

      childNodes.push({
        ...node,
        id: mergedNodeId,
        position: {
          x: BOARD_BASE_X + (parentIndex * BOARD_PARENT_COLUMN_GAP),
          y: BOARD_BASE_Y + (nodeIndex * BOARD_ROW_GAP),
        },
        style: {
          ...node.style,
          ...frame,
        },
        data: {
          ...node.data,
          id: mergedNodeId,
          title,
          summary,
          fullText,
          sourceURL,
          sourceVaultId: investigation.id,
          sourceNodeId: node.id,
          derivedFromMerge: true,
        },
      });

      payloadNodes.push({
        id: mergedNodeId,
        title,
        summary,
        fullText,
        sourceURL,
        sourceVaultId: investigation.id,
        sourceNodeId: node.id,
        derivedFromMerge: true,
      });
    });

    board.edges.forEach((edge, edgeIndex) => {
      const mappedSource = nodeIdMap.get(`${investigation.id}:${edge.source}`);
      const mappedTarget = nodeIdMap.get(`${investigation.id}:${edge.target}`);

      if (!mappedSource || !mappedTarget) {
        return;
      }

      const mergedEdgeId = `merged-edge-${childId}-${investigation.id}-${edgeIndex}`;
      const label = typeof edge.label === 'string' ? edge.label : 'RELATED';
      const reasoning = sanitizeText(edge.data?.reasoning);

      childEdges.push({
        ...edge,
        id: mergedEdgeId,
        source: mappedSource,
        target: mappedTarget,
      });

      payloadEdges.push({
        id: mergedEdgeId,
        source: mappedSource,
        target: mappedTarget,
        tag: label,
        reasoning,
      });
    });

    const existingPortalNode = board.nodes.find((node) => node.id === buildPortalNodeId(investigation.id, childId));
    const portalNode = existingPortalNode || createPortalNode(
      investigation.id,
      childId,
      childTopic,
      investigation.displayTopic,
      mergeEntity,
      board.nodes.filter((node) => node.data?.portalKind).length,
    );

    updatedParentBoards[investigation.id] = {
      mode: board.mode || 'strict-grid',
      nodes: existingPortalNode ? board.nodes : [...board.nodes, portalNode],
      edges: board.edges,
    };
  });

  if (parentBoards.length === 0) {
    updatedParentBoards[primaryParentId] = { mode: 'strict-grid', nodes: [], edges: [] };
  }

  return {
    childBoard: {
      mode: 'strict-grid',
      nodes: childNodes,
      edges: childEdges,
    },
    updatedParentBoards,
    payloadNodes,
    payloadEdges,
  };
};
