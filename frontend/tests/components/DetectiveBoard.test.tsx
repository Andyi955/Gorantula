import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetectiveBoard from '../../src/components/DetectiveBoard'
import { IMAGE_SCRAPING_PREFERENCE_KEY } from '../../src/utils/searchPreferences'

const fitViewMock = vi.fn()
const setCenterMock = vi.fn()
const getZoomMock = vi.fn(() => 0.82)

vi.mock('reactflow', () => {
  return {
    __esModule: true,
    default: ({
      children,
      nodes = [],
      nodeTypes = {},
    }: {
      children?: React.ReactNode
      nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>
      nodeTypes?: Record<string, React.ComponentType<any>>
    }) =>
      React.createElement(
        'div',
        { 'data-testid': 'reactflow' },
        React.createElement('div', { className: 'react-flow__pane', 'data-testid': 'reactflow-pane' }),
        nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type || 'default']
          if (!NodeComponent) {
            return null
          }

          return React.createElement(NodeComponent, {
            key: node.id,
            id: node.id,
            type: node.type || 'custom',
            selected: false,
            dragging: false,
            zIndex: 1,
            isConnectable: true,
            positionAbsoluteX: 0,
            positionAbsoluteY: 0,
            data: node.data,
          })
        }),
        children,
      ),
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Background: () => null,
    Controls: () => null,
    MiniMap: ({ onClick, ...props }: React.HTMLAttributes<HTMLDivElement> & { onClick?: (event: React.MouseEvent, position: { x: number; y: number }) => void }) =>
      React.createElement('div', {
        ...props,
        onClick: (event: React.MouseEvent) => onClick?.(event, { x: 420, y: 310 }),
      }),
    Handle: () => null,
    applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    reconnectEdge: (_oldEdge: unknown, _newConnection: unknown, edges: unknown[]) => edges,
    useReactFlow: () => ({
      fitView: fitViewMock,
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
      setCenter: setCenterMock,
      getZoom: getZoomMock,
    }),
    BackgroundVariant: { Lines: 'lines' },
    ConnectionMode: { Loose: 'Loose', Strict: 'Strict' },
    Position: { Left: 'Left', Right: 'Right', Top: 'Top', Bottom: 'Bottom' },
  }
})

vi.mock('../../src/components/CustomNode', () => ({
  __esModule: true,
  default: ({ data, id }: { id?: string; data?: { title?: string; images?: Array<{ path: string }>; onViewImages?: (images: Array<{ path: string }>, index: number, nodeTitle?: string, nodeId?: string) => void } }) =>
    React.createElement(
      'div',
      null,
      data?.title ? React.createElement('span', null, data.title) : null,
      data?.images?.length
        ? React.createElement(
            'button',
            {
              type: 'button',
              'data-testid': `node-image-trigger-${data.title || 'node'}`,
              onClick: () => data.onViewImages?.(data.images || [], 0, data.title, id),
            },
            'view images',
          )
        : null,
    ),
}))

vi.mock('../../src/components/CustomEdge', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('../../src/utils/ExportUtils', () => ({
  exportAsPdf: vi.fn(),
  exportAsPng: vi.fn(),
  exportAsSvg: vi.fn(),
}))

const RELATIONSHIP_LEGEND_VISIBILITY_KEY = 'detective_board_relationship_legend_visible'

class MockSocket {
  public readyState = WebSocket.OPEN
  public sentMessages: string[] = []
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  addEventListener(type: string, handler: (event: MessageEvent) => void) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)?.add(handler)
  }

  removeEventListener(type: string, handler: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(handler)
  }

  send(payload: string) {
    this.sentMessages.push(payload)
  }

  emit(type: string, payload: unknown) {
    const handlers = this.listeners.get('message')
    const event = { data: JSON.stringify({ type, payload }) } as MessageEvent
    handlers?.forEach((handler) => handler(event))
  }
}

const renderBoard = (investigationId = 'investigation-1', sharedSocket: WebSocket | null = null) =>
  render(
    <DetectiveBoard
      investigationId={investigationId}
      sharedSocket={sharedSocket}
      onDeepDiveNode={vi.fn()}
      onNavigateToChild={vi.fn()}
    />,
  )

