import { createRootInvestigation, INVESTIGATIONS_STORAGE_KEY } from '../src/utils/investigations'
import {
  loadInvestigations,
  loadBoardStateForInvestigation,
  saveBoardStateForInvestigation,
} from '../src/utils/investigationPersistence'
import { BOARD_PERSIST_FAILED_EVENT, parsePersistedBoardState, type PersistedBoardState } from '../src/utils/hierarchicalCanvas'

const backendFlag = globalThis as typeof globalThis & {
  __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean
}

const buildBoardState = (): PersistedBoardState => ({
  mode: 'strict-grid',
  nodes: [
    {
      id: 'node-1',
      type: 'custom',
      position: { x: 10, y: 20 },
      data: { title: 'Persisted lead' },
    },
  ],
  edges: [],
  pendingIntegrationIds: ['node-1'],
  synthesisAlerts: [{ id: 'alert-1', title: 'Theory ready' }],
})

describe('investigation persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    backendFlag.__GORANTULA_BACKEND_PERSISTENCE_TEST__ = true
  })

  afterEach(() => {
    delete backendFlag.__GORANTULA_BACKEND_PERSISTENCE_TEST__
    vi.unstubAllGlobals()
  })

  it('migrates browser-only investigation state into backend vault endpoints', async () => {
    const investigation = createRootInvestigation('inv-migrate', 'Migrated Investigation')
    const boardState = buildBoardState()

    localStorage.setItem(INVESTIGATIONS_STORAGE_KEY, JSON.stringify([investigation]))
    localStorage.setItem(`inv_data_${investigation.id}`, JSON.stringify(boardState))
    localStorage.setItem(`vault_result_${investigation.id}`, JSON.stringify({ report: 'Final report' }))
    localStorage.setItem(
      'gorantula_discoveries_by_investigation',
      JSON.stringify({ [investigation.id]: [{ id: 'discovery-1', title: 'Discovery' }] }),
    )

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        return { ok: true, json: async () => [] } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const investigations = await loadInvestigations()

    expect(investigations).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8080/api/investigations', expect.any(Object))

    const putUrls = fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(([input]) => String(input))
      .sort()

    expect(putUrls).toEqual([
      'http://localhost:8080/api/investigations/inv-migrate',
      'http://localhost:8080/api/investigations/inv-migrate/board',
      'http://localhost:8080/api/investigations/inv-migrate/discoveries',
      'http://localhost:8080/api/investigations/inv-migrate/result',
    ])
  })

  it('falls back to browser board cache and emits autosave warning when backend save fails', async () => {
    const boardState = buildBoardState()
    const failedEvents: Event[] = []
    window.addEventListener(BOARD_PERSIST_FAILED_EVENT, (event) => failedEvents.push(event))

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('backend offline')
    }))

    const saved = await saveBoardStateForInvestigation('inv-fallback', boardState)

    expect(saved).toBe(false)
    expect(parsePersistedBoardState(localStorage.getItem('inv_data_inv-fallback'))?.nodes).toHaveLength(1)
    expect(failedEvents).toHaveLength(1)
  })

  it('uses browser board evidence when the backend still has an empty board', async () => {
    const boardState = buildBoardState()
    localStorage.setItem('inv_data_inv-local-rich', JSON.stringify(boardState))

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: true, json: async () => ({}) } as Response
      }
      return {
        ok: true,
        json: async () => ({
          mode: 'strict-grid',
          nodes: [],
          edges: [],
          pendingIntegrationNodeIds: [],
          synthesisAlerts: [],
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const loaded = await loadBoardStateForInvestigation('inv-local-rich')

    expect(loaded?.nodes).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/investigations/inv-local-rich/board',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('preserves an existing timeline snapshot when board saves omit it', async () => {
    delete backendFlag.__GORANTULA_BACKEND_PERSISTENCE_TEST__
    const existingState: PersistedBoardState = {
      mode: 'strict-grid',
      nodes: [{ id: 'node-1', type: 'custom', position: { x: 0, y: 0 }, data: { title: 'Original' } }],
      edges: [],
      timelineSnapshot: {
        generatedAt: '2026-05-14T12:00:00.000Z',
        sourceFingerprint: 'tl-existing',
        events: [
          {
            id: 'event-1',
            timestamp: '2024-01-15',
            event: 'Shipment departed.',
            sourceNodeId: 'node-1',
            sourceTitle: 'Original',
            provenance: 'persona',
            parsedDate: 1705276800000,
            datePrecision: 'day',
          },
        ],
      },
    }

    localStorage.setItem('inv_data_inv-timeline', JSON.stringify(existingState))
    await loadBoardStateForInvestigation('inv-timeline')

    await saveBoardStateForInvestigation('inv-timeline', {
      mode: 'strict-grid',
      nodes: [{ id: 'node-1', type: 'custom', position: { x: 1, y: 1 }, data: { title: 'Updated' } }],
      edges: [],
    })

    const saved = parsePersistedBoardState(localStorage.getItem('inv_data_inv-timeline'))
    expect(saved?.timelineSnapshot?.events).toHaveLength(1)
    expect(saved?.timelineSnapshot?.sourceFingerprint).toBe('tl-existing')
  })
})
