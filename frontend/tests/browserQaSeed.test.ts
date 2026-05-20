import { createRootInvestigation } from '../src/utils/investigations'
import {
  getCachedBoardStateForInvestigation,
  getCachedInvestigations,
  saveInvestigations,
} from '../src/utils/investigationPersistence'
import {
  BROWSER_QA_CLEARED_EVENT,
  BROWSER_QA_DISCOVERY_DEMO_EVENT,
  BROWSER_QA_PIPELINE_DEMO_EVENT,
  BROWSER_QA_RELATED_INVESTIGATION_IDS,
  BROWSER_QA_SEEDED_EVENT,
  BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT,
  BROWSER_QA_SOURCE_INVESTIGATION_ID,
  BROWSER_QA_SYNTHESIS_DEMO_EVENT,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
  BROWSER_QA_TIMELINE_DEMO_EVENT,
  clearBrowserQaData,
  createBrowserQaSynthesisDemoAlerts,
  createBrowserQaSynthesisDemoTheory,
  createBrowserQaTimelineDemoSnapshot,
  seedBrowserQaData,
} from '../src/utils/browserQaSeed'

describe('browser QA seed helpers', () => {
  beforeEach(async () => {
    localStorage.clear()
    await saveInvestigations([])
  })

  it('seeds deterministic browser QA investigations and board data', async () => {
    await saveInvestigations([createRootInvestigation('real-investigation', 'Real Investigation')])

    const result = seedBrowserQaData()

    expect(getCachedInvestigations().map((entry: { id: string }) => entry.id)).toEqual([
      BROWSER_QA_TARGET_INVESTIGATION_ID,
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      ...BROWSER_QA_RELATED_INVESTIGATION_IDS,
      'real-investigation',
    ])
    expect(result.focusInvestigationId).toBe(BROWSER_QA_TARGET_INVESTIGATION_ID)
    expect(result.investigationIds).toEqual([
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      BROWSER_QA_TARGET_INVESTIGATION_ID,
      ...BROWSER_QA_RELATED_INVESTIGATION_IDS,
    ])

    const targetBoard = getCachedBoardStateForInvestigation(BROWSER_QA_TARGET_INVESTIGATION_ID)
    expect(targetBoard?.nodes.some((node) => node.data?.title === '[IMPORTED] Pulled dossier')).toBe(true)
    expect(targetBoard?.nodes.some((node) => node.data?.title === 'Existing target lead')).toBe(true)

    const sourceBoard = getCachedBoardStateForInvestigation(BROWSER_QA_SOURCE_INVESTIGATION_ID)
    expect(sourceBoard?.nodes.some((node) => node.data?.title === 'Source lead')).toBe(true)
    expect(sourceBoard?.edges).toHaveLength(1)
  })

  it('clears only seeded QA investigations and preserves existing data', async () => {
    await saveInvestigations([createRootInvestigation('real-investigation', 'Real Investigation')])
    seedBrowserQaData()

    clearBrowserQaData()

    expect(getCachedInvestigations().map((entry: { id: string }) => entry.id)).toEqual(['real-investigation'])
    expect(localStorage.getItem(`inv_data_${BROWSER_QA_SOURCE_INVESTIGATION_ID}`)).toBeNull()
    expect(localStorage.getItem(`inv_data_${BROWSER_QA_TARGET_INVESTIGATION_ID}`)).toBeNull()
    BROWSER_QA_RELATED_INVESTIGATION_IDS.forEach((investigationId) => {
      expect(localStorage.getItem(`inv_data_${investigationId}`)).toBeNull()
    })
  })

  it('exports stable QA browser events', () => {
    expect(BROWSER_QA_SEEDED_EVENT).toBe('gorantula:browser-qa-seeded')
    expect(BROWSER_QA_CLEARED_EVENT).toBe('gorantula:browser-qa-cleared')
    expect(BROWSER_QA_DISCOVERY_DEMO_EVENT).toBe('gorantula:browser-qa-play-discovery-demo')
    expect(BROWSER_QA_SYNTHESIS_DEMO_EVENT).toBe('gorantula:browser-qa-play-synthesis-demo')
    expect(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT).toBe('gorantula:browser-qa-play-spider-telemetry-demo')
    expect(BROWSER_QA_PIPELINE_DEMO_EVENT).toBe('gorantula:browser-qa-play-pipeline-demo')
    expect(BROWSER_QA_TIMELINE_DEMO_EVENT).toBe('gorantula:browser-qa-play-timeline-demo')
  })

  it('creates deterministic browser-only timeline demo snapshots', () => {
    const snapshot = createBrowserQaTimelineDemoSnapshot(BROWSER_QA_TARGET_INVESTIGATION_ID)

    expect(snapshot.sourceFingerprint).toBe(`qa-timeline-demo:${BROWSER_QA_TARGET_INVESTIGATION_ID}`)
    expect(snapshot.events.length).toBeGreaterThanOrEqual(4)
    expect(snapshot.events[0]).toEqual(expect.objectContaining({
      id: `qa-timeline-demo-grid-alert-${BROWSER_QA_TARGET_INVESTIGATION_ID}`,
      sourceNodeId: 'qa-target-existing',
      sourceTitle: 'Existing target lead',
    }))
    expect(snapshot.events.some((event) => event.parsedDate === null)).toBe(true)
  })

  it('creates deterministic browser-only synthesis demo payloads', () => {
    const alerts = createBrowserQaSynthesisDemoAlerts(BROWSER_QA_TARGET_INVESTIGATION_ID)

    expect(alerts).toHaveLength(2)
    expect(alerts[0]).toEqual(expect.objectContaining({
      alertKey: `qa-synthesis-grid-signal-${BROWSER_QA_TARGET_INVESTIGATION_ID}`,
      currentVaultId: BROWSER_QA_TARGET_INVESTIGATION_ID,
      entity: 'grid reliability signal',
    }))
    expect(alerts[0].connectedCases).toContain(BROWSER_QA_TARGET_INVESTIGATION_ID)
    expect(alerts[0].connectedCases.length).toBeGreaterThan(5)
    expect(createBrowserQaSynthesisDemoTheory(BROWSER_QA_TARGET_INVESTIGATION_ID)).toContain('QA synthesis theory: shared infrastructure stress pattern')
  })
})
