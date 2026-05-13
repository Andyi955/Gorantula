import { Suspense, lazy, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { MergeCandidateNode } from './components/SynthesisPanel'
import { Terminal, Database, Folder, Plus, Trash2, Settings, Clock, MessageSquare, Search, FileText, X, ListFilter } from 'lucide-react'
import {
  buildSidebarInvestigationRows,
  createRootInvestigation,
  INVESTIGATIONS_STORAGE_KEY,
  normalizeInvestigations,
  registerMergedChildInvestigation,
  removeInvestigationRecord,
  type InvestigationRecord,
} from './utils/investigations'
import { createMergedChildBoard, parsePersistedBoardState, persistBoardStateForInvestigation } from './utils/hierarchicalCanvas'
import { BROWSER_QA_CLEARED_EVENT, BROWSER_QA_SEEDED_EVENT, type BrowserQaSeedResult } from './utils/browserQaSeed'
import { IMAGE_SCRAPING_PREFERENCE_KEY, readImageScrapingPreference } from './utils/searchPreferences'
import { BOARD_WORKSPACE_STATE_UPDATED_EVENT } from './utils/boardWorkspaceEvents'

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

interface ConfidenceCarrier {
  confidence?: number | null
}

interface SidebarRowMetrics {
  evidenceCount: number
}

const DISCOVERIES_STORAGE_KEY = 'gorantula_discoveries_by_investigation'
const BACKEND_STATUS_ENDPOINT = '/__gorantula_backend_status'
const BACKEND_WS_URL = 'ws://localhost:8080/ws'
const WEBSOCKET_RETRY_DELAY_MS = 5000
const SHOULD_PROBE_BACKEND = import.meta.env.DEV && import.meta.env.MODE !== 'test'
const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const investigationTimestampPattern = /(?:inv|merge)-(\d{10,})$/i

const formatCompactTokens = (value: number) => compactTokenFormatter.format(value)

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

const loadInvestigationsFromStorage = () => {
  const saved = localStorage.getItem(INVESTIGATIONS_STORAGE_KEY)
  if (!saved) {
    return []
  }

  try {
    return normalizeInvestigations(JSON.parse(saved))
  } catch (error) {
    console.error('[App] Failed to parse investigations from storage', error)
    return []
  }
}

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
  const [activeTab, setActiveTab] = useState<'spider' | 'board' | 'timeline' | 'chat' | 'settings'>('spider')
  const [prompt, setPrompt] = useState('')
  const [crawlMode, setCrawlMode] = useState<'web' | 'local'>('web')
  const [imageScrapingEnabled, setImageScrapingEnabled] = useState(() => readImageScrapingPreference())
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('')
  const [boardWorkspaceRevision, setBoardWorkspaceRevision] = useState(0)
  const [showSummaryLog, setShowSummaryLog] = useState(false)
  const [socketConfig, setSocketConfig] = useState<{ socket: WebSocket | null, ready: boolean }>({ socket: null, ready: false })

  const [investigations, setInvestigations] = useState<InvestigationRecord[]>([])
  const [currentInvestigationId, setCurrentInvestigationId] = useState<string | null>(null)
  const [returnVaultId, setReturnVaultId] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [discoveriesByInvestigation, setDiscoveriesByInvestigation] = useState<Record<string, DiscoveryRecord[]>>({})
  const [unreadDiscoveriesByInvestigation, setUnreadDiscoveriesByInvestigation] = useState<Record<string, boolean>>({})
  const [sessionTokenUsage, setSessionTokenUsage] = useState<TokenUsageReport>(() => buildEmptyTokenUsageReport('Session Total'))
  const [boardTokenUsageByInvestigation, setBoardTokenUsageByInvestigation] = useState<Record<string, TokenUsageReport>>({})

  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isUnmounted = useRef(false);
  const backendOfflineNoticeShownRef = useRef(false);
  const crawlInputRef = useRef<HTMLInputElement | null>(null);
  const activeSidebarItemRef = useRef<HTMLDivElement | null>(null);
  const currentInvestigation = investigations.find((investigation) => investigation.id === currentInvestigationId) || null;
  const sidebarRows = buildSidebarInvestigationRows(investigations);
  const isBoardWorkspaceActive = activeTab === 'board'

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

      const savedBoardState = parsePersistedBoardState(localStorage.getItem(`inv_data_${investigation.id}`))
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

    const savedBoardState = parsePersistedBoardState(localStorage.getItem(`inv_data_${currentInvestigationId}`))
    const savedVaultResult = localStorage.getItem(`vault_result_${currentInvestigationId}`)
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
        const parsed = JSON.parse(savedVaultResult)
        const rawResult = typeof parsed?.result === 'string' ? parsed.result : ''
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
    localStorage.setItem(INVESTIGATIONS_STORAGE_KEY, JSON.stringify(nextInvestigations));
  }, []);

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
      
      const saved = localStorage.getItem(INVESTIGATIONS_STORAGE_KEY);
      if (saved) {
        try {
          const data = normalizeInvestigations(JSON.parse(saved));
          const ids = data.map((inv) => inv.id);
          s.send(JSON.stringify({ type: 'SYNC_VAULTS', payload: ids }));
        } catch (e) {
          console.error('[App] Failed to parse investigations for sync', e);
        }
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

    // Load list from local storage if any
    const data = loadInvestigationsFromStorage()
    if (data.length > 0) {
      setInvestigations(data)
      setCurrentInvestigationId(data[0].id)
    }

    const savedDiscoveries = localStorage.getItem(DISCOVERIES_STORAGE_KEY)
    if (savedDiscoveries) {
      try {
        const parsed = JSON.parse(savedDiscoveries)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setDiscoveriesByInvestigation(parsed)
        }
      } catch (error) {
        console.error('[App] Failed to parse saved discoveries', error)
      }
    }

    return () => {
      isUnmounted.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current && socketRef.current.readyState === 1) socketRef.current.close();
    }
  }, [])

  useEffect(() => {
    if (!socketConfig.socket) {
      return
    }

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)
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
          localStorage.setItem(DISCOVERIES_STORAGE_KEY, JSON.stringify(next))
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
  }, [currentInvestigationId, socketConfig.socket])

  const currentBoardTokenUsage = currentInvestigationId ? boardTokenUsageByInvestigation[currentInvestigationId] || null : null

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
        localStorage.setItem(DISCOVERIES_STORAGE_KEY, JSON.stringify(next))
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

  const runSpider = (customPrompt?: string, customLabel?: string, overrideMode?: 'web' | 'local') => {
    const textToRun = customPrompt || prompt;
    const labelToUse = customLabel || textToRun;
    const modeToUse = overrideMode || crawlMode;
    const shouldScrapeImages = modeToUse === 'web' && imageScrapingEnabled
    if (socketConfig.socket && socketConfig.ready && textToRun) {
      const id = `inv-${Date.now()}`

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
          ? { type: 'CRAWL_LOCAL', payload: textToRun }
          : { type: 'CRAWL', payload: textToRun, vaultId: id, scrapeImages: shouldScrapeImages }
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
      const saved = localStorage.getItem(`inv_data_${currentInvestigationId}`);
      if (saved) {
        const savedState = parsePersistedBoardState(saved);
        if (!savedState) {
          return;
        }
        const { nodes, edges, mode } = savedState;
        const updatedNodes = nodes.map((n: any) =>
          n.id === sourceNodeId ? { ...n, data: { ...n.data, linkedInvestigationId: newInvId, isDeepDiveSource: false } } : n
        );
        persistBoardStateForInvestigation(currentInvestigationId, {
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
      const board = parsePersistedBoardState(localStorage.getItem(`inv_data_${parentId}`));
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
      persistBoardStateForInvestigation(parentId, board);
    });
    persistBoardStateForInvestigation(childId, childBoard);
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
      localStorage.removeItem(`inv_data_${removedId}`)
      localStorage.removeItem(`vault_result_${removedId}`)
    })

    removal.investigations.forEach((investigation) => {
      const savedState = parsePersistedBoardState(localStorage.getItem(`inv_data_${investigation.id}`))
      if (!savedState) {
        return
      }

      const cleanedNodes = savedState.nodes.filter((node) => !node.data?.portalKind || !removal.removedIds.includes(node.data?.linkedInvestigationId))
      if (cleanedNodes.length !== savedState.nodes.length) {
        persistBoardStateForInvestigation(investigation.id, { ...savedState, nodes: cleanedNodes })
      }
    })

    let vaultPathToRemove = "";
    const vaultResultStr = localStorage.getItem(`vault_result_${idToRemove}`);
    if (vaultResultStr) {
      try {
        const vaultResult = JSON.parse(vaultResultStr);
        vaultPathToRemove = vaultResult.vaultPath || "";
      } catch (err) {}
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

  const headerClassName = isBoardWorkspaceActive
    ? 'forensic-app-shell-header'
    : 'flex items-center justify-between border-b border-cyber-gray bg-cyber-black px-6 py-4 z-50'
  const appShellClassName = isBoardWorkspaceActive
    ? 'forensic-app-shell flex h-screen w-screen flex-col overflow-hidden font-mono'
    : 'flex h-screen w-screen flex-col overflow-hidden bg-cyber-black font-mono'
  const brandClassName = isBoardWorkspaceActive
    ? 'forensic-app-brand text-2xl font-black tracking-tighter italic'
    : 'text-2xl font-black tracking-tighter italic text-cyber-green'
  const tabRailClassName = isBoardWorkspaceActive
    ? 'forensic-app-tab-rail'
    : 'flex gap-4'
  const getTabClassName = (tab: 'spider' | 'board' | 'timeline' | 'chat' | 'settings', activeClassName: string) => (
    isBoardWorkspaceActive
      ? `forensic-app-tab ${activeTab === tab ? `forensic-app-tab-active ${activeClassName}` : ''}`
      : `flex items-center gap-2 px-4 py-2 rounded transition-all ${activeTab === tab ? activeClassName : 'text-gray-500 hover:text-white'}`
  )

  return (
    <div className={appShellClassName}>
      {/* Top Header */}
      <header className={headerClassName}>
        <h1 className={brandClassName}>
          GORANTULA <span className={`ml-2 text-sm not-italic font-normal ${isBoardWorkspaceActive ? 'forensic-app-brand-meta' : 'text-white opacity-50'}`}>v2.0 // ARCHITECT</span>
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
            className={getTabClassName('settings', 'bg-cyber-gray/30 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]')}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`forensic-sidebar forensic-sidebar-shell ${isBoardWorkspaceActive ? 'w-[21rem] xl:w-[22rem]' : 'w-72'} shrink-0 flex flex-col`}>
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
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 relative">
          <Suspense fallback={null}>
            <DiscoveryPanel
              currentInvestigationId={currentInvestigationId}
              discoveries={currentInvestigationId ? (discoveriesByInvestigation[currentInvestigationId] || []) : []}
              hasUnread={currentInvestigationId ? Boolean(unreadDiscoveriesByInvestigation[currentInvestigationId]) : false}
              showHandle={!isBoardWorkspaceActive}
              onOpenDiscovery={(nodeId?: string) => {
                if (!currentInvestigationId) return
                handleNavigateDiscovery(currentInvestigationId, nodeId)
              }}
              onClear={() => {
                if (!currentInvestigationId) return

                setDiscoveriesByInvestigation(prev => {
                  const next = { ...prev, [currentInvestigationId]: [] }
                  localStorage.setItem(DISCOVERIES_STORAGE_KEY, JSON.stringify(next))
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
              showHandle={!isBoardWorkspaceActive}
            />
          </Suspense>

          <div className={`absolute inset-0 transition-opacity duration-500 ${activeTab === 'spider' ? 'opacity-100 z-10' : 'opacity-0 z-0 pointer-events-none'}`}>
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={tabFallback('Spider View')}>
                  <SpiderVisualizer sharedSocket={socketConfig.socket} />
                </Suspense>
              </div>

              {/* Input Footer */}
              <div className="p-6 bg-cyber-gray/30 border-t border-cyber-gray backdrop-blur-sm">
                <div className="max-w-4xl mx-auto flex gap-4 items-center">
                  <div className="flex bg-black border border-cyber-gray overflow-hidden shrink-0">
                    <button
                      onClick={() => setCrawlMode('web')}
                      className={`px-4 py-3 text-xs font-bold transition-colors ${crawlMode === 'web' ? 'bg-cyber-purple text-white shadow-[0_0_10px_rgba(188,19,254,0.5)]' : 'text-gray-500 hover:text-white'}`}
                    >
                      WEB
                    </button>
                    <button
                      onClick={() => setCrawlMode('local')}
                      className={`px-4 py-3 text-xs font-bold transition-colors border-l border-cyber-gray ${crawlMode === 'local' ? 'bg-cyber-cyan text-black shadow-[0_0_10px_rgba(0,243,255,0.5)]' : 'text-gray-500 hover:text-white'}`}
                    >
                      LOCAL
                    </button>
                  </div>

                  {crawlMode === 'web' && (
                    <label className="flex shrink-0 cursor-pointer items-center gap-3 border border-cyber-cyan/25 bg-black/75 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.24em] text-cyber-cyan transition-colors hover:border-cyber-cyan/45">
                      <span className="text-gray-400">Scrape Images</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={imageScrapingEnabled}
                        aria-label="Scrape images"
                        onClick={() => setImageScrapingEnabled((current) => !current)}
                        className={`relative h-5 w-10 rounded-full border transition-colors ${imageScrapingEnabled ? 'border-cyber-cyan bg-cyber-cyan/20' : 'border-cyber-gray bg-cyber-gray/40'}`}
                      >
                        <span
                          className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-all ${imageScrapingEnabled ? 'left-[22px] bg-cyber-cyan shadow-[0_0_10px_rgba(0,243,255,0.55)]' : 'left-[4px] bg-gray-400'}`}
                        />
                      </button>
                    </label>
                  )}

                  <div className="flex-1 flex gap-2 relative">
                    <input
                      ref={crawlInputRef}
                      type="text"
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && runSpider()}
                      placeholder={crawlMode === 'web' ? "ENTER CRAWL PARAMETERS..." : "ENTER ABSOLUTE OS PATHS (DELIMITED) OR CLICK BROWSE..."}
                      className="w-full bg-black border border-cyber-gray px-4 py-3 text-cyber-green focus:border-cyber-green outline-none transition-colors"
                    />

                    {crawlMode === 'local' && (
                      <button
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
                        className="absolute right-0 top-0 bottom-0 bg-cyber-gray/20 hover:bg-cyber-cyan/20 text-cyber-cyan px-4 font-bold border-l border-cyber-gray transition-colors flex items-center gap-2 text-xs"
                      >
                        <Folder size={14} /> BROWSE...
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => runSpider()}
                    className="bg-cyber-green text-black px-8 py-3 font-bold hover:bg-white transition-colors"
                  >
                    EXECUTE
                  </button>
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
