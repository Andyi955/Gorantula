import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import {
  BROWSER_QA_DISCOVERY_DEMO_EVENT,
  BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT,
  BROWSER_QA_PIPELINE_DEMO_EVENT,
  BROWSER_QA_SEEDED_EVENT,
  BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT,
  BROWSER_QA_SYNTHESIS_DEMO_EVENT,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
  BROWSER_QA_TIMELINE_DEMO_EVENT,
  seedBrowserQaData,
} from '../src/utils/browserQaSeed'
import { BOARD_PERSIST_FAILED_EVENT } from '../src/utils/hierarchicalCanvas'

vi.mock('../src/components/SpiderVisualizer', () => ({
  default: ({
    pipelineStatus = 'idle',
    pipelineLabel = 'Pipeline idle',
    pipelineProgressPercent = 0,
    onOpenPipelineMonitor,
    operationMode = 'web',
    localIngestionFiles = [],
    localIngestionProgress,
    qaLocalIngestionDemoRequest,
    qaTelemetryDemoRequest,
    tokenReadout,
  }: {
    pipelineStatus?: string
    pipelineLabel?: string
    pipelineProgressPercent?: number
    onOpenPipelineMonitor?: () => void
    operationMode?: 'web' | 'local'
    localIngestionFiles?: Array<{ path: string; name: string; state: string }>
    localIngestionProgress?: { stepId?: string; status?: string; detail?: string } | null
    qaLocalIngestionDemoRequest?: { requestId: string } | null
    qaTelemetryDemoRequest?: { requestId: string } | null
    tokenReadout?: { value: string; title?: string }
  }) => (
    <div>
      SpiderVisualizer
      <div title={tokenReadout?.title}>
        <span>Tokens</span>
        <strong>{tokenReadout?.value}</strong>
      </div>
      <button type="button" data-testid="mock-spider-pipeline-rail" onClick={onOpenPipelineMonitor}>
        Pipeline rail {pipelineStatus} {pipelineLabel} {pipelineProgressPercent}%
      </button>
      <span data-testid="mock-spider-operation-mode">{operationMode}</span>
      <span data-testid="mock-local-ingestion-files">
        {localIngestionFiles.map((file) => `${file.name}:${file.state}`).join('|')}
      </span>
      <span data-testid="mock-local-ingestion-progress">
        {localIngestionProgress?.stepId || 'none'} {localIngestionProgress?.status || 'idle'} {localIngestionProgress?.detail || ''}
      </span>
      <span data-testid="mock-local-ingestion-demo-request">{qaLocalIngestionDemoRequest?.requestId || 'none'}</span>
      <span data-testid="mock-spider-telemetry-demo-request">{qaTelemetryDemoRequest?.requestId || 'none'}</span>
    </div>
  ),
}))

vi.mock('../src/components/DetectiveBoard', () => ({
  default: ({
    hasTheoryReady = false,
    hasUnreadTheory = false,
    hasDiscoveryReady = false,
    hasUnreadDiscoveries = false,
  }: {
    hasTheoryReady?: boolean
    hasUnreadTheory?: boolean
    hasDiscoveryReady?: boolean
    hasUnreadDiscoveries?: boolean
  }) => (
    <div>
      DetectiveBoard
      <span data-testid="mock-board-theory-state">
        theory-ready {String(hasTheoryReady)} theory-unread {String(hasUnreadTheory)}
      </span>
      <span data-testid="mock-board-discovery-state">
        discovery-ready {String(hasDiscoveryReady)} discovery-unread {String(hasUnreadDiscoveries)}
      </span>
    </div>
  ),
}))

vi.mock('../src/components/SettingsDashboard', () => ({
  default: () => <div>SettingsDashboard</div>,
}))

vi.mock('../src/components/TimelineView', () => ({
  default: ({ qaTimelineDemoSnapshot }: { qaTimelineDemoSnapshot?: { events?: Array<{ id: string; event: string }> } | null }) => (
    <div>
      TimelineView
      {qaTimelineDemoSnapshot?.events?.map((event) => <span key={event.id}>{event.event}</span>)}
    </div>
  ),
}))

vi.mock('../src/components/VaultChatbot', () => ({
  default: () => <div>VaultChatbot</div>,
}))

vi.mock('../src/components/SynthesisPanel', () => ({
  default: ({
    showHandle = true,
    currentTheoryReport,
  }: {
    showHandle?: boolean
    currentTheoryReport?: string | null
  }) => (
    <div>
      {showHandle ? 'SynthesisPanel Handle' : null}
      {currentTheoryReport?.includes('QA synthesis theory') ? <span>{currentTheoryReport}</span> : null}
    </div>
  ),
}))

vi.mock('../src/components/DiscoveryPanel', () => ({
  default: ({ showHandle = true, discoveries = [] }: { showHandle?: boolean, discoveries?: Array<{ title: string }> }) => (
    <div>
      {showHandle ? 'DiscoveryPanel Handle' : null}
      {discoveries.map((discovery) => <span key={discovery.title}>{discovery.title}</span>)}
    </div>
  ),
}))

