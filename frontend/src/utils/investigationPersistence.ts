import type { InvestigationRecord } from './investigations'
import { INVESTIGATIONS_STORAGE_KEY, normalizeInvestigations } from './investigations'
import {
  BOARD_PERSIST_FAILED_EVENT,
  parsePersistedBoardState,
  type PersistedBoardState,
} from './hierarchicalCanvas'
import {
  BOARD_WORKSPACE_STATE_UPDATED_EVENT,
  type BoardWorkspaceStateUpdatedDetail,
} from './boardWorkspaceEvents'

const API_BASE = 'http://localhost:8080/api/investigations'
const DISCOVERIES_STORAGE_KEY = 'gorantula_discoveries_by_investigation'
const BOARD_SHADOW_DB_NAME = 'gorantula-board-cache'
const BOARD_SHADOW_DB_VERSION = 1
const BOARD_SHADOW_STORE_NAME = 'boards'

export type VaultResultPayload = Record<string, unknown>
type DiscoveryPayload = Record<string, unknown>[]
export type RelationshipResultPayload = {
  vaultId?: string
  runId?: string
  createdAt?: string
  incremental?: boolean
  pendingNodeIds?: string[]
  connections: Record<string, unknown>[]
}

const boardStateCache = new Map<string, PersistedBoardState>()
const vaultResultCache = new Map<string, VaultResultPayload>()
const discoveriesCache = new Map<string, DiscoveryPayload>()
const relationshipResultCache = new Map<string, RelationshipResultPayload>()
let investigationCache: InvestigationRecord[] = []
let boardShadowDatabasePromise: Promise<IDBDatabase | null> | null = null

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const shouldUseBackendPersistence = () =>
  import.meta.env.MODE !== 'test' || Boolean((globalThis as { __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean }).__GORANTULA_BACKEND_PERSISTENCE_TEST__)
const shouldUseBrowserInvestigationPersistence = () => !shouldUseBackendPersistence()

const safeJSONStringify = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const buildBoardContentSignature = (state: PersistedBoardState) => {
  const nodes = (state.nodes || []).map((node) => ({
    id: String(node.id || ''),
    title: String(node.data?.title || ''),
    summary: String(node.data?.summary || ''),
    fullText: String(node.data?.fullText || ''),
    sourceURL: String(node.data?.sourceURL || ''),
    sourceURLs: Array.isArray(node.data?.sourceURLs) ? node.data.sourceURLs.map(String).sort() : [],
  })).sort((left, right) => left.id.localeCompare(right.id))

  const edges = (state.edges || []).map((edge) => ({
    id: String(edge.id || ''),
    source: String(edge.source || ''),
    target: String(edge.target || ''),
    label: String(edge.label || edge.data?.displayLabel || edge.data?.tag || ''),
  })).sort((left, right) => left.id.localeCompare(right.id))

  return safeJSONStringify({ nodes, edges }) || `nodes:${nodes.length}|edges:${edges.length}`
}

const buildBoardUpdateDetail = (
  investigationId: string,
  state: PersistedBoardState,
  persisted: boolean,
  source: BoardWorkspaceStateUpdatedDetail['source'],
): BoardWorkspaceStateUpdatedDetail => ({
  investigationId,
  persisted,
  source,
  nodeCount: state.nodes?.length || 0,
  edgeCount: state.edges?.length || 0,
  contentSignature: buildBoardContentSignature(state),
})

const emitBoardUpdate = (detail?: BoardWorkspaceStateUpdatedDetail) => {
  if (!isBrowser()) {
    return
  }
  window.dispatchEvent(new CustomEvent(BOARD_WORKSPACE_STATE_UPDATED_EVENT, detail ? { detail } : undefined))
}

const emitPersistFailure = (investigationId: string, error: unknown) => {
  if (!isBrowser()) {
    return
  }
  window.dispatchEvent(new CustomEvent(BOARD_PERSIST_FAILED_EVENT, {
    detail: {
      investigationId,
      errorName: error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: unknown }).name || 'UnknownError')
        : 'BackendPersistenceError',
    },
  }))
}

const isBackendUnavailableError = (error: unknown) => {
  const errorName = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : ''
  const errorMessage = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : String(error || '')
  return /typeerror/i.test(errorName)
    || /failed to fetch|network|backend offline|connection refused|err_connection_refused/i.test(errorMessage)
}

