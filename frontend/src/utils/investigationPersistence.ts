import type { InvestigationRecord } from './investigations'
import { INVESTIGATIONS_STORAGE_KEY, normalizeInvestigations } from './investigations'
import {
  BOARD_PERSIST_FAILED_EVENT,
  parsePersistedBoardState,
  type PersistedBoardState,
} from './hierarchicalCanvas'
import { BOARD_WORKSPACE_STATE_UPDATED_EVENT } from './boardWorkspaceEvents'

const API_BASE = 'http://localhost:8080/api/investigations'
const DISCOVERIES_STORAGE_KEY = 'gorantula_discoveries_by_investigation'
const MIGRATION_MARKER_KEY = 'gorantula_backend_persistence_migrated_at'

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

const isBrowser = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
const shouldUseBackendPersistence = () =>
  import.meta.env.MODE !== 'test' || Boolean((globalThis as { __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean }).__GORANTULA_BACKEND_PERSISTENCE_TEST__)

const safeJSONStringify = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

const emitBoardUpdate = () => {
  if (!isBrowser()) {
    return
  }
  window.dispatchEvent(new CustomEvent(BOARD_WORKSPACE_STATE_UPDATED_EVENT))
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

const preserveExistingTimelineSnapshot = (
  investigationId: string,
  state: PersistedBoardState,
) => {
  if (state.timelineSnapshot) {
    return state
  }

  const existingState = boardStateCache.get(investigationId) || getLocalBoardStateForInvestigation(investigationId)
  if (!existingState?.timelineSnapshot) {
    return state
  }

  return {
    ...state,
    timelineSnapshot: existingState.timelineSnapshot,
  }
}

const hasBoardEvidence = (state: PersistedBoardState) =>
  state.nodes.length > 0 ||
  state.edges.length > 0 ||
  Boolean(state.pendingIntegrationNodeIds?.length) ||
  Boolean(state.synthesisAlerts?.length)

const reconcileLoadedBoardState = (
  investigationId: string,
  backendState: PersistedBoardState,
) => {
  const localState = getLocalBoardStateForInvestigation(investigationId)
  if (!hasBoardEvidence(backendState) && localState && hasBoardEvidence(localState)) {
    return {
      state: preserveExistingTimelineSnapshot(investigationId, localState),
      shouldBackfillBackend: true,
    }
  }

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

export const getCachedInvestigations = () => investigationCache

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

  localSet(MIGRATION_MARKER_KEY, new Date().toISOString())
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

    if (localRecords.length > 0) {
      const backendIds = new Set(backendRecords.map((record) => record.id))
      const missingLocalRecords = localRecords.filter((record) => !backendIds.has(record.id))
      if (missingLocalRecords.length > 0) {
        await migrateBrowserInvestigationData(missingLocalRecords)
      }
    }

    const merged = normalizeInvestigations([
      ...backendRecords,
      ...localRecords.filter((record) => !backendRecords.some((backend) => backend.id === record.id)),
    ])
    investigationCache = merged
    return merged
  } catch (error) {
    console.warn('[InvestigationPersistence] Backend investigation catalog unavailable; using browser fallback.', error)
    const localRecords = loadInvestigationsFromBrowserStorage()
    investigationCache = localRecords
    return localRecords
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
    console.warn('[InvestigationPersistence] Failed to save investigation catalog to backend; writing browser fallback.', error)
    localSet(INVESTIGATIONS_STORAGE_KEY, records)
    throw error
  }
}

export const getCachedBoardStateForInvestigation = (investigationId: string) => {
  const localState = getLocalBoardStateForInvestigation(investigationId)
  if (import.meta.env.MODE === 'test') {
    return localState || boardStateCache.get(investigationId) || null
  }
  return boardStateCache.get(investigationId) || localState
}

export const loadBoardStateForInvestigation = async (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    try {
      const payload = await requestJSON<unknown>(`${API_BASE}/${encodeURIComponent(investigationId)}/board`)
      const parsed = parsePersistedBoardState(JSON.stringify(payload))
      if (parsed) {
        const { state: hydrated, shouldBackfillBackend } = reconcileLoadedBoardState(investigationId, parsed)
        boardStateCache.set(investigationId, hydrated)
        if (shouldBackfillBackend) {
          void saveBoardStateForInvestigation(investigationId, hydrated, { skipFallback: true })
        }
        return hydrated
      }
    } catch (error) {
      console.warn('[InvestigationPersistence] Backend board load unavailable; using browser fallback.', error)
    }
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
  emitBoardUpdate()

  if (!shouldUseBackendPersistence()) {
    if (!options.skipFallback) {
      localSet(`inv_data_${investigationId}`, stateToPersist, investigationId)
    }
    return true
  }

  try {
    await putJSON(`${API_BASE}/${encodeURIComponent(investigationId)}/board`, stateToPersist)
    return true
  } catch (error) {
    console.warn('[InvestigationPersistence] Failed to save board state to backend.', error)
    if (!options.skipFallback) {
      localSet(`inv_data_${investigationId}`, stateToPersist, investigationId)
      emitPersistFailure(investigationId, error)
    }
    return false
  }
}

export const getCachedVaultResultForInvestigation = (investigationId: string) =>
  vaultResultCache.get(investigationId) || parseLocalJSON<VaultResultPayload | null>(localGet(`vault_result_${investigationId}`), null)

export const loadVaultResultForInvestigation = async (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    try {
      const payload = await requestJSON<VaultResultPayload>(`${API_BASE}/${encodeURIComponent(investigationId)}/result`)
      if (payload && Object.keys(payload).length > 0) {
        vaultResultCache.set(investigationId, payload)
        return payload
      }
    } catch (error) {
      console.warn('[InvestigationPersistence] Backend vault result load unavailable; using browser fallback.', error)
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
      localSet(`vault_result_${investigationId}`, result, investigationId)
      emitPersistFailure(investigationId, error)
    }
    return false
  }
}

export const getCachedDiscoveriesForInvestigation = (investigationId: string) =>
  discoveriesCache.get(investigationId) || readBrowserDiscoveryBuckets()[investigationId] || []

export const loadDiscoveriesForInvestigation = async (investigationId: string) => {
  if (shouldUseBackendPersistence()) {
    try {
      const payload = await requestJSON<DiscoveryPayload>(`${API_BASE}/${encodeURIComponent(investigationId)}/discoveries`)
      const discoveries = Array.isArray(payload) ? payload : []
      const browserFallback = readBrowserDiscoveryBuckets()[investigationId] || []
      if (discoveries.length === 0 && browserFallback.length > 0) {
        discoveriesCache.set(investigationId, browserFallback)
        void saveDiscoveriesForInvestigation(investigationId, browserFallback, { skipFallback: true })
        return browserFallback
      }
      discoveriesCache.set(investigationId, discoveries)
      return discoveries
    } catch (error) {
      console.warn('[InvestigationPersistence] Backend discoveries load unavailable; using browser fallback.', error)
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
      const buckets = readBrowserDiscoveryBuckets()
      buckets[investigationId] = discoveries
      localSet(DISCOVERIES_STORAGE_KEY, buckets, investigationId)
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
