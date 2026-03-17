export type InvestigationKind = 'root' | 'merged-child';

export interface InvestigationRecord {
  id: string;
  topic: string;
  kind: InvestigationKind;
  parentIds: string[];
  childIds: string[];
  mergedFromIds: string[];
  primaryParentId: string | null;
  displayTopic: string;
}

export interface SidebarInvestigationRow {
  investigation: InvestigationRecord;
  depth: number;
}

export const INVESTIGATIONS_STORAGE_KEY = 'gorantula_investigations';

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

export const normalizeInvestigationRecord = (value: unknown): InvestigationRecord | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.topic !== 'string') {
    return null;
  }

  const kind = record.kind === 'merged-child' ? 'merged-child' : 'root';
  const parentIds = normalizeStringArray(record.parentIds);
  const mergedFromIds = normalizeStringArray(record.mergedFromIds);

  return {
    id: record.id,
    topic: record.topic,
    kind,
    parentIds,
    childIds: normalizeStringArray(record.childIds),
    mergedFromIds,
    primaryParentId: typeof record.primaryParentId === 'string' ? record.primaryParentId : (parentIds[0] || null),
    displayTopic: typeof record.displayTopic === 'string' && record.displayTopic.trim().length > 0 ? record.displayTopic : record.topic,
  };
};

export const recomputeChildLinks = (investigations: InvestigationRecord[]): InvestigationRecord[] => {
  const childMap = new Map<string, string[]>();

  investigations.forEach((investigation) => {
    if (investigation.kind !== 'merged-child') {
      return;
    }

    investigation.parentIds.forEach((parentId) => {
      const existing = childMap.get(parentId) || [];
      if (!existing.includes(investigation.id)) {
        existing.push(investigation.id);
      }
      childMap.set(parentId, existing);
    });
  });

  return investigations.map((investigation) => ({
    ...investigation,
    childIds: childMap.get(investigation.id) || [],
  }));
};

export const normalizeInvestigations = (value: unknown): InvestigationRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map(normalizeInvestigationRecord)
    .filter((record): record is InvestigationRecord => record !== null);

  return recomputeChildLinks(normalized);
};

export const createRootInvestigation = (id: string, topic: string): InvestigationRecord => ({
  id,
  topic,
  kind: 'root',
  parentIds: [],
  childIds: [],
  mergedFromIds: [],
  primaryParentId: null,
  displayTopic: topic,
});

export const buildSidebarInvestigationRows = (investigations: InvestigationRecord[]): SidebarInvestigationRow[] => {
  const byId = new Map(investigations.map((investigation) => [investigation.id, investigation]));
  const rows: SidebarInvestigationRow[] = [];
  const visited = new Set<string>();

  const visit = (investigation: InvestigationRecord, depth: number) => {
    if (visited.has(investigation.id)) {
      return;
    }

    visited.add(investigation.id);
    rows.push({ investigation, depth });

    investigation.childIds
      .map((childId) => byId.get(childId))
      .filter((child): child is InvestigationRecord => Boolean(child))
      .filter((child) => child.primaryParentId === investigation.id)
      .forEach((child) => visit(child, depth + 1));
  };

  investigations
    .filter((investigation) => investigation.kind === 'root')
    .forEach((investigation) => visit(investigation, 0));

  investigations
    .filter((investigation) => !visited.has(investigation.id))
    .forEach((investigation) => visit(investigation, investigation.kind === 'merged-child' ? 1 : 0));

  return rows;
};

export interface MergeInvestigationRegistration {
  childId: string;
  childTopic: string;
  parentIds: string[];
  primaryParentId: string;
}

export const registerMergedChildInvestigation = (
  investigations: InvestigationRecord[],
  registration: MergeInvestigationRegistration,
): InvestigationRecord[] => {
  const nextInvestigations = investigations
    .filter((investigation) => investigation.id !== registration.childId)
    .map((investigation) => ({ ...investigation }));

  nextInvestigations.unshift({
    id: registration.childId,
    topic: registration.childTopic,
    kind: 'merged-child',
    parentIds: [...registration.parentIds],
    childIds: [],
    mergedFromIds: [...registration.parentIds],
    primaryParentId: registration.primaryParentId,
    displayTopic: registration.childTopic,
  });

  return recomputeChildLinks(nextInvestigations);
};

export interface RemoveInvestigationResult {
  investigations: InvestigationRecord[];
  removedIds: string[];
}

export const removeInvestigationRecord = (
  investigations: InvestigationRecord[],
  investigationId: string,
): RemoveInvestigationResult => {
  const working = new Map(investigations.map((investigation) => [investigation.id, { ...investigation }]));
  const queue = [investigationId];
  const removed = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId || removed.has(currentId)) {
      continue;
    }

    removed.add(currentId);
    working.delete(currentId);

    working.forEach((investigation, id) => {
      if (!investigation.parentIds.includes(currentId)) {
        return;
      }

      const nextParentIds = investigation.parentIds.filter((parentId) => parentId !== currentId);
      investigation.parentIds = nextParentIds;
      investigation.mergedFromIds = investigation.mergedFromIds.filter((parentId) => parentId !== currentId);
      investigation.primaryParentId = investigation.primaryParentId === currentId ? (nextParentIds[0] || null) : investigation.primaryParentId;

      if (investigation.kind === 'merged-child' && nextParentIds.length === 0) {
        queue.push(id);
      }
    });
  }

  return {
    investigations: recomputeChildLinks(Array.from(working.values())),
    removedIds: Array.from(removed),
  };
};
