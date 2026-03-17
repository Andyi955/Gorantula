import { describe, expect, it } from 'vitest';
import {
  buildSidebarInvestigationRows,
  createRootInvestigation,
  normalizeInvestigations,
  registerMergedChildInvestigation,
  removeInvestigationRecord,
} from '../src/utils/investigations';

describe('investigation hierarchy utilities', () => {
  it('registers merged children and nests them under the primary parent', () => {
    const rootA = createRootInvestigation('inv-a', 'Alpha');
    const rootB = createRootInvestigation('inv-b', 'Beta');

    const investigations = registerMergedChildInvestigation(
      [rootA, rootB],
      {
        childId: 'merge-1',
        childTopic: 'Merged: Alpha + Beta',
        parentIds: ['inv-a', 'inv-b'],
        primaryParentId: 'inv-a',
      },
    );

    const child = investigations.find((investigation) => investigation.id === 'merge-1');
    expect(child?.kind).toBe('merged-child');
    expect(child?.parentIds).toEqual(['inv-a', 'inv-b']);

    const parentA = investigations.find((investigation) => investigation.id === 'inv-a');
    const parentB = investigations.find((investigation) => investigation.id === 'inv-b');
    expect(parentA?.childIds).toContain('merge-1');
    expect(parentB?.childIds).toContain('merge-1');

    const rows = buildSidebarInvestigationRows(investigations);
    expect(rows.map((row) => `${row.depth}:${row.investigation.id}`)).toEqual([
      '0:inv-a',
      '1:merge-1',
      '0:inv-b',
    ]);
  });

  it('cascades orphaned merged children when a parent is removed', () => {
    const normalized = normalizeInvestigations([
      createRootInvestigation('inv-a', 'Alpha'),
      createRootInvestigation('inv-b', 'Beta'),
      {
        id: 'merge-1',
        topic: 'Merged',
        kind: 'merged-child',
        parentIds: ['inv-a'],
        childIds: [],
        mergedFromIds: ['inv-a'],
        primaryParentId: 'inv-a',
        displayTopic: 'Merged',
      },
    ]);

    const result = removeInvestigationRecord(normalized, 'inv-a');
    expect(result.removedIds.sort()).toEqual(['inv-a', 'merge-1']);
    expect(result.investigations.map((investigation) => investigation.id)).toEqual(['inv-b']);
  });
});