const localGet = (key: string) => {
  if (!isBrowser()) {
    return null
  }
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

const getLocalBoardStateForInvestigation = (investigationId: string) =>
  parsePersistedBoardState(localGet(`inv_data_${investigationId}`))

const arePersistedBoardStatesEquivalent = (
  left: PersistedBoardState | null | undefined,
  right: PersistedBoardState | null | undefined,
) => {
  if (!left || !right) {
    return false
  }
  return safeJSONStringify(left) === safeJSONStringify(right)
}

const parseBoardShadowState = (value: unknown) => {
  const serialized = safeJSONStringify(value)
  return serialized ? parsePersistedBoardState(serialized) : null
}

const openBoardShadowDatabase = () => {
  if (!isBrowser() || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null)
  }

  if (boardShadowDatabasePromise) {
    return boardShadowDatabasePromise
  }

  boardShadowDatabasePromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = window.indexedDB.open(BOARD_SHADOW_DB_NAME, BOARD_SHADOW_DB_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(BOARD_SHADOW_STORE_NAME)) {
        database.createObjectStore(BOARD_SHADOW_STORE_NAME, { keyPath: 'investigationId' })
      }
    }

    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }

    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return boardShadowDatabasePromise
}

const withBoardShadowStore = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
) => {
  const database = await openBoardShadowDatabase()
  if (!database) {
    return null
  }

  try {
    const transaction = database.transaction(BOARD_SHADOW_STORE_NAME, mode)
    return await operation(transaction.objectStore(BOARD_SHADOW_STORE_NAME))
  } catch {
    return null
  }
}

const getIndexedBoardShadowStateForInvestigation = async (investigationId: string) =>
  withBoardShadowStore('readonly', (store) => new Promise<PersistedBoardState | null>((resolve) => {
    const request = store.get(investigationId)

    request.onsuccess = () => {
      const record = request.result as { state?: unknown } | undefined
      resolve(parseBoardShadowState(record?.state))
    }

    request.onerror = () => resolve(null)
  }))

const writeIndexedBoardShadowStateForInvestigation = async (
  investigationId: string,
  state: PersistedBoardState,
) => {
  return Boolean(await withBoardShadowStore('readwrite', (store) => new Promise<boolean>((resolve) => {
    const request = store.put({
      investigationId,
      state,
      updatedAt: Date.now(),
    })

    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
  })))
}

const deleteIndexedBoardShadowStateForInvestigation = async (investigationId: string) => {
  await withBoardShadowStore('readwrite', (store) => new Promise<boolean>((resolve) => {
    const request = store.delete(investigationId)

    request.onsuccess = () => resolve(true)
    request.onerror = () => resolve(false)
  }))
}

// Drops the in-memory cache and the IndexedDB shadow for one investigation
// so the next board load fetches the backend board state fresh. Used when
// the backend has written newer board content (gathered nodes from a
// parallel scan) that a stale local shadow must not shadow out.
export const invalidateBoardStateForInvestigation = async (investigationId: string) => {
  const id = investigationId.trim()
  if (!id) {
    return
  }
  boardStateCache.delete(id)
  if (shouldUseBackendPersistence()) {
    await deleteIndexedBoardShadowStateForInvestigation(id)
  }
}

const preserveExistingTimelineSnapshot = (
  investigationId: string,
  state: PersistedBoardState,
) => {
  if (state.timelineSnapshot) {
    return state
  }

  const existingState = boardStateCache.get(investigationId) || (
    shouldUseBrowserInvestigationPersistence()
      ? getLocalBoardStateForInvestigation(investigationId)
      : null
  )
  if (!existingState?.timelineSnapshot) {
    return state
  }

  return {
    ...state,
    timelineSnapshot: existingState.timelineSnapshot,
  }
}

const reconcileLoadedBoardState = (
  investigationId: string,
  backendState: PersistedBoardState,
) => {
  return {
    state: preserveExistingTimelineSnapshot(investigationId, backendState),
    shouldBackfillBackend: false,
  }
}

