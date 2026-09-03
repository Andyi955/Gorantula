import { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { MergeCandidateNode } from './components/SynthesisPanel'
import type { LandingTargetTab } from './components/LandingExperience'
import { Terminal, Database, Folder, Plus, Trash2, Settings, Clock, MessageSquare, Search, FileText, X, ListFilter, ChevronLeft, ChevronRight, GripVertical, AlertTriangle, Activity, Brain } from 'lucide-react'
import {
  buildSidebarInvestigationRows,
  createRootInvestigation,
  registerMergedChildInvestigation,
  removeInvestigationRecord,
  type InvestigationRecord,
} from './utils/investigations'
import { BOARD_PERSIST_FAILED_EVENT, createMergedChildBoard, type PersistedBoardState, type PersistedTimelineSnapshot } from './utils/hierarchicalCanvas'
import {
  BROWSER_QA_CLEARED_EVENT,
  BROWSER_QA_DISCOVERY_DEMO_EVENT,
  BROWSER_QA_ERROR_EMPTY_DEMO_EVENT,
  BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT,
  BROWSER_QA_PIPELINE_DEMO_EVENT,
  BROWSER_QA_SEEDED_EVENT,
  BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT,
  BROWSER_QA_SYNTHESIS_DEMO_EVENT,
  BROWSER_QA_TIMELINE_DEMO_EVENT,
  createBrowserQaDiscoveryDemoRecords,
  createBrowserQaLocalIngestionDemoFiles,
  createBrowserQaSynthesisDemoTheory,
  createBrowserQaTimelineDemoSnapshot,
  type BrowserQaDiscoveryDemoDetail,
  type BrowserQaErrorEmptyDemoDetail,
  type BrowserQaLocalIngestionDemoDetail,
  type BrowserQaPipelineDemoDetail,
  type BrowserQaSeedResult,
  type BrowserQaSpiderTelemetryDemoDetail,
  type BrowserQaSynthesisDemoDetail,
  type BrowserQaTimelineDemoDetail,
} from './utils/browserQaSeed'
import { IMAGE_SCRAPING_PREFERENCE_KEY, readImageScrapingPreference } from './utils/searchPreferences'
import { coerceBrainFiredEvent, fetchBrainSignals, type BrainFollowUpAction, type BrainSignal } from './utils/brainMemory'
import { countUnseenBrainSignals, markBrainSignalsSeen } from './utils/brainSeen'
import {
  BOARD_RESTORE_COMPLETE_EVENT,
  BOARD_TOGGLE_DISCOVERY_PANEL_EVENT,
  BOARD_WORKSPACE_STATE_UPDATED_EVENT,
  type BoardRestoreCompleteDetail,
} from './utils/boardWorkspaceEvents'
import {
  deleteInvestigationPersistence,
  getCachedBoardStateForInvestigation,
  getCachedInvestigations,
  getCachedVaultResultForInvestigation,
  loadBoardStateForInvestigation,
  loadDiscoveriesForInvestigations,
  loadInvestigations,
  loadRelationshipResultForInvestigation,
  loadVaultResultForInvestigation,
  saveBoardStateForInvestigation,
  saveDiscoveriesForInvestigation,
  saveInvestigations,
  saveVaultResultForInvestigation,
  type VaultResultPayload,
} from './utils/investigationPersistence'
import type { LocalIngestionFile, SpiderOperationMode } from './components/SpiderVisualizer'
import { calculateNodeFrame } from './components/boardGeometry'
import { STRICT_GRID_NODE_Z_INDEX } from './components/detectiveBoardStrictGridLayout'
import { nodeHasImages, type NodeImageAsset } from './components/nodeImages'
import { useBackendWebSocket } from './hooks/useBackendWebSocket'
import { usePipelineProgress } from './hooks/usePipelineProgress'
import {
  accumulateTokenUsage,
  buildEmptyTokenUsageReport,
  clampProgressPercent,
  coercePipelineProgressPayload,
  coerceTokenUsageReport,
  formatCompactTokens,
  formatDuration,
  formatPipelinePercent,
  formatTokenProviderBreakdown,
  getPipelineStepTransitionKey,
  getTopPipelineDurationBottleneck,
  getTopPipelineTokenBottleneck,
  getTopPipelineTokenUsage,
  parseTokenCount,
  type PipelinePerformanceProfile,
  type PipelineProgressPayload,
  type PipelineProgressStepState,
  type TokenUsageReport,
} from './utils/pipelineTelemetry'

const SpiderVisualizer = lazy(() => import('./components/SpiderVisualizer'))
const DetectiveBoard = lazy(() => import('./components/DetectiveBoard'))
const SettingsDashboard = lazy(() => import('./components/SettingsDashboard'))
const TimelineView = lazy(() => import('./components/TimelineView'))
const VaultChatbot = lazy(() => import('./components/VaultChatbot'))
const SynthesisPanel = lazy(() => import('./components/SynthesisPanel'))
const DiscoveryPanel = lazy(() => import('./components/DiscoveryPanel'))
const BrainSignalsPanel = lazy(() => import('./components/BrainSignalsPanel'))
const LandingExperience = lazy(() => import('./components/LandingExperience'))

type ActiveTab = 'spider' | 'board' | 'timeline' | 'brain' | 'chat' | 'settings'

export interface DiscoveryRecord {
  id: string
  title: string
  claim: string
  impact: string
  confidence: number
  sourceNodeIDs: string[]
  sourceVaultID: string
  createdAt: string
  nodeKind: string
}

interface AnimatedPipelineTokenState {
  runId: string | null
  target: number
  display: number
  isAnimating: boolean
}

interface RabbitHoleGatekeeperPanelState {
  runId?: string
  vaultId?: string
  pass: number
  descentMode: 'guided' | 'max'
  continueRecommended: boolean
  reason: string
  noveltyScore?: number
  suggestedQueries: string[]
  result?: string
  prompt?: string
}

interface AutosaveWarning {
  investigationId?: string
  errorName?: string
  timestamp: number
}

const formatAutosaveWarningMessage = (warning: AutosaveWarning) => {
  if (/quota/i.test(warning.errorName || '')) {
    return 'Storage quota blocked board persistence'
  }
  if (/backend|network|fetch/i.test(warning.errorName || '')) {
    return 'Backend persistence unavailable; using browser fallback'
  }
  return 'Board persistence needs attention'
}

interface ConfidenceCarrier {
  confidence?: number | null
}

interface SidebarRowMetrics {
  evidenceCount: number
}

interface DiscoveryEvidenceRecord {
  id: string
  title: string
  summary: string
  sourceURL?: string
}

interface InvestigationSwitchOverlayState {
  investigationId: string
  title: string
  startedAt: number
  phase: 'switching' | 'restoring'
}

interface PersistedRelationshipNode {
  id?: unknown
  data?: unknown
}

const BACKEND_STATUS_ENDPOINT = '/__gorantula_backend_status'
const BACKEND_WS_URL = 'ws://localhost:8080/ws'
const PIPELINE_RUNS_ENDPOINT = 'http://localhost:8080/api/pipeline-runs'
const WEBSOCKET_RETRY_DELAY_MS = 5000
const SHOULD_PROBE_BACKEND = import.meta.env.DEV && import.meta.env.MODE !== 'test'
const SIDEBAR_DEFAULT_WIDTH = 288
const SIDEBAR_BOARD_DEFAULT_WIDTH = 336
const SIDEBAR_MIN_WIDTH = 240
const SIDEBAR_MAX_WIDTH = 424
const SIDEBAR_COLLAPSED_WIDTH = 64
const INVESTIGATION_SWITCH_OVERLAY_MIN_MS = 360
const INVESTIGATION_SWITCH_OVERLAY_MAX_MS = 2400
const REPORT_READABILITY_CACHE_LIMIT = 40
const PIPELINE_STEP_TRANSITION_MS = 900
const PIPELINE_TOKEN_COUNT_MS = 600
const investigationTimestampPattern = /(?:inv|merge)-(\d{10,})$/i

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const formatProviderName = (provider: string) => {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'deepseek') return 'DeepSeek'
  if (normalized === 'openai') return 'OpenAI'
  if (normalized === 'gemini') return 'Gemini'
  return provider.trim() || 'Provider'
}

const formatSystemNotice = (message: string) => {
  const trimmed = message.trim()
  const imageFallbackMatch = trimmed.match(/image review failed for provider ['"]?([^'".]+)['"]?/i)
  if (imageFallbackMatch) {
    return `Image review fallback: ${formatProviderName(imageFallbackMatch[1])} using basic scraping`
  }

  const tokenUsageMatch = trimmed.match(/^(.+?) token usage:\s*(\d+)\s+total.*?across\s+(\d+)\s+calls/i)
  if (tokenUsageMatch) {
    const label = tokenUsageMatch[1].replace(/^full-board\s+/i, '').trim()
    const displayLabel = label ? `${label[0].toUpperCase()}${label.slice(1)}` : 'Token usage'
    return `${displayLabel}: ${formatCompactTokens(Number(tokenUsageMatch[2]))} tokens / ${tokenUsageMatch[3]} calls`
  }

  const partialPersonaMatch = trimmed.match(/^Partial persona analysis completed:\s*(\d+)\/(\d+)\s+personas succeeded;\s+missing\s+(.+?)\.?$/i)
  if (partialPersonaMatch) {
    return `Persona partial: ${partialPersonaMatch[1]}/${partialPersonaMatch[2]} succeeded, missing ${partialPersonaMatch[3]}`
  }

  return trimmed
}

const isRabbitHoleInvestigation = (investigation?: InvestigationRecord | null) => {
  if (!investigation) {
    return false
  }

  const topic = `${investigation.displayTopic || ''} ${investigation.topic || ''}`.trim().toLowerCase()
  return topic.startsWith('rabbit hole:') || topic.includes(' rabbit hole:')
}

const clampSidebarWidth = (value: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))

const createPipelineRunId = () => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const parseLocalCrawlPaths = (value: string) =>
  value
    .split('|')
    .map((entry) => entry.trim())
    .filter(Boolean)

const getLocalFileName = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

const createLocalIngestionFiles = (paths: string[]): LocalIngestionFile[] =>
  paths.map((path) => ({
    path,
    name: getLocalFileName(path),
    state: 'queued',
  }))

const coerceRabbitHoleGatekeeperPayload = (payload: unknown): RabbitHoleGatekeeperPanelState | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const candidate = payload as Record<string, unknown>
  const decision = candidate.decision && typeof candidate.decision === 'object' && !Array.isArray(candidate.decision)
    ? candidate.decision as Record<string, unknown>
    : {}
  const suggestedQueries = (Array.isArray(decision.suggestedQueries) ? decision.suggestedQueries : [])
    .filter((query): query is string => typeof query === 'string' && query.trim() !== '')
    .map((query) => query.trim())

  return {
    runId: typeof candidate.runId === 'string' ? candidate.runId.trim() : undefined,
    vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId.trim() : undefined,
    pass: Math.max(1, parseTokenCount(candidate.pass)),
    descentMode: candidate.descentMode === 'max' ? 'max' : 'guided',
    continueRecommended: decision.continue === true,
    reason: typeof decision.reason === 'string' && decision.reason.trim()
      ? decision.reason.trim()
      : (typeof decision.stopReason === 'string' ? decision.stopReason.trim() : 'Gatekeeper review complete.'),
    noveltyScore: typeof decision.noveltyScore === 'number' && Number.isFinite(decision.noveltyScore)
      ? decision.noveltyScore
      : undefined,
    suggestedQueries,
    result: typeof candidate.result === 'string' ? candidate.result : undefined,
    prompt: typeof candidate.prompt === 'string' ? candidate.prompt : undefined,
  }
}

const tabFallback = (label: string) => (
  <div className="forensic-tab-fallback flex h-full items-center justify-center gap-3 bg-cyber-black text-xs font-bold uppercase tracking-[0.24em] text-cyber-cyan/70">
    <span className="forensic-tab-fallback-dot" aria-hidden="true" />
    Loading {label}...
  </div>
)

const getInvestigationTimestamp = (investigationId: string): number | null => {
  const match = investigationId.match(investigationTimestampPattern)
  if (!match) {
    return null
  }

  const timestamp = Number.parseInt(match[1], 10)
  return Number.isFinite(timestamp) ? timestamp : null
}

const getMostRecentInvestigation = (investigations: InvestigationRecord[]): InvestigationRecord | null => {
  return investigations.reduce<InvestigationRecord | null>((latest, investigation) => {
    if (!latest) {
      return investigation
    }

    const latestTimestamp = getInvestigationTimestamp(latest.id) ?? Number.NEGATIVE_INFINITY
    const investigationTimestamp = getInvestigationTimestamp(investigation.id) ?? Number.NEGATIVE_INFINITY
    return investigationTimestamp > latestTimestamp ? investigation : latest
  }, null)
}

const getMostRecentInvestigationId = (investigations: InvestigationRecord[]) =>
  getMostRecentInvestigation(investigations)?.id || null

const getRelationshipSynthesisPayloadNodes = (boardState: { nodes?: unknown[] } | null | undefined) => {
  if (!boardState || !Array.isArray(boardState.nodes)) {
    return []
  }

  return boardState.nodes
    .map((node): Record<string, unknown> | null => {
      if (!node || typeof node !== 'object') {
        return null
      }

      const persistedNode = node as PersistedRelationshipNode
      const data = persistedNode.data && typeof persistedNode.data === 'object'
        ? { ...(persistedNode.data as Record<string, unknown>) }
        : { ...(node as Record<string, unknown>) }
      const nodeId = typeof data.id === 'string' && data.id.trim()
        ? data.id.trim()
        : typeof persistedNode.id === 'string'
          ? persistedNode.id.trim()
          : ''

      if (!nodeId || data.nodeKind === 'discovery') {
        return null
      }

      return {
        ...data,
        id: nodeId,
      }
    })
    .filter((node): node is Record<string, unknown> => Boolean(node))
}

const isRecordValue = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const getStringField = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

const getNumberField = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const isRabbitHoleMemoryNode = (node: Record<string, unknown>) =>
  getStringField(node.origin) === 'rabbit-hole' ||
  Boolean(getStringField(node.rabbitState)) ||
  Boolean(getStringField(node.rabbitTool)) ||
  getNumberField(node.rabbitPass) !== undefined

const coerceMemoryNodeMessagePayload = (payload: unknown) => {
  if (!isRecordValue(payload) || !isRecordValue(payload.node)) {
    return null
  }

  const vaultId = getStringField(payload.vaultId)
  const nodeId = getStringField(payload.node.id)
  if (!vaultId || !nodeId || !isRabbitHoleMemoryNode(payload.node)) {
    return null
  }

  return {
    vaultId,
    append: payload.append === true,
    node: {
      ...payload.node,
      id: nodeId,
    },
  }
}

const coerceRabbitHoleNodeUpdatePayload = (payload: unknown) => {
  if (!isRecordValue(payload)) {
    return null
  }

  const vaultId = getStringField(payload.vaultId)
  const rabbitState = getStringField(payload.rabbitState)
  const nodeIds = Array.isArray(payload.nodeIds)
    ? payload.nodeIds.map(getStringField).filter(Boolean)
    : []

  if (!vaultId || !rabbitState || nodeIds.length === 0) {
    return null
  }

  return { vaultId, rabbitState, nodeIds }
}

const getDurableRabbitNodePosition = (nodeIndex: number) => {
  const column = nodeIndex % 4
  const row = Math.floor(nodeIndex / 4)
  return {
    x: 144 + column * 432,
    y: 144 + row * 288,
  }
}

const createDurableRabbitNode = (
  node: Record<string, unknown> & { id: string },
  nodeIndex: number,
): PersistedBoardState['nodes'][number] => {
  const summary = getStringField(node.summary)
  const fullText = getStringField(node.fullText)
  const images = Array.isArray(node.images) ? node.images as NodeImageAsset[] : undefined
  const frame = calculateNodeFrame(summary, fullText, false, nodeHasImages(images))

  return {
    id: node.id,
    type: 'custom',
    zIndex: STRICT_GRID_NODE_Z_INDEX,
    style: frame,
    position: getDurableRabbitNodePosition(nodeIndex),
    data: {
      ...node,
      id: node.id,
      expanded: false,
      origin: getStringField(node.origin) || 'rabbit-hole',
      boardMode: 'strict-grid',
    },
  }
}

