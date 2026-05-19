import type { Edge, Node } from 'reactflow'
import { calculateNodeFrame } from '../components/boardGeometry'
import { type PersistedBoardState } from './hierarchicalCanvas'
import { createRootInvestigation } from './investigations'
import {
  deleteInvestigationPersistence,
  getCachedInvestigations,
  saveBoardStateForInvestigation,
  saveInvestigations,
} from './investigationPersistence'

export const BROWSER_QA_SEEDED_EVENT = 'gorantula:browser-qa-seeded'
export const BROWSER_QA_CLEARED_EVENT = 'gorantula:browser-qa-cleared'
export const BROWSER_QA_ANIMATION_DEMO_EVENT = 'gorantula:browser-qa-play-animations'
export const BROWSER_QA_ANIMATION_DEMO_PENDING_KEY = 'gorantula_browser_qa_animation_demo_pending'
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

export interface BrowserQaAnimationDemoDetail {
  investigationId: string
  requestId?: string
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

export const clearBrowserQaData = () => {
  const remainingInvestigations = getCachedInvestigations().filter(
    (investigation) => !BROWSER_QA_INVESTIGATION_IDS.includes(investigation.id),
  )

  void saveInvestigations(remainingInvestigations).catch(() => undefined)
  BROWSER_QA_INVESTIGATION_IDS.forEach((investigationId) => {
    void deleteInvestigationPersistence(investigationId).catch(() => undefined)
  })
}

export const seedBrowserQaData = (): BrowserQaSeedResult => {
  clearBrowserQaData()

  const preservedInvestigations = getCachedInvestigations()
  const sourceInvestigation = createRootInvestigation(BROWSER_QA_SOURCE_INVESTIGATION_ID, 'QA: Source Case')
  const targetInvestigation = createRootInvestigation(BROWSER_QA_TARGET_INVESTIGATION_ID, 'QA: Imported Target')

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
  void saveBoardStateForInvestigation(sourceInvestigation.id, sourceBoard)

  const targetBoard: PersistedBoardState = {
    mode: 'strict-grid',
    nodes: targetNodes,
    edges: [],
    pendingIntegrationNodeIds: [],
    synthesisAlerts: [],
  }
  void saveBoardStateForInvestigation(targetInvestigation.id, targetBoard)

  return {
    focusInvestigationId: targetInvestigation.id,
    investigationIds: [...BROWSER_QA_INVESTIGATION_IDS],
  }
}
