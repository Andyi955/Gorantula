import { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { MergeCandidateNode } from './components/SynthesisPanel'
import { Terminal, Database, Folder, Plus, Trash2, Settings, Clock, MessageSquare, Search, FileText, X, ListFilter, ChevronLeft, ChevronRight, GripVertical, AlertTriangle } from 'lucide-react'
import {
  buildSidebarInvestigationRows,
  createRootInvestigation,
  registerMergedChildInvestigation,
  removeInvestigationRecord,
  type InvestigationRecord,
} from './utils/investigations'
import { BOARD_PERSIST_FAILED_EVENT, createMergedChildBoard } from './utils/hierarchicalCanvas'
import { BROWSER_QA_CLEARED_EVENT, BROWSER_QA_SEEDED_EVENT, type BrowserQaSeedResult } from './utils/browserQaSeed'
import { IMAGE_SCRAPING_PREFERENCE_KEY, readImageScrapingPreference } from './utils/searchPreferences'
import { BOARD_WORKSPACE_STATE_UPDATED_EVENT } from './utils/boardWorkspaceEvents'
import {
  deleteInvestigationPersistence,
  getCachedBoardStateForInvestigation,
  getCachedVaultResultForInvestigation,
  loadBoardStateForInvestigation,
  loadDiscoveriesForInvestigations,
  loadInvestigations,
  loadInvestigationsFromBrowserStorage,
  loadVaultResultForInvestigation,
  saveBoardStateForInvestigation,
  saveDiscoveriesForInvestigation,
  saveInvestigations,
} from './utils/investigationPersistence'

const SpiderVisualizer = lazy(() => import('./components/SpiderVisualizer'))
const DetectiveBoard = lazy(() => import('./components/DetectiveBoard'))
const SettingsDashboard = lazy(() => import('./components/SettingsDashboard'))
const TimelineView = lazy(() => import('./components/TimelineView'))
const VaultChatbot = lazy(() => import('./components/VaultChatbot'))
const SynthesisPanel = lazy(() => import('./components/SynthesisPanel'))
const DiscoveryPanel = lazy(() => import('./components/DiscoveryPanel'))

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

interface TokenUsageReport {
  investigationId?: string
  label: string
  callCount: number
  reportedCallCount: number
  estimatedCallCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  providerTotals?: Record<string, number>
}

interface PipelineProgressStepState {
  id: string
  label: string
  status: 'pending' | 'running' | 'complete' | 'error'
  startedAt?: string
  completedAt?: string
  durationMs?: number
  detail?: string
  error?: string
}

interface PipelineProgressPayload {
  runId: string
  vaultId?: string
  mode: string
  stepId: string
  stepLabel: string
  status: 'pending' | 'running' | 'complete' | 'error'
  completedSteps: number
  totalSteps: number
  startedAt?: string
  stepStartedAt?: string
  completedAt?: string
  elapsedMs: number
  durationMs?: number
  estimatedRemainingMs?: number
  detail?: string
  error?: string
  steps?: PipelineProgressStepState[]
}

interface PipelineRunState extends PipelineProgressPayload {
  updatedAt: number
}

interface PipelineProfileBottleneck {
  kind: 'step' | 'span' | 'token'
  id: string
  label: string
  stepId?: string
  durationMs?: number
  totalTokens?: number
  percentOfTotal?: number
}

interface PipelineProfileTokenUsage {
  operation: string
  provider: string
  callCount: number
  reportedCallCount?: number
  estimatedCallCount?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens: number
}

interface PipelinePerformanceProfile {
  runId: string
  vaultId?: string
  mode?: string
  status?: string
  startedAt?: string
  completedAt?: string
  totalElapsedMs: number
  counters?: Record<string, number>
  bottlenecks: PipelineProfileBottleneck[]
  tokenUsage: PipelineProfileTokenUsage[]
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
const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const investigationTimestampPattern = /(?:inv|merge)-(\d{10,})$/i

const formatCompactTokens = (value: number) => compactTokenFormatter.format(value)

const clampSidebarWidth = (value: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)))