const persistDurableRabbitMemoryNode = async (
  payload: ReturnType<typeof coerceMemoryNodeMessagePayload>,
) => {
  if (!payload) {
    return
  }

  const incomingNode = payload.node as Record<string, unknown> & { id: string }
  const existingState = getCachedBoardStateForInvestigation(payload.vaultId)
    || await loadBoardStateForInvestigation(payload.vaultId)
    || { mode: 'strict-grid', nodes: [], edges: [], pendingIntegrationNodeIds: [] }
  const existingNodeIndex = existingState.nodes.findIndex((node) => node.id === incomingNode.id)
  const nextNodes = existingNodeIndex >= 0
    ? existingState.nodes.map((node, index) => (
      index === existingNodeIndex
        ? {
          ...node,
          data: {
            ...node.data,
            ...incomingNode,
            id: incomingNode.id,
            origin: getStringField(incomingNode.origin) || node.data?.origin || 'rabbit-hole',
          },
        }
        : node
    ))
    : [
      ...existingState.nodes,
      createDurableRabbitNode(incomingNode, existingState.nodes.length),
    ]

  const pendingIntegrationNodeIds = payload.append
    ? Array.from(new Set([...(existingState.pendingIntegrationNodeIds || []), incomingNode.id]))
    : existingState.pendingIntegrationNodeIds || []

  await saveBoardStateForInvestigation(payload.vaultId, {
    ...existingState,
    mode: existingState.mode || 'strict-grid',
    nodes: nextNodes,
    edges: existingState.edges || [],
    pendingIntegrationNodeIds,
    synthesisAlerts: existingState.synthesisAlerts || [],
  })
}

const persistDurableRabbitNodeUpdate = async (
  payload: ReturnType<typeof coerceRabbitHoleNodeUpdatePayload>,
) => {
  if (!payload) {
    return
  }

  const existingState = getCachedBoardStateForInvestigation(payload.vaultId)
    || await loadBoardStateForInvestigation(payload.vaultId)
  if (!existingState) {
    return
  }

  const nodeIdSet = new Set(payload.nodeIds)
  let changed = false
  const nextNodes = existingState.nodes.map((node) => {
    if (!nodeIdSet.has(node.id)) {
      return node
    }
    changed = true
    return {
      ...node,
      data: {
        ...node.data,
        rabbitState: payload.rabbitState,
      },
    }
  })

  if (!changed) {
    return
  }

  await saveBoardStateForInvestigation(payload.vaultId, {
    ...existingState,
    nodes: nextNodes,
    edges: existingState.edges || [],
    pendingIntegrationNodeIds: existingState.pendingIntegrationNodeIds || [],
    synthesisAlerts: existingState.synthesisAlerts || [],
  })
}

const formatSidebarActivity = (investigationId: string) => {
  const timestamp = getInvestigationTimestamp(investigationId)
  if (!timestamp) {
    return 'Pinned case'
  }

  const elapsedMs = Date.now() - timestamp
  if (elapsedMs < 60_000) {
    return 'Just now'
  }

  const elapsedMinutes = Math.floor(elapsedMs / 60_000)
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`
  }

  const elapsedDays = Math.floor(elapsedHours / 24)
  if (elapsedDays < 7) {
    return `${elapsedDays}d ago`
  }

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

const getInvestigationCategoryLabel = (investigation: InvestigationRecord) => {
  if (investigation.kind === 'merged-child') {
    return 'Merged canvas'
  }

  if (investigation.kind === 'root') {
    return 'Investigation'
  }

  return 'Local board'
}

const getInvestigationLinkMetric = (investigation: InvestigationRecord) => {
  if (investigation.kind === 'merged-child') {
    return `${investigation.parentIds.length} parents`
  }

  const childCount = investigation.childIds.length
  if (childCount > 0) {
    return `${childCount} linked`
  }

  const mergedCount = investigation.mergedFromIds.length
  if (mergedCount > 0) {
    return `${mergedCount} merged`
  }

  return 'Ready'
}

const stripMarkdownFormatting = (text: string) => text
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
  .replace(/\*\*/g, '')
  .replace(/`/g, '')
  .replace(/^#+\s*/gm, '')
  .replace(/^\s*[-*]\s+/gm, '')
  .replace(/\r/g, '')
  .trim()

const cleanReportBody = (rawText: string) => {
  const normalized = stripMarkdownFormatting(rawText)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const executiveSummaryMatch = normalized.match(/(?:^|\n)(?:executive summary|case summary)\s*:?\s*([\s\S]*)$/i)
  const bodySource = executiveSummaryMatch?.[1] || normalized

  const lines = bodySource
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(intelligence report|to:|from:|date:|subject)\b/i.test(line))

  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

const truncateAtSentenceBoundary = (text: string, limit: number) => {
  if (text.length <= limit) {
    return text
  }

  const slice = text.slice(0, limit)
  const boundaryIndex = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
  )

  if (boundaryIndex > Math.floor(limit * 0.55)) {
    return `${slice.slice(0, boundaryIndex + 1).trim()}`
  }

  return `${slice.trimEnd()}...`
}

const extractReadableSummary = (rawText: string) => {
  const cleaned = cleanReportBody(rawText).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
  return truncateAtSentenceBoundary(cleaned, 240)
}

const readableReportCache = new Map<string, { fullReport: string; summary: string }>()

const getReadableReportSnapshot = (rawText: string) => {
  const cached = readableReportCache.get(rawText)
  if (cached) {
    return cached
  }

  const readableReport = cleanReportBody(rawText)
  const summary = extractReadableSummary(rawText) || truncateAtSentenceBoundary(readableReport, 240)
  const snapshot = {
    fullReport: readableReport || stripMarkdownFormatting(rawText),
    summary,
  }
  readableReportCache.set(rawText, snapshot)
  if (readableReportCache.size > REPORT_READABILITY_CACHE_LIMIT) {
    const oldestKey = readableReportCache.keys().next().value
    if (typeof oldestKey === 'string') {
      readableReportCache.delete(oldestKey)
    }
  }
  return snapshot
}

const getAppLoadNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

const formatWorkspaceTimestamp = (investigationId: string | null) => {
  if (!investigationId) {
    return '--'
  }

  const timestamp = getInvestigationTimestamp(investigationId)
  if (!timestamp) {
    return 'Awaiting sync'
  }

  return new Date(timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  })
}

const isFiniteConfidence = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

type FocusedFollowUpLaunchNotice = {
  title: string
  investigationId: string
}

