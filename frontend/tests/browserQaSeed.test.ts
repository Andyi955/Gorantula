import { createRootInvestigation } from '../src/utils/investigations'
import {
  getCachedBoardStateForInvestigation,
  getCachedInvestigations,
  saveInvestigations,
} from '../src/utils/investigationPersistence'
import {
  BROWSER_QA_CLEARED_EVENT,
  BROWSER_QA_SEEDED_EVENT,
  BROWSER_QA_SOURCE_INVESTIGATION_ID,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
  clearBrowserQaData,
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
      'real-investigation',
    ])
    expect(result.focusInvestigationId).toBe(BROWSER_QA_TARGET_INVESTIGATION_ID)
    expect(result.investigationIds).toEqual([
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      BROWSER_QA_TARGET_INVESTIGATION_ID,
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
  })

  it('exports stable QA browser events', () => {
    expect(BROWSER_QA_SEEDED_EVENT).toBe('gorantula:browser-qa-seeded')
    expect(BROWSER_QA_CLEARED_EVENT).toBe('gorantula:browser-qa-cleared')
  })
})
