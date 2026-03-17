import { describe, expect, it } from 'vitest';
import { createRootInvestigation } from '../src/utils/investigations';
import { createMergedChildBoard, parsePersistedBoardState } from '../src/utils/hierarchicalCanvas';

describe('hierarchical canvas utilities', () => {
  it('builds a merged child board with provenance and portal nodes', () => {
    const rootA = createRootInvestigation('inv-a', 'Alpha');
    const rootB = createRootInvestigation('inv-b', 'Beta');

    const result = createMergedChildBoard(
      'merge-1',
      'Merged: Alpha + Beta',
      [
        {
          investigation: rootA,
          board: {
            mode: 'strict-grid',
            nodes: [
              {
                id: 'node-a',
                type: 'custom',
                position: { x: 0, y: 0 },
                data: { title: 'Node A', summary: '[PERSON:Alice]', fullText: '[PERSON:Alice]', sourceURL: '' },
              },
              {
                id: 'node-a-extra',
                type: 'custom',
                position: { x: 40, y: 40 },
                data: { title: 'Node A Extra', summary: 'irrelevant', fullText: 'irrelevant', sourceURL: '' },
              },
            ],
            edges: [],
          },
        },
        {
          investigation: rootB,
          board: {
            mode: 'strict-grid',
            nodes: [
              {
                id: 'node-b',
                type: 'custom',
                position: { x: 0, y: 0 },
                data: { title: 'Node B', summary: '[ORG:Beta Corp]', fullText: '[ORG:Beta Corp]', sourceURL: '' },
              },
            ],
            edges: [],
          },
        },
      ],
      'inv-a',
      'shared entity',
      [
        { vaultId: 'inv-a', nodeId: 'node-a' },
        { vaultId: 'inv-b', nodeId: 'node-b' },
      ],
    );

    expect(result.childBoard.nodes).toHaveLength(2);
    expect(result.childBoard.nodes.some((node) => node.id.includes('node-a-extra'))).toBe(false);
    expect(result.payloadNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceVaultId: 'inv-a', sourceNodeId: 'node-a', derivedFromMerge: true }),
        expect.objectContaining({ sourceVaultId: 'inv-b', sourceNodeId: 'node-b', derivedFromMerge: true }),
      ]),
    );
    expect(result.updatedParentBoards['inv-a'].nodes.some((node) => node.data?.portalKind === 'merged-child')).toBe(true);
    expect(result.updatedParentBoards['inv-b'].nodes.some((node) => node.data?.portalKind === 'merged-child')).toBe(true);
  });

  it('parses persisted board state safely', () => {
    const state = parsePersistedBoardState(JSON.stringify({
      mode: 'strict-grid',
      nodes: [{ id: 'node-1' }],
      edges: [],
    }));

    expect(state?.mode).toBe('strict-grid');
    expect(state?.nodes).toHaveLength(1);
  });
});
