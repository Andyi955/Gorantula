import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SpiderVisualizer from '../../src/components/SpiderVisualizer'

const { spiderSceneMock } = vi.hoisted(() => ({
  spiderSceneMock: vi.fn(({
    brainState,
    evidencePackets = [],
    pipelineStatus = 'idle',
    operationMode = 'web',
  }: {
    brainState: string
    evidencePackets?: Array<{ id: string; legId: number; mode?: string }>
    pipelineStatus?: string
    operationMode?: string
  }) => (
    <div>
      <span>SpiderScene</span>
      <span>{brainState}</span>
      <span data-testid="mock-scene-pipeline-status">{pipelineStatus}</span>
      <span data-testid="mock-scene-operation-mode">{operationMode}</span>
      <span data-testid="mock-scene-packet-count">{evidencePackets.length}</span>
      {evidencePackets.map((packet) => (
        <span key={packet.id} data-testid="mock-scene-packet">{packet.legId}:{packet.mode || 'web'}</span>
      ))}
    </div>
  )),
}))

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children?: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
}))

vi.mock('@react-three/postprocessing', () => ({
  Bloom: () => null,
  EffectComposer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

vi.mock('../../src/components/SpiderScene', () => ({
  SpiderScene: spiderSceneMock,
}))

describe('SpiderVisualizer', () => {
  class MockSocket {
    private listeners = new Map<string, Set<(event: MessageEvent) => void>>()
    sentMessages: string[] = []

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

    send = vi.fn((message: string) => {
      this.sentMessages.push(message)
    })
  }

  beforeEach(() => {
    spiderSceneMock.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the offline state without a websocket', () => {
    const { container } = render(<SpiderVisualizer sharedSocket={null} />)

    expect(container).toHaveTextContent('Brain: Offline')
    expect(screen.getByText('SpiderScene')).toBeInTheDocument()
  })

  it('renders the forensic lab shell with eight leg telemetry cards', () => {
    render(<SpiderVisualizer sharedSocket={null} />)

    expect(screen.getByTestId('spider-view-root')).toBeInTheDocument()
    expect(screen.getByTestId('spider-lab-stage')).toBeInTheDocument()
    expect(screen.getByTestId('spider-evidence-intake')).toHaveTextContent('Evidence Intake')
    expect(screen.getAllByTestId(/spider-leg-telemetry-/)).toHaveLength(8)
    expect(screen.getByTestId('spider-leg-telemetry-1')).toHaveTextContent('Leg 1')
    expect(screen.getByTestId('spider-leg-telemetry-8')).toHaveTextContent('Leg 8')
  })

  it('switches copy and leg roles to local document intake mode', () => {
    render(<SpiderVisualizer sharedSocket={null} operationMode="local" />)

    expect(screen.getByTestId('spider-evidence-intake')).toHaveTextContent('Document Intake')
    expect(screen.getByTestId('spider-lab-stage')).toHaveTextContent('Document Intake')
    expect(screen.getByTestId('spider-lab-stage')).toHaveTextContent('Case File Index')
    expect(screen.getByTestId('spider-leg-telemetry-1')).toHaveTextContent('Parser')
    expect(screen.getByTestId('spider-leg-telemetry-2')).toHaveTextContent('Chunker')
    expect(screen.getByTestId('mock-scene-operation-mode')).toHaveTextContent('local')
  })

  it('renders and advances a local file stack from pipeline progress', () => {
    const { rerender } = render(
      <SpiderVisualizer
        sharedSocket={null}
        operationMode="local"
        localIngestionFiles={[
          { path: 'C:\\Cases\\grid.pdf', name: 'grid.pdf', state: 'queued' },
          { path: 'C:\\Cases\\notes.docx', name: 'notes.docx', state: 'queued' },
        ]}
        localIngestionProgress={{ stepId: 'plan_queries', status: 'running', detail: 'Parsing local files into chunks' }}
      />,
    )

    expect(screen.getByTestId('local-ingestion-file-stack')).toHaveTextContent('grid.pdf')
    expect(screen.getByTestId('local-ingestion-file-stack')).toHaveTextContent('Parsing')

    rerender(
      <SpiderVisualizer
        sharedSocket={null}
        operationMode="local"
        localIngestionFiles={[
          { path: 'C:\\Cases\\grid.pdf', name: 'grid.pdf', state: 'queued' },
          { path: 'C:\\Cases\\notes.docx', name: 'notes.docx', state: 'queued' },
        ]}
        localIngestionProgress={{ stepId: 'dispatch_legs', status: 'running', detail: 'Dispatching document chunks to legs' }}
      />,
    )

    expect(screen.getByTestId('local-ingestion-file-stack')).toHaveTextContent('Chunking')
  })

  it('keeps long local file stacks scrollable and shows the overflow count', () => {
    const files = Array.from({ length: 10 }, (_, index) => ({
      path: `C:\\Cases\\doc-${index + 1}.md`,
      name: `doc-${index + 1}.md`,
      state: 'queued' as const,
    }))

    render(
      <SpiderVisualizer
        sharedSocket={null}
        operationMode="local"
        localIngestionFiles={files}
        localIngestionProgress={{ stepId: 'complete', status: 'complete', detail: 'Imported local evidence' }}
      />,
    )

    const stack = screen.getByTestId('local-ingestion-file-stack')
    const list = screen.getByTestId('local-ingestion-file-list')

    expect(list).toHaveClass('forensic-local-ingestion-file-list-scrollable')
    expect(stack).toHaveTextContent('doc-1.md')
    expect(stack).toHaveTextContent('doc-10.md')
    expect(stack).toHaveTextContent('+4 more')
    expect(stack).toHaveTextContent('10 files')
  })

  it('switches to connected when a websocket is provided', () => {
    const sharedSocket = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    const { container } = render(<SpiderVisualizer sharedSocket={sharedSocket} />)

    expect(container).toHaveTextContent('Brain: Connected')
  })

  it('renders the brain signal with moving scan and lightning layers', () => {
    const sharedSocket = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    render(<SpiderVisualizer sharedSocket={sharedSocket} />)

    const signal = screen.getByTestId('spider-brain-signal')
    expect(signal).toHaveClass('forensic-spider-brain-signal')
    expect(within(signal).getByTestId('spider-brain-signal-track')).toHaveClass('forensic-spider-brain-signal-track')
    expect(within(signal).getByTestId('spider-brain-signal-bolt')).toHaveClass('forensic-spider-brain-signal-bolt')
    expect(within(signal).getByTestId('spider-brain-signal-scan')).toHaveClass('forensic-spider-brain-signal-scan')
  })

  it('updates leg telemetry from websocket leg events', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 3, state: 'Scraping source map' })
    })

    expect(screen.getByTestId('spider-leg-telemetry-4')).toHaveTextContent('Scraping source map')
    expect(screen.getByTestId('spider-leg-telemetry-4')).toHaveClass('forensic-spider-leg-card-running')
  })

  it('shows failed styling for error-like leg states', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 2, state: 'Error: timeout while scraping' })
    })

    expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-error')
    expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-error-flash')
  })

  it('applies recovery styling when a failed leg starts running again', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 2, state: 'Error: timeout while scraping' })
      sharedSocket.emit('LEG_UPDATE', { legId: 2, state: 'Retrying source fetch' })
    })

    expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-running')
    expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-recovering')
  })

  it('uses static failed styling when reduced motion is preferred', () => {
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

    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 2, state: 'Error: timeout while scraping' })
    })

    expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-error')
    expect(screen.getByTestId('spider-leg-telemetry-3')).not.toHaveClass('forensic-spider-leg-card-error-flash')
  })

  it('creates a transient evidence packet from the most recently active leg when evidence arrives', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 3, state: 'Scraping source map' })
      sharedSocket.emit('MEMORY_NODE_GATHERED', {
        vaultId: 'investigation-1',
        node: { id: 'node-a', title: 'A' },
      })
    })

    expect(screen.getByTestId('mock-scene-packet-count')).toHaveTextContent('1')
    expect(screen.getByTestId('mock-scene-packet')).toHaveTextContent('3')
  })

  it('creates local document packets without changing MEMORY_NODE_GATHERED handling', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} operationMode="local" />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 2, state: 'Processing document chunk' })
      sharedSocket.emit('MEMORY_NODE_GATHERED', {
        vaultId: 'investigation-1',
        node: { id: 'node-local', title: '[IMPORTED] Local note' },
      })
    })

    expect(screen.getByTestId('mock-scene-packet-count')).toHaveTextContent('1')
    expect(screen.getByTestId('mock-scene-packet')).toHaveTextContent('2:local')
  })

  it('clears active legs and evidence packets when synthesis completes', () => {
    const sharedSocket = new MockSocket()
    render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 3, state: 'Scraping source map' })
      sharedSocket.emit('MEMORY_NODE_GATHERED', { node: { id: 'node-a' } })
      sharedSocket.emit('SYNTHESIS_COMPLETE', { vaultId: 'investigation-1' })
    })

    expect(screen.getByTestId('spider-leg-telemetry-4')).toHaveClass('forensic-spider-leg-card-idle')
    expect(screen.getByTestId('mock-scene-packet-count')).toHaveTextContent('0')
  })

  it('powers down on cancelled pipeline status and stops new packets', () => {
    const sharedSocket = new MockSocket()
    const { rerender } = render(
      <SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} pipelineStatus="running" />,
    )

    act(() => {
      sharedSocket.emit('LEG_UPDATE', { legId: 1, state: 'Searching sources' })
    })

    rerender(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} pipelineStatus="cancelled" />)

    act(() => {
      sharedSocket.emit('MEMORY_NODE_GATHERED', { node: { id: 'node-a' } })
    })

    expect(screen.getByTestId('spider-view-root')).toHaveClass('forensic-spider-root-cancelled')
    expect(screen.getByTestId('spider-leg-telemetry-2')).toHaveClass('forensic-spider-leg-card-cancelled')
    expect(screen.getByTestId('mock-scene-packet-count')).toHaveTextContent('0')
  })

  it('settles the local file stack when a local pipeline is cancelled', () => {
    const sharedSocket = new MockSocket()
    const { rerender } = render(
      <SpiderVisualizer
        sharedSocket={sharedSocket as unknown as WebSocket}
        operationMode="local"
        pipelineStatus="running"
        localIngestionFiles={[{ path: 'C:\\Cases\\grid.pdf', name: 'grid.pdf', state: 'queued' }]}
        localIngestionProgress={{ stepId: 'gather_evidence', status: 'running', detail: 'Summarizing local document chunks' }}
      />,
    )

    rerender(
      <SpiderVisualizer
        sharedSocket={sharedSocket as unknown as WebSocket}
        operationMode="local"
        pipelineStatus="cancelled"
        localIngestionFiles={[{ path: 'C:\\Cases\\grid.pdf', name: 'grid.pdf', state: 'queued' }]}
        localIngestionProgress={{ stepId: 'complete', status: 'cancelled', detail: 'Stopped by operator' }}
      />,
    )

    act(() => {
      sharedSocket.emit('MEMORY_NODE_GATHERED', { node: { id: 'node-local' } })
    })

    expect(screen.getByTestId('local-ingestion-file-stack')).toHaveTextContent('Stopped')
    expect(screen.getByTestId('mock-scene-packet-count')).toHaveTextContent('0')
  })

  it('uses a reduced-motion local ingestion stack state', () => {
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

    render(
      <SpiderVisualizer
        sharedSocket={null}
        operationMode="local"
        localIngestionFiles={[{ path: 'C:\\Cases\\grid.pdf', name: 'grid.pdf', state: 'queued' }]}
      />,
    )

    expect(screen.getByTestId('local-ingestion-file-stack')).toHaveClass('forensic-local-ingestion-reduced-motion')
  })

  it('runs the browser-only QA telemetry replay without sending websocket messages', async () => {
    vi.useFakeTimers()
    const sharedSocket = new MockSocket()

    try {
      const { rerender } = render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

      rerender(
        <SpiderVisualizer
          sharedSocket={sharedSocket as unknown as WebSocket}
          qaTelemetryDemoRequest={{ requestId: 'qa-spider-test' }}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(900)
      })

      expect(screen.getByTestId('spider-leg-telemetry-1')).toHaveClass('forensic-spider-leg-card-running')
      expect(Number(screen.getByTestId('mock-scene-packet-count').textContent)).toBeGreaterThan(0)
      expect(sharedSocket.sentMessages).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs the browser-only QA error empty replay through failed and recovered leg states', async () => {
    vi.useFakeTimers()
    const sharedSocket = new MockSocket()

    try {
      const { rerender } = render(<SpiderVisualizer sharedSocket={sharedSocket as unknown as WebSocket} />)

      rerender(
        <SpiderVisualizer
          sharedSocket={sharedSocket as unknown as WebSocket}
          qaErrorEmptyDemoRequest={{ requestId: 'qa-error-empty-test' }}
        />,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(420)
      })

      expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-error')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(520)
      })

      expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-running')
      expect(screen.getByTestId('spider-leg-telemetry-3')).toHaveClass('forensic-spider-leg-card-recovering')
      expect(sharedSocket.sentMessages).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders a pipeline monitor rail button with a live status dot', async () => {
    const user = userEvent.setup()
    const onOpenPipelineMonitor = vi.fn()

    render(
      <SpiderVisualizer
        sharedSocket={null}
        pipelineStatus="running"
        pipelineLabel="Dispatching legs"
        pipelineProgressPercent={25}
        onOpenPipelineMonitor={onOpenPipelineMonitor}
      />,
    )

    const railButton = screen.getByTestId('spider-pipeline-rail-button')
    expect(railButton).toHaveAccessibleName(/open pipeline monitor/i)
    expect(railButton).toHaveAttribute('title', 'Pipeline: Dispatching legs (25%)')
    expect(screen.getByTestId('spider-pipeline-status-dot')).toHaveClass('forensic-spider-pipeline-dot-running')

    await user.click(railButton)

    expect(onOpenPipelineMonitor).toHaveBeenCalledTimes(1)
  })
})
