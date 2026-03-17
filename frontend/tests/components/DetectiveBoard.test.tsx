import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetectiveBoard from '../../src/components/DetectiveBoard'

const fitViewMock = vi.fn()
const setCenterMock = vi.fn()
const getZoomMock = vi.fn(() => 0.82)

vi.mock('reactflow', () => {
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(
        'div',
        { 'data-testid': 'reactflow' },
        React.createElement('div', { className: 'react-flow__pane', 'data-testid': 'reactflow-pane' }),
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
  default: () => null,
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

const renderBoard = (investigationId = 'investigation-1') =>
  render(
    <DetectiveBoard
      investigationId={investigationId}
      sharedSocket={null}
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
})
