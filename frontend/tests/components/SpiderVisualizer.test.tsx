import { render, screen } from '@testing-library/react'
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
})