class WebSocketMock {
  static instances: WebSocketMock[] = []

  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  readyState = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null
  addEventListener = vi.fn((type: string, handler: (event: MessageEvent) => void) => {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)?.add(handler)
  })
  removeEventListener = vi.fn((type: string, handler: (event: MessageEvent) => void) => {
    this.listeners.get(type)?.delete(handler)
  })

  constructor(public url: string) {
    WebSocketMock.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify({ type, payload }) } as MessageEvent
    this.listeners.get('message')?.forEach((handler) => handler(event))
  }
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    WebSocketMock.instances = []
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('WebSocket', WebSocketMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders the main navigation and defaults to the spider view', () => {
    render(<App />)

    expect(screen.getByText('Spider View')).toBeInTheDocument()
    expect(screen.getByText('Detective Board')).toBeInTheDocument()
  })

  it('does not mount backend-only inactive tabs on first load', async () => {
    render(<App />)

    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()
    expect(screen.queryByText('VaultChatbot')).not.toBeInTheDocument()
    expect(screen.queryByText('SettingsDashboard')).not.toBeInTheDocument()
  })

  it('hides floating synthesis and discovery handles on spider view', async () => {
    render(<App />)

    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()
    expect(screen.queryByText('SynthesisPanel Handle')).not.toBeInTheDocument()
    expect(screen.queryByText('DiscoveryPanel Handle')).not.toBeInTheDocument()
  })

  it('hides floating synthesis and discovery handles on settings view', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText('Settings'))

    expect(await screen.findByText('SettingsDashboard')).toBeInTheDocument()
    expect(screen.queryByText('SynthesisPanel Handle')).not.toBeInTheDocument()
    expect(screen.queryByText('DiscoveryPanel Handle')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /settings/i })).toHaveClass('forensic-app-tab-active')
  })

  it('loads saved investigations and switches tabs', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-1', topic: 'Saved Investigation' }]),
    )

    render(<App />)

    expect(screen.getAllByText('Saved Investigation').length).toBeGreaterThan(0)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await user.click(screen.getByText('Vault Chat'))

    expect(await screen.findByText('VaultChatbot')).toBeInTheDocument()
  })

  it('unmounts the spider visualizer when switching to detective board', async () => {
    const user = userEvent.setup()

    render(<App />)

    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await user.click(screen.getByText('Detective Board'))

    expect(await screen.findByText('DetectiveBoard')).toBeInTheDocument()
    expect(screen.queryByText('SpiderVisualizer')).not.toBeInTheDocument()
  })

  it('filters sidebar investigations locally without mutating stored data', async () => {
    const user = userEvent.setup()
    const storedInvestigations = [
      { id: 'inv-1', topic: 'Alpha Thread' },
      { id: 'merge-2', topic: 'Merged Signal' },
    ]
    localStorage.setItem('gorantula_investigations', JSON.stringify(storedInvestigations))

    render(<App />)

    const filterInput = screen.getByPlaceholderText(/search investigations/i)
    await user.type(filterInput, 'merged')

    const sidebar = filterInput.closest('aside') as HTMLElement
    expect(within(sidebar).getByText('Merged Signal')).toBeInTheDocument()
    expect(within(sidebar).queryByText('Alpha Thread')).not.toBeInTheDocument()
    expect(localStorage.getItem('gorantula_investigations')).toBe(JSON.stringify(storedInvestigations))
  })

  it('renders a mockup-style investigation summary and functional sidebar controls in detective board mode', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([
        { id: 'inv-1', topic: 'Nightfall Ledger' },
        { id: 'inv-2', topic: 'Signal Cache' },
      ]),
    )
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        nodes: [
          { id: 'node-1', data: { images: [{ url: 'https://example.com/1.png' }] } },
          { id: 'node-2', data: {} },
        ],
        edges: [{ id: 'edge-1', source: 'node-1', target: 'node-2' }],
      }),
    )
    localStorage.setItem(
      'inv_data_inv-2',
      JSON.stringify({
        nodes: [
          { id: 'node-a', data: {} },
          { id: 'node-b', data: {} },
          { id: 'node-c', data: {} },
          { id: 'node-d', data: {} },
        ],
        edges: [],
      }),
    )
    localStorage.setItem(
      'vault_result_inv-1',
      JSON.stringify({
        result: [
          '**INTELLIGENCE REPORT**',
          '**TO:** Internal Distribution',
          '**FROM:** Senior Intelligence Analyst',
          '**DATE:** Thursday, April 2, 2026',
          '**SUBJECT:** Comprehensive Status Report',
          '',
          '### Executive Summary',
          'A coordinated financial intelligence operation involving offshore transfers and shell entities.',
          '',
          'Follow-on evidence suggests multiple connections to AI infrastructure groups.',
        ].join('\n'),
      }),
    )

    render(<App />)
    await user.click(screen.getByText('Detective Board'))

    const summaryHeading = await screen.findByText('Investigation Summary')
    const summaryCard = summaryHeading.closest('.forensic-sidebar-summary-card') as HTMLElement
    expect(within(summaryCard).getByText(/A coordinated financial intelligence operation/i)).toBeInTheDocument()
    expect(within(summaryCard).queryByText(/\*\*/)).not.toBeInTheDocument()
    expect(within(summaryCard).queryByText(/Internal Distribution/i)).not.toBeInTheDocument()
    expect(within(summaryCard).queryByText(/Board index/i)).not.toBeInTheDocument()
    expect(within(summaryCard).getByText(/View Full Log/i)).toBeInTheDocument()

    const signalCacheRow = screen.getByText('Signal Cache').closest('.forensic-sidebar-item') as HTMLElement
    expect(within(signalCacheRow).getByText('4')).toBeInTheDocument()

    const filterInput = screen.getByPlaceholderText(/search investigations/i)
    await user.type(filterInput, 'signal')
    const clearFilterButton = screen.getByRole('button', { name: /clear investigation filter/i })
    await user.click(clearFilterButton)
    expect(filterInput).toHaveValue('')

    expect(screen.getByText('Graph Nodes')).toBeInTheDocument()
    expect(screen.getByText('Relationships')).toBeInTheDocument()
    expect(screen.getByText('Evidence Items')).toBeInTheDocument()
    expect(screen.getByText('Confidence Score')).toBeInTheDocument()
    expect(screen.queryByText('Current Board')).not.toBeInTheDocument()
  })

  it('switches persisted discoveries and vault reports with the selected investigation', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([
        { id: 'inv-alpha', topic: 'Alpha Case' },
        { id: 'inv-bravo', topic: 'Bravo Case' },
      ]),
    )
    localStorage.setItem(
      'gorantula_discoveries_by_investigation',
      JSON.stringify({
        'inv-alpha': [
          {
            id: 'disc-alpha',
            title: 'Alpha discovery only',
            claim: 'Alpha claim',
            impact: 'Alpha impact',
            confidence: 0.9,
            sourceNodeIDs: ['alpha-node'],
            sourceVaultID: 'inv-alpha',
            createdAt: '2026-05-15T10:00:00.000Z',
            nodeKind: 'discovery',
          },
        ],
        'inv-bravo': [
          {
            id: 'disc-bravo',
            title: 'Bravo discovery only',
            claim: 'Bravo claim',
            impact: 'Bravo impact',
            confidence: 0.8,
            sourceNodeIDs: ['bravo-node'],
            sourceVaultID: 'inv-bravo',
            createdAt: '2026-05-15T10:05:00.000Z',
            nodeKind: 'discovery',
          },
        ],
      }),
    )
    localStorage.setItem('vault_result_inv-alpha', JSON.stringify({ result: 'Alpha theory summary belongs to alpha only.' }))
    localStorage.setItem('vault_result_inv-bravo', JSON.stringify({ result: 'Bravo theory summary belongs to bravo only.' }))

    render(<App />)

    expect(await screen.findByText(/Alpha theory summary belongs to alpha only/i)).toBeInTheDocument()
    expect(screen.getByText('Alpha discovery only')).toBeInTheDocument()
    expect(screen.queryByText('Bravo discovery only')).not.toBeInTheDocument()

    await user.click(screen.getByText('Bravo Case'))

    await waitFor(() => {
      expect(screen.getByText(/Bravo theory summary belongs to bravo only/i)).toBeInTheDocument()
      expect(screen.getByText('Bravo discovery only')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Alpha theory summary belongs to alpha only/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha discovery only')).not.toBeInTheDocument()
  })

  it('stores synthesis completions in the owning investigation without leaking into the selected case', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([
        { id: 'inv-alpha', topic: 'Alpha Case' },
        { id: 'inv-bravo', topic: 'Bravo Case' },
      ]),
    )
    localStorage.setItem('vault_result_inv-alpha', JSON.stringify({ result: 'Alpha original theory remains selected.' }))

    render(<App />)
    expect(await screen.findByText(/Alpha original theory remains selected/i)).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('SYNTHESIS_COMPLETE', {
        vaultId: 'inv-bravo',
        result: 'Bravo completed theory arrived in the background.',
        append: false,
      })
    })

    expect(screen.queryByText(/Bravo completed theory arrived in the background/i)).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('vault_result_inv-bravo') || '{}')).toMatchObject({
      result: 'Bravo completed theory arrived in the background.',
    })

    await user.click(screen.getByText('Bravo Case'))

    await waitFor(() => {
      expect(screen.getByText(/Bravo completed theory arrived in the background/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Alpha original theory remains selected/i)).not.toBeInTheDocument()
  })

  it('switches to the detective board when the active crawl synthesis completes', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-active-crawl', topic: 'Active Crawl Case' }]),
    )

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('SYNTHESIS_COMPLETE', {
        vaultId: 'inv-active-crawl',
        result: 'Unified report is ready.',
        append: false,
        runId: 'run-active-crawl',
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('SpiderVisualizer')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /detective board/i })).toHaveClass('forensic-app-tab-active')
    })
  })

  it('notifies the active board when theory and discoveries finish', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-active', topic: 'Active Case' }]),
    )

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('SYNTHESIS_COMPLETE', {
        vaultId: 'inv-active',
        result: 'The grand unified theory is ready.',
        append: false,
      })
    })
    act(() => {
      WebSocketMock.instances[0]?.emit('DISCOVERIES_FOUND', [
        {
          id: 'discovery-active',
          title: 'Ready discovery',
          claim: 'The discovery review approved a new finding.',
          impact: 'The dashboard should show the discovery as ready.',
          confidence: 0.93,
          sourceNodeIDs: ['node-1'],
          sourceVaultID: 'inv-active',
          createdAt: '2026-05-18T04:30:00.000Z',
          nodeKind: 'discovery',
        },
      ])
    })

    await waitFor(() => {
      expect(screen.getByTestId('mock-board-theory-state')).toHaveTextContent('theory-ready true theory-unread true')
      expect(screen.getByTestId('mock-board-discovery-state')).toHaveTextContent('discovery-ready true discovery-unread true')
    })
  })

  it('marks discovery review complete without an unread dot when no discoveries are approved', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-empty-discovery', topic: 'Empty Discovery Case' }]),
    )

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: 'run-empty-discovery',
        vaultId: 'inv-empty-discovery',
        mode: 'web',
        stepId: 'discovery_review',
        stepLabel: 'Discovery review',
        status: 'complete',
        completedSteps: 11,
        totalSteps: 12,
        detail: 'Approved 0 discoveries',
        elapsedMs: 146000,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('mock-board-discovery-state')).toHaveTextContent('discovery-ready true discovery-unread false')
    })
  })

  it('does not present Discovery persona key findings as approved discoveries', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-persona', topic: 'Persona Discovery Case' }]),
    )
    localStorage.setItem(
      'inv_data_inv-persona',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-persona-1',
            data: {
              title: 'Discovery source node',
              personaInsights: [
                {
                  personaName: 'Discovery',
                  confidence: 0.72,
                  keyFindings: ['Persona-derived discovery should appear in the panel.'],
                  nodeIDs: ['node-persona-1'],
                },
              ],
            },
          },
        ],
        edges: [],
      }),
    )

    render(<App />)

    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()
    expect(screen.queryByText('Persona-derived discovery should appear in the panel.')).not.toBeInTheDocument()
  })

  it('collapses and expands the investigations sidebar with the arrow control', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-1', topic: 'Nightfall Ledger' }]),
    )

    render(<App />)

    const sidebar = screen.getByTestId('app-sidebar')
    expect(sidebar).toHaveStyle({ width: '288px' })
    expect(screen.getByPlaceholderText(/search investigations/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))

    expect(sidebar).toHaveStyle({ width: '64px' })
    expect(screen.queryByPlaceholderText(/search investigations/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expand sidebar/i }))

    expect(sidebar).toHaveStyle({ width: '288px' })
    expect(screen.getByPlaceholderText(/search investigations/i)).toBeInTheDocument()
  })

  it('resizes the investigations sidebar by dragging the resize handle', () => {
    render(<App />)

    const sidebar = screen.getByTestId('app-sidebar')
    const handle = screen.getByRole('separator', { name: /resize sidebar/i })

    fireEvent.mouseDown(handle, { clientX: 288 })
    fireEvent.mouseMove(document, { clientX: 380 })
    fireEvent.mouseUp(document)

    expect(sidebar).toHaveStyle({ width: '380px' })
  })

  it('lets operators toggle image scraping for web crawls', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()
    expect(screen.getByTestId('spider-crawl-console')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    const imageToggle = screen.getByRole('switch', { name: /scrape images/i })
    expect(imageToggle).toHaveAttribute('aria-checked', 'false')

    await user.click(imageToggle)
    expect(imageToggle).toHaveAttribute('aria-checked', 'true')

    await user.type(screen.getByPlaceholderText(/enter a topic or url to crawl the web/i), 'AI frontier systems')
    await user.click(screen.getByRole('button', { name: /execute/i }))

    expect(WebSocketMock.instances[0]?.send).toHaveBeenCalled()
    const crawlMessage = JSON.parse(WebSocketMock.instances[0]?.send.mock.calls.at(-1)?.[0] ?? '{}')
    expect(crawlMessage.type).toBe('CRAWL')
    expect(crawlMessage.runId).toMatch(/^run-/)
    expect(crawlMessage.scrapeImages).toBe(true)
  })

  it('shows global pipeline progress and keeps it visible across tabs', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    await user.type(screen.getByPlaceholderText(/enter a topic or url to crawl the web/i), 'signal pattern research')
    await user.click(screen.getByRole('button', { name: /execute/i }))

    const crawlMessage = JSON.parse(WebSocketMock.instances[0]?.send.mock.calls.at(-1)?.[0] ?? '{}')
    expect(crawlMessage.runId).toMatch(/^run-/)
    expect(crawlMessage.vaultId).toMatch(/^inv-/)

    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: crawlMessage.runId,
        vaultId: crawlMessage.vaultId,
        mode: 'web',
        stepId: 'dispatch_legs',
        stepLabel: 'Dispatching legs',
        status: 'running',
        completedSteps: 2,
        totalSteps: 8,
        elapsedMs: 4200,
        estimatedRemainingMs: 12600,
        steps: [
          { id: 'start', label: 'Starting crawl', status: 'complete', durationMs: 500 },
          { id: 'plan_queries', label: 'Planning search queries', status: 'complete', durationMs: 3700 },
          { id: 'dispatch_legs', label: 'Dispatching legs', status: 'running' },
        ],
      })
    })

    const chip = await screen.findByTestId('pipeline-progress-chip')
    expect(chip).toHaveTextContent('25%')
    expect(chip).toHaveTextContent('Dispatching legs')
    expect(chip).toHaveClass('forensic-pipeline-chip-scanning')
    expect(chip).toHaveAttribute('title', expect.stringContaining('elapsed 4s'))
    expect(chip).toHaveAttribute('title', expect.stringContaining('ETA 13s'))
    expect(within(chip).getByRole('button', { name: /dismiss pipeline status chip/i })).toBeInTheDocument()

    const spiderPipelineRailButton = await screen.findByTestId('mock-spider-pipeline-rail')
    expect(spiderPipelineRailButton).toHaveTextContent('running Dispatching legs 25%')

    await user.click(spiderPipelineRailButton)
    const drawer = screen.getByTestId('pipeline-progress-drawer')
    expect(drawer).toHaveClass('forensic-pipeline-drawer-running')
    expect(drawer).toHaveTextContent('Pipeline Monitor')
    expect(screen.getByTestId('pipeline-progress-bar')).toHaveClass('forensic-pipeline-progress-fill-scanning')
    expect(screen.getByTestId('pipeline-progress-bar')).toHaveStyle({ width: '25%' })
    const steps = screen.getAllByTestId('pipeline-progress-step')
    expect(steps).toHaveLength(3)
    expect(steps[2]).toHaveClass('forensic-pipeline-step-transition-running')

    await user.click(screen.getByText('Detective Board'))
    expect(await screen.findByText('DetectiveBoard')).toBeInTheDocument()
    expect(screen.getByTestId('pipeline-progress-chip')).toHaveTextContent('Dispatching legs')
  })

  it('dismisses the compact pipeline chip without clearing the active rail status', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    await user.type(screen.getByPlaceholderText(/enter a topic or url to crawl the web/i), 'compact status test')
    await user.click(screen.getByRole('button', { name: /execute/i }))

    const crawlMessage = JSON.parse(WebSocketMock.instances[0]?.send.mock.calls.at(-1)?.[0] ?? '{}')
    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: crawlMessage.runId,
        vaultId: crawlMessage.vaultId,
        mode: 'web',
        stepId: 'dispatch_legs',
        stepLabel: 'Dispatching legs',
        status: 'running',
        completedSteps: 2,
        totalSteps: 8,
        elapsedMs: 4200,
      })
    })

    const chip = await screen.findByTestId('pipeline-progress-chip')
    await user.click(within(chip).getByRole('button', { name: /dismiss pipeline status chip/i }))

    expect(screen.queryByTestId('pipeline-progress-chip')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-spider-pipeline-rail')).toHaveTextContent('running Dispatching legs 25%')
  })

  it('sends a stop command for the active pipeline run and renders cancelled status without clearing the investigation', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    await user.type(screen.getByPlaceholderText(/enter a topic or url to crawl the web/i), 'cancel me gently')
    await user.click(screen.getByRole('button', { name: /execute/i }))

    const crawlMessage = JSON.parse(WebSocketMock.instances[0]?.send.mock.calls.at(-1)?.[0] ?? '{}')
    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: crawlMessage.runId,
        vaultId: crawlMessage.vaultId,
        mode: 'web',
        stepId: 'gather_evidence',
        stepLabel: 'Gathering evidence',
        status: 'running',
        completedSteps: 3,
        totalSteps: 8,
        elapsedMs: 5400,
      })
    })

    const stopButton = await screen.findByRole('button', { name: /stop current investigation/i })
    await user.click(stopButton)

    const stopMessage = JSON.parse(WebSocketMock.instances[0]?.send.mock.calls.at(-1)?.[0] ?? '{}')
    expect(stopMessage).toEqual({
      type: 'STOP_PIPELINE',
      runId: crawlMessage.runId,
      vaultId: crawlMessage.vaultId,
    })
    expect(localStorage.getItem('gorantula_investigations')).toContain(crawlMessage.vaultId)

    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: crawlMessage.runId,
        vaultId: crawlMessage.vaultId,
        mode: 'web',
        stepId: 'complete',
        stepLabel: 'Pipeline stopped',
        status: 'cancelled',
        completedSteps: 3,
        totalSteps: 8,
        elapsedMs: 6100,
        detail: 'Stopped by operator',
      })
    })

    expect(screen.getByTestId('mock-spider-pipeline-rail')).toHaveTextContent('cancelled Pipeline stopped 38%')
    await user.click(screen.getByTestId('mock-spider-pipeline-rail'))
    expect(screen.getByTestId('pipeline-progress-drawer')).toHaveClass('forensic-pipeline-drawer-cancelled')
    expect(screen.getByTestId('pipeline-progress-bar')).not.toHaveClass('forensic-pipeline-progress-fill-scanning')
    expect(screen.queryByRole('button', { name: /stop current investigation/i })).not.toBeInTheDocument()
  })

  it('renders saved pipeline performance profiles in the monitor drawer with an animated token readout', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/pipeline-runs')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            {
              runId: 'run-flow-1',
              vaultId: 'inv-flow-1',
              mode: 'web',
              status: 'complete',
              totalElapsedMs: 186000,
              bottlenecks: [
                { kind: 'span', id: 'node_summary', label: 'Node summary', durationMs: 82000, percentOfTotal: 44 },
                { kind: 'token', id: 'persona_analysis', label: 'Persona analysis', totalTokens: 14200 },
              ],
              tokenUsage: [
                { operation: 'persona_analysis', provider: 'gemini', callCount: 7, totalTokens: 14200 },
              ],
            },
          ]),
        } as Response)
      }

      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: 'run-flow-1',
        vaultId: 'inv-flow-1',
        mode: 'web',
        stepId: 'complete',
        stepLabel: 'Pipeline complete',
        status: 'complete',
        completedSteps: 12,
        totalSteps: 12,
        elapsedMs: 186000,
      })
    })
    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROFILE_SAVED', {
        runId: 'run-flow-1',
      })
    })

    await user.click(await screen.findByTestId('mock-spider-pipeline-rail'))

    const drawer = screen.getByTestId('pipeline-progress-drawer')
    expect(await within(drawer).findByText('Performance')).toBeInTheDocument()
    expect(within(drawer).getByText('Node summary')).toBeInTheDocument()
    expect(within(drawer).getByText(/44% of run/i)).toBeInTheDocument()
    const tokenReadout = within(drawer).getByTestId('pipeline-token-hotspot-value')
    expect(tokenReadout).toHaveClass('forensic-pipeline-token-count-animating')
    await waitFor(() => expect(tokenReadout).toHaveTextContent(/14\.2K tokens/i))
    expect(within(drawer).getByText(/3m 06s total/i)).toBeInTheDocument()
  })

  it('shows final pipeline token values immediately when reduced motion is preferred', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        {
          runId: 'run-reduced-motion',
          vaultId: 'inv-reduced-motion',
          mode: 'web',
          status: 'complete',
          totalElapsedMs: 86000,
          bottlenecks: [
            { kind: 'token', id: 'persona_analysis', label: 'Persona analysis', totalTokens: 9800 },
          ],
          tokenUsage: [
            { operation: 'persona_analysis', provider: 'deepseek', callCount: 4, totalTokens: 9800 },
          ],
        },
      ]),
    } as Response)))

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROGRESS', {
        runId: 'run-reduced-motion',
        vaultId: 'inv-reduced-motion',
        mode: 'web',
        stepId: 'complete',
        stepLabel: 'Pipeline complete',
        status: 'complete',
        completedSteps: 12,
        totalSteps: 12,
        elapsedMs: 86000,
      })
    })
    act(() => {
      WebSocketMock.instances[0]?.emit('PIPELINE_PROFILE_SAVED', {
        runId: 'run-reduced-motion',
      })
    })

    await user.click(await screen.findByTestId('mock-spider-pipeline-rail'))

    const tokenReadout = await screen.findByTestId('pipeline-token-hotspot-value')
    expect(tokenReadout).toHaveTextContent(/9\.8K tokens/i)
    expect(tokenReadout).not.toHaveClass('forensic-pipeline-token-count-animating')
  })

  it('runs the browser-only QA pipeline monitor demo without backend messages or persistence', async () => {
    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    act(() => {
      const result = seedBrowserQaData()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }))
    })

    vi.useFakeTimers()

    try {
      act(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_PIPELINE_DEMO_EVENT, {
          detail: {
            investigationId: BROWSER_QA_TARGET_INVESTIGATION_ID,
            requestId: 'qa-pipeline-test',
          },
        }))
      })

      expect(screen.getByTestId('pipeline-progress-drawer')).toHaveTextContent('QA pipeline warmup')
      expect(screen.getByTestId('pipeline-progress-chip')).toHaveClass('forensic-pipeline-chip-scanning')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1700)
      })

      expect(screen.getByTestId('pipeline-progress-drawer')).toHaveTextContent('QA pipeline cancelled')
      expect(screen.getByTestId('pipeline-progress-drawer')).toHaveClass('forensic-pipeline-drawer-cancelled')
      expect(screen.getByTestId('pipeline-token-hotspot-value')).toHaveTextContent(/8\.4K tokens/i)
      expect(WebSocketMock.instances.every((socket) => socket.send.mock.calls.length === 0)).toBe(true)
      expect(localStorage.getItem('gorantula_pipeline_qa_demo')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces board autosave failures in the global status area', async () => {
    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent(BOARD_PERSIST_FAILED_EVENT, {
        detail: {
          investigationId: 'inv-quota',
          errorName: 'QuotaExceededError',
        },
      }))
    })

    expect(screen.getByText(/Autosave warning/i)).toBeInTheDocument()
    expect(screen.getByText(/storage quota/i)).toBeInTheDocument()
  })

  it('distinguishes backend persistence failures from browser storage quota failures', async () => {
    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent(BOARD_PERSIST_FAILED_EVENT, {
        detail: {
          investigationId: 'inv-backend',
          errorName: 'BackendPersistenceError',
        },
      }))
    })

    expect(screen.getByText(/Autosave warning/i)).toBeInTheDocument()
    expect(screen.getByText(/backend persistence unavailable/i)).toBeInTheDocument()
    expect(screen.queryByText(/storage quota/i)).not.toBeInTheDocument()
  })

  it('keeps incoming discoveries visible when discovery persistence hits quota', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-quota', topic: 'Quota Case' }]),
    )
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage)
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      if (key === 'gorantula_discoveries_by_investigation') {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      return originalSetItem(key, value)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('DISCOVERIES_FOUND', [
        {
          id: 'discovery-1',
          title: 'Signal compression finding',
          claim: 'The evidence shows a repeated compression pattern.',
          impact: 'This narrows the investigation path.',
          confidence: 0.91,
          sourceNodeIDs: ['node-1', 'node-2'],
          sourceVaultID: 'inv-quota',
          createdAt: new Date().toISOString(),
          nodeKind: 'discovery',
        },
      ])
    })

    expect(screen.getByText(/Autosave warning/i)).toBeInTheDocument()
    expect(setItemSpy).toHaveBeenCalledWith('gorantula_discoveries_by_investigation', expect.any(String))

    await userEvent.click(screen.getByText('Vault Chat'))
    expect(screen.queryByText('DiscoveryPanel Handle')).not.toBeInTheDocument()
    expect(await screen.findByText('Signal compression finding')).toBeInTheDocument()
  })

  it('keeps local crawl browsing inside the redesigned crawl console', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    const crawlConsole = screen.getByTestId('spider-crawl-console')
    await user.click(within(crawlConsole).getByRole('button', { name: /local/i }))

    expect(screen.getByPlaceholderText(/enter absolute os paths/i)).toBeInTheDocument()
    expect(within(crawlConsole).getByRole('button', { name: /browse/i })).toBeInTheDocument()

    await user.click(within(crawlConsole).getByRole('button', { name: /web/i }))

    expect(within(crawlConsole).queryByRole('button', { name: /browse/i })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /scrape images/i })).toBeInTheDocument()
  })

  it('passes local operation mode and manual document file stack into the spider visualizer', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    const crawlConsole = screen.getByTestId('spider-crawl-console')
    await user.click(within(crawlConsole).getByRole('button', { name: /local/i }))
    await user.type(screen.getByPlaceholderText(/enter absolute os paths/i), 'C:\\Cases\\alpha.pdf|C:\\Cases\\beta.docx')

    expect(screen.getByTestId('mock-spider-operation-mode')).toHaveTextContent('local')
    expect(screen.getByTestId('mock-local-ingestion-files')).toHaveTextContent('alpha.pdf:queued')
    expect(screen.getByTestId('mock-local-ingestion-files')).toHaveTextContent('beta.docx:queued')
  })

  it('populates the local document stack from Browse without sending backend messages', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/pick-files')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['C:\\Docs\\grid.pdf', 'C:\\Docs\\notes.md']),
        } as Response)
      }
      return Promise.reject(new Error(`Unexpected fetch: ${String(input)}`))
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    const crawlConsole = screen.getByTestId('spider-crawl-console')
    await user.click(within(crawlConsole).getByRole('button', { name: /local/i }))
    await user.click(within(crawlConsole).getByRole('button', { name: /browse/i }))

    await waitFor(() => expect(screen.getByTestId('mock-local-ingestion-files')).toHaveTextContent('grid.pdf:queued'))
    expect(screen.getByTestId('mock-local-ingestion-files')).toHaveTextContent('notes.md:queued')
    expect(WebSocketMock.instances[0]?.send).not.toHaveBeenCalled()
  })

  it('keeps local runs on the existing CRAWL_LOCAL websocket contract', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    const crawlConsole = screen.getByTestId('spider-crawl-console')
    await user.click(within(crawlConsole).getByRole('button', { name: /local/i }))
    await user.type(screen.getByPlaceholderText(/enter absolute os paths/i), 'C:\\Cases\\alpha.pdf|C:\\Cases\\beta.docx')
    await user.click(within(crawlConsole).getByRole('button', { name: /execute/i }))

    const crawlMessage = JSON.parse(WebSocketMock.instances[0]?.send.mock.calls.at(-1)?.[0] ?? '{}')
    expect(crawlMessage).toEqual(expect.objectContaining({
      type: 'CRAWL_LOCAL',
      payload: 'C:\\Cases\\alpha.pdf|C:\\Cases\\beta.docx',
      vaultId: expect.any(String),
      runId: expect.any(String),
    }))
  })

  it('routes browser-only local ingestion QA replay into the spider view without backend messages', async () => {
    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_LOCAL_INGESTION_DEMO_EVENT, {
        detail: {
          investigationId: 'qa-local-ingestion',
          requestId: 'qa-local-ingestion-test',
        },
      }))
    })

    expect(screen.getByTestId('mock-spider-operation-mode')).toHaveTextContent('local')
    expect(screen.getByTestId('mock-local-ingestion-demo-request')).toHaveTextContent('qa-local-ingestion-test')
    expect(screen.getByTestId('mock-local-ingestion-files')).toHaveTextContent('grid-brief.pdf')
    expect(WebSocketMock.instances[0]?.send).not.toHaveBeenCalled()
    expect(localStorage.getItem('gorantula_local_ingestion_qa_demo')).toBeNull()
  })

  it('renders compact token usage from websocket events', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-1', topic: 'Board One' }, { id: 'inv-2', topic: 'Board Two' }]),
    )

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('TOKEN_USAGE', {
        investigationId: 'inv-1',
        label: 'Full-board persona analysis',
        callCount: 7,
        reportedCallCount: 7,
        estimatedCallCount: 0,
        promptTokens: 4200,
        completionTokens: 800,
        totalTokens: 5000,
        providerTotals: {
          gemini: 5000,
        },
      })
    })

    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('5K / 7 calls')).toBeInTheDocument()
    expect(screen.getByTitle(/Full-board persona analysis/)).toHaveTextContent('5K / 7 calls')

    act(() => {
      WebSocketMock.instances[0]?.emit('TOKEN_USAGE', {
        investigationId: 'inv-2',
        label: 'Incremental persona analysis',
        callCount: 3,
        reportedCallCount: 2,
        estimatedCallCount: 1,
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1600,
        providerTotals: {
          gemini: 1200,
          openai: 400,
        },
      })
    })

    expect(screen.getByText('5K / 7 calls')).toBeInTheDocument()
    expect(screen.getByTitle(/Session: 6.6K total/)).toBeInTheDocument()
  })

  it('renders compact dismissible system notices in the app header', async () => {
    const user = userEvent.setup()

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('SYSTEM_LOG', 'Full-board persona analysis token usage: 43292 total (15847 prompt, 27445 completion) across 7 calls; 7 reported; providers: deepseek=43292.')
    })

    expect(screen.getByText('Persona analysis: 43.3K tokens / 7 calls')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('43292 total'))

    await user.click(screen.getByRole('button', { name: /dismiss system notice/i }))

    expect(screen.queryByText('Persona analysis: 43.3K tokens / 7 calls')).not.toBeInTheDocument()

    act(() => {
      WebSocketMock.instances[0]?.emit('SYSTEM_LOG', "Image review failed for provider 'deepseek'. Falling back to basic image scraping for this node.")
    })

    expect(screen.getByText('Image review fallback: DeepSeek using basic scraping')).toBeInTheDocument()

    act(() => {
      WebSocketMock.instances[0]?.emit('SYSTEM_LOG', 'Partial persona analysis completed: 5/7 personas succeeded; missing Entity Hunter, Timeline Analyst.')
    })

    expect(screen.getByText('Persona partial: 5/7 succeeded, missing Entity Hunter, Timeline Analyst')).toBeInTheDocument()
  })

  it('ignores malformed token usage payloads', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-1', topic: 'Board One' }]),
    )

    render(<App />)
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()

    await act(async () => {
      WebSocketMock.instances[0]?.onopen?.()
    })

    act(() => {
      WebSocketMock.instances[0]?.emit('TOKEN_USAGE', [])
      WebSocketMock.instances[0]?.emit('TOKEN_USAGE', {
        investigationId: 'inv-1',
        label: 'Broken totals',
        callCount: 'oops',
        reportedCallCount: undefined,
        estimatedCallCount: null,
        promptTokens: 'bad',
        completionTokens: {},
        totalTokens: [],
        providerTotals: {
          gemini: 'bad',
        },
      })
    })

    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('0 / 0 calls')).toBeInTheDocument()
    expect(screen.getByTitle(/Broken totals/)).toBeInTheDocument()
  })

  it('uses the sidebar plus shortcut to jump to spider view and focus the crawl input', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByText('Vault Chat'))
    expect(await screen.findByText('VaultChatbot')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open spider input/i }))

    const crawlInput = screen.getByPlaceholderText(/enter a topic or url to crawl the web/i)
    expect(crawlInput).toHaveFocus()
    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()
  })

  it('refreshes investigations when browser QA data is seeded', () => {
    render(<App />)

    act(() => {
      const result = seedBrowserQaData()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }))
    })

    expect(screen.getAllByText('QA: Imported Target').length).toBeGreaterThan(0)
  })

  it('injects temporary QA discovery demo records without backend messages or persistence', async () => {
    render(<App />)

    act(() => {
      const result = seedBrowserQaData()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(BROWSER_QA_DISCOVERY_DEMO_EVENT, {
        detail: {
          investigationId: BROWSER_QA_TARGET_INVESTIGATION_ID,
          requestId: 'qa-discovery-test',
        },
      }))
    })

    expect(await screen.findByText('QA Discovery: Grid Near-Miss Pattern')).toBeInTheDocument()
    expect(screen.getByTestId('mock-board-discovery-state')).toHaveTextContent('discovery-ready true discovery-unread true')
    expect(WebSocketMock.instances.every((socket) => socket.send.mock.calls.length === 0)).toBe(true)
    expect(localStorage.getItem('gorantula_discoveries_by_investigation')).toBeNull()
  })

  it('injects temporary QA synthesis demo theory without backend messages or persistence', async () => {
    render(<App />)

    act(() => {
      const result = seedBrowserQaData()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SYNTHESIS_DEMO_EVENT, {
        detail: {
          investigationId: BROWSER_QA_TARGET_INVESTIGATION_ID,
          requestId: 'qa-synthesis-test',
        },
      }))
    })

    expect((await screen.findAllByText(/QA synthesis theory: shared infrastructure stress pattern/i)).length).toBeGreaterThan(0)
    expect(screen.getByTestId('mock-board-theory-state')).toHaveTextContent('theory-ready true theory-unread true')
    expect(WebSocketMock.instances.every((socket) => socket.send.mock.calls.length === 0)).toBe(true)
    expect(localStorage.getItem(`vault_result_${BROWSER_QA_TARGET_INVESTIGATION_ID}`)).toBeNull()
  })

  it('routes the browser-only QA spider telemetry demo to the spider view without backend messages', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByText('Detective Board'))
    expect(await screen.findByText('DetectiveBoard')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, {
        detail: {
          investigationId: BROWSER_QA_TARGET_INVESTIGATION_ID,
          requestId: 'qa-spider-test',
        },
      }))
    })

    expect(await screen.findByText('SpiderVisualizer')).toBeInTheDocument()
    expect(screen.getByTestId('mock-spider-telemetry-demo-request')).toHaveTextContent('qa-spider-test')
    expect(WebSocketMock.instances.every((socket) => socket.send.mock.calls.length === 0)).toBe(true)
  })

  it('routes the browser-only QA timeline demo to Timeline View without backend messages or persistence', async () => {
    render(<App />)

    act(() => {
      const result = seedBrowserQaData()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }))
    })

    act(() => {
      window.dispatchEvent(new CustomEvent(BROWSER_QA_TIMELINE_DEMO_EVENT, {
        detail: {
          investigationId: BROWSER_QA_TARGET_INVESTIGATION_ID,
          requestId: 'qa-timeline-test',
        },
      }))
    })

    expect(await screen.findByText('TimelineView')).toBeInTheDocument()
    expect(screen.getByText('QA grid alert opened.')).toBeInTheDocument()
    expect(WebSocketMock.instances.every((socket) => socket.send.mock.calls.length === 0)).toBe(true)
    expect(localStorage.getItem(`inv_data_${BROWSER_QA_TARGET_INVESTIGATION_ID}`)).not.toContain('QA grid alert opened.')
  })
})
