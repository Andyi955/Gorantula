import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import {
  BROWSER_QA_SEEDED_EVENT,
  seedBrowserQaData,
} from '../src/utils/browserQaSeed'
import { BOARD_PERSIST_FAILED_EVENT } from '../src/utils/hierarchicalCanvas'

vi.mock('../src/components/SpiderVisualizer', () => ({
  default: ({
    pipelineStatus = 'idle',
    pipelineLabel = 'Pipeline idle',
    pipelineProgressPercent = 0,
    onOpenPipelineMonitor,
  }: {
    pipelineStatus?: string
    pipelineLabel?: string
    pipelineProgressPercent?: number
    onOpenPipelineMonitor?: () => void
  }) => (
    <div>
      SpiderVisualizer
      <button type="button" data-testid="mock-spider-pipeline-rail" onClick={onOpenPipelineMonitor}>
        Pipeline rail {pipelineStatus} {pipelineLabel} {pipelineProgressPercent}%
      </button>
    </div>
  ),
}))

vi.mock('../src/components/DetectiveBoard', () => ({
  default: () => <div>DetectiveBoard</div>,
}))

vi.mock('../src/components/SettingsDashboard', () => ({
  default: () => <div>SettingsDashboard</div>,
}))

vi.mock('../src/components/TimelineView', () => ({
  default: () => <div>TimelineView</div>,
}))

vi.mock('../src/components/VaultChatbot', () => ({
  default: () => <div>VaultChatbot</div>,
}))

vi.mock('../src/components/SynthesisPanel', () => ({
  default: ({ showHandle = true }: { showHandle?: boolean }) => (
    <div>{showHandle ? 'SynthesisPanel Handle' : null}</div>
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

    await user.type(screen.getByPlaceholderText(/enter crawl parameters/i), 'AI frontier systems')
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

    await user.type(screen.getByPlaceholderText(/enter crawl parameters/i), 'signal pattern research')
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
    expect(chip).toHaveAttribute('title', expect.stringContaining('elapsed 4s'))
    expect(chip).toHaveAttribute('title', expect.stringContaining('ETA 13s'))
    expect(within(chip).getByRole('button', { name: /dismiss pipeline status chip/i })).toBeInTheDocument()

    const spiderPipelineRailButton = await screen.findByTestId('mock-spider-pipeline-rail')
    expect(spiderPipelineRailButton).toHaveTextContent('running Dispatching legs 25%')

    await user.click(spiderPipelineRailButton)
    const drawer = screen.getByTestId('pipeline-progress-drawer')
    expect(drawer).toHaveTextContent('Pipeline Monitor')
    expect(screen.getByTestId('pipeline-progress-bar')).toHaveStyle({ width: '25%' })
    expect(screen.getAllByTestId('pipeline-progress-step')).toHaveLength(3)

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

    await user.type(screen.getByPlaceholderText(/enter crawl parameters/i), 'compact status test')
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

  it('renders saved pipeline performance profiles in the monitor drawer', async () => {
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
    expect(within(drawer).getByText(/14\.2K tokens/i)).toBeInTheDocument()
    expect(within(drawer).getByText(/3m 06s total/i)).toBeInTheDocument()
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
    expect(await screen.findByText('DiscoveryPanel Handle')).toBeInTheDocument()
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

  it('renders current board and session token usage from websocket events', async () => {
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

    expect(screen.getByText('Current Board')).toBeInTheDocument()
    expect(screen.getByText('Session Total')).toBeInTheDocument()
    expect(screen.getByText('Full-board persona analysis')).toBeInTheDocument()
    expect(screen.getAllByText('5K total')).toHaveLength(2)
    expect(screen.getAllByText('4.2K in')).toHaveLength(2)
    expect(screen.getAllByText('800 out')).toHaveLength(2)
    expect(screen.getAllByText('7 calls')).toHaveLength(2)

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

    expect(screen.getByText('6.6K total')).toBeInTheDocument()
    expect(screen.getByText('5.2K in')).toBeInTheDocument()
    expect(screen.getByText('1.3K out')).toBeInTheDocument()
    expect(screen.getByText('10 calls')).toBeInTheDocument()
    expect(screen.getByText('1 est.')).toBeInTheDocument()
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

    expect(screen.getByText('Current Board')).toBeInTheDocument()
    expect(screen.queryByText('Session Total')).not.toBeInTheDocument()
    expect(screen.getByText('Broken totals')).toBeInTheDocument()
    expect(screen.getByText('0 total')).toBeInTheDocument()
    expect(screen.getByText('0 in')).toBeInTheDocument()
    expect(screen.getByText('0 out')).toBeInTheDocument()
    expect(screen.getByText('0 calls')).toBeInTheDocument()
  })

  it('uses the sidebar plus shortcut to jump to spider view and focus the crawl input', async () => {
    const user = userEvent.setup()

    render(<App />)

    await user.click(screen.getByText('Vault Chat'))
    expect(await screen.findByText('VaultChatbot')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open spider input/i }))

    const crawlInput = screen.getByPlaceholderText(/enter crawl parameters/i)
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
})
