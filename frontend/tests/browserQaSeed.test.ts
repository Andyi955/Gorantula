import { parsePersistedBoardState } from '../src/utils/hierarchicalCanvas'
import { createRootInvestigation, INVESTIGATIONS_STORAGE_KEY } from '../src/utils/investigations'
import {
  BROWSER_QA_CLEARED_EVENT,
  BROWSER_QA_SEEDED_EVENT,
  BROWSER_QA_SOURCE_INVESTIGATION_ID,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
  clearBrowserQaData,
  seedBrowserQaData,
} from '../src/utils/browserQaSeed'

describe('browser QA seed helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('seeds deterministic browser QA investigations and board data', () => {
    localStorage.setItem(
      INVESTIGATIONS_STORAGE_KEY,
      JSON.stringify([createRootInvestigation('real-investigation', 'Real Investigation')]),
    )

    const result = seedBrowserQaData()

    const investigations = JSON.parse(localStorage.getItem(INVESTIGATIONS_STORAGE_KEY) || '[]')
    expect(investigations.map((entry: { id: string }) => entry.id)).toEqual([
      BROWSER_QA_TARGET_INVESTIGATION_ID,
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      'real-investigation',
    ])
    expect(result.focusInvestigationId).toBe(BROWSER_QA_TARGET_INVESTIGATION_ID)
    expect(result.investigationIds).toEqual([
      BROWSER_QA_SOURCE_INVESTIGATION_ID,
      BROWSER_QA_TARGET_INVESTIGATION_ID,
    ])

    const targetBoard = parsePersistedBoardState(localStorage.getItem(`inv_data_${BROWSER_QA_TARGET_INVESTIGATION_ID}`))
    expect(targetBoard?.nodes.some((node) => node.data?.title === '[IMPORTED] Pulled dossier')).toBe(true)
    expect(targetBoard?.nodes.some((node) => node.data?.title === 'Existing target lead')).toBe(true)

    const sourceBoard = parsePersistedBoardState(localStorage.getItem(`inv_data_${BROWSER_QA_SOURCE_INVESTIGATION_ID}`))
    expect(sourceBoard?.nodes.some((node) => node.data?.title === 'Source lead')).toBe(true)
    expect(sourceBoard?.edges).toHaveLength(1)
  })

  it('clears only seeded QA investigations and preserves existing data', () => {
    localStorage.setItem(
      INVESTIGATIONS_STORAGE_KEY,
      JSON.stringify([createRootInvestigation('real-investigation', 'Real Investigation')]),
    )
    seedBrowserQaData()

    clearBrowserQaData()

    const investigations = JSON.parse(localStorage.getItem(INVESTIGATIONS_STORAGE_KEY) || '[]')
    expect(investigations.map((entry: { id: string }) => entry.id)).toEqual(['real-investigation'])
    expect(localStorage.getItem(`inv_data_${BROWSER_QA_SOURCE_INVESTIGATION_ID}`)).toBeNull()
    expect(localStorage.getItem(`inv_data_${BROWSER_QA_TARGET_INVESTIGATION_ID}`)).toBeNull()
  })

  it('exports stable QA browser events', () => {
    expect(BROWSER_QA_SEEDED_EVENT).toBe('gorantula:browser-qa-seeded')
    expect(BROWSER_QA_CLEARED_EVENT).toBe('gorantula:browser-qa-cleared')
  })
})