const localSet = (key: string, value: unknown, investigationId?: string) => {
  if (!isBrowser()) {
    return false
  }
  const serialized = typeof value === 'string' ? value : safeJSONStringify(value)
  if (serialized === null) {
    return false
  }
  try {
    window.localStorage.setItem(key, serialized)
    return true
  } catch (error) {
    if (investigationId) {
      emitPersistFailure(investigationId, error)
    }
    return false
  }
}

const localRemove = (key: string) => {
  if (!isBrowser()) {
    return
  }
  try {
    window.localStorage.removeItem(key)
  } catch {
    // best-effort cleanup only
  }
}

export const loadInvestigationsFromBrowserStorage = () => {
  const saved = localGet(INVESTIGATIONS_STORAGE_KEY)
  if (!saved) {
    return []
  }

  try {
    return normalizeInvestigations(JSON.parse(saved))
  } catch (error) {
    console.error('[InvestigationPersistence] Failed to parse local investigations', error)
    return []
  }
}

export const getCachedInvestigations = () =>
  shouldUseBackendPersistence() ? investigationCache : loadInvestigationsFromBrowserStorage()

const requestJSON = async <T>(url: string, options?: RequestInit): Promise<T> => {
  if (!shouldUseBackendPersistence()) {
    throw new Error('Backend persistence disabled in test mode')
  }

  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

const putJSON = async (url: string, payload: unknown) => {
  await requestJSON(url, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export const migrateBrowserInvestigationData = async (records: InvestigationRecord[]) => {
  if (records.length === 0) {
    return
  }

  const discoveryBuckets = readBrowserDiscoveryBuckets()
  await Promise.all(records.map(async (record) => {
    await saveInvestigationMetadata(record)

    const board = parsePersistedBoardState(localGet(`inv_data_${record.id}`))
    if (board) {
      await saveBoardStateForInvestigation(record.id, board, { skipFallback: true })
    }

    const vaultResult = parseLocalJSON<VaultResultPayload | null>(localGet(`vault_result_${record.id}`), null)
    if (vaultResult && Object.keys(vaultResult).length > 0) {
      await saveVaultResultForInvestigation(record.id, vaultResult, { skipFallback: true })
    }

    const discoveries = Array.isArray(discoveryBuckets[record.id]) ? discoveryBuckets[record.id] : []
    if (discoveries.length > 0) {
      await saveDiscoveriesForInvestigation(record.id, discoveries, { skipFallback: true })
    }
  }))

}

const clearBrowserInvestigationData = () => {
  if (!isBrowser()) {
    return
  }

  localRemove(INVESTIGATIONS_STORAGE_KEY)
  localRemove(DISCOVERIES_STORAGE_KEY)

  try {
    const keysToRemove: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key) {
        continue
      }
      if (key.startsWith('inv_data_') || key.startsWith('vault_result_')) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(localRemove)
  } catch {
    // Legacy browser cleanup is best-effort; backend data is already authoritative.
  }
}

export const loadInvestigations = async () => {
  if (!shouldUseBackendPersistence()) {
    const localRecords = loadInvestigationsFromBrowserStorage()
    investigationCache = localRecords
    return localRecords
  }

  try {
    const backendRecords = normalizeInvestigations(await requestJSON<unknown>(API_BASE))
    const localRecords = loadInvestigationsFromBrowserStorage()
    let migratedRecords: InvestigationRecord[] = []

    if (localRecords.length > 0) {
      const backendIds = new Set(backendRecords.map((record) => record.id))
      const missingLocalRecords = localRecords.filter((record) => !backendIds.has(record.id))
      if (missingLocalRecords.length > 0) {
        await migrateBrowserInvestigationData(missingLocalRecords)
        migratedRecords = missingLocalRecords
      }
    }
    clearBrowserInvestigationData()

    const merged = normalizeInvestigations([
      ...backendRecords,
      ...migratedRecords,
    ])
    investigationCache = merged
    return merged
  } catch (error) {
    console.warn('[InvestigationPersistence] Backend investigation catalog unavailable; using in-memory cache only.', error)
    return investigationCache
  }
}

export const saveInvestigationMetadata = async (record: InvestigationRecord) => {
  await putJSON(`${API_BASE}/${encodeURIComponent(record.id)}`, record)
}

export const saveInvestigations = async (records: InvestigationRecord[]) => {
  investigationCache = records
  if (!shouldUseBackendPersistence()) {
    localSet(INVESTIGATIONS_STORAGE_KEY, records)
    return
  }
  try {
    await Promise.all(records.map(saveInvestigationMetadata))
  } catch (error) {
    console.warn('[InvestigationPersistence] Failed to save investigation catalog to backend.', error)
    throw error
  }
}

export const getCachedBoardStateForInvestigation = (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    return boardStateCache.get(investigationId) || null
  }
  const localState = getLocalBoardStateForInvestigation(investigationId)
  return localState || boardStateCache.get(investigationId) || null
}

export const loadBoardStateForInvestigation = async (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    const memoryState = boardStateCache.get(investigationId)
    const indexedShadowState = memoryState ? null : await getIndexedBoardShadowStateForInvestigation(investigationId)

    try {
      // ALWAYS consult the backend board file: with pipeline parallelism the
      // crawl merges gathered nodes into it while the board is unmounted, so
      // a stale shadow can hold fewer nodes than the server. The richer
      // state wins; the shadow only wins an exact tie (nothing new to load).
      const payload = await requestJSON<unknown>(`${API_BASE}/${encodeURIComponent(investigationId)}/board`)
      const parsed = parsePersistedBoardState(JSON.stringify(payload))
      if (parsed) {
        const { state: hydrated, shouldBackfillBackend } = reconcileLoadedBoardState(investigationId, parsed)
        const localCandidate = memoryState || indexedShadowState
        const chosenState = richerBoardState(localCandidate, hydrated)

        const cachedState = boardStateCache.get(investigationId)
        if (cachedState && arePersistedBoardStatesEquivalent(cachedState, chosenState)) {
          boardStateCache.set(investigationId, cachedState)
          void writeIndexedBoardShadowStateForInvestigation(investigationId, cachedState)
          return cachedState
        }

        boardStateCache.set(investigationId, chosenState)
        void writeIndexedBoardShadowStateForInvestigation(investigationId, chosenState)
        if (shouldBackfillBackend) {
          void saveBoardStateForInvestigation(investigationId, chosenState, { skipFallback: true })
        }
        return chosenState
      }
    } catch (error) {
      if (isBackendUnavailableError(error)) {
        if (import.meta.env.DEV) {
          console.debug('[InvestigationPersistence] Backend board load unavailable; using browser cache only.', error)
        }
      } else {
        console.warn('[InvestigationPersistence] Backend board load unavailable; using in-memory cache only.', error)
      }
      return memoryState || indexedShadowState || boardStateCache.get(investigationId) || null
    }

    // Backend answered but had no parseable board: the shadow (if any) is
    // the best available state.
    if (indexedShadowState) {
      boardStateCache.set(investigationId, indexedShadowState)
      return indexedShadowState
    }
    if (memoryState) {
      boardStateCache.set(investigationId, memoryState)
      return memoryState
    }
    return null
  }

  const fallback = getLocalBoardStateForInvestigation(investigationId)
  if (fallback) {
    const hydrated = preserveExistingTimelineSnapshot(investigationId, fallback)
    boardStateCache.set(investigationId, hydrated)
    void saveBoardStateForInvestigation(investigationId, hydrated, { skipFallback: true })
    return hydrated
  } else {
    boardStateCache.delete(investigationId)
  }
  return null
}