describe('DetectiveBoard relationship legend', () => {
  beforeEach(() => {
    localStorage.clear()
    fitViewMock.mockReset()
    setCenterMock.mockReset()
    getZoomMock.mockReset()
    getZoomMock.mockReturnValue(0.82)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the legend by default when no preference exists', () => {
    renderBoard()

    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    expect(localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY)).toBe('true')
  })

  it('restores the minimized legend when the saved preference is hidden', () => {
    localStorage.setItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY, 'false')

    renderBoard()

    expect(screen.queryByText('RELATIONSHIPS')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /relationships/i })).toBeInTheDocument()
  })

  it('collapses the legend to a reopen chip and persists the preference', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /hide/i }))

    expect(screen.queryByText('RELATIONSHIPS')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /relationships/i })).toBeInTheDocument()
    expect(localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY)).toBe('false')

    await user.click(screen.getByRole('button', { name: /relationships/i }))

    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    expect(localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY)).toBe('true')
  })

  it('clears an open tag editor when the legend is hidden', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'board_tag_styles',
      JSON.stringify({
        RELATED: { color: '#bc13fe', pattern: 'solid', shape: 'none' },
      }),
    )
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [],
        edges: [{ id: 'edge-1', source: 'a', target: 'b', label: 'RELATED', data: {} }],
      }),
    )

    renderBoard()

    const tag = await screen.findByText('RELATED')
    await user.click(tag)

    expect(screen.getByText('EDIT: RELATED')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /hide/i }))

    expect(screen.queryByText('EDIT: RELATED')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /relationships/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /relationships/i }))

    await waitFor(() => {
      expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    })
    expect(screen.queryByText('EDIT: RELATED')).not.toBeInTheDocument()
  })

  it('persists expanded line pattern selections from the legend editor', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'board_tag_styles',
      JSON.stringify({
        RELATED: { color: '#bc13fe', pattern: 'solid' },
      }),
    )
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [],
        edges: [{ id: 'edge-1', source: 'a', target: 'b', label: 'RELATED', data: {} }],
      }),
    )

    renderBoard()

    await user.click(await screen.findByText('RELATED'))
    await user.click(screen.getByRole('button', { name: 'dash-dot' }))

    expect(JSON.parse(localStorage.getItem('board_tag_styles') || '{}')).toEqual({
      RELATED: { color: '#bc13fe', pattern: 'dash-dot', shape: 'none' },
    })
  })

  it('persists line shape selections from the legend editor', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'board_tag_styles',
      JSON.stringify({
        RELATED: { color: '#bc13fe', pattern: 'solid', shape: 'none' },
      }),
    )
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [],
        edges: [{ id: 'edge-1', source: 'a', target: 'b', label: 'RELATED', data: {} }],
      }),
    )

    renderBoard()

    await user.click(await screen.findByText('RELATED'))
    await user.click(screen.getByRole('button', { name: 'staggered' }))

    expect(JSON.parse(localStorage.getItem('board_tag_styles') || '{}')).toEqual({
      RELATED: { color: '#bc13fe', pattern: 'solid', shape: 'staggered' },
    })
  })

  it('shows and clears a ctrl-drag marquee on empty pane space', async () => {
    renderBoard()

    const flow = screen.getByTestId('reactflow').parentElement as HTMLDivElement
    const pane = screen.getByTestId('reactflow-pane')
    vi.spyOn(flow, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(pane, { ctrlKey: true, clientX: 100, clientY: 100, pointerId: 1 })
    expect(screen.getByTestId('marquee-selection')).toBeInTheDocument()

    fireEvent.pointerMove(flow, { ctrlKey: true, clientX: 180, clientY: 170, pointerId: 1 })
    expect(screen.getByTestId('marquee-selection')).toHaveStyle({ width: '80px', height: '70px' })

    fireEvent.pointerUp(flow, { ctrlKey: true, clientX: 180, clientY: 170, pointerId: 1 })
    await waitFor(() => {
      expect(screen.queryByTestId('marquee-selection')).not.toBeInTheDocument()
    })
  })

  it('renders the minimap navigation panel alongside existing board chrome', () => {
    renderBoard()

    expect(screen.getByText('Navigator')).toBeInTheDocument()
    expect(screen.getByTestId('reactflow-minimap')).toBeInTheDocument()
    expect(screen.getByTestId('minimap-panel')).toBeInTheDocument()
    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /board controls/i })).toBeInTheDocument()
  })

  it('toggles the minimap size from the expand control', async () => {
    const user = userEvent.setup()
    renderBoard()

    const minimap = screen.getByTestId('reactflow-minimap')
    expect(minimap).toHaveStyle({ width: '168px', height: '168px' })

    await user.click(screen.getByRole('button', { name: /enlarge minimap/i }))
    expect(minimap).toHaveStyle({ width: '256px', height: '232px' })

    await user.click(screen.getByRole('button', { name: /shrink minimap/i }))
    expect(minimap).toHaveStyle({ width: '168px', height: '168px' })
  })

  it('recenters the board when the minimap is clicked without changing board zoom', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByTestId('reactflow-minimap'))

    expect(setCenterMock).toHaveBeenCalledWith(420, 310, {
      zoom: 0.82,
      duration: 180,
    })
  })

  it('renders board controls in an overlay outside the action bar', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /board controls/i }))

    const overlay = screen.getByTestId('board-controls-overlay')
    const actionBar = screen.getByTestId('board-action-bar')

    expect(overlay).toBeInTheDocument()
    expect(actionBar.contains(overlay)).toBe(false)
    expect(screen.getByRole('button', { name: /add evidence/i })).toBeInTheDocument()
  })

  it('closes board controls when clicking outside the overlay', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /board controls/i }))
    expect(screen.getByTestId('board-controls-overlay')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    await waitFor(() => {
      expect(screen.queryByTestId('board-controls-overlay')).not.toBeInTheDocument()
    })
  })

  it('closes board controls when export is opened', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard()

    await user.click(screen.getByRole('button', { name: /board controls/i }))
    expect(screen.getByTestId('board-controls-overlay')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /export/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('board-controls-overlay')).not.toBeInTheDocument()
    })
  })

  it('sends an append crawl request for the active investigation from the board action bar', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.type(screen.getByPlaceholderText(/search more in this investigation/i), 'follow up lead')
    await user.click(screen.getByRole('button', { name: /search more/i }))

    expect(socket.sentMessages).toHaveLength(1)
    expect(JSON.parse(socket.sentMessages[0])).toEqual({
      type: 'APPEND_CRAWL',
      payload: 'follow up lead',
      vaultId: 'investigation-1',
      scrapeImages: false,
    })
  })

  it('inherits the spider image scraping preference for appended searches', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()
    localStorage.setItem(IMAGE_SCRAPING_PREFERENCE_KEY, 'true')

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.type(screen.getByPlaceholderText(/search more in this investigation/i), 'visual lead')
    await user.click(screen.getByRole('button', { name: /search more/i }))

    expect(JSON.parse(socket.sentMessages[0])).toEqual({
      type: 'APPEND_CRAWL',
      payload: 'visual lead',
      vaultId: 'investigation-1',
      scrapeImages: true,
    })
  })

  it('switches the connect action into integrate mode after appended evidence arrives', async () => {
    const socket = new MockSocket()
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    socket.emit('MEMORY_NODE_GATHERED', {
      append: true,
      vaultId: 'investigation-1',
      node: {
        id: 'node-c',
        title: 'C',
        summary: 'C',
        fullText: 'C',
        sourceURL: 'https://example.com',
      },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /integrate new evidence/i })).toBeInTheDocument()
    })
  })

  it('restores pending integration state from persisted board data', async () => {
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /integrate new evidence/i })).toBeInTheDocument()
    })
  })

  it('sends an incremental connect request when pending evidence exists', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.click(screen.getByRole('button', { name: /integrate new evidence/i }))

    expect(JSON.parse(socket.sentMessages[0])).toEqual({
      type: 'CONNECT_DOTS_INCREMENTAL',
      payload: {
        allNodes: [
          { id: 'node-a', title: 'A', summary: 'A', fullText: 'A' },
          { id: 'node-b', title: 'B', summary: 'B', fullText: 'B' },
          { id: 'node-c', title: 'C', summary: 'C', fullText: 'C' },
        ],
        pendingNodeIds: ['node-c'],
      },
      vaultId: 'investigation-1',
    })
  })

  it('clears pending integration ids after a successful incremental merge', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.click(screen.getByRole('button', { name: /integrate new evidence/i }))

    socket.emit('CONNECTIONS_FOUND', [
      {
        source: 'node-b',
        target: 'node-c',
        tag: 'RELATED',
        reasoning: 'Integrated line',
      },
    ])

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.pendingIntegrationNodeIds).toEqual([])
    })
  })

  it('keeps pending integration ids when incremental integration errors', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.click(screen.getByRole('button', { name: /integrate new evidence/i }))
    socket.emit('ERROR', 'integration failed')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /integrate new evidence/i })).toBeInTheDocument()
    })

    const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
    expect(persisted.pendingIntegrationNodeIds).toEqual(['node-c'])
  })

  it('preserves existing connect-the-dots edges while integrating new evidence', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [
          {
            id: 'e-node-a-node-b-RELATED',
            source: 'node-a',
            target: 'node-b',
            label: 'RELATED',
            data: { generatedBy: 'connectTheDots', reasoning: 'Existing line' },
          },
        ],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.click(screen.getByRole('button', { name: /integrate new evidence/i }))

    const message = JSON.parse(socket.sentMessages[0])
    expect(message.type).toBe('CONNECT_DOTS_INCREMENTAL')

    socket.emit('CONNECTIONS_FOUND', [
      {
        source: 'node-b',
        target: 'node-c',
        tag: 'RELATED',
        reasoning: 'Newly found line',
      },
    ])

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'e-node-a-node-b-RELATED' }),
          expect.objectContaining({ id: 'e-node-b-node-c-RELATED' }),
        ]),
      )
    })
  })

  it('replaces stale AI edges on a full reconnect run', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [
          {
            id: 'manual-node-a-node-c',
            source: 'node-a',
            target: 'node-c',
            label: 'MANUAL',
            data: { generatedBy: 'manual', reasoning: 'Manual line' },
          },
          {
            id: 'e-node-a-node-b-RELATED',
            source: 'node-a',
            target: 'node-b',
            label: 'RELATED',
            data: { generatedBy: 'connectTheDots', reasoning: 'Stale AI line' },
          },
        ],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.click(screen.getByRole('button', { name: /reconnect the dots/i }))

    socket.emit('CONNECTIONS_FOUND', [
      {
        source: 'node-b',
        target: 'node-c',
        tag: 'RELATED',
        reasoning: 'Fresh AI line',
      },
    ])

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'manual-node-a-node-c' }),
          expect.objectContaining({ id: 'e-node-b-node-c-RELATED' }),
        ]),
      )
      expect(persisted.edges).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'e-node-a-node-b-RELATED' }),
        ]),
      )
    })
  })

  it('replaces only AI edges touching pending nodes during incremental integration', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 400, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
          { id: 'node-d', position: { x: 600, y: 0 }, data: { title: 'D', summary: 'D', fullText: 'D' }, style: { width: 320, height: 180 } },
        ],
        edges: [
          {
            id: 'manual-node-a-node-d',
            source: 'node-a',
            target: 'node-d',
            label: 'MANUAL',
            data: { generatedBy: 'manual', reasoning: 'Manual line' },
          },
          {
            id: 'e-node-a-node-b-RELATED',
            source: 'node-a',
            target: 'node-b',
            label: 'RELATED',
            data: { generatedBy: 'connectTheDots', reasoning: 'Keep me' },
          },
          {
            id: 'e-node-b-node-c-RELATED',
            source: 'node-b',
            target: 'node-c',
            label: 'RELATED',
            data: { generatedBy: 'connectTheDots', reasoning: 'Replace me' },
          },
        ],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    await user.click(screen.getByRole('button', { name: /integrate new evidence/i }))

    socket.emit('CONNECTIONS_FOUND', [
      {
        source: 'node-c',
        target: 'node-d',
        tag: 'RELATED',
        reasoning: 'New incremental edge',
      },
    ])

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'manual-node-a-node-d' }),
          expect.objectContaining({ id: 'e-node-a-node-b-RELATED' }),
          expect.objectContaining({ id: 'e-node-c-node-d-RELATED' }),
        ]),
      )
      expect(persisted.edges).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'e-node-b-node-c-RELATED' }),
        ]),
      )
    })
  })

  it('opens a node image lightbox and supports cycling attached images', async () => {
    const user = userEvent.setup()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-visual',
            type: 'custom',
            position: { x: 96, y: 96 },
            style: { width: 336, height: 288 },
            data: {
              id: 'node-visual',
              title: 'Visual Node',
              summary: 'Summary',
              fullText: 'Summary',
              images: [
                { id: 'img-1', path: '/evidence/one.png', caption: 'First image' },
                { id: 'img-2', path: '/evidence/two.png', caption: 'Second image' },
              ],
            },
          },
        ],
        edges: [],
      }),
    )

    renderBoard()

    await user.click(await screen.findByTestId('node-image-trigger-Visual Node'))

    expect(screen.getByTestId('node-image-lightbox')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /visual node/i })).toBeInTheDocument()
    expect(screen.getByAltText('First image')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByAltText('Second image')).toBeInTheDocument()

    await user.click(screen.getByTitle('Close image viewer'))
    expect(screen.queryByTestId('node-image-lightbox')).not.toBeInTheDocument()
  })
})
