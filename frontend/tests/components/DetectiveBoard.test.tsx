import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetectiveBoard from '../../src/components/DetectiveBoard'
import { IMAGE_SCRAPING_PREFERENCE_KEY } from '../../src/utils/searchPreferences'
import {
  BOARD_TOGGLE_DISCOVERY_PANEL_EVENT,
  BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT,
} from '../../src/utils/boardWorkspaceEvents'

const localStorage = window.localStorage

const fitViewMock = vi.fn()
const setCenterMock = vi.fn()
const getZoomMock = vi.fn(() => 0.82)
let lastReactFlowProps: Record<string, unknown> | null = null
let lastMiniMapProps: Record<string, unknown> | null = null

vi.mock('reactflow', () => {
  return {
    __esModule: true,
    default: (props: {
      children?: React.ReactNode
      nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>
      nodeTypes?: Record<string, React.ComponentType<any>>
      proOptions?: Record<string, unknown>
    }) => {
      lastReactFlowProps = props as Record<string, unknown>
      const {
        children,
        nodes = [],
        nodeTypes = {},
      } = props

      return (
      React.createElement(
        'div',
        { 'data-testid': 'reactflow' },
        React.createElement('div', { className: 'react-flow__pane', 'data-testid': 'reactflow-pane' }),
        nodes.map((node) => {
          const NodeComponent = nodeTypes[node.type || 'default']
          if (!NodeComponent) {
            return null
          }

          return React.createElement(
            'div',
            {
              key: node.id,
              'data-testid': `mock-node-shell-${node.id}`,
              'data-position-x': node.position?.x,
              'data-position-y': node.position?.y,
            },
            React.createElement(NodeComponent, {
              id: node.id,
              type: node.type || 'custom',
              selected: false,
              dragging: false,
              zIndex: 1,
              isConnectable: true,
              positionAbsoluteX: 0,
              positionAbsoluteY: 0,
              data: node.data,
            }),
          )
        }),
        children,
      )
      )
    },
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Background: () => null,
    Controls: () => React.createElement('div', { 'data-testid': 'reactflow-controls' }),
    MiniMap: ({ onClick, ...props }: React.HTMLAttributes<HTMLDivElement> & { onClick?: (event: React.MouseEvent, position: { x: number; y: number }) => void }) => {
      lastMiniMapProps = props as Record<string, unknown>
      return React.createElement('div', {
        ...props,
        onClick: (event: React.MouseEvent) => onClick?.(event, { x: 420, y: 310 }),
      })
    },
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
  default: ({
    data,
    id,
  }: {
    id?: string
    data?: {
      title?: string
      summary?: string
      fullText?: string
      images?: Array<{ id?: string; path: string }>
      isEditing?: boolean
      isRecentlyImported?: boolean
      onSetEditing?: (id: string | null) => void
      onSave?: (nodeId: string, title: string, text: string, mode: 'save' | 'analyze-and-save') => void
      onAttachImage?: (nodeId: string, file: File) => Promise<void>
      onRemoveImage?: (nodeId: string, imageId: string) => void
      onViewImages?: (images: Array<{ path: string }>, index: number, nodeTitle?: string, nodeId?: string) => void
    }
  }) =>
    React.createElement(
      'div',
      { 'data-testid': `mock-node-${id}` },
      data?.title ? React.createElement('span', null, data.title) : null,
      data?.summary ? React.createElement('span', null, data.summary) : null,
      data?.isRecentlyImported ? React.createElement('span', null, 'recent import') : null,
      React.createElement(
        'button',
        {
          type: 'button',
          onClick: () => id && data?.onSetEditing?.(id),
        },
        'edit node',
      ),
      data?.isEditing
        ? React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => id && data?.onSave?.(id, data.title || '', data.summary || '', 'analyze-and-save'),
              },
              'analyse & save',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => id && data?.onSave?.(id, data.title || '', data.summary || '', 'save'),
              },
              'save',
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                onClick: () => id && data?.onAttachImage?.(id, new File(['image-bytes'], 'board-evidence.png', { type: 'image/png' })),
              },
              'attach image',
            ),
            data?.images?.[0]
              ? React.createElement(
                  'button',
                  {
                    type: 'button',
                    onClick: () => id && data?.onRemoveImage?.(id, data.images?.[0]?.id || 'img-1'),
                  },
                  'remove image',
                )
              : null,
          )
        : null,
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

