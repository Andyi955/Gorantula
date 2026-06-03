import * as React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetectiveBoard from '../../src/components/DetectiveBoard'
import { getMiniMapNodeColor } from '../../src/components/detectiveBoardMinimap'
import { IMAGE_SCRAPING_PREFERENCE_KEY } from '../../src/utils/searchPreferences'
import {
  BOARD_TOGGLE_DISCOVERY_PANEL_EVENT,
  BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT,
} from '../../src/utils/boardWorkspaceEvents'
import { BROWSER_QA_ANIMATION_DEMO_EVENT, BROWSER_QA_DISCOVERY_DEMO_EVENT, BROWSER_QA_ERROR_EMPTY_DEMO_EVENT, BROWSER_QA_EVIDENCE_EXPANSION_DEMO_EVENT, BROWSER_QA_PIPELINE_DEMO_EVENT, BROWSER_QA_RABBIT_HOLE_DEMO_EVENT, BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, BROWSER_QA_SYNTHESIS_DEMO_EVENT, BROWSER_QA_TIMELINE_DEMO_EVENT } from '../../src/utils/browserQaSeed'

const localStorage = window.localStorage

const fitViewMock = vi.fn()
const setCenterMock = vi.fn()
const getZoomMock = vi.fn(() => 0.82)
let viewportMock = { x: -160, y: -90, zoom: 1 }
let lastReactFlowProps: Record<string, unknown> | null = null
type MockNodeComponent = React.ComponentType<Record<string, unknown>>
type MockEdgeComponent = React.ComponentType<Record<string, unknown>>