// Picks the board state holding more nodes: with pipeline parallelism the
// backend board file gains gathered nodes while the board is unmounted, so
// a stale local shadow must not shadow it out. Exact node-count ties prefer
// the local state (it may carry unsaved operator edits).
const richerBoardState = (
  localState: PersistedBoardState | null | undefined,
  backendState: PersistedBoardState,
): PersistedBoardState => {
  if (!localState) {
    return backendState
  }
  const localCount = Array.isArray(localState.nodes) ? localState.nodes.length : 0
  const backendCount = Array.isArray(backendState.nodes) ? backendState.nodes.length : 0
  return backendCount >= localCount ? backendState : localState
}

export const saveBoardStateForInvestigation = async (
  investigationId: string,
  state: PersistedBoardState,
  options: { skipFallback?: boolean } = {},
) => {
  if (!investigationId) {
    return false
  }

  const stateToPersist = preserveExistingTimelineSnapshot(investigationId, state)

  boardStateCache.set(investigationId, stateToPersist)
  emitBoardUpdate(buildBoardUpdateDetail(investigationId, stateToPersist, false, 'memory-cache'))

  if (!shouldUseBackendPersistence()) {
    if (!options.skipFallback) {
      localSet(`inv_data_${investigationId}`, stateToPersist, investigationId)
      emitBoardUpdate(buildBoardUpdateDetail(investigationId, stateToPersist, true, 'browser-local'))
    }
    return true
  }

  try {
    await putJSON(`${API_BASE}/${encodeURIComponent(investigationId)}/board`, stateToPersist)
    void writeIndexedBoardShadowStateForInvestigation(investigationId, stateToPersist)
    emitBoardUpdate(buildBoardUpdateDetail(investigationId, stateToPersist, true, 'backend'))
    return true
  } catch (error) {
    const wroteShadowState = await writeIndexedBoardShadowStateForInvestigation(investigationId, stateToPersist)
    if (isBackendUnavailableError(error) && wroteShadowState) {
      if (import.meta.env.DEV) {
        console.debug('[InvestigationPersistence] Backend board save unavailable; saved browser shadow copy instead.', error)
      }
      emitBoardUpdate(buildBoardUpdateDetail(investigationId, stateToPersist, true, 'browser-shadow'))
      return true
    }

    console.warn('[InvestigationPersistence] Failed to save board state to backend.', error)
    if (!options.skipFallback && !wroteShadowState) {
      emitPersistFailure(investigationId, error)
    }
    return wroteShadowState
  }
}