const renderBoard = (
  investigationId = 'investigation-1',
  sharedSocket: WebSocket | null = null,
  props: Partial<React.ComponentProps<typeof DetectiveBoard>> = {},
) =>
  render(
    <DetectiveBoard
      investigationId={investigationId}
      sharedSocket={sharedSocket}
      onDeepDiveNode={vi.fn()}
      onNavigateToChild={vi.fn()}
      {...props}
    />,
  )

const seedExportableBoard = () => {
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
}

describe('DetectiveBoard relationship legend', () => {
  beforeEach(() => {
    localStorage.clear()
    lastReactFlowProps = null
    lastMiniMapProps = null
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
    expect(screen.getByTitle('Show relationship legend')).toBeInTheDocument()
  })

  it('collapses the legend to a reopen chip and persists the preference', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /^Hide$/i }))

    expect(screen.queryByText('RELATIONSHIPS')).not.toBeInTheDocument()
    expect(screen.getByTitle('Show relationship legend')).toBeInTheDocument()
    expect(localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY)).toBe('false')

    await user.click(screen.getByTitle('Show relationship legend'))

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

    await user.click(screen.getByRole('button', { name: /^Hide$/i }))

    expect(screen.queryByText('EDIT: RELATED')).not.toBeInTheDocument()
    expect(screen.getByTitle('Show relationship legend')).toBeInTheDocument()

    await user.click(screen.getByTitle('Show relationship legend'))

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
    expect(screen.getByTestId('board-utility-rail')).toBeInTheDocument()
    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /board controls/i })).toBeInTheDocument()
  })

  it('anchors the minimap to the top-left workstation position', () => {
    renderBoard()

    expect(lastMiniMapProps?.position).toBe('top-left')
    expect(lastMiniMapProps?.offsetScale).toBe(2.5)
    expect(lastMiniMapProps?.maskColor).toBe('rgba(129, 227, 255, 0.018)')
    expect(lastMiniMapProps?.maskStrokeColor).toBe('rgba(152, 255, 255, 1)')
    expect(lastMiniMapProps?.maskStrokeWidth).toBe(4)
  })

  it('does not render the default React Flow controls', () => {
    renderBoard()

    expect(screen.queryByTestId('reactflow-controls')).not.toBeInTheDocument()
  })

  it('passes React Flow pro options to hide attribution', () => {
    renderBoard()

    expect(lastReactFlowProps?.proOptions).toEqual({ hideAttribution: true })
  })

  it('keeps React Flow node and edge type objects stable across board renders', () => {
    const socket = new MockSocket()
    renderBoard('investigation-1', socket as unknown as WebSocket)

    const firstNodeTypes = lastReactFlowProps?.nodeTypes
    const firstEdgeTypes = lastReactFlowProps?.edgeTypes

    act(() => {
      socket.emit('BRAIN_STATE', 'Synthesizing persona insights...')
    })

    expect(lastReactFlowProps?.nodeTypes).toBe(firstNodeTypes)
    expect(lastReactFlowProps?.edgeTypes).toBe(firstEdgeTypes)
  })

  it('toggles the minimap size from the expand control', async () => {
    const user = userEvent.setup()
    renderBoard()

    const minimap = screen.getByTestId('reactflow-minimap')
    const minimapPanel = screen.getByTestId('minimap-panel')
    expect(minimapPanel).toHaveStyle({ width: '244px', height: '178px', left: '24px', top: '16px' })
    expect(minimap).toHaveStyle({ width: '212px', height: '116px', left: '40px', top: '58px' })

    await user.click(screen.getByRole('button', { name: /enlarge minimap/i }))
    expect(minimapPanel).toHaveStyle({ width: '320px', height: '238px', left: '24px', top: '16px' })
    expect(minimap).toHaveStyle({ width: '288px', height: '176px', left: '40px', top: '58px' })

    await user.click(screen.getByRole('button', { name: /shrink minimap/i }))
    expect(minimapPanel).toHaveStyle({ width: '244px', height: '178px', left: '24px', top: '16px' })
    expect(minimap).toHaveStyle({ width: '212px', height: '116px', left: '40px', top: '58px' })
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

  it('uses the right utility rail to trigger existing workspace actions', async () => {
    const user = userEvent.setup()
    const discoveryListener = vi.fn()
    const synthesisListener = vi.fn()
    window.addEventListener(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT, discoveryListener as EventListener)
    window.addEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, synthesisListener as EventListener)

    renderBoard()

    await user.click(screen.getByRole('button', { name: /toggle synthesis panel/i }))
    await user.click(screen.getByRole('button', { name: /toggle discoveries panel/i }))

    expect(synthesisListener).toHaveBeenCalledTimes(1)
    expect(discoveryListener).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /hide relationships legend/i }))
    expect(screen.queryByText('RELATIONSHIPS')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show relationships legend/i }))
    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /recenter board viewport/i }))
    expect(fitViewMock).toHaveBeenCalledWith({
      duration: 220,
      padding: 0.16,
      minZoom: 0.98,
      maxZoom: 1,
    })

    window.removeEventListener(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT, discoveryListener as EventListener)
    window.removeEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, synthesisListener as EventListener)
  })

  it('colors completed theory and discovery utilities with unread dots', () => {
    renderBoard('investigation-1', null, {
      hasTheoryReady: true,
      hasUnreadTheory: true,
      hasDiscoveryReady: true,
      hasUnreadDiscoveries: true,
    })

    const theoryButton = screen.getByRole('button', { name: /grand unified theory ready/i })
    const discoveryButton = screen.getByRole('button', { name: /discoveries ready/i })

    expect(theoryButton).toHaveClass('forensic-utility-button-complete')
    expect(within(theoryButton).getByTestId('theory-utility-notification')).toBeInTheDocument()
    expect(discoveryButton).toHaveClass('forensic-utility-button-discovery-complete')
    expect(within(discoveryButton).getByTestId('discovery-utility-notification')).toBeInTheDocument()
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

  it('renders export options in an overlay outside the action bar', async () => {
    const user = userEvent.setup()
    seedExportableBoard()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /export/i }))

    const overlay = screen.getByTestId('export-menu-overlay')
    const actionBar = screen.getByTestId('board-action-bar')

    expect(overlay).toBeInTheDocument()
    expect(actionBar.contains(overlay)).toBe(false)
    expect(within(overlay).getByRole('button', { name: /snapshot \(png\)/i })).toBeInTheDocument()
    expect(within(overlay).getByRole('button', { name: /vector \(svg\)/i })).toBeInTheDocument()
    expect(within(overlay).getByRole('button', { name: /full report \(pdf\)/i })).toBeInTheDocument()
  })

  it('closes the export overlay when clicking outside it', async () => {
    const user = userEvent.setup()
    seedExportableBoard()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByTestId('export-menu-overlay')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    await waitFor(() => {
      expect(screen.queryByTestId('export-menu-overlay')).not.toBeInTheDocument()
    })
  })

  it('closes export when board controls are opened', async () => {
    const user = userEvent.setup()
    seedExportableBoard()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /export/i }))
    expect(screen.getByTestId('export-menu-overlay')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /board controls/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('export-menu-overlay')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('board-controls-overlay')).toBeInTheDocument()
  })

  it('closes board controls when export is opened', async () => {
    const user = userEvent.setup()
    seedExportableBoard()

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

  it('ignores relationship results scoped to another investigation', async () => {
    const user = userEvent.setup()
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

    await user.click(screen.getByRole('button', { name: /connect the dots/i }))

    socket.emit('CONNECTIONS_FOUND', [
      {
        vaultId: 'investigation-2',
        source: 'node-a',
        target: 'node-b',
        tag: 'WRONG BOARD',
        reasoning: 'This belongs to another investigation.',
      },
    ])

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.edges || []).toEqual([])
    })

    socket.emit('CONNECTIONS_FOUND', [
      {
        vaultId: 'investigation-1',
        source: 'node-a',
        target: 'node-b',
        tag: 'RIGHT BOARD',
        reasoning: 'This belongs to the active investigation.',
      },
    ])

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'e-node-a-node-b-RIGHT BOARD' }),
        ]),
      )
      expect(persisted.edges).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'e-node-a-node-b-WRONG BOARD' }),
        ]),
      )
    })
  })

  it('replays saved relationship results when the websocket delivery was missed', async () => {
    ;(globalThis as { __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean }).__GORANTULA_BACKEND_PERSISTENCE_TEST__ = true
    const investigationId = 'relationship-replay-investigation'
    const savedBoard = {
      mode: 'legacy',
      nodes: [
        { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
        { id: 'node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
      ],
      edges: [],
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/board') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => savedBoard,
        } as Response
      }
      if (url.endsWith('/relationships') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({
            vaultId: investigationId,
            runId: 'run-1',
            createdAt: new Date().toISOString(),
            connections: [
              {
                vaultId: investigationId,
                source: 'node-a',
                target: 'node-b',
                tag: 'RELATED',
                reasoning: 'Recovered from durable relationship result.',
              },
            ],
          }),
        } as Response
      }
      if (url.endsWith('/board') && init?.method === 'PUT') {
        return {
          ok: true,
          json: async () => ({}),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      renderBoard(investigationId)

      await waitFor(() => {
        const boardPutCall = fetchMock.mock.calls.find(([input, init]) =>
          String(input).endsWith('/board') && init?.method === 'PUT',
        )
        expect(boardPutCall).toBeDefined()
        const persisted = JSON.parse(String(boardPutCall?.[1]?.body || '{}'))
        expect(persisted.edges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: 'e-node-a-node-b-RELATED' }),
          ]),
        )
      })

      expect(fetchMock).toHaveBeenCalledWith(
        `http://localhost:8080/api/investigations/${investigationId}/relationships`,
        expect.objectContaining({ cache: 'no-store' }),
      )
    } finally {
      delete (globalThis as { __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean }).__GORANTULA_BACKEND_PERSISTENCE_TEST__
      vi.unstubAllGlobals()
    }
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

  it('adds manual evidence near the visible board center using strict-grid snapping', async () => {
    const user = userEvent.setup()
    renderBoard()

    const flow = document.getElementById('detective-board-flow')
    expect(flow).not.toBeNull()
    const flowElement = flow as HTMLDivElement
    flowElement.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect

    await user.click(screen.getByRole('button', { name: /add evidence/i }))

    const newNode = await screen.findByTestId(/^mock-node-shell-manual-/)
    expect(newNode).toHaveAttribute('data-position-x', '240')
    expect(newNode).toHaveAttribute('data-position-y', '216')
  })

  it('places imported evidence near the visible board center and briefly highlights it', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      const flow = document.getElementById('detective-board-flow')
      expect(flow).not.toBeNull()
      const flowElement = flow as HTMLDivElement
      flowElement.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect

      act(() => {
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: {
            id: 'imported-node-a',
            title: '[IMPORTED] A',
            summary: 'Imported summary',
            fullText: 'Imported summary',
          },
        })
      })

      const importedNode = screen.getByTestId('mock-node-shell-imported-node-a')
      expect(importedNode).toHaveAttribute('data-position-x', '240')
      expect(importedNode).toHaveAttribute('data-position-y', '216')
      expect(screen.getByText('recent import')).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(screen.queryByText('recent import')).not.toBeInTheDocument()
    } finally {
      randomSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('propagates crawl run ids through auto reconnect and persists gathered nodes with relationships', async () => {
    const socket = new MockSocket()
    renderBoard('investigation-1', socket as unknown as WebSocket)

    act(() => {
      socket.emit('MEMORY_NODE_GATHERED', {
        append: false,
        vaultId: 'investigation-1',
        node: {
          id: 'node-a',
          title: 'A',
          summary: 'A',
          fullText: 'A',
          sourceURL: 'https://example.com/a',
        },
      })
      socket.emit('MEMORY_NODE_GATHERED', {
        append: false,
        vaultId: 'investigation-1',
        node: {
          id: 'node-b',
          title: 'B',
          summary: 'B',
          fullText: 'B',
          sourceURL: 'https://example.com/b',
        },
      })
      socket.emit('SYNTHESIS_COMPLETE', {
        result: 'Unified report',
        vaultPath: 'abdomen_vault/investigation-1/report.md',
        vaultId: 'investigation-1',
        append: false,
        runId: 'run-flow-1',
      })
    })

    await waitFor(() => {
      expect(socket.sentMessages.some((message) => JSON.parse(message).type === 'CONNECT_DOTS')).toBe(true)
    })

    const reconnectMessage = socket.sentMessages
      .map((message) => JSON.parse(message))
      .find((message) => message.type === 'CONNECT_DOTS')
    expect(reconnectMessage).toEqual(expect.objectContaining({
      type: 'CONNECT_DOTS',
      vaultId: 'investigation-1',
      runId: 'run-flow-1',
    }))

    act(() => {
      socket.emit('CONNECTIONS_FOUND', [
        {
          source: 'node-a',
          target: 'node-b',
          tag: 'RELATED',
          reasoning: 'Shared evidence trail',
        },
      ])
    })

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'node-a' }),
          expect.objectContaining({ id: 'node-b' }),
        ]),
      )
      expect(persisted.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'e-node-a-node-b-RELATED' }),
        ]),
      )
    })
  })

  it('does not auto reconnect a board when another investigation completes synthesis', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_merge-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [
          { id: 'merge-node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'merge-node-b', position: { x: 200, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    try {
      renderBoard('merge-1', socket as unknown as WebSocket)

      act(() => {
        socket.emit('SYNTHESIS_COMPLETE', {
          result: 'Different investigation report',
          vaultPath: 'abdomen_vault/investigation-2/report.md',
          vaultId: 'investigation-2',
          append: false,
          runId: 'run-other-vault',
        })
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(socket.sentMessages.map((message) => JSON.parse(message).type)).not.toContain('CONNECT_DOTS')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not auto reconnect when the matching crawl run was stopped before a late synthesis completion', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      act(() => {
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: {
            id: 'node-a',
            title: 'A',
            summary: 'A',
            fullText: 'A',
            sourceURL: 'https://example.com/a',
          },
        })
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: {
            id: 'node-b',
            title: 'B',
            summary: 'B',
            fullText: 'B',
            sourceURL: 'https://example.com/b',
          },
        })
        socket.emit('PIPELINE_PROGRESS', {
          runId: 'run-stopped-1',
          vaultId: 'investigation-1',
          mode: 'web',
          stepId: 'complete',
          stepLabel: 'Pipeline stopped',
          status: 'cancelled',
          completedSteps: 3,
          totalSteps: 8,
          elapsedMs: 6000,
        })
        socket.emit('SYNTHESIS_COMPLETE', {
          result: 'Late report',
          vaultPath: 'abdomen_vault/investigation-1/report.md',
          vaultId: 'investigation-1',
          append: false,
          runId: 'run-stopped-1',
        })
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(socket.sentMessages.map((message) => JSON.parse(message).type)).not.toContain('CONNECT_DOTS')
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves edited text without sending manual node analysis', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    renderBoard('investigation-1', socket as unknown as WebSocket)

    socket.emit('MEMORY_NODE_GATHERED', {
      append: false,
      vaultId: 'investigation-1',
      node: {
        id: 'node-a',
        title: 'A',
        summary: 'A',
        fullText: 'A',
      },
    })

    const node = await screen.findByTestId('mock-node-node-a')
    await user.click(within(node).getByRole('button', { name: /edit node/i }))
    await user.click(await within(node).findByRole('button', { name: /^save$/i }))

    expect(socket.sentMessages).toEqual([])
  })

  it('sends manual node analysis only for analyse and save', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()

    renderBoard('investigation-1', socket as unknown as WebSocket)

    socket.emit('MEMORY_NODE_GATHERED', {
      append: false,
      vaultId: 'investigation-1',
      node: {
        id: 'node-a',
        title: 'A',
        summary: 'A',
        fullText: 'A',
      },
    })

    const node = await screen.findByTestId('mock-node-node-a')
    await user.click(within(node).getByRole('button', { name: /edit node/i }))
    await user.click(await within(node).findByRole('button', { name: /analyse & save/i }))

    expect(socket.sentMessages).toHaveLength(1)
    expect(JSON.parse(socket.sentMessages[0])).toEqual({
      type: 'PROCESS_MANUAL_NODE',
      payload: {
        nodeId: 'node-a',
        text: 'A',
      },
    })
  })

  it('does not send manual analysis for image attach or remove actions', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        image: { id: 'img-new', path: '/evidence/board-evidence.png', caption: 'Board evidence' },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderBoard('investigation-1', socket as unknown as WebSocket)

    socket.emit('MEMORY_NODE_GATHERED', {
      append: false,
      vaultId: 'investigation-1',
      node: {
        id: 'node-a',
        title: 'A',
        summary: 'A',
        fullText: 'A',
        images: [{ id: 'img-1', path: '/evidence/original.png', caption: 'Original' }],
      },
    })

    const node = await screen.findByTestId('mock-node-node-a')
    await user.click(within(node).getByRole('button', { name: /edit node/i }))
    await user.click(await within(node).findByRole('button', { name: /attach image/i }))
    await user.click(await within(node).findByRole('button', { name: /remove image/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(socket.sentMessages).toEqual([])
  })

  it('keeps existing processed text on plain save when no reanalysis is requested', async () => {
    const user = userEvent.setup()
    const socket = new MockSocket()
    const processedText = '[PERSON:ALICE] met [ORG:OPENAI]'

    renderBoard('investigation-1', socket as unknown as WebSocket)

    socket.emit('MEMORY_NODE_GATHERED', {
      append: false,
      vaultId: 'investigation-1',
      node: {
        id: 'node-a',
        title: 'A',
        summary: processedText,
        fullText: processedText,
      },
    })

    expect(await screen.findByTestId('mock-node-node-a')).toHaveTextContent(processedText)

    const node = await screen.findByTestId('mock-node-node-a')
    await user.click(within(node).getByRole('button', { name: /edit node/i }))
    await user.click(await within(node).findByRole('button', { name: /^save$/i }))

    expect(node).toHaveTextContent(processedText)
    expect(socket.sentMessages).toEqual([])
  })
})
