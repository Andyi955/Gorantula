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
export const BROWSER_QA_DISCOVERY_DEMO_EVENT = 'gorantula:browser-qa-play-discovery-demo'
export const BROWSER_QA_SYNTHESIS_DEMO_EVENT = 'gorantula:browser-qa-play-synthesis-demo'
export const BROWSER_QA_ANIMATION_DEMO_PENDING_KEY = 'gorantula_browser_qa_animation_demo_pending'
export const BROWSER_QA_SOURCE_INVESTIGATION_ID = 'qa-browser-source'
export const BROWSER_QA_TARGET_INVESTIGATION_ID = 'qa-browser-target'
export const BROWSER_QA_RELATED_INVESTIGATION_IDS = [
  'qa-browser-capacity-costs',
  'qa-browser-cooling-load',
  'qa-browser-prior-near-miss',
  'qa-browser-utility-planning',
] as const

const BROWSER_QA_INVESTIGATION_IDS = [
  BROWSER_QA_SOURCE_INVESTIGATION_ID,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
  ...BROWSER_QA_RELATED_INVESTIGATION_IDS,
]

export interface BrowserQaSeedResult {
  focusInvestigationId: string
  investigationIds: string[]
}

export interface BrowserQaAnimationDemoDetail {
  investigationId: string
  requestId?: string
  includeConnections?: boolean
}

export interface BrowserQaDiscoveryDemoDetail {
  investigationId: string
  requestId?: string
}

export interface BrowserQaSynthesisDemoDetail {
  investigationId: string
  requestId?: string
}

export const createBrowserQaSynthesisDemoAlerts = (investigationId: string) => [
  {
    type: 'synthesis_alert',
    alertKey: `qa-synthesis-grid-signal-${investigationId}`,
    entity: 'grid reliability signal',
    currentVaultId: investigationId,
    connectedCases: [
      investigationId,
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      BROWSER_QA_TARGET_INVESTIGATION_ID,
      ...BROWSER_QA_RELATED_INVESTIGATION_IDS,
    ],
    nodes: [
      {
        vaultId: investigationId,
        nodeId: 'qa-target-existing',
        summary: 'Existing target lead shows recurring data center load pressure.',
      },
      {
        vaultId: BROWSER_QA_SOURCE_INVESTIGATION_ID,
        nodeId: 'qa-source-lead',
        summary: 'Source case includes an earlier operational stress pattern.',
      },
    ],
    analysis: 'QA signal links the active case with prior infrastructure stress evidence through a shared grid reliability pattern.',
    timestamp: '2026-05-20T10:00:00Z',
    score: 0.82,
  },
  {
    type: 'synthesis_alert',
    alertKey: `qa-synthesis-capacity-cost-${investigationId}`,
    entity: 'capacity cost pressure',
    currentVaultId: investigationId,
    connectedCases: [
      investigationId,
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      BROWSER_QA_RELATED_INVESTIGATION_IDS[0],
      BROWSER_QA_RELATED_INVESTIGATION_IDS[3],
    ],
    nodes: [
      {
        vaultId: investigationId,
        nodeId: 'imported-qa-target-node',
        summary: 'Imported brief describes mitigation costs and demand-response pressure.',
      },
    ],
    analysis: 'QA signal ties capacity planning language to the same operational reliability theme.',
    timestamp: '2026-05-20T10:01:00Z',
    score: 0.74,
  },
]

export const createBrowserQaSynthesisDemoTheory = (investigationId: string) => [
  'QA synthesis theory: shared infrastructure stress pattern.',
  '',
  `The active investigation (${investigationId}) and related QA cases point to the same reliability theme: concentrated compute load, emergency cooling draw, and capacity-cost pressure are clustering around grid operations rather than appearing as isolated notes.`,
  '',
  'The useful interpretation is not that every case is identical, but that each one exposes a different face of the same constraint: reliability margins are tightening before planning and mitigation processes fully catch up.',
].join('\n')

export const createBrowserQaDiscoveryDemoRecords = (investigationId: string) => [
  {
    id: `qa-discovery-grid-near-miss-${investigationId}`,
    title: 'QA Discovery: Grid Near-Miss Pattern',
    claim: 'Two QA evidence cards point to the same substation corridor as a recurring reliability pressure point.',
    impact: 'The pattern turns isolated load and cooling notes into a stronger infrastructure-risk finding for animation review.',
    confidence: 0.92,
    sourceNodeIDs: ['qa-target-existing', 'imported-qa-target-node'],
    sourceVaultID: investigationId,
    createdAt: '2026-05-19T12:00:00Z',
    nodeKind: 'discovery',
  },
  {
    id: `qa-discovery-imported-brief-${investigationId}`,
    title: 'QA Discovery: Imported Brief Confirms Exposure',
    claim: 'The imported regulator brief reinforces the target case with prior near-miss language and mitigation guidance.',
    impact: 'This gives the discovery accordion a mixed local/imported evidence trail without calling any provider.',
    confidence: 0.86,
    sourceNodeIDs: ['imported-qa-target-node', 'qa-target-existing'],
    sourceVaultID: investigationId,
    createdAt: '2026-05-19T12:01:00Z',
    nodeKind: 'discovery',
  },
  {
    id: `qa-discovery-cost-signal-${investigationId}`,
    title: 'QA Discovery: Cost Signal Needs Review',
    claim: 'The available QA evidence suggests reliability costs may concentrate around the same operational constraint.',
    impact: 'This lower-confidence item gives the panel a second rank and count-up target for visual QA.',
    confidence: 0.74,
    sourceNodeIDs: ['qa-target-existing'],
    sourceVaultID: investigationId,
    createdAt: '2026-05-19T12:02:00Z',
    nodeKind: 'discovery',
  },
]

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
  const relatedInvestigations = [
    createRootInvestigation(BROWSER_QA_RELATED_INVESTIGATION_IDS[0], 'QA: Capacity Costs'),
    createRootInvestigation(BROWSER_QA_RELATED_INVESTIGATION_IDS[1], 'QA: Cooling Load'),
    createRootInvestigation(BROWSER_QA_RELATED_INVESTIGATION_IDS[2], 'QA: Prior Near-Miss'),
    createRootInvestigation(BROWSER_QA_RELATED_INVESTIGATION_IDS[3], 'QA: Utility Planning'),
  ]

  void saveInvestigations([targetInvestigation, sourceInvestigation, ...relatedInvestigations, ...preservedInvestigations]).catch(() => undefined)

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