vi.mock('reactflow', () => {
  return {
    __esModule: true,
    default: (props: {
      children?: React.ReactNode
      nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>
      edges?: Array<{ id: string; source: string; target: string; type?: string; data?: Record<string, unknown> }>
      nodeTypes?: Record<string, MockNodeComponent>
      edgeTypes?: Record<string, MockEdgeComponent>
      proOptions?: Record<string, unknown>
    }) => {
      lastReactFlowProps = props as Record<string, unknown>
      const {
        children,
        nodes = [],
        edges = [],
        nodeTypes = {},
        edgeTypes = {},
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
        edges.map((edge) => {
          const EdgeComponent = edgeTypes[edge.type || 'default']
          if (!EdgeComponent) {
            return null
          }

          return React.createElement(EdgeComponent, {
            key: edge.id,
            id: edge.id,
            source: edge.source,
            target: edge.target,
            sourceX: 0,
            sourceY: 0,
            targetX: 100,
            targetY: 100,
            data: edge.data,
          })
        }),
        children,
      )
      )
    },
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Background: () => null,
    Controls: () => React.createElement('div', { 'data-testid': 'reactflow-controls' }),
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
    useViewport: () => viewportMock,
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
      isConnectionHighlighted?: boolean
      connectionHighlightColor?: string
      nodeEntryAnimation?: 'evidence' | 'imported'
      nodeEntryDelayMs?: number
      isPersonaScanActive?: boolean
      isLayoutChoreographyActive?: boolean
      isTimelineFocused?: boolean
      evidenceCount?: number
      rabbitState?: string
      evidenceRole?: string
      supportCluster?: string
      isSupportEvidenceCompact?: boolean
      isSupportTetherSource?: boolean
      isSupportTetherTarget?: boolean
      onSupportHover?: (nodeId: string, active: boolean) => void
      onExpand?: (nodeId: string, expanded: boolean) => void
      onSetEditing?: (id: string | null) => void
      onSave?: (nodeId: string, title: string, text: string, mode: 'save' | 'analyze-and-save') => void
      onAttachImage?: (nodeId: string, file: File) => Promise<void>
      onRemoveImage?: (nodeId: string, imageId: string) => void
      onViewImages?: (images: Array<{ path: string }>, index: number, nodeTitle?: string, nodeId?: string) => void
    }
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': `mock-node-${id}`,
        onMouseEnter: () => id && data?.onSupportHover?.(id, true),
        onMouseLeave: () => id && data?.onSupportHover?.(id, false),
      },
      data?.title ? React.createElement('span', null, data.title) : null,
      data?.summary ? React.createElement('span', null, data.summary) : null,
      data?.isRecentlyImported ? React.createElement('span', null, 'recent import') : null,
      data?.isConnectionHighlighted ? React.createElement('span', null, 'connection highlight') : null,
      data?.connectionHighlightColor ? React.createElement('span', null, `connection color ${data.connectionHighlightColor}`) : null,
      data?.nodeEntryAnimation ? React.createElement('span', null, `entry ${data.nodeEntryAnimation} ${data.nodeEntryDelayMs || 0}`) : null,
      data?.isPersonaScanActive ? React.createElement('span', null, 'persona scan') : null,
      data?.isLayoutChoreographyActive ? React.createElement('span', null, 'layout choreography') : null,
      data?.isTimelineFocused ? React.createElement('span', null, 'timeline focus') : null,
      data?.evidenceCount && data.evidenceCount > 1 ? React.createElement('span', null, `merged evidence ${data.evidenceCount}`) : null,
      data?.rabbitState ? React.createElement('span', null, `rabbit ${data.rabbitState}`) : null,
      data?.evidenceRole ? React.createElement('span', null, `evidence role ${data.evidenceRole}`) : null,
      data?.supportCluster ? React.createElement('span', null, `support cluster ${data.supportCluster}`) : null,
      data?.isSupportEvidenceCompact ? React.createElement('span', null, 'compact support') : null,
      data?.isSupportTetherSource ? React.createElement('span', null, 'support tether source') : null,
      data?.isSupportTetherTarget ? React.createElement('span', null, 'support tether target') : null,
      data?.expanded ? React.createElement('span', null, 'expanded node') : null,
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
  default: ({
    data,
    id,
    source,
    target,
  }: {
    data?: {
      color?: string
      onConnectionHover?: (payload: { edgeId?: string; source?: string; target?: string; color?: string; active?: boolean }) => void
    }
    id?: string
    source?: string
    target?: string
  }) =>
    React.createElement(
      'div',
      {
        'data-testid': `mock-edge-label-${id}`,
        onMouseEnter: () => data?.onConnectionHover?.({
            edgeId: id,
            source,
            target,
            color: data?.color,
            active: true,
        }),
        onMouseLeave: () => data?.onConnectionHover?.({
            edgeId: id,
            source,
            target,
            color: data?.color,
            active: false,
        }),
      },
      'edge label',
    ),
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
    delete (globalThis as { __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean }).__GORANTULA_BACKEND_PERSISTENCE_TEST__
    localStorage.clear()
    lastReactFlowProps = null
    viewportMock = { x: -160, y: -90, zoom: 1 }
    fitViewMock.mockReset()
    setCenterMock.mockReset()
    getZoomMock.mockReset()
    getZoomMock.mockReturnValue(0.82)
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    delete (globalThis as { __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean }).__GORANTULA_BACKEND_PERSISTENCE_TEST__
    vi.restoreAllMocks()
  })

  const enableQaTools = () => {
    fireEvent.click(screen.getByRole('button', { name: /board controls/i }))
    fireEvent.click(screen.getByRole('button', { name: /enable qa tools/i }))
  }

  const openQaReplayMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: /open qa replay menu/i }))
  }

  it('shows the legend by default when no preference exists', () => {
    renderBoard()

    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    expect(localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY)).toBe('true')
  })

  it('shows a short restore veil and logs board load timing when switching investigations', async () => {
    localStorage.setItem(
      'inv_data_inv-load-metric',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-load-metric',
            type: 'custom',
            position: { x: 96, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'node-load-metric',
              title: 'Load Metric Node',
              summary: 'A restored board used to verify load timing.',
              fullText: 'A restored board used to verify load timing.',
            },
          },
        ],
        edges: [],
      }),
    )

    renderBoard('inv-load-metric')

    expect(await screen.findByTestId('board-restore-loading')).toHaveTextContent('Restoring board')
    await waitFor(() => {
      expect(console.info).toHaveBeenCalledWith('[BoardLoad] restored', expect.objectContaining({
        investigationId: 'inv-load-metric',
        source: 'memory-cache',
        nodeCount: 1,
        edgeCount: 0,
        durationMs: expect.any(Number),
      }))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('board-restore-loading')).not.toBeInTheDocument()
    })
  })

  it('keeps the restore veil above the hidden prefit layer for restored Rabbit Hole boards', async () => {
    localStorage.setItem(
      'inv_data_inv-rabbit-prefit-loader',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'rabbit-prefit-a',
            type: 'custom',
            position: { x: 1800, y: 1200 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-prefit-a',
              title: 'Rabbit Prefit A',
              summary: 'A restored Rabbit Hole node that should trigger initial viewport prefit.',
              fullText: 'A restored Rabbit Hole node that should trigger initial viewport prefit.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'rabbit-prefit-b',
            type: 'custom',
            position: { x: 2220, y: 1200 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-prefit-b',
              title: 'Rabbit Prefit B',
              summary: 'A second restored Rabbit Hole node for the slow-board loader regression.',
              fullText: 'A second restored Rabbit Hole node for the slow-board loader regression.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'vault_search',
              rabbitPass: 2,
            },
          },
        ],
        edges: [
          {
            id: 'e-rabbit-prefit-a-rabbit-prefit-b',
            source: 'rabbit-prefit-a',
            target: 'rabbit-prefit-b',
            type: 'customEdge',
            data: { generatedBy: 'connectTheDots', tag: 'RABBIT_PREFIT' },
          },
        ],
      }),
    )

    renderBoard('inv-rabbit-prefit-loader')

    const loader = await screen.findByTestId('board-restore-loading')
    const boardFlow = document.getElementById('detective-board-flow')
    expect(boardFlow).toHaveClass('forensic-board-restore-prefit')
    expect(loader.closest('#detective-board-flow')).toBeNull()
    expect(loader).toHaveTextContent('Restoring board')
  })

  it('promotes live Rabbit Hole provisional nodes from websocket updates', async () => {
    const socket = new MockSocket()
    renderBoard('inv-rabbit', socket as unknown as WebSocket)

    act(() => {
      socket.emit('MEMORY_NODE_GATHERED', {
        vaultId: 'inv-rabbit',
        append: false,
        node: {
          id: 'rabbit-node-1',
          title: 'Rabbit Lead',
          summary: 'A provisional lead from Rabbit Hole.',
          fullText: 'A provisional lead from Rabbit Hole.',
          sourceURL: 'rabbit://timeline-context',
          origin: 'rabbit-hole',
          rabbitState: 'provisional',
          rabbitTool: 'timeline_context',
          rabbitPass: 1,
        },
      })
    })

    expect(await screen.findByTestId('mock-node-rabbit-node-1')).toHaveTextContent('rabbit provisional')

    act(() => {
      socket.emit('RABBIT_HOLE_NODE_UPDATE', {
        vaultId: 'inv-rabbit',
        nodeIds: ['rabbit-node-1'],
        rabbitState: 'promoted',
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('mock-node-rabbit-node-1')).toHaveTextContent('rabbit promoted')
    })
  })

  it('places unconnected Rabbit Hole nodes into a supporting evidence band with visual tethers', async () => {
    localStorage.setItem(
      'inv_data_inv-rabbit-support',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'rabbit-primary-a',
            type: 'custom',
            position: { x: 96, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-primary-a',
              title: 'Google Kairos Deal',
              summary: 'Google and Kairos sign a nuclear power agreement.',
              fullText: 'Google and Kairos sign a nuclear power agreement.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'rabbit-primary-b',
            type: 'custom',
            position: { x: 528, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-primary-b',
              title: 'Microsoft Helion PPA',
              summary: 'Microsoft and Helion announce a fusion power purchase agreement.',
              fullText: 'Microsoft and Helion announce a fusion power purchase agreement.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'rabbit-support-web',
            type: 'custom',
            position: { x: 960, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-support-web',
              title: 'Google PPA Detail',
              summary: 'Google Kairos agreement adds 500 MW for data centers.',
              fullText: 'Google Kairos agreement adds 500 MW for data centers.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 2,
            },
          },
          {
            id: 'rabbit-support-timeline',
            type: 'custom',
            position: { x: 1296, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-support-timeline',
              title: 'NRC Timeline Context',
              summary: 'Timeline helper extracts nuclear permitting dates.',
              fullText: 'Timeline helper extracts nuclear permitting dates.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'timeline_context',
              rabbitPass: 2,
            },
          },
        ],
        edges: [
          {
            id: 'e-rabbit-primary-a-rabbit-primary-b',
            source: 'rabbit-primary-a',
            target: 'rabbit-primary-b',
            type: 'customEdge',
            data: { generatedBy: 'connectTheDots', tag: 'NUCLEAR_PPA' },
          },
        ],
      }),
    )

    renderBoard('inv-rabbit-support')

    expect(await screen.findByText('Supporting Evidence')).toBeInTheDocument()
    expect(screen.getByText('Web 1')).toBeInTheDocument()
    expect(screen.getByText('Timeline 1')).toBeInTheDocument()
    expect(screen.getAllByText('evidence role primary')).toHaveLength(2)
    expect(screen.getAllByText('evidence role supporting')).toHaveLength(2)
    expect(screen.getAllByText('compact support')).toHaveLength(2)

    fireEvent.mouseEnter(screen.getByTestId('mock-node-rabbit-support-web'))

    expect(await screen.findByTestId('support-evidence-tether-overlay')).toBeInTheDocument()
    expect(screen.getAllByTestId('support-evidence-tether-line').length).toBeGreaterThan(0)
    expect(screen.getByTestId('mock-node-rabbit-support-web')).toHaveTextContent('support tether source')
    expect(screen.getByTestId('mock-node-rabbit-primary-a')).toHaveTextContent('support tether target')
    expect(screen.getByTestId('board-navigator-support-tethers')).toBeInTheDocument()
    expect(screen.getAllByTestId('board-navigator-support-tether').length).toBeGreaterThan(0)
    expect(document.querySelector('[data-node-id="rabbit-support-web"]')).toHaveClass('forensic-board-navigator-node-support-source')
    expect(document.querySelector('[data-node-id="rabbit-primary-a"]')).toHaveClass('forensic-board-navigator-node-support-target')

    const renderedNodes = () => (lastReactFlowProps?.nodes || []) as Array<{ id: string; style?: { width?: number; height?: number } }>
    expect(renderedNodes().find((node) => node.id === 'rabbit-support-web')?.style).toEqual(expect.objectContaining({ width: 288, height: 192 }))

    act(() => {
      const onNodesChange = lastReactFlowProps?.onNodesChange as ((changes: Array<Record<string, unknown>>) => void) | undefined
      onNodesChange?.([
        {
          id: 'rabbit-support-web',
          type: 'dimensions',
          dimensions: { width: 528, height: 288 },
          resizing: false,
        },
      ])
    })

    await waitFor(() => {
      expect(renderedNodes().find((node) => node.id === 'rabbit-support-web')?.style).toEqual(expect.objectContaining({ width: 288, height: 192 }))
    })
  })

  it('does not replay stale relationship recovery after restoring a board with visible edges', async () => {
    const backendFlag = globalThis as typeof globalThis & {
      __GORANTULA_BACKEND_PERSISTENCE_TEST__?: boolean
    }
    backendFlag.__GORANTULA_BACKEND_PERSISTENCE_TEST__ = true

    const restoredBoard = {
      mode: 'strict-grid',
      nodes: [
        {
          id: 'rabbit-primary-a',
          type: 'custom',
          position: { x: 96, y: 96 },
          style: { width: 336, height: 216 },
          data: {
            id: 'rabbit-primary-a',
            title: 'Rabbit primary A',
            summary: 'A restored Rabbit Hole lead.',
            fullText: 'A restored Rabbit Hole lead.',
            origin: 'rabbit-hole',
            rabbitTool: 'web_search',
          },
        },
        {
          id: 'rabbit-primary-b',
          type: 'custom',
          position: { x: 528, y: 96 },
          style: { width: 336, height: 216 },
          data: {
            id: 'rabbit-primary-b',
            title: 'Rabbit primary B',
            summary: 'A second restored Rabbit Hole lead.',
            fullText: 'A second restored Rabbit Hole lead.',
            origin: 'rabbit-hole',
            rabbitTool: 'timeline_context',
          },
        },
      ],
      edges: [
        {
          id: 'edge-rabbit-a-b',
          source: 'rabbit-primary-a',
          target: 'rabbit-primary-b',
          sourceHandle: 'port-right-0',
          targetHandle: 'port-left-0',
          type: 'customEdge',
          data: {
            generatedBy: 'connectTheDots',
            tag: 'RESTORED_LINK',
            routePoints: [
              { x: 432, y: 160 },
              { x: 528, y: 160 },
            ],
          },
        },
      ],
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/board')) {
        return { ok: true, json: async () => restoredBoard } as Response
      }
      if (url.endsWith('/relationships')) {
        return {
          ok: true,
          json: async () => ({
            vaultId: 'inv-restored-rabbit',
            connections: [{ source: 'missing-node', target: 'rabbit-primary-a', tag: 'STALE' }],
          }),
        } as Response
      }
      return { ok: true, json: async () => ({}) } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      renderBoard('inv-restored-rabbit')

      expect(await screen.findByText('Rabbit primary A')).toBeInTheDocument()

      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 20))
      })

      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith('/relationships'))).toBe(false)
    } finally {
      delete backendFlag.__GORANTULA_BACKEND_PERSISTENCE_TEST__
    }
  })

  it('keeps relationship label hover highlighting connected nodes on Rabbit Hole boards', async () => {
    localStorage.setItem(
      'inv_data_inv-rabbit-hover',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'rabbit-primary-a',
            type: 'custom',
            position: { x: 96, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-primary-a',
              title: 'Huawei Alternative',
              summary: 'Huawei offers an AI chip alternative.',
              fullText: 'Huawei offers an AI chip alternative.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'rabbit-primary-b',
            type: 'custom',
            position: { x: 528, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-primary-b',
              title: 'Nvidia Controls',
              summary: 'Nvidia export controls create demand for alternatives.',
              fullText: 'Nvidia export controls create demand for alternatives.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'rabbit-support',
            type: 'custom',
            position: { x: 960, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-support',
              title: 'Support Trail',
              summary: 'Supporting trail should not block relationship hover.',
              fullText: 'Supporting trail should not block relationship hover.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'timeline_context',
              rabbitPass: 2,
            },
          },
        ],
        edges: [
          {
            id: 'e-rabbit-primary-a-rabbit-primary-b-HUAWEI_AS_NVIDIA_ALTERNATIVE',
            source: 'rabbit-primary-a',
            target: 'rabbit-primary-b',
            type: 'customEdge',
            data: { generatedBy: 'connectTheDots', tag: 'HUAWEI_AS_NVIDIA_ALTERNATIVE', color: '#ff5b78' },
          },
        ],
      }),
    )

    renderBoard('inv-rabbit-hover')

    await waitFor(() => {
      const edge = ((lastReactFlowProps?.edges || []) as Array<{ data?: { onConnectionHover?: unknown } }>)[0]
      expect(edge?.data?.onConnectionHover).toEqual(expect.any(Function))
    })

    const edge = ((lastReactFlowProps?.edges || []) as Array<{
      id: string
      source: string
      target: string
      data?: { onConnectionHover?: (payload: { source?: string; target?: string; color?: string; active?: boolean }) => void }
    }>)[0]
    expect(edge.source).toBe('rabbit-primary-a')
    expect(edge.target).toBe('rabbit-primary-b')
    expect(edge.data?.onConnectionHover).toEqual(expect.any(Function))

    fireEvent.mouseEnter(screen.getByTestId(`mock-edge-label-${edge.id}`))

    await waitFor(() => {
      const renderedNodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(renderedNodes.find((node) => node.id === 'rabbit-primary-a')?.data?.isConnectionHighlighted).toBe(true)
      expect(screen.getByTestId('mock-node-rabbit-primary-a')).toHaveTextContent('connection highlight')
      expect(screen.getByTestId('mock-node-rabbit-primary-b')).toHaveTextContent('connection highlight')
      expect(screen.getByTestId('mock-node-rabbit-primary-a')).toHaveTextContent(/connection color #[0-9a-f]{6}/i)
      expect(screen.getByTestId('mock-node-rabbit-primary-b')).toHaveTextContent(/connection color #[0-9a-f]{6}/i)
    })
  })

  it('recenters restored Rabbit Hole boards after strict-grid support layout settles', async () => {
    localStorage.setItem(
      'inv_data_inv-rabbit-start',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'rabbit-center-a',
            type: 'custom',
            position: { x: 1800, y: 1200 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-center-a',
              title: 'Rabbit Center A',
              summary: 'Primary restored Rabbit Hole node.',
              fullText: 'Primary restored Rabbit Hole node.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'rabbit-center-b',
            type: 'custom',
            position: { x: 2220, y: 1200 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-center-b',
              title: 'Rabbit Center B',
              summary: 'Connected restored Rabbit Hole node.',
              fullText: 'Connected restored Rabbit Hole node.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'vault_search',
              rabbitPass: 2,
            },
          },
          {
            id: 'rabbit-center-support',
            type: 'custom',
            position: { x: 2640, y: 1200 },
            style: { width: 336, height: 216 },
            data: {
              id: 'rabbit-center-support',
              title: 'Rabbit Center Support',
              summary: 'Unconnected support trail should not leave the viewport parked in empty space.',
              fullText: 'Unconnected support trail should not leave the viewport parked in empty space.',
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'timeline_context',
              rabbitPass: 3,
            },
          },
        ],
        edges: [
          {
            id: 'e-rabbit-center-a-rabbit-center-b-RELATED',
            source: 'rabbit-center-a',
            target: 'rabbit-center-b',
            type: 'customEdge',
            data: { generatedBy: 'connectTheDots', tag: 'RELATED', color: '#8ee8ff' },
          },
        ],
      }),
    )

    renderBoard('inv-rabbit-start')
    const boardFlow = document.getElementById('detective-board-flow')
    expect(boardFlow).toHaveClass('forensic-board-restore-prefit')

    expect(await screen.findByText('Rabbit Center A')).toBeInTheDocument()
    await waitFor(() => {
      expect(fitViewMock).toHaveBeenCalledWith({
        duration: 0,
        padding: 0.16,
        minZoom: 0.72,
        maxZoom: 1,
      })
    })
    await waitFor(() => {
      expect(boardFlow).not.toHaveClass('forensic-board-restore-prefit')
    })
  })

  it('promotes expanded nodes above neighboring cards and restores normal stacking on collapse', async () => {
    localStorage.setItem(
      'inv_data_inv-expand-z',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-front-test-a',
            type: 'custom',
            position: { x: 96, y: 96 },
            style: { width: 336, height: 216 },
            data: {
              id: 'node-front-test-a',
              title: 'Expanded Front Test',
              summary: 'Short visible text',
              fullText: 'Long expanded text '.repeat(80),
              origin: 'rabbit-hole',
              rabbitState: 'promoted',
              rabbitTool: 'web_search',
              rabbitPass: 1,
            },
          },
          {
            id: 'node-front-test-b',
            type: 'custom',
            position: { x: 360, y: 168 },
            style: { width: 336, height: 216 },
            data: {
              id: 'node-front-test-b',
              title: 'Neighbor Card',
              summary: 'A nearby card that should sit behind the expanded node.',
            },
          },
        ],
        edges: [],
      }),
    )

    renderBoard('inv-expand-z')

    await waitFor(() => {
      expect(((lastReactFlowProps?.nodes || []) as Array<{ id: string }>).some((node) => node.id === 'node-front-test-a')).toBe(true)
    })

    const getNode = (id: string) =>
      ((lastReactFlowProps?.nodes || []) as Array<{ id: string; zIndex?: number; data?: { onExpand?: (nodeId: string, expanded: boolean) => void; expanded?: boolean } }>).find((node) => node.id === id)

    const baseZ = getNode('node-front-test-b')?.zIndex || 0

    act(() => {
      getNode('node-front-test-a')?.data?.onExpand?.('node-front-test-a', true)
    })

    await waitFor(() => {
      expect(getNode('node-front-test-a')?.data?.expanded).toBe(true)
      expect(getNode('node-front-test-a')?.zIndex || 0).toBeGreaterThan(baseZ)
    })

    act(() => {
      getNode('node-front-test-a')?.data?.onExpand?.('node-front-test-a', false)
    })

    await waitFor(() => {
      expect(getNode('node-front-test-a')?.data?.expanded).toBe(false)
      expect(getNode('node-front-test-a')?.zIndex).toBe(baseZ)
    })
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

    const tag = await screen.findByText('Hidden Connection')
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

  it('collapses duplicate detective legend labels and keeps raw-looking tags out of view', async () => {
    localStorage.setItem(
      'board_tag_styles',
      JSON.stringify({
        WH_PLEDGE_PRECEDES_DPA: { color: '#bc13fe', pattern: 'solid', shape: 'none' },
        DPA_PRECEDES_NERC_ALERT: { color: '#89f7fe', pattern: 'dashed', shape: 'none' },
        LIN1_IGNITION_2022: { color: '#f6c879', pattern: 'solid', shape: 'none' },
        LIN1_IGNITION_REFERENCE: { color: '#8de0a6', pattern: 'solid', shape: 'none' },
      }),
    )
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [],
        edges: [
          { id: 'edge-1', source: 'a', target: 'b', label: 'WH_PLEDGE_PRECEDES_DPA', data: { generatedBy: 'connectTheDots', tag: 'WH_PLEDGE_PRECEDES_DPA' } },
          { id: 'edge-2', source: 'b', target: 'c', label: 'DPA_PRECEDES_NERC_ALERT', data: { generatedBy: 'connectTheDots', tag: 'DPA_PRECEDES_NERC_ALERT' } },
          { id: 'edge-3', source: 'c', target: 'd', label: 'LIN1_IGNITION_2022', data: { generatedBy: 'connectTheDots', tag: 'LIN1_IGNITION_2022' } },
          { id: 'edge-4', source: 'd', target: 'e', label: 'LIN1_IGNITION_REFERENCE', data: { generatedBy: 'connectTheDots', tag: 'LIN1_IGNITION_REFERENCE' } },
        ],
      }),
    )

    renderBoard()

    await waitFor(() => {
      expect(screen.getAllByText('Timeline Lead')).toHaveLength(1)
    })
    expect(screen.getByText('Trigger Event')).toBeInTheDocument()
    expect(screen.getByText('Evidence Match')).toBeInTheDocument()
    expect(screen.queryByText(/Lin1 Ignition/i)).not.toBeInTheDocument()
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

    await user.click(await screen.findByText('Hidden Connection'))
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

    await user.click(await screen.findByText('Hidden Connection'))
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
    expect(screen.getByTestId('board-navigator')).toBeInTheDocument()
    expect(screen.getByTestId('minimap-panel')).toBeInTheDocument()
    expect(screen.getByTestId('board-utility-rail')).toBeInTheDocument()
    expect(screen.getByText('RELATIONSHIPS')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /board controls/i })).toBeInTheDocument()
  })

  it('colors Rabbit Hole supporting evidence differently in the minimap', () => {
    const normalColor = getMiniMapNodeColor({
      id: 'normal-node',
      position: { x: 0, y: 0 },
      data: { title: 'Normal', summary: 'Normal evidence' },
    })
    const supportColor = getMiniMapNodeColor({
      id: 'rabbit-support',
      position: { x: 0, y: 0 },
      data: {
        title: 'Support',
        origin: 'rabbit-hole',
        evidenceRole: 'supporting',
        supportCluster: 'web',
      },
    })

    expect(normalColor).toBe('#00f3ff')
    expect(supportColor).toBe('#ff5b78')
    expect(supportColor).not.toBe(normalColor)
  })

  it('lets the append-search field use spare toolbar width without collapsing controls', () => {
    renderBoard()

    expect(screen.getByTestId('board-action-bar')).toHaveClass('w-full', 'max-w-full')
    expect(screen.getByTestId('board-action-bar')).toHaveClass('flex-wrap')
    expect(screen.getByTestId('board-action-bar').className).not.toContain('overflow-x-auto')
    expect(screen.getByTestId('board-search-cluster')).toHaveClass('min-w-[18rem]', 'max-w-[30rem]')
    expect(screen.getByTestId('board-search-cluster').className).toContain('flex-[1_1_20rem]')
    expect(screen.getByTestId('append-search-shell')).toHaveClass('min-w-0', 'w-full')
    expect(screen.getByTestId('append-search-shell').className).not.toContain('flex-[1_1_22rem]')
    expect(screen.getByTestId('append-search-shell').className).not.toContain('w-[clamp(24rem,34vw,42rem)]')
    expect(screen.getByTestId('append-search-shell').className).not.toContain('md:max-w-[27rem]')
  })

  it('keeps board controls inside the board viewport with an internal scroll area', async () => {
    const user = userEvent.setup()
    renderBoard()

    const boardRoot = document.getElementById('detective-board-container')
    const actionBar = screen.getByTestId('board-action-bar')
    const boardControlsButton = screen.getByRole('button', { name: /board controls/i })
    expect(boardRoot).not.toBeNull()

    vi.spyOn(boardRoot!, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 1280,
      height: 720,
      right: 1280,
      bottom: 720,
      toJSON: () => ({}),
    })
    vi.spyOn(actionBar, 'getBoundingClientRect').mockReturnValue({
      x: 288,
      top: 20,
      y: 20,
      left: 288,
      width: 968,
      height: 56,
      right: 1256,
      bottom: 76,
      toJSON: () => ({}),
    })

    await user.click(boardControlsButton)

    const overlay = screen.getByTestId('board-controls-overlay')
    expect(overlay).toHaveStyle({ top: '88px', right: '0px', width: '416px', maxHeight: '616px' })
    expect(screen.getByTestId('board-toolbar-shell')).toHaveClass('z-[70]')
    expect(overlay).toHaveClass('z-[80]', 'flex', 'overflow-hidden')
    expect(screen.getByTestId('board-controls-scroll')).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  })

  it('renders a clean custom navigator without React Flow minimap artifacts', async () => {
    seedExportableBoard()
    renderBoard()

    const navigator = screen.getByTestId('board-navigator')
    expect(navigator).toHaveClass('forensic-board-navigator')
    expect(document.querySelector('.react-flow__minimap')).not.toBeInTheDocument()
    expect(document.querySelector('.react-flow__minimap-mask')).not.toBeInTheDocument()
    expect(navigator.querySelector('filter')).not.toBeInTheDocument()
    expect(navigator.querySelector('[style*="filter"]')).not.toBeInTheDocument()
    expect(await screen.findAllByTestId('board-navigator-node')).toHaveLength(1)
  })

  it('does not render the default React Flow controls', () => {
    renderBoard()

    expect(screen.queryByTestId('reactflow-controls')).not.toBeInTheDocument()
  })

  it('passes React Flow pro options to hide attribution', () => {
    renderBoard()

    expect(lastReactFlowProps?.proOptions).toEqual({ hideAttribution: true })
  })

  it('allows the detective board to zoom out farther for large investigations', () => {
    renderBoard()

    expect(lastReactFlowProps?.minZoom).toBe(0.5)
    expect(lastReactFlowProps?.fitViewOptions).toMatchObject({
      minZoom: 0.72,
      maxZoom: 1,
    })
  })

  it('keeps React Flow snap disabled so resize gestures use raw pointer movement', async () => {
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          { id: 'node-a', type: 'custom', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 336, height: 240 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1')

    await waitFor(() => {
      expect(((lastReactFlowProps?.nodes || []) as Array<{ id: string }>).some((node) => node.id === 'node-a')).toBe(true)
    })
    expect(lastReactFlowProps?.snapToGrid).toBe(false)
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

    const minimap = screen.getByTestId('board-navigator')
    const minimapPanel = screen.getByTestId('minimap-panel')
    expect(minimapPanel).toHaveStyle({ width: '244px', height: '220px', left: '24px', top: '16px' })
    expect(minimap).toHaveStyle({ width: '212px', height: '116px' })
    expect(screen.getByRole('button', { name: /enlarge minimap/i })).toHaveClass('h-8', 'w-8', 'shrink-0', 'overflow-visible')

    await user.click(screen.getByRole('button', { name: /enlarge minimap/i }))
    expect(minimapPanel).toHaveStyle({ width: '320px', height: '280px', left: '24px', top: '16px' })
    expect(minimap).toHaveStyle({ width: '288px', height: '176px' })
    expect(screen.getByRole('button', { name: /shrink minimap/i })).toHaveClass('h-8', 'w-8', 'shrink-0', 'overflow-visible')

    await user.click(screen.getByRole('button', { name: /shrink minimap/i }))
    expect(minimapPanel).toHaveStyle({ width: '244px', height: '220px', left: '24px', top: '16px' })
    expect(minimap).toHaveStyle({ width: '212px', height: '116px' })
  })

  it('recenters the board when the custom navigator is clicked without changing board zoom', () => {
    renderBoard()

    const navigator = screen.getByTestId('board-navigator')
    vi.spyOn(navigator, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 212,
      height: 116,
      right: 212,
      bottom: 116,
      toJSON: () => ({}),
    })

    fireEvent.click(navigator, { clientX: 106, clientY: 58 })

    expect(setCenterMock).toHaveBeenCalledWith(640, 360, {
      zoom: 0.82,
      duration: 620,
    })
  })

  it('pans from custom navigator drag without animated viewport transitions', () => {
    renderBoard()

    const navigator = screen.getByTestId('board-navigator')
    vi.spyOn(navigator, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 212,
      height: 116,
      right: 212,
      bottom: 116,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(navigator, { clientX: 20, clientY: 20, pointerId: 7 })
    fireEvent.pointerMove(navigator, { clientX: 106, clientY: 58, pointerId: 7 })
    fireEvent.pointerUp(navigator, { clientX: 106, clientY: 58, pointerId: 7 })

    expect(setCenterMock).toHaveBeenLastCalledWith(640, 360, {
      zoom: 0.82,
      duration: 0,
    })
  })

  it('shows board camera movement feedback during a minimap glide', () => {
    vi.useFakeTimers()

    try {
      renderBoard()

      const boardRoot = document.getElementById('detective-board-container')
      expect(boardRoot).not.toHaveClass('forensic-board-camera-moving')
      expect(screen.getByText('0 nodes')).toBeInTheDocument()

      fireEvent.click(screen.getByTestId('board-navigator'))

      expect(boardRoot).toHaveClass('forensic-board-camera-moving')
      expect(screen.getByText('Moving')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(760)
      })

      expect(boardRoot).not.toHaveClass('forensic-board-camera-moving')
      expect(screen.getByText('0 nodes')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('adds idle grid motion only for an empty idle board', async () => {
    const { unmount } = renderBoard()

    expect(document.getElementById('detective-board-container')).toHaveClass('forensic-board-empty-idle')
    unmount()

    localStorage.setItem(
      'inv_data_investigation-2',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          { id: 'node-a', type: 'custom', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-2')

    await waitFor(() => {
      expect(document.getElementById('detective-board-container')).not.toHaveClass('forensic-board-empty-idle')
    })
  })

  it('does not idle-animate the empty board while gathering', () => {
    const socket = new MockSocket()
    renderBoard('investigation-1', socket as unknown as WebSocket)

    act(() => {
      socket.emit('BRAIN_STATE', 'Gathering Intel...')
    })

    expect(document.getElementById('detective-board-container')).not.toHaveClass('forensic-board-empty-idle')
  })

  it('keeps the gathering status out of the toolbar flow', () => {
    const socket = new MockSocket()
    renderBoard('investigation-1', socket as unknown as WebSocket)

    act(() => {
      socket.emit('BRAIN_STATE', 'Gathering Intel...')
    })

    const busyPill = screen.getByText(/Gathering Intel/i).closest('.forensic-busy-pill')

    expect(busyPill?.parentElement).toHaveClass('absolute', 'top-full', 'pointer-events-none')
    expect(screen.getByTestId('board-toolbar-shell')).toContainElement(screen.getByTestId('board-action-bar'))
  })

  it('uses static board navigation when reduced motion is preferred', () => {
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

    renderBoard()

    const navigator = screen.getByTestId('board-navigator')
    vi.spyOn(navigator, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 212,
      height: 116,
      right: 212,
      bottom: 116,
      toJSON: () => ({}),
    })

    fireEvent.click(navigator, { clientX: 106, clientY: 58 })

    expect(setCenterMock).toHaveBeenCalledWith(640, 360, {
      zoom: 0.82,
      duration: 0,
    })
    expect(document.getElementById('detective-board-container')).not.toHaveClass('forensic-board-camera-moving')
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
      duration: 900,
      padding: 0.16,
      minZoom: 0.72,
      maxZoom: 1,
    })

    window.removeEventListener(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT, discoveryListener as EventListener)
    window.removeEventListener(BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT, synthesisListener as EventListener)
  })

  it('enables QA tools from board controls and replays the animation demo from the utility rail', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      expect(screen.queryByRole('button', { name: /replay board animation demo/i })).not.toBeInTheDocument()

      enableQaTools()

      expect(screen.getByRole('button', { name: /open qa replay menu/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /replay board animation demo/i })).not.toBeInTheDocument()
      expect(localStorage.getItem('detective_board_qa_tools_enabled')).toBeNull()

      openQaReplayMenu()
      expect(screen.getByTestId('board-utility-rail')).toHaveClass('z-[90]')
      expect(screen.getByTestId('board-qa-menu')).toHaveClass('max-h-[min(28rem,calc(100vh-8rem))]', 'overflow-y-auto')
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay discovery demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay synthesis demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay spider telemetry demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay pipeline demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay local ingestion demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay error\/empty demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay timeline demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay evidence expansion demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay duplicate evidence squash demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay text fit demo/i })).toBeInTheDocument()
      expect(within(screen.getByTestId('board-qa-menu')).getByRole('button', { name: /replay gathering status demo/i })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /replay board animation demo/i }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2400)
      })

      const nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
        'qa-animation-grid-load',
        'qa-animation-thermal-cooling',
        'imported-qa-animation-brief',
        'qa-animation-capacity-auction',
        'qa-animation-demand-response',
        'qa-animation-backup-dispatch',
        'qa-animation-interconnection-queue',
        'qa-animation-transformer-order',
        'qa-animation-water-permit',
        'qa-animation-community-hearing',
      ]))
      expect(nodes).toHaveLength(10)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1800)
      })

      const edges = (lastReactFlowProps?.edges || []) as Array<{ label?: string; data?: Record<string, unknown> }>
      expect(edges.map((edge) => edge.label)).toEqual(expect.arrayContaining([
        'Pressure Point',
        'Policy Trigger',
        'Money Trail',
        'Operator Response',
        'Resilience Gap',
        'Timeline Lead',
        'Supply Chain',
        'Operational Constraint',
      ]))
      expect(edges.map((edge) => edge.data?.tag)).toEqual(expect.arrayContaining([
        'INFRASTRUCTURE_STRESS',
        'REGULATORY_SIGNAL',
        'MARKET_PRESSURE',
        'DEMAND_RESPONSE',
        'RESILIENCE_GAP',
        'INTERCONNECTION_DELAY',
        'SUPPLY_CHAIN',
        'WATER_CONSTRAINT',
        'PUBLIC_PRESSURE',
      ]))
      expect(edges.every((edge) => edge.data?.isConnectionRevealing === true)).toBe(true)
      expect(socket.sentMessages).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('replays the gathering status QA demo without moving the toolbar flow or calling the backend', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay gathering status demo/i }))

      const busyPill = screen.getByText(/Gathering Intel/i).closest('.forensic-busy-pill')

      expect(busyPill?.parentElement).toHaveClass('absolute', 'top-full', 'pointer-events-none')
      expect(screen.queryByTestId('board-qa-menu')).not.toBeInTheDocument()
      expect(socket.sentMessages).toEqual([])

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5200)
      })

      expect(screen.queryByText(/Gathering Intel/i)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('replays the duplicate evidence squash QA demo as one merged card without duplicate edges', () => {
    renderBoard('investigation-1', new MockSocket() as unknown as WebSocket)

    enableQaTools()
    openQaReplayMenu()
    fireEvent.click(screen.getByRole('button', { name: /replay duplicate evidence squash demo/i }))

    const nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
    expect(nodes).toHaveLength(3)
    const mergedNode = nodes.find((node) => node.id === 'qa-duplicate-squashed-evidence')
    expect(mergedNode?.data?.title).toBe('QA Squashed Duplicate Evidence')
    expect(mergedNode?.data?.evidenceCount).toBe(3)
    expect(mergedNode?.data?.duplicateNodeIds).toEqual(['qa-duplicate-source-a', 'qa-duplicate-source-b'])
    expect(screen.getByText('merged evidence 3')).toBeInTheDocument()

    const edges = (lastReactFlowProps?.edges || []) as Array<{ data?: Record<string, unknown> }>
    expect(edges.map((edge) => edge.data?.tag)).not.toEqual(expect.arrayContaining([
      'DUPLICATE_CONTENT',
      'IDENTICAL_EXCERPT',
    ]))
  })

  it('replays the text fit QA demo with already fitted eight-line collapsed cards', () => {
    renderBoard('investigation-1', new MockSocket() as unknown as WebSocket)

    enableQaTools()
    openQaReplayMenu()
    fireEvent.click(screen.getByRole('button', { name: /replay text fit demo/i }))

    const nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown>; style?: Record<string, unknown> }>
    const textFitNodes = nodes.filter((node) => String(node.id || '').startsWith('qa-text-fit-'))
    const legacyLineCounts = textFitNodes.map((node) => {
        const width = Number(node.data?.legacyWidth || 336)
        const usableCharsPerLine = Math.max(28, Math.floor((width - 72) / 6.8))
        return Math.ceil(String(node.data?.summary || '').length / usableCharsPerLine)
      })

    expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'qa-text-fit-sentiment',
      'qa-text-fit-milestones',
      'qa-text-fit-chip-density',
    ]))
    expect(textFitNodes.every((node) => Number(node.data?.legacyWidth || 0) <= 384)).toBe(true)
    expect(textFitNodes.every((node) => Number(node.style?.width || 0) > Number(node.data?.legacyWidth || 0))).toBe(true)
    expect(textFitNodes.every((node) => typeof node.data?.onResizeCommit === 'function')).toBe(true)
    expect(legacyLineCounts.every((lineCount) => lineCount >= 8)).toBe(true)
    expect(screen.getAllByText(/line seven and line eight pressure/i)).toHaveLength(3)
  })

  it('replays the error and empty state demo from the QA utility rail without backend socket messages', async () => {
    const socket = new MockSocket()
    const errorEmptyListener = vi.fn()
    window.addEventListener(BROWSER_QA_ERROR_EMPTY_DEMO_EVENT, errorEmptyListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay error\/empty demo/i }))

      expect(errorEmptyListener).toHaveBeenCalledTimes(1)
      expect((errorEmptyListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: expect.stringMatching(/^qa-error-empty-/),
        requestId: expect.stringMatching(/^qa-error-empty-/),
      }))
      expect(socket.sentMessages).toEqual([])
    } finally {
      window.removeEventListener(BROWSER_QA_ERROR_EMPTY_DEMO_EVENT, errorEmptyListener as EventListener)
    }
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
    expect(within(theoryButton).getByTestId('theory-utility-notification')).toHaveClass('forensic-utility-notification-dot-unread')
    expect(discoveryButton).toHaveClass('forensic-utility-button-discovery-complete')
    expect(within(discoveryButton).getByTestId('discovery-utility-notification')).toHaveClass('forensic-utility-notification-dot-unread')
  })

  it('replays the synthesis demo from the QA utility rail without backend socket messages', () => {
    const socket = new MockSocket()
    const synthesisDemoListener = vi.fn()
    window.addEventListener(BROWSER_QA_SYNTHESIS_DEMO_EVENT, synthesisDemoListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay synthesis demo/i }))

      expect(synthesisDemoListener).toHaveBeenCalledTimes(1)
      expect((synthesisDemoListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: 'investigation-1',
        requestId: expect.any(String),
      }))
      expect(socket.sentMessages).toEqual([])
    } finally {
      window.removeEventListener(BROWSER_QA_SYNTHESIS_DEMO_EVENT, synthesisDemoListener as EventListener)
    }
  })

  it('replays the spider telemetry demo from the QA utility rail without backend socket messages', () => {
    const socket = new MockSocket()
    const spiderTelemetryDemoListener = vi.fn()
    window.addEventListener(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, spiderTelemetryDemoListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay spider telemetry demo/i }))

      expect(spiderTelemetryDemoListener).toHaveBeenCalledTimes(1)
      expect((spiderTelemetryDemoListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: 'investigation-1',
        requestId: expect.any(String),
      }))
      expect(socket.sentMessages).toEqual([])
    } finally {
      window.removeEventListener(BROWSER_QA_SPIDER_TELEMETRY_DEMO_EVENT, spiderTelemetryDemoListener as EventListener)
    }
  })

  it('replays the pipeline monitor demo from the QA utility rail without backend socket messages', () => {
    const socket = new MockSocket()
    const pipelineDemoListener = vi.fn()
    window.addEventListener(BROWSER_QA_PIPELINE_DEMO_EVENT, pipelineDemoListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay pipeline demo/i }))

      expect(pipelineDemoListener).toHaveBeenCalledTimes(1)
      expect((pipelineDemoListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: 'investigation-1',
        requestId: expect.any(String),
      }))
      expect(socket.sentMessages).toEqual([])
    } finally {
      window.removeEventListener(BROWSER_QA_PIPELINE_DEMO_EVENT, pipelineDemoListener as EventListener)
    }
  })

  it('replays the timeline demo from the QA utility rail without backend socket messages', () => {
    const socket = new MockSocket()
    const timelineDemoListener = vi.fn()
    window.addEventListener(BROWSER_QA_TIMELINE_DEMO_EVENT, timelineDemoListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay timeline demo/i }))

      expect(timelineDemoListener).toHaveBeenCalledTimes(1)
      expect((timelineDemoListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: 'investigation-1',
        requestId: expect.any(String),
      }))
      expect(socket.sentMessages).toEqual([])
    } finally {
      window.removeEventListener(BROWSER_QA_TIMELINE_DEMO_EVENT, timelineDemoListener as EventListener)
    }
  })

  it('keeps QA tools off by default even if an old saved flag exists', () => {
    localStorage.setItem('detective_board_qa_tools_enabled', 'true')

    renderBoard('investigation-1', new MockSocket() as unknown as WebSocket)

    expect(screen.queryByRole('button', { name: /replay board animation demo/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /board controls/i }))
    expect(screen.getByRole('button', { name: /enable qa tools/i })).toHaveAttribute('aria-pressed', 'false')
    expect(localStorage.getItem('detective_board_qa_tools_enabled')).toBeNull()
  })

  it('replays the discovery demo from the QA utility rail without backend socket messages', async () => {
    const socket = new MockSocket()
    const discoveryDemoListener = vi.fn()
    window.addEventListener(BROWSER_QA_DISCOVERY_DEMO_EVENT, discoveryDemoListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay discovery demo/i }))

      expect(discoveryDemoListener).toHaveBeenCalledTimes(1)
      expect((discoveryDemoListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: 'investigation-1',
        requestId: expect.any(String),
      }))
      expect(socket.sentMessages).toEqual([])
    } finally {
      window.removeEventListener(BROWSER_QA_DISCOVERY_DEMO_EVENT, discoveryDemoListener as EventListener)
    }
  })

  it('replays the evidence expansion demo from the QA utility rail without backend socket messages or persistence', async () => {
    const socket = new MockSocket()
    const evidenceDemoListener = vi.fn()
    window.addEventListener(BROWSER_QA_EVIDENCE_EXPANSION_DEMO_EVENT, evidenceDemoListener as EventListener)

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      enableQaTools()
      openQaReplayMenu()
      fireEvent.click(screen.getByRole('button', { name: /replay evidence expansion demo/i }))

      expect(evidenceDemoListener).toHaveBeenCalledTimes(1)
      expect((evidenceDemoListener.mock.calls[0][0] as CustomEvent).detail).toEqual(expect.objectContaining({
        investigationId: 'investigation-1',
        requestId: expect.any(String),
      }))
      expect(socket.sentMessages).toEqual([])

      const demoNodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(demoNodes.some((node) => node.id === 'qa-evidence-expansion-node')).toBe(true)
      expect(demoNodes.find((node) => node.id === 'qa-evidence-expansion-node')?.data).toEqual(expect.objectContaining({
        expanded: true,
        sourceURL: 'https://example.com/qa-evidence-expansion',
      }))
      expect(localStorage.getItem('inv_data_investigation-1')).toBeNull()
    } finally {
      window.removeEventListener(BROWSER_QA_EVIDENCE_EXPANSION_DEMO_EVENT, evidenceDemoListener as EventListener)
    }
  })

  it('does not pulse the discovery utility dot after discoveries are read', () => {
    renderBoard('investigation-1', null, {
      hasDiscoveryReady: true,
      hasUnreadDiscoveries: false,
    })

    const discoveryButton = screen.getByRole('button', { name: /discoveries ready/i })

    expect(within(discoveryButton).queryByTestId('discovery-utility-notification')).not.toBeInTheDocument()
  })

  it('applies a transient timeline focus pulse when timeline navigation targets a board node', async () => {
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-a',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: { title: 'Timeline source node', summary: 'Matched from the chronology.' },
            style: { width: 320, height: 180 },
          },
        ],
        edges: [],
      }),
    )
    const baseProps = {
      investigationId: 'investigation-1',
      sharedSocket: null,
      onDeepDiveNode: vi.fn(),
      onNavigateToChild: vi.fn(),
    }
    const view = render(<DetectiveBoard {...baseProps} focusNodeId={null} />)

    expect(await screen.findByText('Timeline source node')).toBeInTheDocument()

    vi.useFakeTimers()
    try {
      view.rerender(<DetectiveBoard {...baseProps} focusNodeId="node-a" />)

      expect(fitViewMock).toHaveBeenCalled()
      expect(screen.getByText('timeline focus')).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1400)
      })

      expect(screen.queryByText('timeline focus')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
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

  it('marks only newly accepted connect-the-dots edges for reveal animation', async () => {
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

    await waitFor(() => {
      const edges = (lastReactFlowProps?.edges || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(edges.find((edge) => edge.id === 'e-node-a-node-b-RELATED')?.data?.isConnectionRevealing).toBeFalsy()
    })

    socket.emit('CONNECTIONS_FOUND', [
      {
        source: 'node-b',
        target: 'node-c',
        tag: 'RELATED',
        reasoning: 'Newly found line',
      },
    ])

    await waitFor(() => {
      const edges = (lastReactFlowProps?.edges || []) as Array<{ id: string; data?: Record<string, unknown> }>
      const newEdge = edges.find((edge) => edge.id === 'e-node-b-node-c-RELATED')
      expect(newEdge?.data?.isConnectionRevealing).toBe(true)
      expect(newEdge?.data?.onConnectionHover).toEqual(expect.any(Function))
    })
  })

  it('starts layout choreography when manual Connect the Dots is dispatched', async () => {
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 0, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 0, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1', socket as unknown as WebSocket)

    fireEvent.click(screen.getByRole('button', { name: /connect the dots/i }))

    const analyzingButton = screen.getByRole('button', { name: /analyzing patterns/i })
    expect(analyzingButton).toHaveClass('forensic-connect-button-scanning')

    expect(JSON.parse(socket.sentMessages[0])).toMatchObject({
      type: 'CONNECT_DOTS',
      vaultId: 'investigation-1',
    })

    const nodes = (lastReactFlowProps?.nodes || []) as Array<{
      id: string
      className?: string
      data?: Record<string, unknown>
      position?: { x: number; y: number }
    }>
    expect(nodes).toHaveLength(3)
    expect(nodes.every((node) => node.className?.includes('forensic-react-flow-node-moving'))).toBe(true)
    expect(nodes.every((node) => node.data?.isLayoutChoreographyActive === true)).toBe(true)
    expect(new Set(nodes.map((node) => `${node.position?.x},${node.position?.y}`)).size).toBeGreaterThan(1)
  })

  it('waits for card layout to settle before revealing returned connect-the-dots edges', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 0, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 0, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      fireEvent.click(screen.getByRole('button', { name: /connect the dots/i }))

      act(() => {
        socket.emit('CONNECTIONS_FOUND', [
          {
            source: 'node-a',
            target: 'node-b',
            tag: 'RELATED',
            reasoning: 'New line',
          },
        ])
      })

      expect((lastReactFlowProps?.edges || []) as Array<unknown>).toEqual([])
      expect(((lastReactFlowProps?.nodes || []) as Array<{ data?: Record<string, unknown> }>).some((node) => node.data?.isLayoutChoreographyActive)).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(849)
      })
      expect((lastReactFlowProps?.edges || []) as Array<unknown>).toEqual([])

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })

      const edges = (lastReactFlowProps?.edges || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(edges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'e-node-a-node-b-RELATED',
          data: expect.objectContaining({
            isConnectionRevealing: true,
            routeSourcePoint: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
            routeTargetPoint: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
          }),
        }),
      ]))
      expect(((lastReactFlowProps?.nodes || []) as Array<{ data?: Record<string, unknown> }>).some((node) => node.data?.isLayoutChoreographyActive)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves existing incremental edges while delaying only newly returned edges', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        pendingIntegrationNodeIds: ['node-c'],
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 320, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
          { id: 'node-c', position: { x: 640, y: 0 }, data: { title: 'C', summary: 'C', fullText: 'C' }, style: { width: 320, height: 180 } },
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

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      fireEvent.click(screen.getByRole('button', { name: /integrate new evidence/i }))
      act(() => {
        socket.emit('CONNECTIONS_FOUND', [
          {
            source: 'node-b',
            target: 'node-c',
            tag: 'RELATED',
            reasoning: 'New incremental line',
          },
        ])
      })

      let edges = (lastReactFlowProps?.edges || []) as Array<{ id: string }>
      expect(edges.map((edge) => edge.id)).toEqual(['e-node-a-node-b-RELATED'])

      await act(async () => {
        await vi.advanceTimersByTimeAsync(900)
      })

      edges = (lastReactFlowProps?.edges || []) as Array<{ id: string }>
      expect(edges.map((edge) => edge.id)).toEqual(expect.arrayContaining([
        'e-node-a-node-b-RELATED',
        'e-node-b-node-c-RELATED',
      ]))
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears layout choreography when connect-the-dots analysis errors', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    vi.spyOn(window, 'alert').mockImplementation(() => {})

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          { id: 'node-a', position: { x: 0, y: 0 }, data: { title: 'A', summary: 'A', fullText: 'A' }, style: { width: 320, height: 180 } },
          { id: 'node-b', position: { x: 0, y: 0 }, data: { title: 'B', summary: 'B', fullText: 'B' }, style: { width: 320, height: 180 } },
        ],
        edges: [],
      }),
    )

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      fireEvent.click(screen.getByRole('button', { name: /connect the dots/i }))
      expect(((lastReactFlowProps?.nodes || []) as Array<{ data?: Record<string, unknown> }>).some((node) => node.data?.isLayoutChoreographyActive)).toBe(true)

      act(() => {
        socket.emit('ERROR', 'analysis failed')
      })

      expect(((lastReactFlowProps?.nodes || []) as Array<{ data?: Record<string, unknown> }>).some((node) => node.data?.isLayoutChoreographyActive)).toBe(false)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1200)
      })
      expect((lastReactFlowProps?.edges || []) as Array<unknown>).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('strips transient connection animation state before persisting board data', async () => {
    vi.useFakeTimers()

    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'legacy',
        nodes: [
          {
            id: 'node-a',
            position: { x: 0, y: 0 },
            className: 'forensic-react-flow-node-moving',
            data: {
              title: 'A',
              summary: 'A',
              fullText: 'A',
              isConnectionHighlighted: true,
              connectionHighlightColor: '#ff5500',
              isLayoutChoreographyActive: true,
              layoutChoreographyStartedAt: 123,
            },
            style: { width: 320, height: 180 },
          },
          {
            id: 'node-b',
            position: { x: 200, y: 0 },
            data: { title: 'B', summary: 'B', fullText: 'B' },
            style: { width: 320, height: 180 },
          },
        ],
        edges: [
          {
            id: 'e-node-a-node-b-RELATED',
            source: 'node-a',
            target: 'node-b',
            label: 'RELATED',
            data: {
              generatedBy: 'connectTheDots',
              reasoning: 'Existing line',
              isConnectionRevealing: true,
              connectionRevealStartedAt: 123,
              onConnectionHover: 'not persisted',
            },
          },
        ],
      }),
    )

    try {
      renderBoard('investigation-1', new MockSocket() as unknown as WebSocket)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.nodes[0]).not.toHaveProperty('className')
      expect(persisted.nodes[0].data).not.toHaveProperty('isConnectionHighlighted')
      expect(persisted.nodes[0].data).not.toHaveProperty('connectionHighlightColor')
      expect(persisted.nodes[0].data).not.toHaveProperty('isLayoutChoreographyActive')
      expect(persisted.nodes[0].data).not.toHaveProperty('layoutChoreographyStartedAt')
      expect(persisted.edges[0].data).not.toHaveProperty('isConnectionRevealing')
      expect(persisted.edges[0].data).not.toHaveProperty('connectionRevealStartedAt')
      expect(persisted.edges[0].data).not.toHaveProperty('onConnectionHover')
    } finally {
      vi.useRealTimers()
    }
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

  it('marks live gathered evidence with staggered entry metadata and strips it before persistence', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      act(() => {
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: {
            id: 'node-entry-a',
            title: 'Entry A',
            summary: 'Entry summary A',
            fullText: 'Entry summary A',
          },
        })
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: {
            id: 'node-entry-b',
            title: 'Entry B',
            summary: 'Entry summary B',
            fullText: 'Entry summary B',
          },
        })
      })

      const nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(nodes.find((node) => node.id === 'node-entry-a')?.data).toEqual(expect.objectContaining({
        nodeEntryAnimation: 'evidence',
        nodeEntryDelayMs: 0,
      }))
      expect(nodes.find((node) => node.id === 'node-entry-b')?.data).toEqual(expect.objectContaining({
        nodeEntryAnimation: 'evidence',
        nodeEntryDelayMs: 120,
      }))
      expect(nodes.find((node) => node.id === 'node-entry-a')?.position).not.toEqual(
        nodes.find((node) => node.id === 'node-entry-b')?.position,
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      const persisted = JSON.parse(localStorage.getItem('inv_data_investigation-1') || '{}')
      expect(persisted.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'node-entry-a',
            data: expect.not.objectContaining({
              nodeEntryAnimation: expect.anything(),
              nodeEntryDelayMs: expect.anything(),
              nodeEntryStartedAt: expect.anything(),
            }),
          }),
        ]),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replay stale entry or scan metadata from persisted boards', async () => {
    localStorage.setItem(
      'inv_data_investigation-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-saved-a',
            type: 'custom',
            position: { x: 96, y: 96 },
            style: { width: 336, height: 220 },
            data: {
              title: 'Saved A',
              summary: 'Saved summary',
              fullText: 'Saved summary',
              nodeEntryAnimation: 'evidence',
              nodeEntryDelayMs: 120,
              isPersonaScanActive: true,
            },
          },
        ],
        edges: [],
      }),
    )

    renderBoard('investigation-1')

    await waitFor(() => {
      const nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      const restored = nodes.find((node) => node.id === 'node-saved-a')
      expect(restored?.data).not.toEqual(expect.objectContaining({
        nodeEntryAnimation: expect.anything(),
        isPersonaScanActive: expect.anything(),
      }))
      expect(typeof restored?.data?.onResizeCommit).toBe('function')
    })
  })

  it('runs a temporary scan glow only on nodes that receive persona insights', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      act(() => {
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: { id: 'node-scan-a', title: 'Scan A', summary: 'A', fullText: 'A' },
        })
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'investigation-1',
          node: { id: 'node-scan-b', title: 'Scan B', summary: 'B', fullText: 'B' },
        })
        socket.emit('PERSONA_INSIGHTS', [
          {
            personaName: 'Discovery',
            perspective: 'Finds hidden patterns',
            keyFindings: ['Pattern found'],
            connections: [],
            questions: [],
            confidence: 0.8,
            fullAnalysis: 'Pattern found',
            nodeIDs: ['node-scan-a'],
          },
        ])
      })

      let nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(nodes.find((node) => node.id === 'node-scan-a')?.data).toEqual(expect.objectContaining({
        isPersonaScanActive: true,
      }))
      expect(nodes.find((node) => node.id === 'node-scan-b')?.data).not.toEqual(expect.objectContaining({
        isPersonaScanActive: true,
      }))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2200)
      })

      nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(nodes.find((node) => node.id === 'node-scan-a')?.data).not.toEqual(expect.objectContaining({
        isPersonaScanActive: true,
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('plays the browser QA animation demo without sending backend socket messages', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      act(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_ANIMATION_DEMO_EVENT, {
          detail: { investigationId: 'investigation-1' },
        }))
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2400)
      })

      let nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>
      expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
        'qa-animation-grid-load',
        'qa-animation-thermal-cooling',
        'imported-qa-animation-brief',
        'qa-animation-capacity-auction',
        'qa-animation-demand-response',
        'qa-animation-backup-dispatch',
        'qa-animation-interconnection-queue',
        'qa-animation-transformer-order',
        'qa-animation-water-permit',
        'qa-animation-community-hearing',
      ]))
      expect(nodes).toHaveLength(10)
      const stagedPositions = new Map(nodes.map((node) => [node.id, `${node.position?.x},${node.position?.y}`]))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(430)
      })

      nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>
      const movedNodeCount = nodes.filter((node) => stagedPositions.get(node.id) !== `${node.position?.x},${node.position?.y}`).length
      expect(movedNodeCount).toBeGreaterThanOrEqual(3)
      expect(nodes.some((node) => node.data?.nodeEntryAnimation)).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1400)
      })

      const edges = (lastReactFlowProps?.edges || []) as Array<{ label?: string; data?: Record<string, unknown> }>
      expect(edges.map((edge) => edge.label)).toEqual(expect.arrayContaining([
        'Pressure Point',
        'Policy Trigger',
        'Money Trail',
        'Operator Response',
        'Resilience Gap',
        'Timeline Lead',
        'Supply Chain',
        'Operational Constraint',
      ]))
      expect(edges.map((edge) => edge.data?.tag)).toEqual(expect.arrayContaining([
        'INFRASTRUCTURE_STRESS',
        'REGULATORY_SIGNAL',
        'MARKET_PRESSURE',
        'DEMAND_RESPONSE',
        'RESILIENCE_GAP',
        'INTERCONNECTION_DELAY',
        'SUPPLY_CHAIN',
        'WATER_CONSTRAINT',
        'PUBLIC_PRESSURE',
      ]))
      expect(edges.every((edge) => edge.data?.isConnectionRevealing === true)).toBe(true)
      expect(socket.sentMessages).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('plays the Rabbit Hole trail QA demo with live promotion and no backend messages', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      renderBoard('investigation-1', socket as unknown as WebSocket)

      act(() => {
        window.dispatchEvent(new CustomEvent(BROWSER_QA_RABBIT_HOLE_DEMO_EVENT, {
          detail: { investigationId: 'investigation-1', requestId: 'qa-rabbit-test' },
        }))
      })

      let nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
        'qa-rabbit-web-descent',
        'qa-rabbit-vault-echo',
        'qa-rabbit-timeline-rift',
      ]))
      expect(nodes.every((node) => node.data?.origin === 'rabbit-hole')).toBe(true)
      expect(nodes.every((node) => node.data?.rabbitState === 'provisional')).toBe(true)
      expect(nodes.map((node) => node.data?.rabbitTool)).toEqual(expect.arrayContaining([
        'web_search',
        'vault_search',
        'timeline_context',
      ]))
      expect(screen.getAllByText('rabbit provisional')).toHaveLength(3)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500)
      })

      nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string; data?: Record<string, unknown> }>
      expect(nodes.every((node) => node.data?.rabbitState === 'promoted')).toBe(true)
      expect(screen.getAllByText('rabbit promoted')).toHaveLength(3)
      const edges = (lastReactFlowProps?.edges || []) as Array<{ label?: string; data?: Record<string, unknown> }>
      expect(edges.map((edge) => edge.label)).toEqual(expect.arrayContaining([
        'Hidden Connection',
        'Timeline Lead',
      ]))
      expect(edges.every((edge) => edge.data?.generatedBy === 'qaRabbitHole')).toBe(true)
      expect(socket.sentMessages).toEqual([])
    } finally {
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

  it('shows detective display labels while preserving generated relationship tags', async () => {
    const socket = new MockSocket()
    renderBoard('investigation-display-tags', socket as unknown as WebSocket)

    act(() => {
      socket.emit('MEMORY_NODE_GATHERED', {
        append: false,
        vaultId: 'investigation-display-tags',
        node: {
          id: 'node-power',
          title: 'Power demand spike',
          summary: 'AI data centers are changing regional power loads.',
          fullText: 'AI data centers are changing regional power loads.',
          sourceURL: 'https://example.com/power',
        },
      })
      socket.emit('MEMORY_NODE_GATHERED', {
        append: false,
        vaultId: 'investigation-display-tags',
        node: {
          id: 'node-grid',
          title: 'Grid instability alert',
          summary: 'Utilities warn that load swings can stress grid operations.',
          fullText: 'Utilities warn that load swings can stress grid operations.',
          sourceURL: 'https://example.com/grid',
        },
      })
    })

    await waitFor(() => {
      const nodes = (lastReactFlowProps?.nodes || []) as Array<{ id: string }>
      expect(nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['node-power', 'node-grid']))
    })

    act(() => {
      socket.emit('CONNECTIONS_FOUND', [
        {
          source: 'node-power',
          target: 'node-grid',
          tag: 'DATA_CENTER_POWER_SWING_RISK',
          reasoning: 'Both nodes describe power-load swings creating operational grid risk.',
        },
      ])
    })

    await waitFor(() => {
      const edges = (lastReactFlowProps?.edges || []) as Array<{ label?: string; data?: Record<string, unknown> }>
      expect(edges).toEqual(expect.arrayContaining([
        expect.objectContaining({
          label: 'Grid Threat',
          data: expect.objectContaining({
            tag: 'DATA_CENTER_POWER_SWING_RISK',
            displayLabel: 'Grid Threat',
          }),
        }),
      ]))
    })

    expect(screen.getByText('Grid Threat')).toBeInTheDocument()
    expect(screen.queryByText('DATA_CENTER_POWER_SWING_RISK')).not.toBeInTheDocument()
  })

  it('auto reconnects a matching completed crawl even while a previous board analysis is still active', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()

    try {
      const { rerender } = renderBoard('previous-investigation', socket as unknown as WebSocket)

      act(() => {
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'previous-investigation',
          node: {
            id: 'old-node-a',
            title: 'A',
            summary: 'A',
            fullText: 'A',
            sourceURL: 'https://example.com/a',
          },
        })
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: 'previous-investigation',
          node: {
            id: 'old-node-b',
            title: 'B',
            summary: 'B',
            fullText: 'B',
            sourceURL: 'https://example.com/b',
          },
        })
      })

      fireEvent.click(screen.getByRole('button', { name: /connect the dots/i }))
      expect(socket.sentMessages.map((message) => JSON.parse(message))).toContainEqual(expect.objectContaining({
        type: 'CONNECT_DOTS',
        vaultId: 'previous-investigation',
      }))
      socket.sentMessages = []

      rerender(
        <DetectiveBoard
          investigationId="investigation-1"
          sharedSocket={socket as unknown as WebSocket}
          onDeepDiveNode={vi.fn()}
          onNavigateToChild={vi.fn()}
        />,
      )

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
          runId: 'run-flow-2',
        })
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600)
      })

      expect(socket.sentMessages.map((message) => JSON.parse(message))).toContainEqual(expect.objectContaining({
        type: 'CONNECT_DOTS',
        vaultId: 'investigation-1',
        runId: 'run-flow-2',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('queues auto reconnect when synthesis completes before gathered nodes are render-ready', async () => {
    vi.useFakeTimers()
    const socket = new MockSocket()
    const investigationId = 'investigation-delayed-auto'

    try {
      renderBoard(investigationId, socket as unknown as WebSocket)

      act(() => {
        socket.emit('SYNTHESIS_COMPLETE', {
          result: 'Unified report',
          vaultPath: `abdomen_vault/${investigationId}/report.md`,
          vaultId: investigationId,
          append: false,
          runId: 'run-flow-delayed-nodes',
        })
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(700)
      })

      expect(socket.sentMessages.map((message) => JSON.parse(message).type)).not.toContain('CONNECT_DOTS')

      act(() => {
        socket.emit('MEMORY_NODE_GATHERED', {
          append: false,
          vaultId: investigationId,
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
          vaultId: investigationId,
          node: {
            id: 'node-b',
            title: 'B',
            summary: 'B',
            fullText: 'B',
            sourceURL: 'https://example.com/b',
          },
        })
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(socket.sentMessages.map((message) => JSON.parse(message))).toContainEqual(expect.objectContaining({
        type: 'CONNECT_DOTS',
        vaultId: investigationId,
        runId: 'run-flow-delayed-nodes',
      }))
    } finally {
      vi.useRealTimers()
    }
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
