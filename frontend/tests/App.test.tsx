import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/App'

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

class WebSocketMock {
  static instances: WebSocketMock[] = []

  readyState = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null

  constructor(public url: string) {
    WebSocketMock.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn()
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
})