export const getCachedVaultResultForInvestigation = (investigationId: string) =>
  vaultResultCache.get(investigationId) || (
    shouldUseBrowserInvestigationPersistence()
      ? parseLocalJSON<VaultResultPayload | null>(localGet(`vault_result_${investigationId}`), null)
      : null
  )

export const loadVaultResultForInvestigation = async (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    try {
      const payload = await requestJSON<VaultResultPayload>(`${API_BASE}/${encodeURIComponent(investigationId)}/result`)
      if (payload && Object.keys(payload).length > 0) {
        vaultResultCache.set(investigationId, payload)
        return payload
      }
    } catch (error) {
      console.warn('[InvestigationPersistence] Backend vault result load unavailable; using in-memory cache only.', error)
      return vaultResultCache.get(investigationId) || null
    }
  }

  const fallback = parseLocalJSON<VaultResultPayload | null>(localGet(`vault_result_${investigationId}`), null)
  if (fallback) {
    vaultResultCache.set(investigationId, fallback)
    void saveVaultResultForInvestigation(investigationId, fallback, { skipFallback: true })
  }
  return fallback
}

export const saveVaultResultForInvestigation = async (
  investigationId: string,
  result: VaultResultPayload,
  options: { skipFallback?: boolean } = {},
) => {
  vaultResultCache.set(investigationId, result)
  if (!shouldUseBackendPersistence()) {
    if (!options.skipFallback) {
      localSet(`vault_result_${investigationId}`, result, investigationId)
    }
    return true
  }
  try {
    await putJSON(`${API_BASE}/${encodeURIComponent(investigationId)}/result`, result)
    return true
  } catch (error) {
    console.warn('[InvestigationPersistence] Failed to save vault result to backend.', error)
    if (!options.skipFallback) {
      emitPersistFailure(investigationId, error)
    }
    return false
  }
}

export const getCachedDiscoveriesForInvestigation = (investigationId: string) =>
  discoveriesCache.get(investigationId) || (
    shouldUseBrowserInvestigationPersistence()
      ? readBrowserDiscoveryBuckets()[investigationId] || []
      : []
  )

export const loadDiscoveriesForInvestigation = async (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    try {
      const payload = await requestJSON<DiscoveryPayload>(`${API_BASE}/${encodeURIComponent(investigationId)}/discoveries`)
      const discoveries = Array.isArray(payload) ? payload : []
      discoveriesCache.set(investigationId, discoveries)
      return discoveries
    } catch (error) {
      console.warn('[InvestigationPersistence] Backend discoveries load unavailable; using in-memory cache only.', error)
      return discoveriesCache.get(investigationId) || []
    }
  }

  const fallback = readBrowserDiscoveryBuckets()[investigationId] || []
  discoveriesCache.set(investigationId, fallback)
  if (fallback.length > 0) {
    void saveDiscoveriesForInvestigation(investigationId, fallback, { skipFallback: true })
  }
  return fallback
}