const createPipelineRunId = () => `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const clampProgressPercent = (completedSteps: number, totalSteps: number) => {
  if (!Number.isFinite(completedSteps) || !Number.isFinite(totalSteps) || totalSteps <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((completedSteps / totalSteps) * 100)))
}

const formatDuration = (milliseconds?: number | null) => {
  if (!milliseconds || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0s'
  }

  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) {
    return `${seconds}s`
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

const coercePipelineStatus = (value: unknown): PipelineProgressPayload['status'] => {
  if (value === 'pending' || value === 'running' || value === 'complete' || value === 'error') {
    return value
  }
  return 'running'
}

const coercePipelineProgressPayload = (payload: unknown): PipelineProgressPayload | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.runId !== 'string' || candidate.runId.trim() === '') {
    return null
  }

  const rawSteps = Array.isArray(candidate.steps) ? candidate.steps : []
  const steps = rawSteps
    .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object' && !Array.isArray(step))
    .map((step) => ({
      id: typeof step.id === 'string' ? step.id : '',
      label: typeof step.label === 'string' ? step.label : 'Pipeline step',
      status: coercePipelineStatus(step.status),
      startedAt: typeof step.startedAt === 'string' ? step.startedAt : undefined,
      completedAt: typeof step.completedAt === 'string' ? step.completedAt : undefined,
      durationMs: parseTokenCount(step.durationMs),
      detail: typeof step.detail === 'string' ? step.detail : undefined,
      error: typeof step.error === 'string' ? step.error : undefined,
    }))
    .filter((step) => step.id)

  return {
    runId: candidate.runId.trim(),
    vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId : undefined,
    mode: typeof candidate.mode === 'string' ? candidate.mode : 'web',
    stepId: typeof candidate.stepId === 'string' ? candidate.stepId : 'pipeline',
    stepLabel: typeof candidate.stepLabel === 'string' ? candidate.stepLabel : 'Pipeline',
    status: coercePipelineStatus(candidate.status),
    completedSteps: parseTokenCount(candidate.completedSteps),
    totalSteps: Math.max(1, parseTokenCount(candidate.totalSteps)),
    startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : undefined,
    stepStartedAt: typeof candidate.stepStartedAt === 'string' ? candidate.stepStartedAt : undefined,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined,
    elapsedMs: parseTokenCount(candidate.elapsedMs),
    durationMs: parseTokenCount(candidate.durationMs),
    estimatedRemainingMs: parseTokenCount(candidate.estimatedRemainingMs),
    detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    steps,
  }
}

const tabFallback = (label: string) => (
  <div className="flex h-full items-center justify-center bg-cyber-black text-xs font-bold uppercase tracking-[0.24em] text-cyber-cyan/70">
    Loading {label}...
  </div>
)

const formatTokenProviderBreakdown = (providerTotals?: Record<string, number>) => {
  const entries = Object.entries(providerTotals || {})
  if (entries.length === 0) {
    return 'No provider totals reported'
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, total]) => `${provider}: ${total.toLocaleString()}`)
    .join(' | ')
}

const buildEmptyTokenUsageReport = (label: string): TokenUsageReport => ({
  label,
  callCount: 0,
  reportedCallCount: 0,
  estimatedCallCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  providerTotals: {},
})

const parseTokenCount = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

const coerceTokenUsageReport = (payload: unknown): TokenUsageReport | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.label !== 'string' || candidate.label.trim() === '') {
    return null
  }

  const rawProviderTotals = candidate.providerTotals && typeof candidate.providerTotals === 'object' && !Array.isArray(candidate.providerTotals)
    ? candidate.providerTotals as Record<string, unknown>
    : {}

  const providerTotals = Object.entries(rawProviderTotals).reduce<Record<string, number>>((totals, [provider, total]) => {
    totals[provider] = parseTokenCount(total)
    return totals
  }, {})

  return {
    investigationId: typeof candidate.investigationId === 'string' && candidate.investigationId.trim() !== '' ? candidate.investigationId : undefined,
    label: candidate.label,
    callCount: parseTokenCount(candidate.callCount),
    reportedCallCount: parseTokenCount(candidate.reportedCallCount),
    estimatedCallCount: parseTokenCount(candidate.estimatedCallCount),
    promptTokens: parseTokenCount(candidate.promptTokens),
    completionTokens: parseTokenCount(candidate.completionTokens),
    totalTokens: parseTokenCount(candidate.totalTokens),
    providerTotals,
  }
}

const coercePipelineProfile = (payload: unknown): PipelinePerformanceProfile | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.runId !== 'string' || candidate.runId.trim() === '') {
    return null
  }

  const rawCounters = candidate.counters && typeof candidate.counters === 'object' && !Array.isArray(candidate.counters)
    ? candidate.counters as Record<string, unknown>
    : {}
  const counters = Object.entries(rawCounters).reduce<Record<string, number>>((accumulator, [key, value]) => {
    accumulator[key] = parseTokenCount(value)
    return accumulator
  }, {})

  const bottlenecks = (Array.isArray(candidate.bottlenecks) ? candidate.bottlenecks : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item): PipelineProfileBottleneck => ({
      kind: item.kind === 'step' || item.kind === 'span' || item.kind === 'token' ? item.kind : 'span',
      id: typeof item.id === 'string' ? item.id : '',
      label: typeof item.label === 'string' && item.label.trim() ? item.label : 'Pipeline bottleneck',
      stepId: typeof item.stepId === 'string' ? item.stepId : undefined,
      durationMs: parseTokenCount(item.durationMs),
      totalTokens: parseTokenCount(item.totalTokens),
      percentOfTotal: parseTokenCount(item.percentOfTotal),
    }))
    .filter((item) => item.id || item.label)

  const tokenUsage = (Array.isArray(candidate.tokenUsage) ? candidate.tokenUsage : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      operation: typeof item.operation === 'string' && item.operation.trim() ? item.operation : 'unknown',
      provider: typeof item.provider === 'string' && item.provider.trim() ? item.provider : 'unknown',
      callCount: parseTokenCount(item.callCount),
      reportedCallCount: parseTokenCount(item.reportedCallCount),
      estimatedCallCount: parseTokenCount(item.estimatedCallCount),
      promptTokens: parseTokenCount(item.promptTokens),
      completionTokens: parseTokenCount(item.completionTokens),
      totalTokens: parseTokenCount(item.totalTokens),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)

  return {
    runId: candidate.runId.trim(),
    vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId : undefined,
    mode: typeof candidate.mode === 'string' ? candidate.mode : undefined,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : undefined,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined,
    totalElapsedMs: parseTokenCount(candidate.totalElapsedMs),
    counters,
    bottlenecks,
    tokenUsage,
  }
}

const coercePipelineProfiles = (payload: unknown): PipelinePerformanceProfile[] => {
  if (!Array.isArray(payload)) {
    return []
  }
  return payload
    .map(coercePipelineProfile)
    .filter((profile): profile is PipelinePerformanceProfile => Boolean(profile))
}

const getTopPipelineDurationBottleneck = (profile?: PipelinePerformanceProfile | null) =>
  profile?.bottlenecks.find((bottleneck) => bottleneck.kind === 'span' || bottleneck.kind === 'step') || null

const getTopPipelineTokenBottleneck = (profile?: PipelinePerformanceProfile | null) =>
  profile?.bottlenecks.find((bottleneck) => bottleneck.kind === 'token' && (bottleneck.totalTokens || 0) > 0) || null

const getTopPipelineTokenUsage = (profile?: PipelinePerformanceProfile | null) =>
  profile?.tokenUsage[0] || null

const formatPipelinePercent = (value?: number | null) => {
  if (!value || !Number.isFinite(value)) {
    return '0%'
  }
  return `${Math.round(value)}%`
}

const accumulateTokenUsage = (base: TokenUsageReport, incoming: TokenUsageReport): TokenUsageReport => {
  const providerTotals: Record<string, number> = { ...(base.providerTotals || {}) }
  for (const [provider, total] of Object.entries(incoming.providerTotals || {})) {
    providerTotals[provider] = (providerTotals[provider] || 0) + total
  }

  return {
    investigationId: base.investigationId,
    label: base.label,
    callCount: base.callCount + incoming.callCount,
    reportedCallCount: base.reportedCallCount + incoming.reportedCallCount,
    estimatedCallCount: base.estimatedCallCount + incoming.estimatedCallCount,
    promptTokens: base.promptTokens + incoming.promptTokens,
    completionTokens: base.completionTokens + incoming.completionTokens,
    totalTokens: base.totalTokens + incoming.totalTokens,
    providerTotals,
  }
}

const loadInvestigationsFromStorage = loadInvestigationsFromBrowserStorage

const getInvestigationTimestamp = (investigationId: string): number | null => {
  const match = investigationId.match(investigationTimestampPattern)
  if (!match) {
    return null
  }

  const timestamp = Number.parseInt(match[1], 10)
  return Number.isFinite(timestamp) ? timestamp : null
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

const shouldFetchPipelineProfiles = () => {
  if (import.meta.env.MODE !== 'test') {
    return true
  }
  return Boolean((fetch as unknown as { mock?: unknown }).mock)
}

const isBackendReachable = async () => {
  if (!SHOULD_PROBE_BACKEND) {
    return true
  }

  try {
    const response = await fetch(BACKEND_STATUS_ENDPOINT, { cache: 'no-store' })
    if (!response.ok) {
      return true
    }

    const status = await response.json()
    return status?.ready === true
  } catch {
    // In dev, prefer quiet local mode over noisy connection-refused loops.
    return false
  }
}

function App() {
  const initialInvestigationsRef = useRef<InvestigationRecord[] | null>(null)
  if (initialInvestigationsRef.current === null) {
    initialInvestigationsRef.current = loadInvestigationsFromStorage()
  }

  const [activeTab, setActiveTab] = useState<'spider' | 'board' | 'timeline' | 'chat' | 'settings'>('spider')
  const [prompt, setPrompt] = useState('')
  const [crawlMode, setCrawlMode] = useState<'web' | 'local'>('web')
  const [imageScrapingEnabled, setImageScrapingEnabled] = useState(() => readImageScrapingPreference())
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [hasCustomSidebarWidth, setHasCustomSidebarWidth] = useState(false)
  const [boardWorkspaceRevision, setBoardWorkspaceRevision] = useState(0)
  const [showSummaryLog, setShowSummaryLog] = useState(false)
  const [socketConfig, setSocketConfig] = useState<{ socket: WebSocket | null, ready: boolean }>({ socket: null, ready: false })

  const [investigations, setInvestigations] = useState<InvestigationRecord[]>(() => initialInvestigationsRef.current || [])
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(() => initialInvestigationsRef.current?.[0]?.id || null)
  const [returnVaultId, setReturnVaultId] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [discoveriesByInvestigation, setDiscoveriesByInvestigation] = useState<Record<string, DiscoveryRecord[]>>({})
  const [unreadDiscoveriesByInvestigation, setUnreadDiscoveriesByInvestigation] = useState<Record<string, boolean>>({})
  const [sessionTokenUsage, setSessionTokenUsage] = useState<TokenUsageReport>(() => buildEmptyTokenUsageReport('Session Total'))
  const [boardTokenUsageByInvestigation, setBoardTokenUsageByInvestigation] = useState<Record<string, TokenUsageReport>>({})
  const [pipelineRunsById, setPipelineRunsById] = useState<Record<string, PipelineRunState>>({})
  const [pipelineProfiles, setPipelineProfiles] = useState<PipelinePerformanceProfile[]>([])
  const [activePipelineRunId, setActivePipelineRunId] = useState<string | null>(null)
  const [isPipelineDrawerOpen, setIsPipelineDrawerOpen] = useState(false)
  const [dismissedPipelineChipRuns, setDismissedPipelineChipRuns] = useState<Record<string, boolean>>({})
  const [autosaveWarning, setAutosaveWarning] = useState<AutosaveWarning | null>(null)

  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isUnmounted = useRef(false);
  const backendOfflineNoticeShownRef = useRef(false);
  const crawlInputRef = useRef<HTMLInputElement | null>(null);
  const activeSidebarItemRef = useRef<HTMLDivElement | null>(null);
  const sidebarResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const currentInvestigation = investigations.find((investigation) => investigation.id === currentInvestigationId) || null;
  const sidebarRows = buildSidebarInvestigationRows(investigations);
  const isBoardWorkspaceActive = activeTab === 'board'
  const isForensicWorkspaceActive = isBoardWorkspaceActive || activeTab === 'spider' || activeTab === 'timeline' || activeTab === 'settings'
  const expandedSidebarWidth = hasCustomSidebarWidth
    ? sidebarWidth
    : (isBoardWorkspaceActive ? SIDEBAR_BOARD_DEFAULT_WIDTH : SIDEBAR_DEFAULT_WIDTH)
  const renderedSidebarWidth = isSidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : expandedSidebarWidth
  const showFloatingPanelHandles = activeTab !== 'spider' && activeTab !== 'settings' && activeTab !== 'timeline' && !isBoardWorkspaceActive

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
      }
    }

    const savedBoardState = getCachedBoardStateForInvestigation(currentInvestigationId)
    const savedVaultResult = getCachedVaultResultForInvestigation(currentInvestigationId)
    const savedDiscoveries = discoveriesByInvestigation[currentInvestigationId] || []
    const nodes = savedBoardState?.nodes || []
    const edges = savedBoardState?.edges || []
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
    if (savedVaultResult) {
      try {
        const rawResult = typeof savedVaultResult?.result === 'string' ? savedVaultResult.result : ''
        if (rawResult.trim()) {
          const readableReport = cleanReportBody(rawResult)
          const readableSummary = extractReadableSummary(rawResult)
          fullReport = readableReport || stripMarkdownFormatting(rawResult)
          summary = readableSummary || truncateAtSentenceBoundary(fullReport, 240)
        }
      } catch (error) {
        console.error('[App] Failed to parse persisted vault result', error)
      }
    } else if (nodes.length > 0) {
      const firstSummary = nodes.find((node) => typeof node.data?.summary === 'string' && node.data.summary.trim())?.data?.summary
      if (typeof firstSummary === 'string' && firstSummary.trim()) {
        const readableReport = cleanReportBody(firstSummary)
        summary = extractReadableSummary(firstSummary)
        fullReport = readableReport || summary
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
    }
  }, [boardWorkspaceRevision, currentInvestigationId, discoveriesByInvestigation])

  const focusSpiderInput = useCallback(() => {
    crawlInputRef.current?.focus()
  }, [])

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

  const refreshPipelineProfiles = useCallback(async () => {
    if (!shouldFetchPipelineProfiles()) {
      return
    }
    try {
      const response = await fetch(`${PIPELINE_RUNS_ENDPOINT}?limit=20`, { cache: 'no-store' })
      if (!response.ok) {
        return
      }
      const data = await response.json()
      setPipelineProfiles(coercePipelineProfiles(data))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.debug('[App] Pipeline profile history unavailable', error)
      }
    }
  }, [])

  const scheduleReconnect = (delay = WEBSOCKET_RETRY_DELAY_MS) => {
    if (isUnmounted.current) {
      return
    }

    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current)
    }

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null
      void connect()
    }, delay)
  }

  const connect = async () => {
    if (isUnmounted.current) {
      return
    }

    if (socketRef.current && (socketRef.current.readyState === 0 || socketRef.current.readyState === 1)) {
      return
    }

    const backendReady = await isBackendReachable()
    if (!backendReady) {
      setSocketConfig({ socket: null, ready: false })
      if (!backendOfflineNoticeShownRef.current) {
        console.debug('[App] Backend offline; staying in local UI mode and retrying quietly.')
        backendOfflineNoticeShownRef.current = true
      }
      scheduleReconnect()
      return
    }

    console.debug('[App] Connecting to WebSocket...');
    const s = new WebSocket(BACKEND_WS_URL)

    socketRef.current = s;

    s.onopen = () => {
      backendOfflineNoticeShownRef.current = false
      console.debug('[App] WebSocket Connected');
      setSocketConfig({ socket: s, ready: true });
      
      const ids = investigations.map((inv) => inv.id);
      if (ids.length > 0) {
        s.send(JSON.stringify({ type: 'SYNC_VAULTS', payload: ids }));
      }
    };

    s.onclose = () => {
      setSocketConfig({ socket: null, ready: false });
      socketRef.current = null;
      scheduleReconnect();
    };

    s.onerror = () => {
      if (s.readyState !== 3) {
        s.close();
      }
    };
  };

  useEffect(() => {
    isUnmounted.current = false;
    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      void connect();
    }, 0);

    void (async () => {
      const data = await loadInvestigations()
      if (isUnmounted.current) {
        return
      }
      if (data.length > 0) {
        setInvestigations(data)
        setCurrentInvestigationId(data[0].id)
        const [discoveries] = await Promise.all([
          loadDiscoveriesForInvestigations(data),
          ...data.map((investigation) => loadBoardStateForInvestigation(investigation.id)),
          ...data.map((investigation) => loadVaultResultForInvestigation(investigation.id)),
        ])
        if (!isUnmounted.current) {
          setDiscoveriesByInvestigation(discoveries as unknown as Record<string, DiscoveryRecord[]>)
          setBoardWorkspaceRevision((current) => current + 1)
        }
      }
    })()

    return () => {
      isUnmounted.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current && socketRef.current.readyState === 1) socketRef.current.close();
    }
  }, [])

  useEffect(() => {
    void refreshPipelineProfiles()
  }, [refreshPipelineProfiles])

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

          setPipelineRunsById((current) => ({
            ...current,
            [progress.runId]: {
              ...(current[progress.runId] || {}),
              ...progress,
              updatedAt: Date.now(),
            },
          }))
          setActivePipelineRunId(progress.runId)
          return
        }

        if (msg.type === 'PIPELINE_PROFILE_SAVED') {
          void refreshPipelineProfiles()
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

        if (msg.type !== 'DISCOVERIES_FOUND' || !Array.isArray(msg.payload)) {
          return
        }

        const incoming = msg.payload as DiscoveryRecord[]
        const vaultId = incoming[0]?.sourceVaultID
        if (!vaultId) {
          return
        }

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

        if (currentInvestigationId !== vaultId) {
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
  }, [currentInvestigationId, refreshPipelineProfiles, socketConfig.socket])

  const currentBoardTokenUsage = currentInvestigationId ? boardTokenUsageByInvestigation[currentInvestigationId] || null : null
  const pipelineRuns = useMemo(
    () => Object.values(pipelineRunsById).sort((left, right) => right.updatedAt - left.updatedAt),
    [pipelineRunsById],
  )
  const activePipelineRun = activePipelineRunId ? pipelineRunsById[activePipelineRunId] || null : pipelineRuns[0] || null
  const pipelineProfilesByRunId = useMemo(() => {
    return pipelineProfiles.reduce<Record<string, PipelinePerformanceProfile>>((profiles, profile) => {
      profiles[profile.runId] = profile
      return profiles
    }, {})
  }, [pipelineProfiles])
  const activePipelineProfile = activePipelineRun
    ? pipelineProfilesByRunId[activePipelineRun.runId] || null
    : pipelineProfiles[0] || null
  const comparisonPipelineProfile = activePipelineProfile
    ? pipelineProfiles.find((profile) => (
      profile.runId !== activePipelineProfile.runId &&
      profile.vaultId === activePipelineProfile.vaultId &&
      profile.mode === activePipelineProfile.mode
    )) || null
    : null
  const activePipelineDurationBottleneck = getTopPipelineDurationBottleneck(activePipelineProfile)
  const activePipelineTokenBottleneck = getTopPipelineTokenBottleneck(activePipelineProfile)
  const activePipelineTokenUsageHotspot = getTopPipelineTokenUsage(activePipelineProfile)
  const activePipelineImpactMs = comparisonPipelineProfile && activePipelineProfile
    ? comparisonPipelineProfile.totalElapsedMs - activePipelineProfile.totalElapsedMs
    : 0
  const activePipelinePercent = activePipelineRun
    ? clampProgressPercent(activePipelineRun.completedSteps, activePipelineRun.totalSteps)
    : 0
  const activePipelineEta = activePipelineRun?.status === 'complete'
    ? 'done'
    : activePipelineRun?.estimatedRemainingMs
      ? formatDuration(activePipelineRun.estimatedRemainingMs)
      : 'calibrating'
  const activePipelineRailStatus: 'idle' | 'running' | 'complete' | 'error' = !activePipelineRun
    ? 'idle'
    : activePipelineRun.status === 'complete'
      ? 'complete'
      : activePipelineRun.status === 'error'
        ? 'error'
        : 'running'
  const isPipelineChipDismissed = activePipelineRun
    ? Boolean(dismissedPipelineChipRuns[activePipelineRun.runId])
    : false

  useEffect(() => {
    const handleClearDiscoveries = (event: Event) => {
      const customEvent = event as CustomEvent<{ vaultId?: string }>
      const vaultId = customEvent.detail?.vaultId
      if (!vaultId) {
        return
      }

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
      const nextInvestigations = loadInvestigationsFromStorage()
      setInvestigations(nextInvestigations)
      setCurrentInvestigationId(
        detail?.focusInvestigationId && nextInvestigations.some((investigation) => investigation.id === detail.focusInvestigationId)
          ? detail.focusInvestigationId
          : (nextInvestigations[0]?.id || null),
      )
      setReturnVaultId(null)
      setFocusedNodeId(null)
      setActiveTab('board')
      setBoardWorkspaceRevision((current) => current + 1)
    }

    const handleBrowserQaCleared = () => {
      const nextInvestigations = loadInvestigationsFromStorage()
      setInvestigations(nextInvestigations)
      setCurrentInvestigationId((current) => (
        current && nextInvestigations.some((investigation) => investigation.id === current)
          ? current
          : (nextInvestigations[0]?.id || null)
      ))
      setReturnVaultId((current) => (
        current && nextInvestigations.some((investigation) => investigation.id === current)
          ? current
          : null
      ))
      setFocusedNodeId(null)
      setBoardWorkspaceRevision((current) => current + 1)
    }

    window.addEventListener(BROWSER_QA_SEEDED_EVENT, handleBrowserQaSeeded as EventListener)
    window.addEventListener(BROWSER_QA_CLEARED_EVENT, handleBrowserQaCleared as EventListener)
    return () => {
      window.removeEventListener(BROWSER_QA_SEEDED_EVENT, handleBrowserQaSeeded as EventListener)
      window.removeEventListener(BROWSER_QA_CLEARED_EVENT, handleBrowserQaCleared as EventListener)
    }
  }, [])

  useEffect(() => {
    const handleBoardWorkspaceUpdate = () => {
      setBoardWorkspaceRevision((current) => current + 1)
    }

    window.addEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardWorkspaceUpdate)
    return () => window.removeEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardWorkspaceUpdate)
  }, [])

  useEffect(() => {
    if (!currentInvestigationId) {
      return
    }
    void Promise.all([
      loadBoardStateForInvestigation(currentInvestigationId),
      loadVaultResultForInvestigation(currentInvestigationId),
      loadDiscoveriesForInvestigations(investigations.filter((investigation) => investigation.id === currentInvestigationId)),
    ]).then(([_, __, discoveries]) => {
      if (discoveries[currentInvestigationId]) {
        setDiscoveriesByInvestigation((current) => ({
          ...current,
        [currentInvestigationId]: discoveries[currentInvestigationId] as unknown as DiscoveryRecord[],
        }))
      }
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

  const runSpider = (customPrompt?: string, customLabel?: string, overrideMode?: 'web' | 'local') => {
    const textToRun = customPrompt || prompt;
    const labelToUse = customLabel || textToRun;
    const modeToUse = overrideMode || crawlMode;
    const shouldScrapeImages = modeToUse === 'web' && imageScrapingEnabled
    if (socketConfig.socket && socketConfig.ready && textToRun) {
      const id = `inv-${Date.now()}`
      const runId = createPipelineRunId()

      // Extract folder name for better label
      let displayTopic = labelToUse;
      if (modeToUse === 'local') {
        const parts = labelToUse.split(/[\\/]/);
        displayTopic = `Local: ${parts[parts.length - 1] || labelToUse}`;
      }

      const newInv = createRootInvestigation(id, displayTopic)
      const updated = [newInv, ...investigations]
      persistInvestigations(updated)
      setCurrentInvestigationId(id)

      socketConfig.socket.send(JSON.stringify(
        modeToUse === 'local'
          ? { type: 'CRAWL_LOCAL', payload: textToRun, vaultId: id, runId }
          : { type: 'CRAWL', payload: textToRun, vaultId: id, runId, scrapeImages: shouldScrapeImages }
      ))
      if (!customPrompt) setPrompt('')
      setActiveTab('spider')
      return id;
    } else {
      alert("System not ready. Please check backend connection.");
      return null;
    }
  }

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
        const updatedNodes = nodes.map((n: any) =>
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
      void deleteInvestigationPersistence(removedId).catch((error) => {
        console.warn('[App] Failed to delete persisted investigation data', error)
      })
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
      setCurrentInvestigationId(removal.investigations[0]?.id || null)
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
    ? 'forensic-app-shell flex h-screen w-screen flex-col overflow-hidden font-mono'
    : 'flex h-screen w-screen flex-col overflow-hidden bg-cyber-black font-mono'
  const brandClassName = isForensicWorkspaceActive
    ? 'forensic-app-brand text-2xl font-black tracking-tighter italic'
    : 'text-2xl font-black tracking-tighter italic text-cyber-green'
  const tabRailClassName = isForensicWorkspaceActive
    ? 'forensic-app-tab-rail'
    : 'flex gap-4'
  const getTabClassName = (tab: 'spider' | 'board' | 'timeline' | 'chat' | 'settings', activeClassName: string) => (
    isForensicWorkspaceActive
      ? `forensic-app-tab ${activeTab === tab ? `forensic-app-tab-active ${activeClassName}` : ''}`
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
    <div className={appShellClassName}>
      {/* Top Header */}
      <header className={headerClassName}>
        <h1 className={brandClassName}>
          GORANTULA <span className={`ml-2 text-sm not-italic font-normal ${isBoardWorkspaceActive || activeTab === 'spider' ? 'forensic-app-brand-meta' : 'text-white opacity-50'}`}>v2.0 // ARCHITECT</span>
        </h1>

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
                      setCurrentInvestigationId(investigation.id);
                      setReturnVaultId(investigation.kind === 'merged-child' ? investigation.primaryParentId : null);
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
              filteredSidebarRows.map(({ investigation, depth }) => (
                <div
                  key={investigation.id}
                  ref={currentInvestigationId === investigation.id ? activeSidebarItemRef : null}
                  className={`forensic-sidebar-item group relative ${currentInvestigationId === investigation.id ? 'forensic-sidebar-item-active' : ''}`}
                >
                  <button
                    onClick={() => {
                      setCurrentInvestigationId(investigation.id);
                      setReturnVaultId(investigation.kind === 'merged-child' ? investigation.primaryParentId : null);
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
              discoveries={currentInvestigationId ? (discoveriesByInvestigation[currentInvestigationId] || []) : []}
              hasUnread={currentInvestigationId ? Boolean(unreadDiscoveriesByInvestigation[currentInvestigationId]) : false}
              showHandle={showFloatingPanelHandles}
              onOpenDiscovery={(nodeId?: string) => {
                if (!currentInvestigationId) return
                handleNavigateDiscovery(currentInvestigationId, nodeId)
              }}
              onClear={() => {
                if (!currentInvestigationId) return

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
                    />
                  </Suspense>
                )}
              </div>

              {/* Input Footer */}
              <div data-testid="spider-crawl-console" className="forensic-spider-crawl-console">
                <div className="forensic-spider-console-grid">
                  <section className="forensic-spider-console-panel forensic-spider-console-panel-mode">
                    <div className="forensic-spider-console-label">Crawl Console</div>
                    <div className="forensic-spider-mode-toggle" role="group" aria-label="Crawl mode">
                      <button
                        type="button"
                        onClick={() => setCrawlMode('web')}
                        className={crawlMode === 'web' ? 'forensic-spider-mode-active' : ''}
                      >
                        WEB
                      </button>
                      <button
                        type="button"
                        onClick={() => setCrawlMode('local')}
                        className={crawlMode === 'local' ? 'forensic-spider-mode-active' : ''}
                      >
                        LOCAL
                      </button>
                    </div>
                    <div className="forensic-spider-console-meta">
                      <span>Mode: {crawlMode === 'web' ? 'Web Crawl' : 'Local Vault'}</span>
                      <span>Depth Limit <strong>3</strong></span>
                      <span>Rate Limit <strong>150</strong></span>
                    </div>
                  </section>

                  <section className="forensic-spider-console-panel forensic-spider-console-panel-options">
                    <div className="flex items-center justify-between gap-3">
                      <div className="forensic-spider-console-label">Scrape Images</div>
                      {crawlMode === 'web' ? (
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
                    <div className="forensic-spider-console-select">
                      <span>User Agent</span>
                      <strong>Gorantula/2.0</strong>
                    </div>
                    <div className="forensic-spider-console-select">
                      <span>Proxy Pool</span>
                      <strong>Default Pool</strong>
                    </div>
                  </section>

                  <section className="forensic-spider-console-panel forensic-spider-console-panel-params">
                    <div className="forensic-spider-console-label">Crawl Parameters</div>
                    <pre aria-hidden="true">{`{
  "start_urls": [],
  "allowed_domains": [],
  "follow_external": true,
  "respect_robots": true,
  "max_pages": 10000,
  "max_depth": 3
}`}</pre>
                  </section>

                  <section className="forensic-spider-console-panel forensic-spider-console-panel-command">
                    <div className="forensic-spider-console-label">Command</div>
                    <div className="forensic-spider-command-input-wrap">
                      <input
                        ref={crawlInputRef}
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && runSpider()}
                        placeholder={crawlMode === 'web' ? "ENTER CRAWL PARAMETERS..." : "ENTER ABSOLUTE OS PATHS (DELIMITED) OR CLICK BROWSE..."}
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
                      <button type="button" className="forensic-spider-command-more" aria-label="Command options">
                        <ChevronRight size={15} />
                      </button>
                    </div>
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
              />
            </Suspense>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'timeline' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <Suspense fallback={tabFallback('Timeline')}>
              <TimelineView
                investigationId={currentInvestigationId}
                investigationTitle={currentInvestigation?.displayTopic || null}
                onNavigateToNode={(nodeId) => {
                  setFocusedNodeId(nodeId);
                  setActiveTab('board');
                  // Clear the focus after a delay to allow re-triggering same node
                  setTimeout(() => setFocusedNodeId(null), 1000);
                }}
              />
            </Suspense>
          </div>

          <div className={`absolute inset-0 transition-opacity duration-500 flex flex-col ${activeTab === 'chat' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            {activeTab === 'chat' && (
              <Suspense fallback={tabFallback('Vault Chat')}>
                <VaultChatbot sharedSocket={socketConfig.socket} />
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
        </main>
      </div>

      {/* Status Bar */}
      <footer className="forensic-statusbar forensic-statusbar-shell px-3 py-2 text-[10px] z-50 overflow-hidden">
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

        {activePipelineRun && !isPipelineChipDismissed && (
          <div
            data-testid="pipeline-progress-chip"
            className="forensic-pipeline-chip forensic-status-segment ml-4 shrink-0 text-left text-[10px]"
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
          <div className="forensic-autosave-warning forensic-status-segment ml-4 flex shrink-0 items-center gap-2 pl-4 text-[10px]">
            <AlertTriangle size={14} />
            <span className="font-bold uppercase tracking-[0.18em]">Autosave warning</span>
            <span>{formatAutosaveWarningMessage(autosaveWarning)}</span>
          </div>
        )}

        {!isBoardWorkspaceActive && currentBoardTokenUsage && (
          <div
            className="forensic-status-metric forensic-status-segment ml-4 flex shrink-0 items-center gap-3 pl-4 text-[10px]"
            title={`${currentBoardTokenUsage.label} | ${formatTokenProviderBreakdown(currentBoardTokenUsage.providerTotals)}`}
          >
            <span className="forensic-status-heading font-bold uppercase tracking-[0.2em]">Current Board</span>
            <span className="text-[var(--forensic-text)]">{currentBoardTokenUsage.label}</span>
            <span>{formatCompactTokens(currentBoardTokenUsage.totalTokens)} total</span>
            <span>{formatCompactTokens(currentBoardTokenUsage.promptTokens)} in</span>
            <span>{formatCompactTokens(currentBoardTokenUsage.completionTokens)} out</span>
            <span>{currentBoardTokenUsage.callCount} calls</span>
            {currentBoardTokenUsage.estimatedCallCount > 0 && (
              <span>{currentBoardTokenUsage.estimatedCallCount} est.</span>
            )}
          </div>
        )}
        {!isBoardWorkspaceActive && sessionTokenUsage.totalTokens > 0 && (
          <div
            className="forensic-status-metric forensic-status-segment ml-4 flex shrink-0 items-center gap-3 pl-4 text-[10px]"
            title={formatTokenProviderBreakdown(sessionTokenUsage.providerTotals)}
          >
            <span className="forensic-status-heading font-bold uppercase tracking-[0.2em]">Session Total</span>
            <span>{formatCompactTokens(sessionTokenUsage.totalTokens)} total</span>
            <span>{formatCompactTokens(sessionTokenUsage.promptTokens)} in</span>
            <span>{formatCompactTokens(sessionTokenUsage.completionTokens)} out</span>
            <span>{sessionTokenUsage.callCount} calls</span>
            {sessionTokenUsage.estimatedCallCount > 0 && (
              <span>{sessionTokenUsage.estimatedCallCount} est.</span>
            )}
          </div>
        )}
      </footer>

      {isPipelineDrawerOpen && activePipelineRun && (
        <aside data-testid="pipeline-progress-drawer" className="forensic-pipeline-drawer">
          <div className="flex items-start justify-between gap-4 border-b border-[rgba(129,227,255,0.16)] pb-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-[var(--forensic-accent-muted)]">Pipeline Monitor</div>
              <h2 className="mt-2 text-lg font-black text-[var(--forensic-text)]">{activePipelineRun.stepLabel}</h2>
              <p className="mt-1 text-xs text-[var(--forensic-text-muted)]">
                {activePipelineRun.mode.toUpperCase()} / {activePipelineRun.vaultId || 'unassigned vault'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPipelineDrawerOpen(false)}
              className="rounded-lg border border-white/10 p-2 text-[var(--forensic-text-faint)] transition-colors hover:border-white/30 hover:text-white"
              aria-label="Close pipeline monitor"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-bold text-[var(--forensic-accent)]">
              <span>{activePipelinePercent}% complete</span>
              <span>Elapsed {formatDuration(activePipelineRun.elapsedMs)} / ETA {activePipelineEta}</span>
            </div>
            <div className="forensic-pipeline-progress-track">
              <div
                data-testid="pipeline-progress-bar"
                className="forensic-pipeline-progress-fill"
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
            ).map((step) => (
              <div key={step.id} data-testid="pipeline-progress-step" className={`forensic-pipeline-step forensic-pipeline-step-${step.status}`}>
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
            ))}
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
                    <p>
                      {formatCompactTokens(activePipelineTokenBottleneck?.totalTokens || activePipelineTokenUsageHotspot?.totalTokens || 0)} tokens
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
    </div>
  )
}

export default App
