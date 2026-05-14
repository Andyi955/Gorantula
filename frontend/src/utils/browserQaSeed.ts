import type { Edge, Node } from 'reactflow'
import { calculateNodeFrame } from '../components/boardGeometry'
import { persistBoardStateForInvestigation, type PersistedBoardState } from './hierarchicalCanvas'
import { createRootInvestigation, INVESTIGATIONS_STORAGE_KEY, normalizeInvestigations } from './investigations'
import {
  deleteInvestigationPersistence,
  saveBoardStateForInvestigation,
  saveInvestigations,
} from './investigationPersistence'

const DISCOVERIES_STORAGE_KEY = 'gorantula_discoveries_by_investigation'

export const BROWSER_QA_SEEDED_EVENT = 'gorantula:browser-qa-seeded'
export const BROWSER_QA_CLEARED_EVENT = 'gorantula:browser-qa-cleared'
export const BROWSER_QA_SOURCE_INVESTIGATION_ID = 'qa-browser-source'
export const BROWSER_QA_TARGET_INVESTIGATION_ID = 'qa-browser-target'

const BROWSER_QA_INVESTIGATION_IDS = [
  BROWSER_QA_SOURCE_INVESTIGATION_ID,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
]

export interface BrowserQaSeedResult {
  focusInvestigationId: string
  investigationIds: string[]
}

const createEvidenceNode = (
  id: string,
  title: string,
  summary: string,
  position: { x: number; y: number },
  sourceURL: string,
): Node => {
  const frame = calculateNodeFrame(summary, summary, false, false)

  return {
    id,
    type: 'custom',
    position,
    style: frame,
    data: {
      id,
      title,
      summary,
      fullText: summary,
      sourceURL,
    },
  }
}

const createRelationshipEdge = (
  id: string,
  source: string,
  target: string,
  label: string,
): Edge => ({
  id,
  source,
  target,
  type: 'customEdge',
  label,
  data: {
    tag: label,
    reasoning: `${source} informs ${target}`,
    color: '#00f3ff',
    pattern: 'solid',
    shape: 'line',
  },
})

const readStoredInvestigations = () => {
  const raw = localStorage.getItem(INVESTIGATIONS_STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    return normalizeInvestigations(JSON.parse(raw))
  } catch (error) {
    console.error('[BrowserQaSeed] Failed to parse stored investigations', error)
    return []
  }
}

const writeStoredInvestigations = (investigations: ReturnType<typeof readStoredInvestigations>) => {
  localStorage.setItem(INVESTIGATIONS_STORAGE_KEY, JSON.stringify(investigations))
}

const removeQaDiscoveries = () => {
  const raw = localStorage.getItem(DISCOVERIES_STORAGE_KEY)
  if (!raw) {
    return
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return
    }

    const nextEntries = Object.entries(parsed as Record<string, unknown>).filter(
      ([key]) => !BROWSER_QA_INVESTIGATION_IDS.includes(key),
    )

    if (nextEntries.length === 0) {
      localStorage.removeItem(DISCOVERIES_STORAGE_KEY)
      return
    }

    localStorage.setItem(DISCOVERIES_STORAGE_KEY, JSON.stringify(Object.fromEntries(nextEntries)))
  } catch (error) {
    console.error('[BrowserQaSeed] Failed to parse discoveries store', error)
  }
}

export const clearBrowserQaData = () => {
  const remainingInvestigations = readStoredInvestigations().filter(
    (investigation) => !BROWSER_QA_INVESTIGATION_IDS.includes(investigation.id),
  )

  writeStoredInvestigations(remainingInvestigations)
  BROWSER_QA_INVESTIGATION_IDS.forEach((investigationId) => {
    void deleteInvestigationPersistence(investigationId).catch(() => undefined)
    localStorage.removeItem(`inv_data_${investigationId}`)
    localStorage.removeItem(`vault_result_${investigationId}`)
  })
  removeQaDiscoveries()
}

export const seedBrowserQaData = (): BrowserQaSeedResult => {
  clearBrowserQaData()

  const preservedInvestigations = readStoredInvestigations()
  const sourceInvestigation = createRootInvestigation(BROWSER_QA_SOURCE_INVESTIGATION_ID, 'QA: Source Case')
  const targetInvestigation = createRootInvestigation(BROWSER_QA_TARGET_INVESTIGATION_ID, 'QA: Imported Target')

  writeStoredInvestigations([targetInvestigation, sourceInvestigation, ...preservedInvestigations])
  void saveInvestigations([targetInvestigation, sourceInvestigation, ...preservedInvestigations]).catch(() => undefined)

  const sourceNodes = [
    createEvidenceNode(
      'qa-source-lead',
      'Source lead',
      'A source-side dossier about shell companies, payment routing, and a recurring logistics contact.',
      { x: 96, y: 96 },
      'https://example.com/source-lead',
    ),
    createEvidenceNode(
      'qa-source-support',
      'Supporting witness',
      'A secondary article that reinforces the source lead and adds dates useful for timeline testing.',
      { x: 480, y: 96 },
      'https://example.com/source-support',
    ),
  ]
  const sourceEdges = [
    createRelationshipEdge('qa-source-edge', 'qa-source-lead', 'qa-source-support', 'SUPPORTS'),
  ]

  const targetNodes = [
    createEvidenceNode(
      'qa-target-existing',
      'Existing target lead',
      'A local board node already present in the target investigation so imported styling can be compared side by side.',
      { x: 96, y: 96 },
      'https://example.com/target-existing',
    ),
    createEvidenceNode(
      'imported-qa-target-node',
      '[IMPORTED] Pulled dossier',
      'An imported browser QA node used to verify imported styling and compare centered placement against regular evidence.',
      { x: 456, y: 264 },
      'https://example.com/imported-dossier',
    ),
  ]

  const sourceBoard: PersistedBoardState = {
    mode: 'strict-grid',
    nodes: sourceNodes,
    edges: sourceEdges,
    pendingIntegrationNodeIds: [],
    synthesisAlerts: [],
  }
  persistBoardStateForInvestigation(sourceInvestigation.id, sourceBoard)
  void saveBoardStateForInvestigation(sourceInvestigation.id, sourceBoard)

  const targetBoard: PersistedBoardState = {
    mode: 'strict-grid',
    nodes: targetNodes,
    edges: [],
    pendingIntegrationNodeIds: [],
    synthesisAlerts: [],
  }
  persistBoardStateForInvestigation(targetInvestigation.id, targetBoard)
  void saveBoardStateForInvestigation(targetInvestigation.id, targetBoard)

  return {
    focusInvestigationId: targetInvestigation.id,
    investigationIds: [...BROWSER_QA_INVESTIGATION_IDS],
  }
}
