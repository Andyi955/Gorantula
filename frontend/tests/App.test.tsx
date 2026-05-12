import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'
import {
  BROWSER_QA_SEEDED_EVENT,
  seedBrowserQaData,
} from '../src/utils/browserQaSeed'

vi.mock('../src/components/SpiderVisualizer', () => ({
  default: () => <div>SpiderVisualizer</div>,
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
  default: () => <div>SynthesisPanel</div>,
}))

vi.mock('../src/components/DiscoveryPanel', () => ({
  default: () => <div>DiscoveryPanel</div>,
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
    expect(screen.getByText('SpiderVisualizer')).toBeInTheDocument()
  })

  it('loads saved investigations and switches tabs', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-1', topic: 'Saved Investigation' }]),
    )

    render(<App />)

    expect(screen.getAllByText('Saved Investigation').length).toBeGreaterThan(0)

    await user.click(screen.getByText('Vault Chat'))

    expect(screen.getByText('VaultChatbot')).toBeInTheDocument()
  })

  it('lets operators toggle image scraping for web crawls', async () => {
    const user = userEvent.setup()

    render(<App />)

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
    expect(crawlMessage.scrapeImages).toBe(true)
  })

  it('renders current board and session token usage from websocket events', async () => {
    localStorage.setItem(
      'gorantula_investigations',
      JSON.stringify([{ id: 'inv-1', topic: 'Board One' }, { id: 'inv-2', topic: 'Board Two' }]),
    )

    render(<App />)

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
    expect(screen.getByText('VaultChatbot')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open spider input/i }))

    const crawlInput = screen.getByPlaceholderText(/enter crawl parameters/i)
    expect(crawlInput).toHaveFocus()
    expect(screen.getByText('SpiderVisualizer')).toBeInTheDocument()
  })

  it('refreshes investigations when browser QA data is seeded', () => {
    render(<App />)

    act(() => {
      const result = seedBrowserQaData()
      window.dispatchEvent(new CustomEvent(BROWSER_QA_SEEDED_EVENT, { detail: result }))
    })

    expect(screen.getAllByText('QA: Imported Target').length).toBeGreaterThan(0)
    expect(screen.getByText('DetectiveBoard')).toBeInTheDocument()
  })
})
