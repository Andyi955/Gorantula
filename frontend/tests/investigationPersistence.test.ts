import { createRootInvestigation, INVESTIGATIONS_STORAGE_KEY } from '../src/utils/investigations'
import {
  getCachedBoardStateForInvestigation,
  loadInvestigations,
  loadBoardStateForInvestigation,
  loadDiscoveriesForInvestigation,
  saveBoardStateForInvestigation,
} from '../src/utils/investigationPersistence'
import { BOARD_PERSIST_FAILED_EVENT, type PersistedBoardState } from '../src/utils/hierarchicalCanvas'
import {
  BOARD_WORKSPACE_STATE_UPDATED_EVENT,
  type BoardWorkspaceStateUpdatedDetail,
} from '../src/utils/boardWorkspaceEvents'

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
  pendingIntegrationNodeIds: ['node-1'],
  synthesisAlerts: [],
})

const installIndexedBoardShadowMock = () => {
  const records = new Map<string, unknown>()
  const objectStore = {
    put: vi.fn((record: { investigationId: string }) => {
      const request = {} as IDBRequest<boolean>
      queueMicrotask(() => {
        records.set(record.investigationId, record)
        request.onsuccess?.(new Event('success') as Event)
      })
      return request
    }),
    get: vi.fn((investigationId: string) => {
      const request = {} as IDBRequest<unknown>
      queueMicrotask(() => {
        Object.defineProperty(request, 'result', {
          configurable: true,
          value: records.get(investigationId),
        })
        request.onsuccess?.(new Event('success') as Event)
      })
      return request
    }),
    delete: vi.fn((investigationId: string) => {
      const request = {} as IDBRequest<boolean>
      queueMicrotask(() => {
        records.delete(investigationId)
        request.onsuccess?.(new Event('success') as Event)
      })
      return request
    }),
  }
  const database = {
    objectStoreNames: {
      contains: () => true,
    },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    transaction: vi.fn(() => ({
      objectStore: () => objectStore,
    })),
  }
  const indexedDB = {
    open: vi.fn(() => {
      const request = {} as IDBOpenDBRequest
      queueMicrotask(() => {
        Object.defineProperty(request, 'result', {
          configurable: true,
          value: database,
        })
        request.onsuccess?.(new Event('success') as Event)
      })
      return request
    }),
  }

  Object.defineProperty(window, 'indexedDB', {
    configurable: true,
    value: indexedDB,
  })

  return { records, objectStore }
}

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

  it('clears orphaned legacy browser investigation payloads after backend catalog load', async () => {
    localStorage.setItem('inv_data_inv-orphaned', JSON.stringify(buildBoardState()))
    localStorage.setItem('vault_result_inv-orphaned', JSON.stringify({ report: 'Old report' }))
    localStorage.setItem(
      'gorantula_discoveries_by_investigation',
      JSON.stringify({ 'inv-orphaned': [{ id: 'old-discovery', title: 'Old discovery' }] }),
    )

    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: true, json: async () => [] } as Response
    }))

    await loadInvestigations()

    expect(localStorage.getItem('inv_data_inv-orphaned')).toBeNull()
    expect(localStorage.getItem('vault_result_inv-orphaned')).toBeNull()
    expect(localStorage.getItem('gorantula_discoveries_by_investigation')).toBeNull()
  })

  it('saves a board shadow without warning when backend board save is offline', async () => {
    const boardState = buildBoardState()
    const failedEvents: Event[] = []
    const shadow = installIndexedBoardShadowMock()
    window.addEventListener(BOARD_PERSIST_FAILED_EVENT, (event) => failedEvents.push(event))

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('backend offline')
    }))

    const saved = await saveBoardStateForInvestigation('inv-fallback', boardState)

    expect(saved).toBe(true)
    expect(localStorage.getItem('inv_data_inv-fallback')).toBeNull()
    expect(shadow.objectStore.put).toHaveBeenCalled()
    expect(shadow.records.get('inv-fallback')).toMatchObject({
      investigationId: 'inv-fallback',
      state: boardState,
    })
    expect(failedEvents).toHaveLength(0)
  })

  it('serves a backend-mode board from the in-memory cache before backend hydration', async () => {
    const boardState = buildBoardState()
    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: true, json: async () => ({}) } as Response
    }))

    await saveBoardStateForInvestigation('inv-memory-cache', boardState)

    const cached = getCachedBoardStateForInvestigation('inv-memory-cache')

    expect(cached?.nodes).toHaveLength(1)
    expect(cached?.nodes[0]?.data?.title).toBe('Persisted lead')
  })

  it('emits a persisted board update detail after backend board save completes', async () => {
    const boardState = buildBoardState()
    const updates: BoardWorkspaceStateUpdatedDetail[] = []
    window.addEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, (event) => {
      updates.push((event as CustomEvent<BoardWorkspaceStateUpdatedDetail>).detail)
    })

    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: true, json: async () => ({}) } as Response
    }))

    await saveBoardStateForInvestigation('inv-brain-refresh', boardState)

    expect(updates).toHaveLength(2)
    expect(updates[0]).toMatchObject({
      investigationId: 'inv-brain-refresh',
      persisted: false,
      source: 'memory-cache',
      nodeCount: 1,
      edgeCount: 0,
    })
    expect(updates[1]).toMatchObject({
      investigationId: 'inv-brain-refresh',
      persisted: true,
      source: 'backend',
      nodeCount: 1,
      edgeCount: 0,
    })
    expect(updates[1]?.contentSignature).toContain('Persisted lead')
  })

  it('keeps the cached board object when backend hydration matches memory cache', async () => {
    const boardState = buildBoardState()
    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: true, json: async () => ({}) } as Response
    }))

    await saveBoardStateForInvestigation('inv-shadow-match', boardState)
    const cached = getCachedBoardStateForInvestigation('inv-shadow-match')

    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: true, json: async () => boardState } as Response
    }))

    const loaded = await loadBoardStateForInvestigation('inv-shadow-match')

    expect(loaded).toBe(cached)
  })

  it('does not use quota-limited browser storage for backend board shadow saves', async () => {
    const boardState = buildBoardState()
    const failedEvents: Event[] = []
    window.addEventListener(BOARD_PERSIST_FAILED_EVENT, (event) => failedEvents.push(event))
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    vi.stubGlobal('fetch', vi.fn(async () => {
      return { ok: true, json: async () => ({}) } as Response
    }))

    try {
      const saved = await saveBoardStateForInvestigation('inv-shadow-save', boardState)

      expect(saved).toBe(true)
      expect(localStorage.getItem('inv_data_inv-shadow-save')).toBeNull()
      expect(localStorage.getItem('gorantula_board_shadow_inv-shadow-save')).toBeNull()
      expect(setItemSpy).not.toHaveBeenCalled()
      expect(failedEvents).toHaveLength(0)
    } finally {
      setItemSpy.mockRestore()
    }
  })

  it('keeps backend board state authoritative when browser storage has stale board evidence', async () => {
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

    expect(loaded?.nodes).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://localhost:8080/api/investigations/inv-local-rich/board',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('keeps backend discovery state authoritative when browser storage has stale discoveries', async () => {
    localStorage.setItem(
      'gorantula_discoveries_by_investigation',
      JSON.stringify({
        'inv-local-discoveries': [
          { id: 'discovery-local', title: 'Recovered local discovery' },
        ],
      }),
    )

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: true, json: async () => ({}) } as Response
      }
      return { ok: true, json: async () => [] } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const discoveries = await loadDiscoveriesForInvestigation('inv-local-discoveries')

    expect(discoveries).toEqual([])
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://localhost:8080/api/investigations/inv-local-discoveries/discoveries',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('preserves an existing timeline snapshot when board saves omit it', async () => {
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

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return { ok: true, json: async () => ({}) } as Response
      }
      return { ok: true, json: async () => existingState } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await loadBoardStateForInvestigation('inv-timeline')

    await saveBoardStateForInvestigation('inv-timeline', {
      mode: 'strict-grid',
      nodes: [{ id: 'node-1', type: 'custom', position: { x: 1, y: 1 }, data: { title: 'Updated' } }],
      edges: [],
    })

    const putCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(putCall).toBeDefined()
    const saved = JSON.parse(String(putCall?.[1]?.body))
    expect(saved.timelineSnapshot.events).toHaveLength(1)
    expect(saved.timelineSnapshot.sourceFingerprint).toBe('tl-existing')
  })
})
