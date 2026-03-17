import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DetectiveBoard from '../../src/components/DetectiveBoard'

vi.mock('reactflow', () => {
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'reactflow' }, children),
    ReactFlowProvider: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    Background: () => null,
    Controls: () => null,
    Handle: () => null,
    applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    reconnectEdge: (_oldEdge: unknown, _newConnection: unknown, edges: unknown[]) => edges,
    useReactFlow: () => ({ fitView: vi.fn() }),
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
      RELATED: { color: '#bc13fe', pattern: 'dash-dot' },
    })
  })
})