export const saveDiscoveriesForInvestigation = async (
  investigationId: string,
  discoveries: DiscoveryPayload,
  options: { skipFallback?: boolean } = {},
) => {
  discoveriesCache.set(investigationId, discoveries)
  if (!shouldUseBackendPersistence()) {
    if (!options.skipFallback) {
      const buckets = readBrowserDiscoveryBuckets()
      buckets[investigationId] = discoveries
      localSet(DISCOVERIES_STORAGE_KEY, buckets, investigationId)
    }
    return true
  }
  try {
    await putJSON(`${API_BASE}/${encodeURIComponent(investigationId)}/discoveries`, discoveries)
    return true
  } catch (error) {
    console.warn('[InvestigationPersistence] Failed to save discoveries to backend.', error)
    if (!options.skipFallback) {
      emitPersistFailure(investigationId, error)
    }
    return false
  }
}

const normalizeRelationshipResultPayload = (
  investigationId: string,
  payload: unknown,
): RelationshipResultPayload | null => {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const result = payload as {
    vaultId?: unknown
    runId?: unknown
    createdAt?: unknown
    incremental?: unknown
    pendingNodeIds?: unknown
    connections?: unknown
  }

  if (!Array.isArray(result.connections)) {
    return null
  }

  return {
    vaultId: typeof result.vaultId === 'string' ? result.vaultId : investigationId,
    runId: typeof result.runId === 'string' ? result.runId : undefined,
    createdAt: typeof result.createdAt === 'string' ? result.createdAt : undefined,
    incremental: typeof result.incremental === 'boolean' ? result.incremental : undefined,
    pendingNodeIds: Array.isArray(result.pendingNodeIds)
      ? result.pendingNodeIds.filter((nodeId): nodeId is string => typeof nodeId === 'string')
      : undefined,
    connections: result.connections.filter((connection): connection is Record<string, unknown> =>
      Boolean(connection && typeof connection === 'object'),
    ),
  }
}

export const loadRelationshipResultForInvestigation = async (investigationId: string) => {
  if (!shouldUseBackendPersistence()) {
    return null
  }

  try {
    const payload = await requestJSON<unknown>(`${API_BASE}/${encodeURIComponent(investigationId)}/relationships`)
    const result = normalizeRelationshipResultPayload(investigationId, payload)
    if (!result) {
      return null
    }
    relationshipResultCache.set(investigationId, result)
    return result
  } catch (error) {
    console.warn('[InvestigationPersistence] Backend relationship result load unavailable.', error)
    return relationshipResultCache.get(investigationId) || null
  }
}

export const loadDiscoveriesForInvestigations = async (records: InvestigationRecord[]) => {
  const entries = await Promise.all(records.map(async (record) => [
    record.id,
    await loadDiscoveriesForInvestigation(record.id),
  ] as const))
  return Object.fromEntries(entries)
}

export const deleteInvestigationPersistence = async (investigationId: string) => {
  boardStateCache.delete(investigationId)
  vaultResultCache.delete(investigationId)
  discoveriesCache.delete(investigationId)
  relationshipResultCache.delete(investigationId)
  localRemove(`inv_data_${investigationId}`)
  localRemove(`vault_result_${investigationId}`)
  void deleteIndexedBoardShadowStateForInvestigation(investigationId)

  try {
    if (!shouldUseBackendPersistence()) {
      return
    }
    const response = await fetch(`${API_BASE}/${encodeURIComponent(investigationId)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(`Delete failed with ${response.status}`)
    }
  } catch (error) {
    console.warn('[InvestigationPersistence] Failed to delete backend investigation data.', error)
    throw error
  }
}

export const readBrowserDiscoveryBuckets = (): Record<string, DiscoveryPayload> => {
  const raw = localGet(DISCOVERIES_STORAGE_KEY)
  if (!raw) {
    return {}
  }
  return parseLocalJSON<Record<string, DiscoveryPayload>>(raw, {}) || {}
}

const parseLocalJSON = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