function App() {
  const initialInvestigationsRef = useRef<InvestigationRecord[] | null>(null)
  if (initialInvestigationsRef.current === null) {
    initialInvestigationsRef.current = getCachedInvestigations()
  }

  const [activeTab, setActiveTab] = useState<ActiveTab>('spider')
  // Brain synapse engine: bumped whenever the backend broadcasts BRAIN_FIRED so
  // the open Brain panel refreshes. The badge counts unseen signals per
  // investigation (persisted seen-state in utils/brainSeen.ts), so the number
  // is stable across page refreshes instead of counting raw events.
  const [brainFiredToken, setBrainFiredToken] = useState(0)
  const [brainUnreadByInvestigation, setBrainUnreadByInvestigation] = useState<Record<string, number>>({})
  const [prompt, setPrompt] = useState('')
  const [crawlMode, setCrawlMode] = useState<SpiderOperationMode>('web')
  const [rabbitHoleDescentMode, setRabbitHoleDescentMode] = useState<'guided' | 'max'>('guided')
  const [focusedFollowUpLaunchNotice, setFocusedFollowUpLaunchNotice] = useState<FocusedFollowUpLaunchNotice | null>(null)
  const [imageScrapingEnabled, setImageScrapingEnabled] = useState(() => readImageScrapingPreference())
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [hasCustomSidebarWidth, setHasCustomSidebarWidth] = useState(false)
  const [investigationSwitchOverlay, setInvestigationSwitchOverlay] = useState<InvestigationSwitchOverlayState | null>(null)
  const [boardWorkspaceRevision, setBoardWorkspaceRevision] = useState(0)
  const [showSummaryLog, setShowSummaryLog] = useState(false)
  const [showLandingExperience, setShowLandingExperience] = useState(() => import.meta.env.MODE !== 'test')

  const [investigations, setInvestigations] = useState<InvestigationRecord[]>(() => initialInvestigationsRef.current || [])
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(() => getMostRecentInvestigationId(initialInvestigationsRef.current || []))
  // Mirrors the current view for the websocket handler, which is registered
  // once per socket and must not read stale state from its closure.
  const brainViewStateRef = useRef<{ tab: ActiveTab; investigationId: string | null }>({ tab: activeTab, investigationId: currentInvestigationId })
  useEffect(() => {
    brainViewStateRef.current = { tab: activeTab, investigationId: currentInvestigationId }
  }, [activeTab, currentInvestigationId])
  const brainUnreadCount = useMemo(
    () => Object.values(brainUnreadByInvestigation).reduce((total, count) => total + count, 0),
    [brainUnreadByInvestigation],
  )
  const recountBrainUnread = useCallback(async (investigationId: string) => {
    try {
      const signals = await fetchBrainSignals(investigationId)
      const unseen = countUnseenBrainSignals(investigationId, signals)
      setBrainUnreadByInvestigation((current) => ({ ...current, [investigationId]: unseen }))
    } catch {
      // Backend unavailable: leave the previous badge untouched.
    }
  }, [])
  // The Brain panel calls this after every load while it is open, which is
  // exactly what "the operator has looked at it" means.
  const handleBrainSignalsLoaded = useCallback((investigationId: string, signals: BrainSignal[]) => {
    markBrainSignalsSeen(investigationId, signals)
    setBrainUnreadByInvestigation((current) => (
      current[investigationId] ? { ...current, [investigationId]: 0 } : current
    ))
  }, [])
  const [returnVaultId, setReturnVaultId] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [discoveriesByInvestigation, setDiscoveriesByInvestigation] = useState<Record<string, DiscoveryRecord[]>>({})
  const [vaultResultsByInvestigation, setVaultResultsByInvestigation] = useState<Record<string, VaultResultPayload | null>>({})
  const [unreadDiscoveriesByInvestigation, setUnreadDiscoveriesByInvestigation] = useState<Record<string, boolean>>({})
  const [completedDiscoveryReviewByInvestigation, setCompletedDiscoveryReviewByInvestigation] = useState<Record<string, boolean>>({})
  const qaDiscoveryDemoByInvestigationRef = useRef<Record<string, DiscoveryRecord[]>>({})
  const qaSynthesisDemoByInvestigationRef = useRef<Record<string, VaultResultPayload>>({})
  const [qaTimelineDemoByInvestigation, setQaTimelineDemoByInvestigation] = useState<Record<string, PersistedTimelineSnapshot>>({})
  const [qaSpiderTelemetryDemoRequest, setQaSpiderTelemetryDemoRequest] = useState<{ investigationId?: string; requestId: string } | null>(null)
  const [qaLocalIngestionDemoRequest, setQaLocalIngestionDemoRequest] = useState<{ investigationId?: string; requestId: string } | null>(null)
  const [qaErrorEmptyDemoRequest, setQaErrorEmptyDemoRequest] = useState<{ investigationId?: string; requestId: string } | null>(null)
  const [qaLocalIngestionFilePaths, setQaLocalIngestionFilePaths] = useState<string[]>([])
  const [activeLocalIngestionFilePaths, setActiveLocalIngestionFilePaths] = useState<string[]>([])
  const [unreadTheoryByInvestigation, setUnreadTheoryByInvestigation] = useState<Record<string, boolean>>({})
  const [sessionTokenUsage, setSessionTokenUsage] = useState<TokenUsageReport>(() => buildEmptyTokenUsageReport('Session Total'))
  const [boardTokenUsageByInvestigation, setBoardTokenUsageByInvestigation] = useState<Record<string, TokenUsageReport>>({})
  const [rabbitHoleGatekeeper, setRabbitHoleGatekeeper] = useState<RabbitHoleGatekeeperPanelState | null>(null)
  const [animatedPipelineToken, setAnimatedPipelineToken] = useState<AnimatedPipelineTokenState>({
    runId: null,
    target: 0,
    display: 0,
    isAnimating: false,
  })
  const [autosaveWarning, setAutosaveWarning] = useState<AutosaveWarning | null>(null)
  const [systemNotice, setSystemNotice] = useState<string | null>(null)
  const [dismissedSystemNotice, setDismissedSystemNotice] = useState<string | null>(null)

  const investigationsRef = useRef(investigations);
  const investigationHydrationRequestRef = useRef(0);
  const crawlInputRef = useRef<HTMLInputElement | null>(null);
  const activeSidebarItemRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const investigationSwitchRequestRef = useRef(0);
  const investigationSwitchOverlayRef = useRef<InvestigationSwitchOverlayState | null>(null);
  const investigationSwitchOverlayTimeoutRef = useRef<number | null>(null);
  const currentInvestigation = investigations.find((investigation) => investigation.id === currentInvestigationId) || null;
  const qaPipelineDemoTimeoutsRef = useRef<number[]>([])
  const animatedPipelineTokenRef = useRef(animatedPipelineToken)
  const {
    pipelineRuns,
    activePipelineRun,
    activePipelineProfile,
    comparisonPipelineProfile,
    isPipelineDrawerOpen,
    dismissedPipelineChipRuns,
    pipelineStepTransitions,
    setPipelineProfiles,
    setActivePipelineRunId,
    setIsPipelineDrawerOpen,
    setDismissedPipelineChipRuns,
    refreshPipelineProfiles,
    clearPipelineStepTransitions,
    applyPipelineProgress,
    closePipelineDrawer: closePipelineProgressDrawer,
  } = usePipelineProgress({
    profilesEndpoint: PIPELINE_RUNS_ENDPOINT,
    stepTransitionMs: PIPELINE_STEP_TRANSITION_MS,
  })
  investigationsRef.current = investigations
  const getBackendSyncVaultIds = useCallback(() => investigationsRef.current.map((investigation) => investigation.id), [])
  const socketConfig = useBackendWebSocket({
    socketUrl: BACKEND_WS_URL,
    statusEndpoint: BACKEND_STATUS_ENDPOINT,
    reconnectDelayMs: WEBSOCKET_RETRY_DELAY_MS,
    shouldProbeBackend: SHOULD_PROBE_BACKEND,
    getSyncVaultIds: getBackendSyncVaultIds,
  })
  const sidebarRows = buildSidebarInvestigationRows(investigations);
  const isBoardWorkspaceActive = activeTab === 'board'
  const isForensicWorkspaceActive = isBoardWorkspaceActive || activeTab === 'spider' || activeTab === 'timeline' || activeTab === 'brain' || activeTab === 'chat' || activeTab === 'settings'
  const expandedSidebarWidth = hasCustomSidebarWidth
    ? sidebarWidth
    : (isBoardWorkspaceActive ? SIDEBAR_BOARD_DEFAULT_WIDTH : SIDEBAR_DEFAULT_WIDTH)
  const renderedSidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : expandedSidebarWidth
  const showFloatingPanelHandles = activeTab !== 'spider' && activeTab !== 'settings' && activeTab !== 'timeline' && activeTab !== 'brain' && activeTab !== 'chat' && !isBoardWorkspaceActive
  const visibleSystemNotice = activeTab === 'spider' && systemNotice && dismissedSystemNotice !== systemNotice ? systemNotice : null
  const systemNoticeText = visibleSystemNotice ? formatSystemNotice(visibleSystemNotice) : null

  const filteredSidebarRows = useMemo(() => {
    const query = sidebarSearchQuery.trim().toLowerCase()
    if (!query) {
      return sidebarRows
    }

    return sidebarRows.filter(({ investigation }) => {
      const searchableFields = [
        investigation.displayTopic,
        investigation.topic,
        getInvestigationCategoryLabel(investigation),
        getInvestigationLinkMetric(investigation),
      ]

      return searchableFields.some((field) => field.toLowerCase().includes(query))
    })
  }, [sidebarRows, sidebarSearchQuery])

  const sidebarRowMetrics = useMemo(() => {
    // Board state is cached outside React; this revision keeps sidebar counts fresh after board saves.
    void boardWorkspaceRevision
    return sidebarRows.reduce<Record<string, SidebarRowMetrics>>((metrics, { investigation }) => {
      if (metrics[investigation.id]) {
        return metrics
      }

      const savedBoardState = getCachedBoardStateForInvestigation(investigation.id)
      const nodes = savedBoardState?.nodes || []
      metrics[investigation.id] = {
        evidenceCount: nodes.filter((node) => !node.data?.portalKind).length,
      }
      return metrics
    }, {})
  }, [boardWorkspaceRevision, sidebarRows])

  const currentBoardSnapshot = useMemo(() => {
    // Board state is cached outside React; this revision keeps the summary in sync after board saves.
    void boardWorkspaceRevision
    if (!currentInvestigationId) {
      return {
        summary: 'Select an investigation to inspect its working summary, evidence counts, and board health.',
        fullReport: 'No investigation selected.',
        nodeCount: 0,
        edgeCount: 0,
        importCount: 0,
        imageCount: 0,
        evidenceCount: 0,
        confidenceScore: 0,
        lastActivityLabel: '--',
        discoveryRecords: [],
        evidenceByNodeId: {},
        hasTheoryReport: false,
        relationshipLabels: [],
        hasRabbitHoleEvidence: false,
      }
    }

    const savedBoardState = getCachedBoardStateForInvestigation(currentInvestigationId)
    const hasHydratedVaultResult = Object.prototype.hasOwnProperty.call(vaultResultsByInvestigation, currentInvestigationId)
    const qaSynthesisDemoResult = qaSynthesisDemoByInvestigationRef.current[currentInvestigationId]
    const savedVaultResult = qaSynthesisDemoResult || (hasHydratedVaultResult
      ? vaultResultsByInvestigation[currentInvestigationId]
      : getCachedVaultResultForInvestigation(currentInvestigationId))
    const persistedDiscoveries = discoveriesByInvestigation[currentInvestigationId] || []
    const savedDiscoveries = persistedDiscoveries
    const nodes = savedBoardState?.nodes || []
    const hasRabbitHoleEvidence = nodes.some((node) => node.data?.origin === 'rabbit-hole')
    const evidenceByNodeId = nodes.reduce<Record<string, DiscoveryEvidenceRecord>>((lookup, node) => {
      const id = typeof node.id === 'string' ? node.id : ''
      if (!id) {
        return lookup
      }
      lookup[id] = {
        id,
        title: String(node.data?.title || id),
        summary: String(node.data?.summary || node.data?.fullText || ''),
        sourceURL: typeof node.data?.sourceURL === 'string' ? node.data.sourceURL : undefined,
      }
      return lookup
    }, {})
    const edges = savedBoardState?.edges || []
    const relationshipLabels = Array.from(new Set(edges
      .map((edge) => String(edge.label || edge.data?.displayLabel || edge.data?.tag || '').trim())
      .filter(Boolean)))
      .slice(0, 8)
    const importCount = nodes.filter((node) => String(node.data?.title || '').includes('[IMPORTED]') || String(node.id || '').startsWith('imported-')).length
    const imageCount = nodes.reduce((total, node) => {
      const images = Array.isArray(node.data?.images) ? node.data.images.length : 0
      return total + images
    }, 0)
    const evidenceCount = nodes.filter((node) => !node.data?.portalKind).length
    const insightConfidences = nodes.flatMap((node) => (
      Array.isArray(node.data?.personaInsights)
        ? (node.data.personaInsights as ConfidenceCarrier[])
          .map((insight) => insight.confidence)
          .filter(isFiniteConfidence)
        : []
    ))
    const discoveryConfidences = savedDiscoveries
      .map((discovery) => discovery.confidence)
      .filter(isFiniteConfidence)

    let summary = 'No investigation summary available yet. Run a crawl or append more evidence to populate the case summary.'
    let fullReport = summary
    let hasTheoryReport = false
    if (savedVaultResult) {
      try {
        const rawResult = typeof savedVaultResult?.result === 'string' ? savedVaultResult.result : ''
        if (rawResult.trim()) {
          hasTheoryReport = true
          const readableSnapshot = getReadableReportSnapshot(rawResult)
          fullReport = readableSnapshot.fullReport
          summary = readableSnapshot.summary
        }
      } catch (error) {
        console.error('[App] Failed to parse persisted vault result', error)
      }
    } else if (nodes.length > 0) {
      const firstSummary = nodes.find((node) => typeof node.data?.summary === 'string' && node.data.summary.trim())?.data?.summary
      if (typeof firstSummary === 'string' && firstSummary.trim()) {
        const readableSnapshot = getReadableReportSnapshot(firstSummary)
        summary = readableSnapshot.summary
        fullReport = readableSnapshot.fullReport || summary
      }
    }

    const computedConfidence = insightConfidences.length > 0
      ? insightConfidences.reduce((total, confidence) => total + confidence, 0) / insightConfidences.length
      : discoveryConfidences.length > 0
        ? discoveryConfidences.reduce((total, confidence) => total + confidence, 0) / discoveryConfidences.length
        : nodes.length > 0
          ? Math.min(0.92, Math.max(0.42, 0.48 + ((edges.length / Math.max(nodes.length, 1)) * 0.08) + (Math.min(imageCount, 8) * 0.01)))
          : 0

    const confidenceScore = Math.max(0, Math.min(1, computedConfidence))

    return {
      summary,
      fullReport,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      importCount,
      imageCount,
      evidenceCount,
      confidenceScore,
      lastActivityLabel: formatWorkspaceTimestamp(currentInvestigationId),
      discoveryRecords: savedDiscoveries,
      evidenceByNodeId,
      hasTheoryReport,
      relationshipLabels,
      hasRabbitHoleEvidence,
    }
  }, [boardWorkspaceRevision, currentInvestigationId, discoveriesByInvestigation, vaultResultsByInvestigation])

  const vaultChatInvestigationContext = useMemo(() => {
    if (!currentInvestigationId || !currentInvestigation) {
      return null
    }

    return {
      investigationId: currentInvestigationId,
      title: currentInvestigation.displayTopic || currentInvestigation.topic,
      summary: currentBoardSnapshot.summary,
      fullReport: currentBoardSnapshot.fullReport,
      evidenceCount: currentBoardSnapshot.evidenceCount,
      relationshipCount: currentBoardSnapshot.edgeCount,
      importCount: currentBoardSnapshot.importCount,
      confidenceScore: currentBoardSnapshot.confidenceScore,
      hasTheoryReport: currentBoardSnapshot.hasTheoryReport,
      relationshipLabels: currentBoardSnapshot.relationshipLabels,
      evidence: Object.values(currentBoardSnapshot.evidenceByNodeId),
      discoveries: currentBoardSnapshot.discoveryRecords.map((discovery) => ({
        title: discovery.title,
        claim: discovery.claim,
        impact: discovery.impact,
        confidence: discovery.confidence,
        sourceNodeIDs: discovery.sourceNodeIDs,
      })),
    }
  }, [currentBoardSnapshot, currentInvestigation, currentInvestigationId])

  const focusSpiderInput = useCallback(() => {
    crawlInputRef.current?.focus()
  }, [])

  const handleLandingEnter = useCallback((tab?: LandingTargetTab) => {
    if (tab) {
      setActiveTab(tab)
    }
    setShowLandingExperience(false)
  }, [])

  const clearInvestigationSwitchTimeout = useCallback(() => {
    if (investigationSwitchOverlayTimeoutRef.current !== null) {
      window.clearTimeout(investigationSwitchOverlayTimeoutRef.current)
      investigationSwitchOverlayTimeoutRef.current = null
    }
  }, [])

  const clearInvestigationSwitchOverlay = useCallback((expectedInvestigationId?: string, expectedStartedAt?: number) => {
    const current = investigationSwitchOverlayRef.current
    if (
      expectedInvestigationId &&
      (
        !current ||
        current.investigationId !== expectedInvestigationId ||
        (typeof expectedStartedAt === 'number' && current.startedAt !== expectedStartedAt)
      )
    ) {
      return
    }

    clearInvestigationSwitchTimeout()
    investigationSwitchOverlayRef.current = null
    setInvestigationSwitchOverlay(null)
  }, [clearInvestigationSwitchTimeout])

  const openInvestigationFromSidebar = useCallback((investigation: InvestigationRecord, source: 'sidebar' | 'collapsed-sidebar' = 'sidebar') => {
    const nextReturnVaultId = investigation.kind === 'merged-child' ? investigation.primaryParentId : null

    if (currentInvestigationId === investigation.id) {
      setReturnVaultId(nextReturnVaultId)
      return
    }

    const startedAt = getAppLoadNow()
    const requestId = investigationSwitchRequestRef.current + 1
    const title = investigation.displayTopic || investigation.topic || investigation.id
    investigationSwitchRequestRef.current = requestId
    clearInvestigationSwitchTimeout()

    const nextOverlay: InvestigationSwitchOverlayState = {
      investigationId: investigation.id,
      title,
      startedAt,
      phase: 'switching',
    }
    investigationSwitchOverlayRef.current = nextOverlay
    setInvestigationSwitchOverlay(nextOverlay)
    console.info('[InvestigationSwitch] selected', {
      investigationId: investigation.id,
      title,
      source,
    })

    investigationSwitchOverlayTimeoutRef.current = window.setTimeout(() => {
      clearInvestigationSwitchOverlay(investigation.id, startedAt)
    }, INVESTIGATION_SWITCH_OVERLAY_MAX_MS)

    window.setTimeout(() => {
      if (investigationSwitchRequestRef.current !== requestId) {
        return
      }

      setReturnVaultId(nextReturnVaultId)
      setCurrentInvestigationId(investigation.id)
      console.info('[InvestigationSwitch] committed', {
        investigationId: investigation.id,
        durationMs: Math.max(0, Math.round(getAppLoadNow() - startedAt)),
      })
    }, 0)
  }, [clearInvestigationSwitchOverlay, clearInvestigationSwitchTimeout, currentInvestigationId])

  const handleOpenBrainInvestigation = useCallback((investigationId: string) => {
    const targetInvestigation = investigationsRef.current.find((investigation) => investigation.id === investigationId)
    if (!targetInvestigation) {
      return
    }

    openInvestigationFromSidebar(targetInvestigation)
    setActiveTab('board')
  }, [openInvestigationFromSidebar])

  const persistInvestigations = useCallback((nextInvestigations: InvestigationRecord[]) => {
    setInvestigations(nextInvestigations);
    void saveInvestigations(nextInvestigations).catch((error) => {
      console.warn('[App] Failed to persist investigations to backend.', error)
      setAutosaveWarning({
        errorName: error && typeof error === 'object' && 'name' in error
          ? String((error as { name?: unknown }).name || 'BackendPersistenceError')
          : 'BackendPersistenceError',
        timestamp: Date.now(),
      })
    });
  }, []);

  const closePipelineDrawer = useCallback(() => {
    closePipelineProgressDrawer()
    setAnimatedPipelineToken((current) => ({
      ...current,
      display: current.target,
      isAnimating: false,
    }))
  }, [closePipelineProgressDrawer])

  const clearQaPipelineDemoTimers = useCallback(() => {
    qaPipelineDemoTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId))
    qaPipelineDemoTimeoutsRef.current = []
  }, [])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const data = await loadInvestigations()
      if (cancelled) {
        return
      }
      if (data.length > 0) {
        setInvestigations(data)
        setCurrentInvestigationId(getMostRecentInvestigationId(data))
        const [discoveries, vaultResultEntries] = await Promise.all([
          loadDiscoveriesForInvestigations(data),
          Promise.all(data.map(async (investigation) => [
            investigation.id,
            await loadVaultResultForInvestigation(investigation.id),
          ] as const)),
          Promise.all(data.map((investigation) => loadBoardStateForInvestigation(investigation.id))),
        ])
        if (!cancelled) {
          setDiscoveriesByInvestigation(discoveries as unknown as Record<string, DiscoveryRecord[]>)
          setVaultResultsByInvestigation(Object.fromEntries(vaultResultEntries))
          setBoardWorkspaceRevision((current) => current + 1)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void refreshPipelineProfiles()
  }, [refreshPipelineProfiles])

  const requestOffscreenRelationshipSynthesis = useCallback(async (vaultId: string, runId?: string) => {
    const socket = socketConfig.socket
    if (!socket || !socketConfig.ready) {
      return
    }

    const savedBoardState = getCachedBoardStateForInvestigation(vaultId)
      || await loadBoardStateForInvestigation(vaultId)
    const evidenceNodes = getRelationshipSynthesisPayloadNodes(savedBoardState)

    if (evidenceNodes.length < 2) {
      return
    }

    socket.send(JSON.stringify({
      type: 'CONNECT_DOTS',
      payload: evidenceNodes,
      vaultId,
      runId: runId || undefined,
    }))
  }, [socketConfig.ready, socketConfig.socket])

  // The backend persists the relationship result BEFORE broadcasting
  // SYNTHESIS_COMPLETE, and the board replays the saved result on mount.
  // Re-running the whole pipeline for an offscreen board whose result is
  // already saved would just double the provider load - and on
  // graceful-degradation runs (empty connections) it would re-fire in a
  // loop. Only synthesize when the completed run's result is missing.
  const ensureOffscreenRelationshipSynthesis = useCallback(async (vaultId: string, runId?: string) => {
    const completedRunId = typeof runId === 'string' ? runId.trim() : ''
    if (completedRunId) {
      const saved = await loadRelationshipResultForInvestigation(vaultId)
      if (saved && saved.runId === completedRunId) {
        return
      }
    }
    await requestOffscreenRelationshipSynthesis(vaultId, runId)
  }, [requestOffscreenRelationshipSynthesis])

  useEffect(() => {
    if (!socketConfig.socket) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'PIPELINE_PROGRESS') {
          const progress = coercePipelineProgressPayload(msg.payload)
          if (!progress) {
            return
          }

          applyPipelineProgress(progress)
          const completedDiscoveryVaultId = typeof progress.vaultId === 'string' ? progress.vaultId.trim() : ''
          if (completedDiscoveryVaultId && progress.stepId === 'discovery_review' && progress.status === 'complete') {
            setCompletedDiscoveryReviewByInvestigation((current) => ({
              ...current,
              [completedDiscoveryVaultId]: true,
            }))
          }
          return
        }

        if (msg.type === 'PIPELINE_PROFILE_SAVED') {
          void refreshPipelineProfiles()
          return
        }

        if (msg.type === 'BRAIN_FIRED') {
          const firing = coerceBrainFiredEvent(msg.payload)
          if (!firing) {
            return
          }
          const view = brainViewStateRef.current
          const isViewingThisInvestigation = view.tab === 'brain' && view.investigationId === firing.investigationId
          if (!isViewingThisInvestigation) {
            void recountBrainUnread(firing.investigationId)
          }
          setBrainFiredToken((current) => current + 1)
          return
        }

        if (msg.type === 'SYSTEM_LOG') {
          if (typeof msg.payload === 'string') {
            setSystemNotice(msg.payload)
          } else if (msg.payload == null) {
            setSystemNotice(null)
            setDismissedSystemNotice(null)
          } else {
            setSystemNotice(String(msg.payload))
          }
          return
        }

        if (msg.type === 'TOKEN_USAGE') {
          const report = coerceTokenUsageReport(msg.payload)
          if (!report) {
            return
          }
          setSessionTokenUsage((current) => accumulateTokenUsage(current, report))
          if (report.investigationId) {
            setBoardTokenUsageByInvestigation((current) => ({
              ...current,
              [report.investigationId!]: report,
            }))
          }
          return
        }

        if (msg.type === 'RABBIT_HOLE_GATEKEEPER') {
          const gatekeeper = coerceRabbitHoleGatekeeperPayload(msg.payload)
          if (gatekeeper) {
            setRabbitHoleGatekeeper(gatekeeper)
          }
          return
        }

        if (msg.type === 'MEMORY_NODE_GATHERED') {
          const payload = coerceMemoryNodeMessagePayload(msg.payload)
          if (payload) {
            void persistDurableRabbitMemoryNode(payload).catch((error) => {
              console.warn('[App] Failed to persist Rabbit Hole node globally.', error)
              setAutosaveWarning({
                investigationId: payload.vaultId,
                errorName: error && typeof error === 'object' && 'name' in error
                  ? String((error as { name?: unknown }).name || 'UnknownError')
                  : 'UnknownError',
                timestamp: Date.now(),
              })
            })
          }
          return
        }

        if (msg.type === 'RABBIT_HOLE_NODE_UPDATE') {
          const payload = coerceRabbitHoleNodeUpdatePayload(msg.payload)
          if (payload) {
            void persistDurableRabbitNodeUpdate(payload).catch((error) => {
              console.warn('[App] Failed to persist Rabbit Hole node state globally.', error)
              setAutosaveWarning({
                investigationId: payload.vaultId,
                errorName: error && typeof error === 'object' && 'name' in error
                  ? String((error as { name?: unknown }).name || 'UnknownError')
                  : 'UnknownError',
                timestamp: Date.now(),
              })
            })
          }
          return
        }

        if (msg.type === 'SYNTHESIS_COMPLETE' && msg.payload && typeof msg.payload === 'object') {
          const payload = msg.payload as VaultResultPayload
          const explicitVaultId = typeof payload.vaultId === 'string' ? payload.vaultId.trim() : ''
          const vaultId = explicitVaultId || currentInvestigationId
          if (!vaultId) {
            return
          }

          delete qaSynthesisDemoByInvestigationRef.current[vaultId]
          setVaultResultsByInvestigation((current) => ({
            ...current,
            [vaultId]: payload,
          }))
          if (vaultId === currentInvestigationId && !payload.append) {
            setActiveTab('board')
          }
          if (typeof payload.result === 'string' && payload.result.trim()) {
            setUnreadTheoryByInvestigation((current) => ({
              ...current,
              [vaultId]: true,
            }))
          }
          if (explicitVaultId && explicitVaultId !== currentInvestigationId && !payload.append) {
            const runId = typeof payload.runId === 'string' ? payload.runId.trim() : ''
            void ensureOffscreenRelationshipSynthesis(vaultId, runId)
          }
          void saveVaultResultForInvestigation(vaultId, payload).catch((error) => {
            console.warn('[App] Failed to persist vault result; keeping it in memory for this session.', error)
            setAutosaveWarning({
              investigationId: vaultId,
              errorName: error && typeof error === 'object' && 'name' in error
                ? String((error as { name?: unknown }).name || 'UnknownError')
                : 'UnknownError',
              timestamp: Date.now(),
            })
          })
          setBoardWorkspaceRevision((current) => current + 1)
          return
        }

        if (msg.type !== 'DISCOVERIES_FOUND' || !Array.isArray(msg.payload)) {
          return
        }

        const incoming = msg.payload as DiscoveryRecord[]
        const vaultId = incoming[0]?.sourceVaultID
        if (!vaultId) {
          return
        }

        delete qaDiscoveryDemoByInvestigationRef.current[vaultId]
        setDiscoveriesByInvestigation(prev => {
          const next = {
            ...prev,
            [vaultId]: incoming,
          }
          void saveDiscoveriesForInvestigation(vaultId, incoming as unknown as Record<string, unknown>[]).catch((error) => {
            console.warn('[App] Failed to persist discoveries; keeping them in memory for this session.', error)
            setAutosaveWarning({
              investigationId: vaultId,
              errorName: error && typeof error === 'object' && 'name' in error
                ? String((error as { name?: unknown }).name || 'UnknownError')
                : 'UnknownError',
              timestamp: Date.now(),
            })
          })
          return next
        })

        if (incoming.length > 0) {
          setCompletedDiscoveryReviewByInvestigation(prev => ({
            ...prev,
            [vaultId]: true,
          }))
          setUnreadDiscoveriesByInvestigation(prev => ({
            ...prev,
            [vaultId]: true,
          }))
        }
      } catch (error) {
        console.error('[App] Failed to parse websocket message', error)
      }
    }

    socketConfig.socket.addEventListener('message', handleMessage)
    return () => socketConfig.socket?.removeEventListener('message', handleMessage)
  }, [applyPipelineProgress, currentInvestigationId, ensureOffscreenRelationshipSynthesis, refreshPipelineProfiles, socketConfig.socket])

  const currentBoardTokenUsage = currentInvestigationId ? boardTokenUsageByInvestigation[currentInvestigationId] || null : null
  const sessionTokenSummary = `Session: ${formatCompactTokens(sessionTokenUsage.totalTokens)} total, ${formatCompactTokens(sessionTokenUsage.promptTokens)} in, ${formatCompactTokens(sessionTokenUsage.completionTokens)} out, ${sessionTokenUsage.callCount} calls | ${formatTokenProviderBreakdown(sessionTokenUsage.providerTotals)}`
  const spiderTokenUsage = currentBoardTokenUsage || (sessionTokenUsage.totalTokens > 0 ? sessionTokenUsage : null)
  const spiderTokenReadout = spiderTokenUsage
    ? {
      value: `${formatCompactTokens(spiderTokenUsage.totalTokens)} / ${spiderTokenUsage.callCount} calls`,
      title: currentBoardTokenUsage
        ? `Current board: ${currentBoardTokenUsage.label} | ${formatCompactTokens(currentBoardTokenUsage.totalTokens)} total, ${formatCompactTokens(currentBoardTokenUsage.promptTokens)} in, ${formatCompactTokens(currentBoardTokenUsage.completionTokens)} out, ${currentBoardTokenUsage.callCount} calls | ${formatTokenProviderBreakdown(currentBoardTokenUsage.providerTotals)} | ${sessionTokenSummary}`
        : sessionTokenSummary,
    }
    : {
      value: '0',
      title: 'No token usage reported yet',
    }
  const activePipelineDurationBottleneck = getTopPipelineDurationBottleneck(activePipelineProfile)
  const activePipelineTokenBottleneck = getTopPipelineTokenBottleneck(activePipelineProfile)
  const activePipelineTokenUsageHotspot = getTopPipelineTokenUsage(activePipelineProfile)
  const activePipelineTokenTotal = activePipelineTokenBottleneck?.totalTokens || activePipelineTokenUsageHotspot?.totalTokens || 0
  const activePipelineTokenDisplayTotal = activePipelineRun && animatedPipelineToken.runId === activePipelineRun.runId
    ? animatedPipelineToken.display
    : activePipelineTokenTotal
  const isActivePipelineTokenAnimating = Boolean(
    activePipelineRun &&
    animatedPipelineToken.runId === activePipelineRun.runId &&
    animatedPipelineToken.target === activePipelineTokenTotal &&
    animatedPipelineToken.isAnimating,
  )
  const activePipelineImpactMs = comparisonPipelineProfile && activePipelineProfile
    ? comparisonPipelineProfile.totalElapsedMs - activePipelineProfile.totalElapsedMs
    : 0
  const activePipelinePercent = activePipelineRun
    ? clampProgressPercent(activePipelineRun.completedSteps, activePipelineRun.totalSteps)
    : 0
  const activePipelineEta = activePipelineRun?.status === 'complete'
    ? 'done'
    : activePipelineRun?.status === 'cancelled'
      ? 'stopped'
      : activePipelineRun?.estimatedRemainingMs
        ? formatDuration(activePipelineRun.estimatedRemainingMs)
        : 'calibrating'
  const activePipelineRailStatus: 'idle' | 'running' | 'complete' | 'error' | 'cancelled' = !activePipelineRun
    ? 'idle'
    : activePipelineRun.status === 'complete'
      ? 'complete'
      : activePipelineRun.status === 'error' || activePipelineRun.status === 'cancelled'
        ? activePipelineRun.status
        : 'running'
  const activePipelineMode = activePipelineRailStatus === 'running'
    ? activePipelineRun?.mode
    : null
  const promptLocalFilePaths = useMemo(
    () => (crawlMode === 'local' ? parseLocalCrawlPaths(prompt) : []),
    [crawlMode, prompt],
  )
  const spiderOperationMode: SpiderOperationMode = qaLocalIngestionDemoRequest
    ? 'local'
    : activePipelineMode === 'local'
      ? 'local'
      : activePipelineMode === 'rabbit-hole'
        ? 'rabbit-hole'
      : crawlMode
  const isRabbitContext =
    isRabbitHoleInvestigation(currentInvestigation) ||
    currentBoardSnapshot.hasRabbitHoleEvidence ||
    activePipelineMode === 'rabbit-hole' ||
    crawlMode === 'rabbit-hole' ||
    spiderOperationMode === 'rabbit-hole'
  const visibleLocalIngestionPaths = useMemo(() => {
    if (qaLocalIngestionDemoRequest) {
      return qaLocalIngestionFilePaths
    }
    if (promptLocalFilePaths.length > 0) {
      return promptLocalFilePaths
    }
    return spiderOperationMode === 'local' ? activeLocalIngestionFilePaths : []
  }, [activeLocalIngestionFilePaths, promptLocalFilePaths, qaLocalIngestionDemoRequest, qaLocalIngestionFilePaths, spiderOperationMode])
  const localIngestionFiles = useMemo(
    () => createLocalIngestionFiles(visibleLocalIngestionPaths),
    [visibleLocalIngestionPaths],
  )
  const localIngestionProgress = spiderOperationMode === 'local' && activePipelineRun
    ? {
      ...activePipelineRun,
      counters: activePipelineProfile?.counters,
    }
    : null
  const canStopActivePipeline = Boolean(
    activePipelineRun &&
    socketConfig.socket &&
    socketConfig.ready &&
    activePipelineRun.status !== 'complete' &&
    activePipelineRun.status !== 'error' &&
    activePipelineRun.status !== 'cancelled',
  )
  const isPipelineChipDismissed = activePipelineRun
    ? Boolean(dismissedPipelineChipRuns[activePipelineRun.runId])
    : false
  const isActivePipelineRunning = activePipelineRailStatus === 'running'
  const activePipelineRunIdForToken = activePipelineRun?.runId || null
  const activePipelineRunStatusForToken = activePipelineRun?.status || null

  useEffect(() => {
    animatedPipelineTokenRef.current = animatedPipelineToken
  }, [animatedPipelineToken])

  useEffect(() => {
    if (!activePipelineRunIdForToken || activePipelineTokenTotal <= 0) {
      setAnimatedPipelineToken({
        runId: activePipelineRunIdForToken,
        target: activePipelineTokenTotal,
        display: activePipelineTokenTotal,
        isAnimating: false,
      })
      return
    }

    const runId = activePipelineRunIdForToken
    const previous = animatedPipelineTokenRef.current
    const from = previous.runId === runId ? previous.display : 0
    const shouldShowFinalValue = prefersReducedMotion() ||
      activePipelineRunStatusForToken === 'cancelled' ||
      activePipelineRunStatusForToken === 'error' ||
      from === activePipelineTokenTotal
    if (shouldShowFinalValue) {
      setAnimatedPipelineToken({
        runId,
        target: activePipelineTokenTotal,
        display: activePipelineTokenTotal,
        isAnimating: false,
      })
      return
    }

    const startedAt = performance.now()
    setAnimatedPipelineToken({
      runId,
      target: activePipelineTokenTotal,
      display: from,
      isAnimating: true,
    })

    const intervalId = window.setInterval(() => {
      const elapsed = performance.now() - startedAt
      const progress = Math.min(1, elapsed / PIPELINE_TOKEN_COUNT_MS)
      const display = Math.round(from + ((activePipelineTokenTotal - from) * progress))
      setAnimatedPipelineToken({
        runId,
        target: activePipelineTokenTotal,
        display,
        isAnimating: progress < 1,
      })
      if (progress >= 1) {
        window.clearInterval(intervalId)
      }
    }, 40)

    return () => window.clearInterval(intervalId)
  }, [activePipelineRunIdForToken, activePipelineRunStatusForToken, activePipelineTokenTotal])

  useEffect(() => {
    clearPipelineStepTransitions()
  }, [clearPipelineStepTransitions, currentInvestigationId])

  useEffect(() => {
    if (!focusedFollowUpLaunchNotice || !activePipelineRun) {
      return
    }
    if (activePipelineRun.vaultId !== focusedFollowUpLaunchNotice.investigationId) {
      return
    }
    if (
      activePipelineRun.status === 'complete' ||
      activePipelineRun.status === 'error' ||
      activePipelineRun.status === 'cancelled'
    ) {
      setFocusedFollowUpLaunchNotice(null)
    }
  }, [activePipelineRun?.status, activePipelineRun?.vaultId, focusedFollowUpLaunchNotice])

  useEffect(() => () => {
    clearQaPipelineDemoTimers()
  }, [clearQaPipelineDemoTimers])

  const stopActivePipeline = useCallback(() => {
    if (!activePipelineRun || !socketConfig.socket || !socketConfig.ready) {
      return
    }
    if (activePipelineRun.status === 'complete' || activePipelineRun.status === 'error' || activePipelineRun.status === 'cancelled') {
      return
    }
    socketConfig.socket.send(JSON.stringify({
      type: 'STOP_PIPELINE',
      runId: activePipelineRun.runId,
      vaultId: activePipelineRun.vaultId,
    }))
    setFocusedFollowUpLaunchNotice(null)
  }, [activePipelineRun, socketConfig.ready, socketConfig.socket])

  useEffect(() => {
    const handleClearDiscoveries = (event: Event) => {
      const customEvent = event as CustomEvent<{ vaultId?: string }>
      const vaultId = customEvent.detail?.vaultId
      if (!vaultId) {
        return
      }

      delete qaDiscoveryDemoByInvestigationRef.current[vaultId]
      setDiscoveriesByInvestigation(prev => {
        const next = {
          ...prev,
          [vaultId]: [],
        }
        void saveDiscoveriesForInvestigation(vaultId, [])
        return next
      })
      setUnreadDiscoveriesByInvestigation(prev => ({
        ...prev,
        [vaultId]: false,
      }))
    }

    window.addEventListener('gorantula:clear-discoveries', handleClearDiscoveries as EventListener)
    return () => window.removeEventListener('gorantula:clear-discoveries', handleClearDiscoveries as EventListener)
  }, [])

  useEffect(() => {
    localStorage.setItem(IMAGE_SCRAPING_PREFERENCE_KEY, imageScrapingEnabled ? 'true' : 'false')
  }, [imageScrapingEnabled])

  useEffect(() => {
    const handleBrowserQaSeeded = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaSeedResult>).detail
      const nextInvestigations = getCachedInvestigations()
      setInvestigations(nextInvestigations)
      setCurrentInvestigationId(
        detail?.focusInvestigationId && nextInvestigations.some((investigation) => investigation.id === detail.focusInvestigationId)
          ? detail.focusInvestigationId
          : getMostRecentInvestigationId(nextInvestigations),
      )
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setActiveTab('board')
      setBoardWorkspaceRevision((current) => current + 1)
    }

    const handleBrowserQaCleared = () => {
      qaDiscoveryDemoByInvestigationRef.current = {}
      qaSynthesisDemoByInvestigationRef.current = {}
      setQaTimelineDemoByInvestigation({})
      const nextInvestigations = getCachedInvestigations()
      setInvestigations(nextInvestigations)
      setCurrentInvestigationId((current) => (
        current && nextInvestigations.some((investigation) => investigation.id === current)
          ? current
          : getMostRecentInvestigationId(nextInvestigations)
      ))
      setReturnVaultId((current) => (
        current && nextInvestigations.some((investigation) => investigation.id === current)
          ? current
          : null
      ))
      setFocusedNodeId(null)
      setBoardWorkspaceRevision((current) => current + 1)
    }

    const handleBrowserQaSynthesisDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaSynthesisDemoDetail>).detail
      const requestedInvestigationId = typeof detail?.investigationId === 'string'
        ? detail.investigationId.trim()
        : ''
      const targetInvestigationId = requestedInvestigationId || currentInvestigationId
      const availableInvestigations = getCachedInvestigations()
      const investigationExists = Boolean(targetInvestigationId) && (
        investigations.some((investigation) => investigation.id === targetInvestigationId) ||
        availableInvestigations.some((investigation) => investigation.id === targetInvestigationId)
      )
      if (!targetInvestigationId || !investigationExists) {
        return
      }

      const demoResult: VaultResultPayload = {
        vaultId: targetInvestigationId,
        result: createBrowserQaSynthesisDemoTheory(targetInvestigationId),
        qaOnly: true,
      }
      qaSynthesisDemoByInvestigationRef.current = {
        ...qaSynthesisDemoByInvestigationRef.current,
        [targetInvestigationId]: demoResult,
      }
      setVaultResultsByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: demoResult,
      }))
      setUnreadTheoryByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: true,
      }))
      setCurrentInvestigationId(targetInvestigationId)
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setActiveTab('board')
      setBoardWorkspaceRevision((current) => current + 1)
    }

    const handleBrowserQaDiscoveryDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaDiscoveryDemoDetail>).detail
      const requestedInvestigationId = typeof detail?.investigationId === 'string'
        ? detail.investigationId.trim()
        : ''
      const targetInvestigationId = requestedInvestigationId || currentInvestigationId
      if (!targetInvestigationId || !investigations.some((investigation) => investigation.id === targetInvestigationId)) {
        return
      }

      const demoDiscoveries = createBrowserQaDiscoveryDemoRecords(targetInvestigationId) as DiscoveryRecord[]
      qaDiscoveryDemoByInvestigationRef.current = {
        ...qaDiscoveryDemoByInvestigationRef.current,
        [targetInvestigationId]: demoDiscoveries,
      }
      setDiscoveriesByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: demoDiscoveries,
      }))
      setCompletedDiscoveryReviewByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: true,
      }))
      setUnreadDiscoveriesByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: true,
      }))
      setCurrentInvestigationId(targetInvestigationId)
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setActiveTab('board')
      setBoardWorkspaceRevision((current) => current + 1)
    }

    const handleBrowserQaErrorEmptyDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaErrorEmptyDemoDetail>).detail
      const requestId = typeof detail?.requestId === 'string' && detail.requestId.trim()
        ? detail.requestId.trim()
        : `qa-error-empty-${Date.now()}`
      const requestedInvestigationId = typeof detail?.investigationId === 'string'
        ? detail.investigationId.trim()
        : ''
      const targetInvestigationId = requestedInvestigationId || `qa-error-empty-${requestId}`

      setInvestigations((current) => (
        current.some((investigation) => investigation.id === targetInvestigationId)
          ? current
          : [...current, createRootInvestigation(targetInvestigationId, 'QA Error / Empty Demo')]
      ))
      qaDiscoveryDemoByInvestigationRef.current = {
        ...qaDiscoveryDemoByInvestigationRef.current,
        [targetInvestigationId]: [],
      }
      setDiscoveriesByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: [],
      }))
      setCompletedDiscoveryReviewByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: true,
      }))
      setUnreadDiscoveriesByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: false,
      }))
      setQaErrorEmptyDemoRequest({
        investigationId: targetInvestigationId,
        requestId,
      })
      setCurrentInvestigationId(targetInvestigationId)
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setActiveTab('board')
      setBoardWorkspaceRevision((current) => current + 1)
      window.dispatchEvent(new CustomEvent(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT, {
        detail: { open: true },
      }))
    }

    const handleBrowserQaTimelineDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaTimelineDemoDetail>).detail
      const requestedInvestigationId = typeof detail?.investigationId === 'string'
        ? detail.investigationId.trim()
        : ''
      const targetInvestigationId = requestedInvestigationId || currentInvestigationId
      const availableInvestigations = getCachedInvestigations()
      const investigationExists = Boolean(targetInvestigationId) && (
        investigations.some((investigation) => investigation.id === targetInvestigationId) ||
        availableInvestigations.some((investigation) => investigation.id === targetInvestigationId)
      )
      if (!targetInvestigationId || !investigationExists) {
        return
      }

      const demoSnapshot = createBrowserQaTimelineDemoSnapshot(targetInvestigationId)
      setQaTimelineDemoByInvestigation((current) => ({
        ...current,
        [targetInvestigationId]: demoSnapshot,
      }))
      setCurrentInvestigationId(targetInvestigationId)
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setActiveTab('timeline')
      setBoardWorkspaceRevision((current) => current + 1)
    }

    const handleBrowserQaPipelineDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaPipelineDemoDetail>).detail
      const requestedInvestigationId = typeof detail?.investigationId === 'string'
        ? detail.investigationId.trim()
        : ''
      const targetInvestigationId = requestedInvestigationId || currentInvestigationId || 'qa-pipeline-demo-vault'
      const requestId = typeof detail?.requestId === 'string' && detail.requestId.trim()
        ? detail.requestId.trim()
        : `qa-pipeline-${Date.now()}`
      const runId = `qa-pipeline-demo-${requestId}`

      clearQaPipelineDemoTimers()
      setCurrentInvestigationId((current) => (
        targetInvestigationId && investigations.some((investigation) => investigation.id === targetInvestigationId)
          ? targetInvestigationId
          : current
      ))
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setIsPipelineDrawerOpen(true)
      setDismissedPipelineChipRuns((current) => {
        const next = { ...current }
        delete next[runId]
        return next
      })

      const makeProfile = (status: PipelinePerformanceProfile['status'], totalElapsedMs: number, totalTokens: number): PipelinePerformanceProfile => ({
        runId,
        vaultId: targetInvestigationId,
        mode: 'qa',
        status,
        totalElapsedMs,
        bottlenecks: [
          { kind: 'span', id: 'qa-layout', label: 'QA layout synthesis', durationMs: Math.max(600, Math.round(totalElapsedMs * 0.44)), percentOfTotal: 44 },
          { kind: 'token', id: 'qa-token-hotspot', label: 'QA persona review', totalTokens },
        ],
        tokenUsage: [
          { operation: 'qa_persona_review', provider: 'demo', callCount: 3, totalTokens },
        ],
      })

      const publishProfile = (profile: PipelinePerformanceProfile) => {
        setPipelineProfiles((current) => [
          profile,
          ...current.filter((entry) => entry.runId !== runId),
        ])
      }

      const publishProgress = (progress: PipelineProgressPayload, tokenTotal: number) => {
        applyPipelineProgress(progress)
        publishProfile(makeProfile(progress.status, progress.elapsedMs || 1, tokenTotal))
      }

      const baseSteps: PipelineProgressStepState[] = [
        { id: 'qa_warmup', label: 'QA monitor warmup', status: 'running', detail: 'Priming pipeline telemetry' },
        { id: 'qa_gather', label: 'QA evidence intake', status: 'pending' },
        { id: 'qa_profile', label: 'QA token profiling', status: 'pending' },
        { id: 'qa_terminal', label: 'QA terminal state', status: 'pending' },
      ]

      publishProgress({
        runId,
        vaultId: targetInvestigationId,
        mode: 'qa',
        stepId: 'qa_warmup',
        stepLabel: 'QA pipeline warmup',
        status: 'running',
        completedSteps: 0,
        totalSteps: 4,
        elapsedMs: 240,
        estimatedRemainingMs: 1800,
        steps: baseSteps,
      }, 1200)

      const sequence: Array<{ delay: number; progress: PipelineProgressPayload; tokens: number }> = [
        {
          delay: 450,
          tokens: 3600,
          progress: {
            runId,
            vaultId: targetInvestigationId,
            mode: 'qa',
            stepId: 'qa_gather',
            stepLabel: 'QA evidence intake',
            status: 'running',
            completedSteps: 1,
            totalSteps: 4,
            elapsedMs: 720,
            estimatedRemainingMs: 1200,
            steps: [
              { ...baseSteps[0], status: 'complete', durationMs: 420 },
              { ...baseSteps[1], status: 'running', detail: 'Staggering live run updates' },
              baseSteps[2],
              baseSteps[3],
            ],
          },
        },
        {
          delay: 950,
          tokens: 8400,
          progress: {
            runId,
            vaultId: targetInvestigationId,
            mode: 'qa',
            stepId: 'qa_profile',
            stepLabel: 'QA token profiling',
            status: 'running',
            completedSteps: 2,
            totalSteps: 4,
            elapsedMs: 1280,
            estimatedRemainingMs: 700,
            steps: [
              { ...baseSteps[0], status: 'complete', durationMs: 420 },
              { ...baseSteps[1], status: 'complete', durationMs: 560 },
              { ...baseSteps[2], status: 'running', detail: 'Counting profile tokens' },
              baseSteps[3],
            ],
          },
        },
        {
          delay: 1500,
          tokens: 8400,
          progress: {
            runId,
            vaultId: targetInvestigationId,
            mode: 'qa',
            stepId: 'qa_terminal',
            stepLabel: 'QA pipeline cancelled',
            status: 'cancelled',
            completedSteps: 2,
            totalSteps: 4,
            elapsedMs: 1780,
            detail: 'QA terminal state preview',
            steps: [
              { ...baseSteps[0], status: 'complete', durationMs: 420 },
              { ...baseSteps[1], status: 'complete', durationMs: 560 },
              { ...baseSteps[2], status: 'cancelled', detail: 'Stopped before profile writeback' },
              { ...baseSteps[3], status: 'cancelled', detail: 'Power-down state preview' },
            ],
          },
        },
      ]

      qaPipelineDemoTimeoutsRef.current = sequence.map(({ delay, progress, tokens }) => (
        window.setTimeout(() => publishProgress(progress, tokens), delay)
      ))
    }

    const handleBrowserQaSpiderTelemetryDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaSpiderTelemetryDemoDetail>).detail
      setQaSpiderTelemetryDemoRequest({
        investigationId: typeof detail?.investigationId === 'string' ? detail.investigationId : currentInvestigationId || undefined,
        requestId: typeof detail?.requestId === 'string' && detail.requestId.trim()
          ? detail.requestId.trim()
          : `qa-spider-${Date.now()}`,
      })
      setActiveTab('spider')
    }

    const handleBrowserQaLocalIngestionDemo = (event: Event) => {
      const detail = (event as CustomEvent<BrowserQaLocalIngestionDemoDetail>).detail
      const files = Array.isArray(detail?.files) && detail.files.length > 0
        ? detail.files.filter((path): path is string => typeof path === 'string' && path.trim() !== '')
        : createBrowserQaLocalIngestionDemoFiles()
      const requestId = typeof detail?.requestId === 'string' && detail.requestId.trim()
        ? detail.requestId.trim()
        : `qa-local-ingestion-${Date.now()}`

      setQaLocalIngestionDemoRequest({
        investigationId: typeof detail?.investigationId === 'string' ? detail.investigationId : currentInvestigationId || undefined,
        requestId,
      })
      setQaLocalIngestionFilePaths(files)
      setActiveLocalIngestionFilePaths(files)
      setCrawlMode('local')
      setPrompt(files.join('|'))
      setActiveTab('spider')
    }

    window.addEventListener(BROWSER_QA_SEEDED_EVENT, handleBrowserQaSeeded as EventListener)
    window.addEventListener(BROWSER_QA_CLEARED_EVENT, handleBrowserQaCleared as EventListener)
    window.addEventListener(BROWSER_QA_DISCOVERY_DEMO_EVENT, handleBrowserQaDiscoveryDemo as EventListener)
    window.addEventListener(BROWSER_QA_ERROR_EMPTY_DEMO_EVENT, handleBrowserQaErrorEmptyDemo as EventListener)
    window.addEventListener(BROWSER_QA_SYNTHESIS_DEMO_EVENT, handleBrowserQaSynthesisDemo as EventListener)
    window.addEventListener(BROWSER_QA_TIMELINE_DEMO_EVENT, handleBrowserQaTimelineDemo as EventListener)
    window.addEventListener(BROWSER_QA_PIPELINE_DEMO_EVENT, handleBrowserQaPipelineDemo as EventListener)
    window.addEventListener(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, handleBrowserQaSpiderTelemetryDemo as EventListener)
    window.addEventListener(BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT, handleBrowserQaLocalIngestionDemo as EventListener)
    return () => {
      window.removeEventListener(BROWSER_QA_SEEDED_EVENT, handleBrowserQaSeeded as EventListener)
      window.removeEventListener(BROWSER_QA_CLEARED_EVENT, handleBrowserQaCleared as EventListener)
      window.removeEventListener(BROWSER_QA_DISCOVERY_DEMO_EVENT, handleBrowserQaDiscoveryDemo as EventListener)
      window.removeEventListener(BROWSER_QA_ERROR_EMPTY_DEMO_EVENT, handleBrowserQaErrorEmptyDemo as EventListener)
      window.removeEventListener(BROWSER_QA_SYNTHESIS_DEMO_EVENT, handleBrowserQaSynthesisDemo as EventListener)
      window.removeEventListener(BROWSER_QA_TIMELINE_DEMO_EVENT, handleBrowserQaTimelineDemo as EventListener)
      window.removeEventListener(BROWSER_QA_PIPELINE_DEMO_EVENT, handleBrowserQaPipelineDemo as EventListener)
      window.removeEventListener(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, handleBrowserQaSpiderTelemetryDemo as EventListener)
      window.removeEventListener(BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT, handleBrowserQaLocalIngestionDemo as EventListener)
    }
  }, [applyPipelineProgress, clearQaPipelineDemoTimers, currentInvestigationId, investigations])

  useEffect(() => {
    const handleBoardWorkspaceUpdate = () => {
      setBoardWorkspaceRevision((current) => current + 1)
    }

    window.addEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardWorkspaceUpdate)
    return () => window.removeEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardWorkspaceUpdate)
  }, [])

  useEffect(() => {
    const handleBoardRestoreComplete = (event: Event) => {
      const detail = (event as CustomEvent<BoardRestoreCompleteDetail>).detail
      const current = investigationSwitchOverlayRef.current
      if (!current || !detail?.investigationId || detail.investigationId !== current.investigationId) {
        return
      }

      const totalDurationMs = Math.max(0, Math.round(getAppLoadNow() - current.startedAt))
      console.info('[InvestigationSwitch] board-ready', {
        investigationId: current.investigationId,
        switchDurationMs: totalDurationMs,
        boardDurationMs: detail.durationMs,
        source: detail.source,
        nodeCount: detail.nodeCount,
        edgeCount: detail.edgeCount,
      })

      const nextOverlay: InvestigationSwitchOverlayState = {
        ...current,
        phase: 'restoring',
      }
      investigationSwitchOverlayRef.current = nextOverlay
      setInvestigationSwitchOverlay(nextOverlay)
      clearInvestigationSwitchTimeout()

      const hideDelayMs = Math.max(0, INVESTIGATION_SWITCH_OVERLAY_MIN_MS - totalDurationMs)
      investigationSwitchOverlayTimeoutRef.current = window.setTimeout(() => {
        clearInvestigationSwitchOverlay(current.investigationId, current.startedAt)
      }, hideDelayMs)
    }

    window.addEventListener(BOARD_RESTORE_COMPLETE_EVENT, handleBoardRestoreComplete as EventListener)
    return () => {
      window.removeEventListener(BOARD_RESTORE_COMPLETE_EVENT, handleBoardRestoreComplete as EventListener)
    }
  }, [clearInvestigationSwitchOverlay, clearInvestigationSwitchTimeout])

  useEffect(() => () => {
    clearInvestigationSwitchTimeout()
  }, [clearInvestigationSwitchTimeout])

  useEffect(() => {
    if (!currentInvestigationId) {
      investigationHydrationRequestRef.current += 1
      return
    }
    const requestId = investigationHydrationRequestRef.current + 1
    investigationHydrationRequestRef.current = requestId

    void Promise.all([
      loadBoardStateForInvestigation(currentInvestigationId),
      loadVaultResultForInvestigation(currentInvestigationId),
      loadDiscoveriesForInvestigations(investigations.filter((investigation) => investigation.id === currentInvestigationId)),
    ]).then(([, vaultResult, discoveries]) => {
      if (investigationHydrationRequestRef.current !== requestId) {
        return
      }

      const qaSynthesisDemo = qaSynthesisDemoByInvestigationRef.current[currentInvestigationId]
      setVaultResultsByInvestigation((current) => ({
        ...current,
        [currentInvestigationId]: qaSynthesisDemo || vaultResult,
      }))
      const qaDemoDiscoveries = qaDiscoveryDemoByInvestigationRef.current[currentInvestigationId]
      setDiscoveriesByInvestigation((current) => ({
        ...current,
        [currentInvestigationId]: qaDemoDiscoveries || ((discoveries[currentInvestigationId] || []) as unknown as DiscoveryRecord[]),
      }))
      setBoardWorkspaceRevision((current) => current + 1)
    })
  }, [currentInvestigationId, investigations])

  useEffect(() => {
    const handlePersistFailure = (event: Event) => {
      const detail = (event as CustomEvent<{ investigationId?: string; errorName?: string }>).detail || {}
      setAutosaveWarning({
        investigationId: detail.investigationId,
        errorName: detail.errorName,
        timestamp: Date.now(),
      })
    }

    window.addEventListener(BOARD_PERSIST_FAILED_EVENT, handlePersistFailure as EventListener)
    return () => window.removeEventListener(BOARD_PERSIST_FAILED_EVENT, handlePersistFailure as EventListener)
  }, [])

  const runSpider = useCallback((
    customPrompt?: string,
    customLabel?: string,
    overrideMode?: SpiderOperationMode,
    overrideRabbitHoleDescentMode?: 'guided' | 'max',
  ) => {
    const inputValue = crawlInputRef.current?.value || '';
    const textToRun = customPrompt || inputValue || prompt;
    const labelToUse = customLabel || textToRun;
    const modeToUse = overrideMode || crawlMode;
    const shouldScrapeImages = modeToUse !== 'local' && imageScrapingEnabled
    if (socketConfig.socket && socketConfig.ready && textToRun) {
      if (!customPrompt) {
        setFocusedFollowUpLaunchNotice(null)
      }
      const id = `inv-${Date.now()}`
      const runId = createPipelineRunId()
      const localPaths = modeToUse === 'local' ? parseLocalCrawlPaths(textToRun) : []

      // Extract folder name for better label
      let displayTopic = labelToUse;
      if (modeToUse === 'local') {
        const primaryLocalLabel = localPaths[0] || labelToUse
        displayTopic = `Local: ${getLocalFileName(primaryLocalLabel)}`;
      } else if (modeToUse === 'rabbit-hole') {
        displayTopic = `Rabbit Hole: ${labelToUse}`;
      }

      const newInv = createRootInvestigation(id, displayTopic)
      const updated = [newInv, ...investigations]
      persistInvestigations(updated)
      setCurrentInvestigationId(id)
      setRabbitHoleGatekeeper(null)

      const crawlMessage = modeToUse === 'local'
        ? { type: 'CRAWL_LOCAL', payload: textToRun, vaultId: id, runId }
        : modeToUse === 'rabbit-hole'
          ? { type: 'CRAWL_RABBIT_HOLE', payload: textToRun, vaultId: id, runId, scrapeImages: shouldScrapeImages, descentMode: overrideRabbitHoleDescentMode || rabbitHoleDescentMode }
          : { type: 'CRAWL', payload: textToRun, vaultId: id, runId, scrapeImages: shouldScrapeImages }
      socketConfig.socket.send(JSON.stringify(crawlMessage))
      if (modeToUse === 'local') {
        setActiveLocalIngestionFilePaths(localPaths)
        setQaLocalIngestionDemoRequest(null)
      }
      if (!customPrompt) setPrompt('')
      setActiveTab('spider')
      return id;
    } else {
      alert("System not ready. Please check backend connection.");
      return null;
    }
  }, [crawlMode, imageScrapingEnabled, investigations, persistInvestigations, prompt, rabbitHoleDescentMode, socketConfig.ready, socketConfig.socket])

  const continueRabbitHoleDescent = useCallback(() => {
    if (!rabbitHoleGatekeeper || !socketConfig.socket || !socketConfig.ready) {
      return
    }
    if (rabbitHoleGatekeeper.descentMode !== 'guided') {
      return
    }
    const vaultId = rabbitHoleGatekeeper.vaultId || currentInvestigationId
    if (!vaultId) {
      return
    }
    const runId = createPipelineRunId()
    const baseTopic = rabbitHoleGatekeeper.prompt || currentInvestigation?.topic || prompt || 'current investigation'
    const continuationPass = rabbitHoleGatekeeper.pass + 1
    const priorFindings = rabbitHoleGatekeeper.result
      ? [`Pass ${rabbitHoleGatekeeper.pass} summary:\n${rabbitHoleGatekeeper.result}`]
      : []

    socketConfig.socket.send(JSON.stringify({
      type: 'CRAWL_RABBIT_HOLE',
      payload: baseTopic,
      vaultId,
      runId,
      scrapeImages: imageScrapingEnabled,
      descentMode: 'guided',
      append: true,
      continuationPass,
      priorFindings,
      suggestedQueries: rabbitHoleGatekeeper.suggestedQueries,
    }))
    setRabbitHoleGatekeeper(null)
    setActiveTab('spider')
  }, [currentInvestigation?.topic, currentInvestigationId, imageScrapingEnabled, prompt, rabbitHoleGatekeeper, socketConfig.ready, socketConfig.socket])

  const handleLaunchFocusedRabbitHole = useCallback((action: BrainFollowUpAction) => {
    const promptToRun = action.prompt || action.summary || action.title
    if (!promptToRun) {
      return
    }
    setCrawlMode('rabbit-hole')
    setRabbitHoleDescentMode('guided')
    const launchedInvestigationId = runSpider(
      promptToRun,
      action.title || 'Focused Brain follow-up',
      'rabbit-hole',
      'guided',
    )
    if (launchedInvestigationId) {
      setFocusedFollowUpLaunchNotice({
        title: action.title || 'Focused Brain follow-up',
        investigationId: launchedInvestigationId,
      })
    }
  }, [runSpider])

  const finishRabbitHoleDescent = useCallback(() => {
    if (!rabbitHoleGatekeeper || !socketConfig.socket || !socketConfig.ready) {
      return
    }
    if (rabbitHoleGatekeeper.descentMode !== 'guided') {
      return
    }
    const vaultId = rabbitHoleGatekeeper.vaultId || currentInvestigationId
    if (!vaultId || !rabbitHoleGatekeeper.result) {
      return
    }
    socketConfig.socket.send(JSON.stringify({
      type: 'FINISH_RABBIT_HOLE',
      vaultId,
      runId: rabbitHoleGatekeeper.runId,
      result: rabbitHoleGatekeeper.result,
      prompt: rabbitHoleGatekeeper.prompt || currentInvestigation?.topic || prompt,
    }))
    setRabbitHoleGatekeeper(null)
  }, [currentInvestigation?.topic, currentInvestigationId, prompt, rabbitHoleGatekeeper, socketConfig.ready, socketConfig.socket])

  const handleDeepDiveNode = useCallback((promptStr: string, titleStr: string, sourceNodeId: string) => {
    const newInvId = runSpider(`Deep Dive Research on: ${promptStr}`, `Deep Dive: ${titleStr.substring(0, 50)}${titleStr.length > 50 ? '...' : ''}`, 'web');
    if (newInvId && currentInvestigationId) {
      // Update original board to link to this new investigation
      const savedState = getCachedBoardStateForInvestigation(currentInvestigationId);
      if (savedState) {
        if (!savedState) {
          return;
        }
        const { nodes, edges, mode } = savedState;
        const updatedNodes = nodes.map((n: PersistedBoardState['nodes'][number]) =>
          n.id === sourceNodeId ? { ...n, data: { ...n.data, linkedInvestigationId: newInvId, isDeepDiveSource: false } } : n
        );
        void saveBoardStateForInvestigation(currentInvestigationId, {
          mode,
          nodes: updatedNodes,
          edges,
          pendingIntegrationNodeIds: savedState.pendingIntegrationNodeIds || [],
          synthesisAlerts: savedState.synthesisAlerts || [],
        });
      }
    }
  }, [currentInvestigationId, runSpider]);

  const handleNavigateToChild = useCallback((id: string, parentId?: string) => {
    setReturnVaultId(parentId || null);
    setCurrentInvestigationId(id);
    setActiveTab('board');
  }, []);

  const handleNavigateSynthesis = useCallback((id: string, nodeId?: string) => {
    if (id === returnVaultId) {
      setReturnVaultId(null);
    } else if (!returnVaultId && currentInvestigationId && currentInvestigationId !== id) {
      setReturnVaultId(currentInvestigationId);
    }
    setCurrentInvestigationId(id);
    setActiveTab('board');
    setUnreadTheoryByInvestigation(prev => ({
      ...prev,
      [id]: false,
    }))
    if (nodeId) {
      setFocusedNodeId(nodeId);
      setTimeout(() => setFocusedNodeId(null), 1000);
    }
  }, [currentInvestigationId, returnVaultId]);

  const handleNavigateDiscovery = useCallback((investigationId: string, nodeId?: string) => {
    setCurrentInvestigationId(investigationId)
    setActiveTab('board')
    setUnreadDiscoveriesByInvestigation(prev => ({
      ...prev,
      [investigationId]: false,
    }))
    if (nodeId) {
      setFocusedNodeId(nodeId)
      setTimeout(() => setFocusedNodeId(null), 1000)
    }
  }, [])

  const handleMergeInvestigations = useCallback((entity: string, connectedCases: string[], relevantNodes: MergeCandidateNode[]) => {
    const parentIds = Array.from(new Set(connectedCases)).filter((id) => investigations.some((investigation) => investigation.id === id));
    if (parentIds.length < 2) {
      alert('Need at least two persisted investigations to create a merged canvas.');
      return;
    }

    const filteredRelevantNodes = relevantNodes.filter((node) => parentIds.includes(node.vaultId));
    if (filteredRelevantNodes.length < 2) {
      alert('This overlap does not have enough relevant node context to create a merged canvas yet.');
      return;
    }

    const primaryParentId = parentIds.includes(currentInvestigationId || '') ? currentInvestigationId! : parentIds[0];
    const parentBoards = parentIds.map((parentId) => {
      const investigation = investigations.find((entry) => entry.id === parentId);
      const board = getCachedBoardStateForInvestigation(parentId);
      return investigation && board ? { investigation, board } : null;
    }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (parentBoards.length < 2) {
      alert('Both investigations need saved board state before they can be merged.');
      return;
    }

    const childId = `merge-${Date.now()}`;
    const childTopic = `Merged: ${entity}`;
    const { childBoard, updatedParentBoards, payloadNodes, payloadEdges } = createMergedChildBoard(
      childId,
      childTopic,
      parentBoards,
      primaryParentId,
      entity,
      filteredRelevantNodes,
    );

    const updatedInvestigations = registerMergedChildInvestigation(investigations, {
      childId,
      childTopic,
      parentIds,
      primaryParentId,
    });

    Object.entries(updatedParentBoards).forEach(([parentId, board]) => {
      void saveBoardStateForInvestigation(parentId, board);
    });
    void saveBoardStateForInvestigation(childId, childBoard);
    persistInvestigations(updatedInvestigations);

    if (socketConfig.socket && socketConfig.ready) {
      socketConfig.socket.send(JSON.stringify({
        type: 'MERGE_INVESTIGATIONS',
        payload: {
          childVaultId: childId,
          childTopic,
          parentIds,
          nodes: payloadNodes,
          edges: payloadEdges,
        },
      }));
    }

    setCurrentInvestigationId(childId);
    setReturnVaultId(primaryParentId);
    setActiveTab('board');
  }, [currentInvestigationId, investigations, persistInvestigations, socketConfig.ready, socketConfig.socket]);

  const handleReturnToParent = useCallback(() => {
    if (!returnVaultId) {
      return;
    }

    setCurrentInvestigationId(returnVaultId);
    setReturnVaultId(null);
    setActiveTab('board');
  }, [returnVaultId]);

  const deleteInvestigation = (e: React.MouseEvent, idToRemove: string) => {
    e.stopPropagation()
    const removal = removeInvestigationRecord(investigations, idToRemove)
    persistInvestigations(removal.investigations)
    removal.removedIds.forEach((removedId) => {
      delete qaDiscoveryDemoByInvestigationRef.current[removedId]
      delete qaSynthesisDemoByInvestigationRef.current[removedId]
      void deleteInvestigationPersistence(removedId).catch((error) => {
        console.warn('[App] Failed to delete persisted investigation data', error)
      })
    })
    setQaTimelineDemoByInvestigation((current) => {
      const next = { ...current }
      removal.removedIds.forEach((removedId) => {
        delete next[removedId]
      })
      return next
    })

    removal.investigations.forEach((investigation) => {
      const savedState = getCachedBoardStateForInvestigation(investigation.id)
      if (!savedState) {
        return
      }

      const cleanedNodes = savedState.nodes.filter((node) => !node.data?.portalKind || !removal.removedIds.includes(node.data?.linkedInvestigationId))
      if (cleanedNodes.length !== savedState.nodes.length) {
        void saveBoardStateForInvestigation(investigation.id, { ...savedState, nodes: cleanedNodes })
      }
    })

    let vaultPathToRemove = "";
    const vaultResult = getCachedVaultResultForInvestigation(idToRemove);
    if (vaultResult) {
      vaultPathToRemove = typeof vaultResult.vaultPath === 'string' ? vaultResult.vaultPath : "";
    }
    if (socketConfig.socket && socketConfig.ready) {
      socketConfig.socket.send(JSON.stringify({ 
        type: 'DELETE_VAULT', 
        payload: idToRemove,
        vaultPath: vaultPathToRemove 
      }))
    }

    if (currentInvestigationId && removal.removedIds.includes(currentInvestigationId)) {
      setCurrentInvestigationId(getMostRecentInvestigationId(removal.investigations))
      setReturnVaultId(null)
    } else if (returnVaultId && removal.removedIds.includes(returnVaultId)) {
      const survivingCurrent = removal.investigations.find((investigation) => investigation.id === currentInvestigationId)
      setReturnVaultId(survivingCurrent?.primaryParentId || null)
    }
  }

  const headerClassName = isForensicWorkspaceActive
    ? 'forensic-app-shell-header'
    : 'flex items-center justify-between border-b border-cyber-gray bg-cyber-black px-6 py-4 z-50'
  const appShellClassName = isForensicWorkspaceActive
    ? `forensic-app-shell ${isRabbitContext ? 'forensic-rabbit-context' : ''} flex h-screen w-screen flex-col overflow-hidden font-mono`
    : `flex h-screen w-screen flex-col overflow-hidden bg-cyber-black font-mono ${isRabbitContext ? 'forensic-rabbit-context' : ''}`
  const brandClassName = isForensicWorkspaceActive
    ? 'forensic-app-brand text-2xl font-black tracking-tighter italic'
    : 'text-2xl font-black tracking-tighter italic text-cyber-green'
  const tabRailClassName = isForensicWorkspaceActive
    ? 'forensic-app-tab-rail'
    : 'flex gap-4'
  const getTabClassName = (tab: ActiveTab, activeClassName: string) => (
    isForensicWorkspaceActive
      ? `forensic-app-tab ${activeTab === tab ? 'forensic-app-tab-active' : ''}`
      : `flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === tab ? activeClassName : 'text-gray-500 hover:text-white'}`
  )
  const startSidebarResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (isSidebarCollapsed) {
      return
    }

    event.preventDefault()
    sidebarResizeStartRef.current = {
      startX: event.clientX,
      startWidth: expandedSidebarWidth,
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const start = sidebarResizeStartRef.current
      if (!start) {
        return
      }

      setHasCustomSidebarWidth(true)
      setSidebarWidth(clampSidebarWidth(start.startWidth + (moveEvent.clientX - start.startX)))
    }

    const stopResize = () => {
      sidebarResizeStartRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', stopResize)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', stopResize)
  }, [expandedSidebarWidth, isSidebarCollapsed])
  const handleSidebarResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isSidebarCollapsed) {
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      setHasCustomSidebarWidth(true)
      setSidebarWidth((current) => clampSidebarWidth((hasCustomSidebarWidth ? current : expandedSidebarWidth) + (event.key === 'ArrowLeft' ? -16 : 16)))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setHasCustomSidebarWidth(true)
      setSidebarWidth(SIDEBAR_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setHasCustomSidebarWidth(true)
      setSidebarWidth(SIDEBAR_MAX_WIDTH)
    }
  }, [expandedSidebarWidth, hasCustomSidebarWidth, isSidebarCollapsed])

  return (
    <div data-testid="app-shell" className={appShellClassName}>
      {/* Top Header */}
      <header className={headerClassName}>
        <h1
          className={`${brandClassName} cursor-pointer select-none`}
          title="Return to launch screen"
          onClick={() => setShowLandingExperience(true)}
        >
          GORANTULA
        </h1>

        <div className="forensic-app-header-notice-slot">
          {visibleSystemNotice && systemNoticeText && (
            <div className="forensic-app-system-notice" title={visibleSystemNotice} role="status">
              <Activity size={13} />
              <span>{systemNoticeText}</span>
              <button
                type="button"
                aria-label="Dismiss system notice"
                onClick={() => setDismissedSystemNotice(visibleSystemNotice)}
              >
                <X size={11} />
              </button>
            </div>
          )}
        </div>

        <div className={tabRailClassName}>
          <button
            onClick={() => setActiveTab('spider')}
            className={getTabClassName('spider', 'bg-cyber-purple text-white shadow-[0_0_15px_rgba(188,19,254,0.5)]')}
          >
            <Terminal size={18} />
            Spider View
          </button>
          <button
            onClick={() => setActiveTab('board')}
            className={getTabClassName('board', 'bg-cyber-cyan text-black shadow-[0_0_15px_rgba(0,243,255,0.5)]')}
          >
            <Database size={18} />
            Detective Board
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={getTabClassName('timeline', 'bg-cyber-green text-black shadow-[0_0_15px_rgba(16,185,129,0.5)]')}
          >
            <Clock size={18} />
            Timeline View
          </button>
          <button
            onClick={() => setActiveTab('brain')}
            className={getTabClassName('brain', 'bg-cyber-cyan text-black shadow-[0_0_15px_rgba(0,243,255,0.5)]')}
          >
            <Brain size={18} />
            Brain
            {/* Hidden while Brain is open: the badge sums unseen overlaps for
                every case, and with the synapse engine live across the vault
                other cases keep re-arming it — a count on the tab you are
                already reading is noise, not signal. */}
            {activeTab !== 'brain' && brainUnreadCount > 0 && (
              <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-cyber-purple px-1.5 text-[11px] font-bold text-white">
                {brainUnreadCount > 9 ? '9+' : brainUnreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('chat')}
            className={getTabClassName('chat', 'bg-cyber-purple text-white shadow-[0_0_15px_rgba(188,19,254,0.5)]')}
          >
            <MessageSquare size={18} />
            Vault Chat
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={getTabClassName('settings', 'bg-cyber-purple text-white shadow-[0_0_15px_rgba(188,19,254,0.5)]')}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>
      </header>

      <div className="forensic-app-main-row flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside
          data-testid="app-sidebar"
          aria-label="Investigations sidebar"
          className={`forensic-sidebar forensic-sidebar-shell ${isSidebarCollapsed ? 'forensic-sidebar-collapsed' : ''} shrink-0 flex flex-col`}
          style={{ width: `${renderedSidebarWidth}px` }}
        >
          <button
            type="button"
            aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
            className="forensic-sidebar-toggle"
          >
            {isSidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
          </button>
          {!isSidebarCollapsed && (
            <div
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={expandedSidebarWidth}
              tabIndex={0}
              onMouseDown={startSidebarResize}
              onKeyDown={handleSidebarResizeKeyDown}
              className="forensic-sidebar-resize-handle"
              title="Resize sidebar"
            >
              <GripVertical size={14} />
            </div>
          )}

          {isSidebarCollapsed ? (
            <div className="forensic-sidebar-collapsed-rail flex flex-1 flex-col items-center gap-3 px-2 py-4">
              <button
                type="button"
                aria-label="Open spider input"
                onClick={() => {
                  setActiveTab('spider')
                  focusSpiderInput()
                }}
                className="forensic-sidebar-plus rounded-md p-2 transition-colors"
              >
                <Plus size={15} />
              </button>
              <div className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto">
                {filteredSidebarRows.map(({ investigation }) => (
                  <button
                    key={investigation.id}
                    type="button"
                    aria-label={`Open ${investigation.displayTopic}`}
                    title={investigation.displayTopic}
                    onClick={() => {
                      openInvestigationFromSidebar(investigation, 'collapsed-sidebar');
                    }}
                    className={`forensic-sidebar-collapsed-item ${currentInvestigationId === investigation.id ? 'forensic-sidebar-collapsed-item-active' : ''}`}
                  >
                    <Folder size={16} />
                    <span className="sr-only">{investigation.displayTopic}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
          <div className="forensic-sidebar-header p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="forensic-sidebar-label text-[10px] font-bold uppercase">Investigations</span>
              <button
                type="button"
                aria-label="Open spider input"
                onClick={() => {
                  setActiveTab('spider')
                  focusSpiderInput()
                }}
                className="forensic-sidebar-plus rounded-md p-1.5 transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>

            <label className="forensic-sidebar-search mt-4 flex items-center gap-2 rounded-xl px-3 py-2" aria-label="Filter investigations">
              <Search size={14} className="text-[var(--forensic-text-faint)]" />
              <input
                type="search"
                value={sidebarSearchQuery}
                onChange={(event) => setSidebarSearchQuery(event.target.value)}
                placeholder="Search investigations..."
                className="w-full bg-transparent text-xs text-[var(--forensic-text)] outline-none placeholder:text-[var(--forensic-text-faint)]"
              />
              <button
                type="button"
                aria-label={sidebarSearchQuery.trim() ? 'Clear investigation filter' : 'Focus active investigation'}
                title={sidebarSearchQuery.trim() ? 'Clear investigation filter' : 'Focus active investigation'}
                onClick={() => {
                  if (sidebarSearchQuery.trim()) {
                    setSidebarSearchQuery('')
                    return
                  }

                  activeSidebarItemRef.current?.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth',
                  })
                }}
                className="forensic-sidebar-search-action inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
              >
                {sidebarSearchQuery.trim() ? <X size={12} /> : <ListFilter size={12} />}
              </button>
            </label>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredSidebarRows.length === 0 ? (
              <div className="px-4 py-6 text-xs leading-relaxed text-[var(--forensic-text-faint)]">
                No investigations match <span className="font-black text-[var(--forensic-accent)]">"{sidebarSearchQuery}"</span>.
              </div>
            ) : (
              filteredSidebarRows.map(({ investigation, depth }, rowIndex) => (
                <div
                  key={investigation.id}
                  ref={currentInvestigationId === investigation.id ? activeSidebarItemRef : null}
                  className={`forensic-sidebar-item group relative ${currentInvestigationId === investigation.id ? 'forensic-sidebar-item-active' : ''}`}
                  style={{ '--sidebar-row-index': rowIndex } as CSSProperties}
                >
                  <button
                    onClick={() => {
                      openInvestigationFromSidebar(investigation);
                    }}
                    className="w-full text-left p-4 transition-colors"
                    style={{ paddingLeft: `${16 + (depth * 18)}px` }}
                  >
                    <div className="flex items-start gap-3">
                      <Folder size={16} className="forensic-sidebar-folder mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1 pr-6">
                        <div className="flex items-start justify-between gap-2">
                          <span className={`forensic-sidebar-topic block truncate text-xs ${currentInvestigationId === investigation.id ? 'font-bold' : ''}`}>
                            {investigation.displayTopic}
                          </span>
                          {currentInvestigationId === investigation.id ? (
                            <span
                              aria-label="Active investigation"
                              className="forensic-sidebar-active-dot mt-1 shrink-0 rounded-full"
                            />
                          ) : (
                            <span className="forensic-sidebar-count-pill shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em]">
                              {sidebarRowMetrics[investigation.id]?.evidenceCount || 0}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[9px] uppercase tracking-[0.18em] text-[var(--forensic-text-faint)]">
                          <span>{formatSidebarActivity(investigation.id)}</span>
                          <span className="text-[var(--forensic-border-strong)]">/</span>
                          <span>{getInvestigationLinkMetric(investigation)}</span>
                          {investigation.kind === 'merged-child' && (
                            <span className="forensic-sidebar-badge rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.2em]">
                              Merged
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={(e) => deleteInvestigation(e, investigation.id)}
                    className="forensic-sidebar-delete absolute right-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete Investigation"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="forensic-sidebar-summary border-t border-[rgba(116,148,171,0.16)] px-4 pb-4 pt-3">
            <div className="forensic-sidebar-summary-card rounded-[1.1rem] p-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent-muted)]">
                Investigation Summary
              </div>
              <p className="forensic-sidebar-summary-copy text-xs text-[var(--forensic-text-muted)]">
                {currentBoardSnapshot.summary}
              </p>
              <div className="mt-3">
                <div className="flex items-center justify-between text-[11px] font-bold text-[var(--forensic-accent)]">
                  <span>Confidence: {Math.round(currentBoardSnapshot.confidenceScore * 100)}%</span>
                </div>
                <div className="forensic-confidence-track mt-2 h-2 overflow-hidden rounded-full">
                  <div
                    className="forensic-confidence-fill h-full rounded-full"
                    style={{ width: `${Math.round(currentBoardSnapshot.confidenceScore * 100)}%` }}
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowSummaryLog(true)}
                className="forensic-summary-log-button mt-3 flex w-full items-center justify-between rounded-lg px-3 py-2 text-[9px] font-black uppercase tracking-[0.22em]"
              >
                <span>View Full Log</span>
                <FileText size={12} />
              </button>
            </div>
          </div>
            </>
          )}
        </aside>

        {/* Main Content Area */}
        <main className="forensic-app-main-content flex-1 relative">
          <Suspense fallback={null}>
            <DiscoveryPanel
              currentInvestigationId={currentInvestigationId}
              discoveries={currentBoardSnapshot.discoveryRecords}
              evidenceByNodeId={currentBoardSnapshot.evidenceByNodeId}
              hasCompletedReview={currentInvestigationId ? Boolean(completedDiscoveryReviewByInvestigation[currentInvestigationId]) : false}
              hasUnread={currentInvestigationId ? Boolean(unreadDiscoveriesByInvestigation[currentInvestigationId]) : false}
              showHandle={showFloatingPanelHandles}
              onOpenDiscovery={(nodeId?: string) => {
                if (!currentInvestigationId) return
                handleNavigateDiscovery(currentInvestigationId, nodeId)
              }}
              onClear={() => {
                if (!currentInvestigationId) return

                delete qaDiscoveryDemoByInvestigationRef.current[currentInvestigationId]
                setDiscoveriesByInvestigation(prev => {
                  const next = { ...prev, [currentInvestigationId]: [] }
                  void saveDiscoveriesForInvestigation(currentInvestigationId, [])
                  return next
                })
                setUnreadDiscoveriesByInvestigation(prev => ({
                  ...prev,
                  [currentInvestigationId]: false,
                }))
              }}
              onMarkRead={() => {
                if (!currentInvestigationId) return
                setUnreadDiscoveriesByInvestigation(prev => ({
                  ...prev,
                  [currentInvestigationId]: false,
                }))
              }}
            />
            <SynthesisPanel
              sharedSocket={socketConfig.socket}
              currentInvestigationId={currentInvestigationId}
              onNavigateVault={handleNavigateSynthesis}
              returnVaultId={returnVaultId}
              investigations={investigations}
              onMergeInvestigations={handleMergeInvestigations}
              showHandle={showFloatingPanelHandles}
              currentTheoryReport={currentBoardSnapshot.fullReport}
              hasTheoryReady={currentBoardSnapshot.hasTheoryReport}
              hasUnreadTheory={currentInvestigationId ? Boolean(unreadTheoryByInvestigation[currentInvestigationId]) : false}
              isRabbitHoleInvestigation={isRabbitHoleInvestigation(currentInvestigation) || currentBoardSnapshot.hasRabbitHoleEvidence}
              onMarkTheoryRead={() => {
                if (!currentInvestigationId) return
                setUnreadTheoryByInvestigation(prev => ({
                  ...prev,
                  [currentInvestigationId]: false,
                }))
              }}
            />
          </Suspense>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'spider' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-hidden">
                {activeTab === 'spider' && (
                  <Suspense fallback={tabFallback('Spider View')}>
                    <SpiderVisualizer
                      sharedSocket={socketConfig.socket}
                      displayMetrics={{
                        nodeCount: currentBoardSnapshot.nodeCount,
                        edgeCount: currentBoardSnapshot.edgeCount,
                        evidenceCount: currentBoardSnapshot.evidenceCount,
                        imageCount: currentBoardSnapshot.imageCount,
                        confidenceScore: currentBoardSnapshot.confidenceScore,
                        lastActivityLabel: currentBoardSnapshot.lastActivityLabel,
                      }}
                      pipelineStatus={activePipelineRailStatus}
                      pipelineLabel={activePipelineRun?.stepLabel ?? 'Pipeline idle'}
                      pipelineProgressPercent={activePipelinePercent}
                      onOpenPipelineMonitor={() => setIsPipelineDrawerOpen(true)}
                      tokenReadout={spiderTokenReadout}
                      qaTelemetryDemoRequest={qaSpiderTelemetryDemoRequest}
                      qaErrorEmptyDemoRequest={qaErrorEmptyDemoRequest}
                      operationMode={spiderOperationMode}
                      localIngestionFiles={localIngestionFiles}
                      localIngestionProgress={localIngestionProgress}
                      qaLocalIngestionDemoRequest={qaLocalIngestionDemoRequest}
                    />
                  </Suspense>
                )}
              </div>

              {/* Input Footer */}
              <div data-testid="spider-crawl-console" className="forensic-spider-crawl-console">
                <div className="forensic-spider-console-grid">
                  <section
                    data-testid="spider-crawl-control-stack"
                    className="forensic-spider-console-panel forensic-spider-console-panel-controls"
                  >
                    <div className="forensic-spider-console-control-row">
                      <div className="forensic-spider-console-label">Scrape Images</div>
                      {crawlMode !== 'local' ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={imageScrapingEnabled}
                          aria-label="Scrape images"
                          onClick={() => setImageScrapingEnabled((current) => !current)}
                          className={`forensic-spider-switch ${imageScrapingEnabled ? 'forensic-spider-switch-on' : ''}`}
                        >
                          <span />
                        </button>
                      ) : (
                        <span className="forensic-spider-console-chip">Local</span>
                      )}
                    </div>
                    <div className="forensic-spider-console-mode-block">
                      <div className="forensic-spider-console-label">Crawl Console</div>
                      <div className="forensic-spider-mode-toggle" role="group" aria-label="Crawl mode">
                        <button
                          type="button"
                          onClick={() => {
                            setCrawlMode('web')
                            setFocusedFollowUpLaunchNotice(null)
                            setQaLocalIngestionDemoRequest(null)
                          }}
                          className={crawlMode === 'web' ? 'forensic-spider-mode-active' : ''}
                        >
                          WEB
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCrawlMode('rabbit-hole')
                            setFocusedFollowUpLaunchNotice(null)
                            setQaLocalIngestionDemoRequest(null)
                          }}
                          className={crawlMode === 'rabbit-hole' ? 'forensic-spider-mode-active' : ''}
                        >
                          RABBIT HOLE
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCrawlMode('local')
                            setFocusedFollowUpLaunchNotice(null)
                            setQaLocalIngestionDemoRequest(null)
                          }}
                          className={crawlMode === 'local' ? 'forensic-spider-mode-active' : ''}
                        >
                          LOCAL
                        </button>
                      </div>
                      {crawlMode === 'rabbit-hole' && (
                        <div className="forensic-spider-mode-toggle forensic-spider-rabbit-descent-toggle" role="group" aria-label="Rabbit Hole descent">
                          <button
                            type="button"
                            onClick={() => {
                              setRabbitHoleDescentMode('guided')
                              setFocusedFollowUpLaunchNotice(null)
                            }}
                            className={`${rabbitHoleDescentMode === 'guided' ? 'forensic-spider-mode-active' : ''} ${focusedFollowUpLaunchNotice ? 'forensic-spider-guided-followup-active' : ''}`}
                          >
                            GUIDED
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRabbitHoleDescentMode('max')
                              setFocusedFollowUpLaunchNotice(null)
                            }}
                            className={rabbitHoleDescentMode === 'max' ? 'forensic-spider-mode-active' : ''}
                          >
                            MAX DESCENT
                          </button>
                        </div>
                      )}
                    </div>
                  </section>

                  <section className="forensic-spider-console-panel forensic-spider-console-panel-command">
                    <div className="forensic-spider-console-label">Command</div>
                    {focusedFollowUpLaunchNotice && crawlMode === 'rabbit-hole' && (
                      <div
                        data-testid="brain-followup-spider-handoff"
                        className="forensic-spider-brain-followup-handoff"
                        aria-live="polite"
                      >
                        <div>
                          <span>Brain follow-up active</span>
                          <strong>Guided Rabbit Hole</strong>
                        </div>
                        <p>{focusedFollowUpLaunchNotice.title}</p>
                        <small>Prompt sent to guided descent</small>
                      </div>
                    )}
                    <div className="forensic-spider-command-input-wrap">
                      <input
                        ref={crawlInputRef}
                        type="text"
                        value={prompt}
                        onChange={(e) => {
                          setPrompt(e.target.value)
                          setFocusedFollowUpLaunchNotice(null)
                          if (crawlMode === 'local') {
                            setQaLocalIngestionDemoRequest(null)
                          }
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && runSpider()}
                        placeholder={
                          crawlMode === 'local'
                            ? "ENTER ABSOLUTE OS PATHS (DELIMITED) OR CLICK BROWSE..."
                            : crawlMode === 'rabbit-hole'
                              ? "ENTER A TOPIC FOR RABBIT HOLE MODE..."
                              : "ENTER A TOPIC OR URL TO CRAWL THE WEB..."
                        }
                        className="forensic-spider-command-input"
                      />

                      {crawlMode === 'local' && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch('http://localhost:8080/api/pick-files');
                              if (!res.ok) throw new Error('Failed to open file picker');
                              const paths = await res.json();
                              if (paths && paths.length > 0) {
                                setPrompt(paths.join('|'));
                                setActiveLocalIngestionFilePaths(paths);
                                setQaLocalIngestionDemoRequest(null);
                              }
                            } catch (err) {
                              console.error(err);
                            }
                          }}
                          className="forensic-spider-browse-button"
                        >
                          <Folder size={14} /> Browse
                        </button>
                      )}
                    </div>
                    <div className="forensic-spider-command-actions">
                      <button
                        type="button"
                        onClick={() => runSpider()}
                        className="forensic-spider-execute-button"
                      >
                        Execute
                      </button>
                      {canStopActivePipeline ? (
                        <button
                          type="button"
                          onClick={stopActivePipeline}
                          className="forensic-spider-stop-button"
                          aria-label="Stop current investigation"
                          title="Stop current investigation"
                        >
                          <X size={15} />
                          Stop
                        </button>
                      ) : (
                        <button type="button" className="forensic-spider-command-more" aria-label="Command options">
                          <ChevronRight size={15} />
                        </button>
                      )}
                    </div>
                    {rabbitHoleGatekeeper && (
                      <div data-testid="rabbit-hole-gatekeeper-panel" className="forensic-rabbit-gatekeeper-panel">
                        <div>
                          <span>Gatekeeper</span>
                          <strong>Pass {rabbitHoleGatekeeper.pass}</strong>
                        </div>
                        <p>{rabbitHoleGatekeeper.reason}</p>
                        <div>
                          <span>
                            {rabbitHoleGatekeeper.descentMode === 'max' && rabbitHoleGatekeeper.continueRecommended
                              ? 'Max descent continuing'
                              : rabbitHoleGatekeeper.continueRecommended
                                ? 'Continue recommended'
                                : 'Trail exhausted'}
                          </span>
                          {typeof rabbitHoleGatekeeper.noveltyScore === 'number' && (
                            <strong>{Math.round(rabbitHoleGatekeeper.noveltyScore * 100)}% novelty</strong>
                          )}
                        </div>
                        {rabbitHoleGatekeeper.descentMode === 'guided' && rabbitHoleGatekeeper.continueRecommended && (
                          <div className="forensic-rabbit-gatekeeper-actions">
                            <button
                              type="button"
                              onClick={continueRabbitHoleDescent}
                              className="forensic-rabbit-gatekeeper-action"
                            >
                              Continue Rabbit Hole Descent
                            </button>
                            <button
                              type="button"
                              onClick={finishRabbitHoleDescent}
                              disabled={!rabbitHoleGatekeeper.result}
                              className="forensic-rabbit-gatekeeper-action forensic-rabbit-gatekeeper-action-secondary"
                            >
                              Finish Rabbit Hole
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'board' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <Suspense fallback={tabFallback('Detective Board')}>
              <DetectiveBoard
                investigationId={currentInvestigationId}
                returnVaultId={returnVaultId}
                sharedSocket={socketConfig.socket}
                onDeepDiveNode={handleDeepDiveNode}
                onNavigateToChild={handleNavigateToChild}
                focusNodeId={focusedNodeId}
                onReturnToParent={handleReturnToParent}
                isMergedChild={currentInvestigation?.kind === 'merged-child'}
                hasTheoryReady={currentBoardSnapshot.hasTheoryReport}
                hasUnreadTheory={currentInvestigationId ? Boolean(unreadTheoryByInvestigation[currentInvestigationId]) : false}
                hasDiscoveryReady={currentBoardSnapshot.discoveryRecords.length > 0 || (currentInvestigationId ? Boolean(completedDiscoveryReviewByInvestigation[currentInvestigationId]) : false)}
                hasUnreadDiscoveries={currentInvestigationId ? Boolean(unreadDiscoveriesByInvestigation[currentInvestigationId]) : false}
              />
            </Suspense>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'timeline' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <Suspense fallback={tabFallback('Timeline')}>
              <TimelineView
                investigationId={currentInvestigationId}
                investigationTitle={currentInvestigation?.displayTopic || null}
                qaTimelineDemoSnapshot={currentInvestigationId ? qaTimelineDemoByInvestigation[currentInvestigationId] || null : null}
                onNavigateToNode={(nodeId) => {
                  setFocusedNodeId(nodeId);
                  setActiveTab('board');
                  // Clear the focus after a delay to allow re-triggering same node
                  setTimeout(() => setFocusedNodeId(null), 1000);
                }}
              />
            </Suspense>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'brain' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            {activeTab === 'brain' && (
              <Suspense fallback={tabFallback('Brain Signals')}>
                <BrainSignalsPanel
                  currentInvestigationId={currentInvestigationId}
                  currentInvestigationTitle={currentInvestigation?.displayTopic || currentInvestigation?.topic || null}
                  onOpenInvestigation={handleOpenBrainInvestigation}
                  onLaunchFocusedRabbitHole={handleLaunchFocusedRabbitHole}
                  externalFiredToken={brainFiredToken}
                  onSignalsLoaded={handleBrainSignalsLoaded}
                />
              </Suspense>
            )}
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 flex flex-col ${activeTab === 'chat' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            {activeTab === 'chat' && (
              <Suspense fallback={tabFallback('Vault Chat')}>
                <VaultChatbot
                  sharedSocket={socketConfig.socket}
                  investigationContext={vaultChatInvestigationContext}
                />
              </Suspense>
            )}
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'settings' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            {activeTab === 'settings' && (
              <Suspense fallback={tabFallback('Settings')}>
                <SettingsDashboard />
              </Suspense>
            )}
          </div>
          {investigationSwitchOverlay && (
            <div
              data-testid="investigation-switch-loading"
              className="forensic-board-restore-loading pointer-events-none absolute inset-0 z-[60] flex items-center justify-center"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="forensic-board-restore-loading-panel">
                <div className="forensic-board-restore-loading-scan" />
                <div className="forensic-board-restore-loading-title">
                  Switching investigation
                </div>
                <div className="forensic-board-restore-loading-meta">
                  {investigationSwitchOverlay.phase === 'restoring' ? 'Evidence map ready' : 'Preparing evidence map'}
                </div>
                <div className="forensic-board-restore-loading-meta forensic-investigation-switch-title">
                  {investigationSwitchOverlay.title}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Status Bar */}
      <footer className="forensic-statusbar forensic-statusbar-shell px-3 py-2 text-[10px] z-50">
        <div className="forensic-status-grid">
          <div className="forensic-status-block">
            <span className="forensic-status-label">System Status</span>
            <div className="forensic-status-value flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${socketConfig.ready ? 'bg-cyber-green animate-pulse' : 'bg-red-500'}`} />
              <span>{socketConfig.ready ? 'Nominal' : 'Offline'}</span>
            </div>
          </div>
          <div className="forensic-status-block">
            <span className="forensic-status-label">Websocket</span>
            <div className="forensic-status-value">{socketConfig.ready ? 'Active' : 'Retrying'}</div>
          </div>
          <div className="forensic-status-block">
            <span className="forensic-status-label">Graph Nodes</span>
            <div className="forensic-status-value">{currentBoardSnapshot.nodeCount}</div>
          </div>
          <div className="forensic-status-block">
            <span className="forensic-status-label">Relationships</span>
            <div className="forensic-status-value">{currentBoardSnapshot.edgeCount}</div>
          </div>
          <div className="forensic-status-block">
            <span className="forensic-status-label">Evidence Items</span>
            <div className="forensic-status-value">{currentBoardSnapshot.evidenceCount}</div>
          </div>
          <div className="forensic-status-block">
            <span className="forensic-status-label">Last Activity</span>
            <div className="forensic-status-value">{currentBoardSnapshot.lastActivityLabel}</div>
          </div>
          <div className="forensic-status-block">
            <span className="forensic-status-label">Auto-Save</span>
            <div className="forensic-status-value">Enabled</div>
          </div>
          <div className="forensic-status-block forensic-status-block-confidence">
            <span className="forensic-status-label">Confidence Score</span>
            <div className="flex items-center gap-3">
              <div className="forensic-status-value">{Math.round(currentBoardSnapshot.confidenceScore * 100)}%</div>
              <div className="forensic-confidence-track h-2 flex-1 overflow-hidden rounded-full">
                <div
                  className="forensic-confidence-fill h-full rounded-full"
                  style={{ width: `${Math.round(currentBoardSnapshot.confidenceScore * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="forensic-status-activity">
          {activePipelineRun && !isPipelineChipDismissed && (
            <div
              data-testid="pipeline-progress-chip"
              className={`forensic-pipeline-chip forensic-pipeline-chip-${activePipelineRailStatus} ${isActivePipelineRunning ? 'forensic-pipeline-chip-scanning' : ''} forensic-status-segment text-left text-[10px]`}
              title={`${activePipelineRun.stepLabel} | elapsed ${formatDuration(activePipelineRun.elapsedMs)} | ETA ${activePipelineEta}`}
            >
              <button
                type="button"
                onClick={() => setIsPipelineDrawerOpen(true)}
                className="forensic-pipeline-chip-main"
                aria-label={`Open pipeline monitor: ${activePipelineRun.stepLabel}`}
              >
                <span className={`forensic-pipeline-chip-dot forensic-pipeline-chip-dot-${activePipelineRailStatus}`} aria-hidden="true" />
                <span className="forensic-status-heading font-bold uppercase tracking-[0.18em]">Pipeline</span>
                <strong>{activePipelinePercent}%</strong>
                <span className="forensic-pipeline-chip-label">{activePipelineRun.stepLabel}</span>
              </button>
              <button
                type="button"
                className="forensic-pipeline-chip-dismiss"
                aria-label="Dismiss pipeline status chip"
                onClick={() => {
                  setDismissedPipelineChipRuns((current) => ({
                    ...current,
                    [activePipelineRun.runId]: true,
                  }))
                }}
              >
                <X size={11} />
              </button>
            </div>
          )}

          {autosaveWarning && (
            <div className="forensic-autosave-warning forensic-status-segment flex items-center gap-2 text-[10px]">
              <AlertTriangle size={14} />
              <span className="font-bold uppercase tracking-[0.18em]">Autosave warning</span>
              <span>{formatAutosaveWarningMessage(autosaveWarning)}</span>
            </div>
          )}
        </div>

      </footer>

      {isPipelineDrawerOpen && activePipelineRun && (
        <aside data-testid="pipeline-progress-drawer" className={`forensic-pipeline-drawer forensic-pipeline-drawer-${activePipelineRailStatus} ${isActivePipelineRunning ? 'forensic-pipeline-drawer-scanning' : ''}`}>
          <div className="flex items-start justify-between gap-4 border-b border-[rgba(129,227,255,0.16)] pb-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent-muted)]">Pipeline Monitor</div>
              <h2 className="mt-2 text-lg font-black text-[var(--forensic-text)]">{activePipelineRun.stepLabel}</h2>
              <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">
                {activePipelineRun.mode.toUpperCase()} / {activePipelineRun.vaultId || 'unassigned vault'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canStopActivePipeline && (
                <button
                  type="button"
                  onClick={stopActivePipeline}
                  className="forensic-pipeline-stop-button"
                  aria-label="Stop current investigation"
                  title="Stop current investigation"
                >
                  <X size={14} />
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={closePipelineDrawer}
                className="rounded-lg border border-white/10 p-2 text-[var(--forensic-text-faint)] transition-colors hover:border-white/30 hover:text-white"
                aria-label="Close pipeline monitor"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-bold text-[var(--forensic-accent)]">
              <span>{activePipelinePercent}% complete</span>
              <span>Elapsed {formatDuration(activePipelineRun.elapsedMs)} / ETA {activePipelineEta}</span>
            </div>
            <div className="forensic-pipeline-progress-track">
              <div
                data-testid="pipeline-progress-bar"
                className={`forensic-pipeline-progress-fill ${isActivePipelineRunning ? 'forensic-pipeline-progress-fill-scanning' : ''}`}
                style={{ width: `${activePipelinePercent}%` }}
              />
            </div>
          </div>

          <div className="mt-5 space-y-2 overflow-y-auto pr-1">
            {(activePipelineRun.steps && activePipelineRun.steps.length > 0
              ? activePipelineRun.steps
              : [{
                id: activePipelineRun.stepId,
                label: activePipelineRun.stepLabel,
                status: activePipelineRun.status,
                durationMs: activePipelineRun.durationMs,
                detail: activePipelineRun.detail,
                error: activePipelineRun.error,
              } as PipelineProgressStepState]
            ).map((step) => {
              const transitionKey = getPipelineStepTransitionKey(activePipelineRun.runId, step.id, step.status)
              const transitionStatus = pipelineStepTransitions[transitionKey]
              return (
                <div
                  key={step.id}
                  data-testid="pipeline-progress-step"
                  className={`forensic-pipeline-step forensic-pipeline-step-${step.status} ${transitionStatus ? `forensic-pipeline-step-transition forensic-pipeline-step-transition-${transitionStatus}` : ''}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="forensic-pipeline-step-dot" />
                      <strong>{step.label}</strong>
                    </div>
                    {(step.error || step.detail) && (
                      <p>{step.error || step.detail}</p>
                    )}
                  </div>
                  <span>{step.status === 'pending' ? '--' : formatDuration(step.durationMs)}</span>
                </div>
              )
            })}
          </div>

          {activePipelineProfile && (
            <section className="forensic-pipeline-performance mt-5 border-t border-[rgba(129,227,255,0.12)] pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent-muted)]">Performance</div>
                <strong className="text-xs text-[var(--forensic-text)]">{formatDuration(activePipelineProfile.totalElapsedMs)} total</strong>
              </div>

              <div className="grid gap-2">
                {activePipelineDurationBottleneck && (
                  <div className="forensic-pipeline-profile-card">
                    <span>Slowest measured span</span>
                    <strong>{activePipelineDurationBottleneck.label}</strong>
                    <p>
                      {formatDuration(activePipelineDurationBottleneck.durationMs)} / {formatPipelinePercent(activePipelineDurationBottleneck.percentOfTotal)} of run
                    </p>
                  </div>
                )}

                {(activePipelineTokenBottleneck || activePipelineTokenUsageHotspot) && (
                  <div className="forensic-pipeline-profile-card">
                    <span>Token hotspot</span>
                    <strong>{activePipelineTokenBottleneck?.label || activePipelineTokenUsageHotspot?.operation}</strong>
                    <p
                      data-testid="pipeline-token-hotspot-value"
                      className={`forensic-pipeline-token-count ${isActivePipelineTokenAnimating ? 'forensic-pipeline-token-count-animating' : ''}`}
                    >
                      {formatCompactTokens(activePipelineTokenDisplayTotal)} tokens
                      {activePipelineTokenUsageHotspot ? ` / ${activePipelineTokenUsageHotspot.provider}` : ''}
                    </p>
                  </div>
                )}

                {comparisonPipelineProfile && (
                  <div className={`forensic-pipeline-profile-card ${activePipelineImpactMs > 0 ? 'forensic-pipeline-profile-card-positive' : ''}`}>
                    <span>Optimization impact</span>
                    <strong>{activePipelineImpactMs > 0 ? `${formatDuration(activePipelineImpactMs)} faster` : 'No speedup yet'}</strong>
                    <p>Previous similar run: {formatDuration(comparisonPipelineProfile.totalElapsedMs)} total</p>
                  </div>
                )}
              </div>
            </section>
          )}

          {pipelineRuns.length > 1 && (
            <div className="mt-5 border-t border-[rgba(129,227,255,0.12)] pt-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent-muted)]">Recent Runs</div>
              <div className="space-y-2">
                {pipelineRuns.slice(0, 4).map((run) => (
                  <button
                    key={run.runId}
                    type="button"
                    onClick={() => setActivePipelineRunId(run.runId)}
                    className="forensic-pipeline-run-row"
                  >
                    <span>{run.stepLabel}</span>
                    <strong>{clampProgressPercent(run.completedSteps, run.totalSteps)}%</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}

      {showSummaryLog && (
        <div className="absolute inset-0 z-[80] flex items-center justify-center bg-black/70 px-6 py-8 backdrop-blur-sm">
          <div className="forensic-board-dialog w-full max-w-3xl rounded-[1.35rem] p-6">
            <div className="mb-4 flex items-start justify-between gap-4 border-b border-[rgba(129,227,255,0.18)] pb-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent-muted)]">Full Log</div>
                <h2 className="mt-2 text-lg font-black text-[var(--forensic-text)]">{currentInvestigation?.displayTopic || 'Current Investigation'}</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowSummaryLog(false)}
                className="rounded-lg border border-white/10 p-2 text-[var(--forensic-text-faint)] transition-colors hover:border-white/30 hover:text-white"
                aria-label="Close investigation log"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap pr-2 text-sm leading-relaxed text-[var(--forensic-text-muted)]">
              {currentBoardSnapshot.fullReport}
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showLandingExperience && (
          <Suspense fallback={<div className="fixed inset-0 z-[100] bg-[#02060a]" />}>
            <LandingExperience
              onEnter={handleLandingEnter}
              stats={{
                investigations: investigations.length,
                evidence: currentBoardSnapshot.evidenceCount,
                relationships: currentBoardSnapshot.edgeCount,
              }}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
