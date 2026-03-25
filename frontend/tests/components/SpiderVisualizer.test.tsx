import { act, render, screen } from '@testing-library/react'
import SpiderVisualizer from '../../src/components/SpiderVisualizer'

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
}))

vi.mock('@react-three/postprocessing', () => ({
  Bloom: () => null,
  EffectComposer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../src/components/SpiderScene', () => ({
  SpiderScene: () => <div>SpiderScene</div>,
}))

describe('SpiderVisualizer', () => {
  class MockSocket {
    private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

    addEventListener = vi.fn((type: string, handler: (event: MessageEvent) => void) => {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set())
      }
      this.listeners.get(type)?.add(handler)
    })

    removeEventListener = vi.fn((type: string, handler: (event: MessageEvent) => void) => {
      this.listeners.get(type)?.delete(handler)
    })

    emit(type: string, payload: unknown) {
      const event = { data: JSON.stringify({ type, payload }) } as MessageEvent
      this.listeners.get('message')?.forEach((handler) => handler(event))
    }
  }

  it('shows the offline state without a websocket', () => {
    const { container } = render(<SpiderVisualizer sharedSocket={null} />)

    expect(container).toHaveTextContent('Brain: Offline')
    expect(screen.getByText('SpiderScene')).toBeInTheDocument()
  })

  it('switches to connected when a websocket is provided', () => {
    const sharedSocket = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    const { container } = render(<SpiderVisualizer sharedSocket={sharedSocket} />)

    expect(container).toHaveTextContent('Brain: Connected')
  })

  it('renders system log warnings from the crawl pipeline', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('SYSTEM_LOG', "Image scraping is enabled, but provider 'minimax' does not support multimodal image review.")
    })

    expect(screen.getByText(/does not support multimodal image review/i)).toBeInTheDocument()
  })
})
