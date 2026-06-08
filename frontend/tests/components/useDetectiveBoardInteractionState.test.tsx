import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import {
  BOARD_CONTROLS_PANEL_MARGIN,
  BOARD_CONTROLS_PANEL_MAX_WIDTH,
  DETECTIVE_BOARD_SHOW_GRID_KEY,
  DETECTIVE_BOARD_SNAP_CONNECTION_LABELS_KEY,
  DETECTIVE_BOARD_SNAP_NODES_KEY,
  EXPORT_MENU_WIDTH,
  RELATIONSHIP_LEGEND_VISIBILITY_KEY,
  useDetectiveBoardInteractionState,
} from '../../src/components/useDetectiveBoardInteractionState'

const makeRect = (rect: Partial<DOMRect>): DOMRect => ({
  x: rect.left ?? 0,
  y: rect.top ?? 0,
  top: rect.top ?? 0,
  right: rect.right ?? ((rect.left ?? 0) + (rect.width ?? 0)),
  bottom: rect.bottom ?? ((rect.top ?? 0) + (rect.height ?? 0)),
  left: rect.left ?? 0,
  width: rect.width ?? 0,
  height: rect.height ?? 0,
  toJSON: () => ({}),
})

const setRect = (element: Element, rect: Partial<DOMRect>) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(makeRect(rect))
}

interface HarnessProps {
  canExport?: boolean
  onRelationshipLegendClosed?: () => void
}

const Harness = ({ canExport = true, onRelationshipLegendClosed = vi.fn() }: HarnessProps) => {
  const boardContainerRef = useRef<HTMLDivElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const exportMenuPanelRef = useRef<HTMLDivElement>(null)
  const boardToolbarRef = useRef<HTMLDivElement>(null)
  const boardActionBarRef = useRef<HTMLDivElement>(null)
  const boardControlsButtonRef = useRef<HTMLButtonElement>(null)
  const boardControlsPanelRef = useRef<HTMLDivElement>(null)
  const state = useDetectiveBoardInteractionState({
    canExport,
    boardContainerRef,
    exportButtonRef,
    exportMenuPanelRef,
    boardToolbarRef,
    boardActionBarRef,
    boardControlsButtonRef,
    boardControlsPanelRef,
    onRelationshipLegendClosed,
  })

  return (
    <div ref={boardContainerRef} data-testid="board-container">
      <div ref={boardToolbarRef} data-testid="board-toolbar">
        <div ref={boardActionBarRef} data-testid="board-action-bar">
          <button type="button" ref={exportButtonRef} onClick={state.toggleExportMenu}>
            export
          </button>
          <button type="button" ref={boardControlsButtonRef} onClick={state.toggleBoardControlsPanel}>
            board controls
          </button>
        </div>
      </div>
      {state.showExportMenu && <div ref={exportMenuPanelRef}>export menu</div>}
      {state.showBoardControls && <div ref={boardControlsPanelRef}>controls menu</div>}
      <span data-testid="legend">{String(state.showRelationshipLegend)}</span>
      <span data-testid="grid">{String(state.showGrid)}</span>
      <span data-testid="snap-labels">{String(state.snapConnectionLabels)}</span>
      <span data-testid="snap-nodes">{String(state.snapNodes)}</span>
      <span data-testid="export-position">{JSON.stringify(state.exportMenuPosition)}</span>
      <span data-testid="controls-position">{JSON.stringify(state.boardControlsPosition)}</span>
      <button type="button" onClick={state.closeRelationshipLegend}>close legend</button>
      <button type="button" onClick={state.openRelationshipLegend}>open legend</button>
      <button type="button" onClick={state.toggleRelationshipWorkspacePanel}>toggle legend</button>
      <button type="button" onClick={state.toggleShowGrid}>toggle grid</button>
      <button type="button" onClick={state.toggleSnapConnectionLabels}>toggle snap labels</button>
      <button type="button" onClick={state.toggleSnapNodes}>toggle snap nodes</button>
      <button type="button" onClick={state.closeBoardOverlays}>close overlays</button>
    </div>
  )
}

describe('useDetectiveBoardInteractionState', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('loads and persists the relationship legend and board display preferences', async () => {
    localStorage.setItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY, 'false')
    localStorage.setItem(DETECTIVE_BOARD_SHOW_GRID_KEY, 'false')
    localStorage.setItem(DETECTIVE_BOARD_SNAP_CONNECTION_LABELS_KEY, 'true')
    localStorage.setItem(DETECTIVE_BOARD_SNAP_NODES_KEY, 'true')

    render(<Harness />)

    expect(screen.getByTestId('legend')).toHaveTextContent('false')
    expect(screen.getByTestId('grid')).toHaveTextContent('false')
    expect(screen.getByTestId('snap-labels')).toHaveTextContent('true')
    expect(screen.getByTestId('snap-nodes')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('button', { name: 'open legend' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle grid' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle snap labels' }))
    fireEvent.click(screen.getByRole('button', { name: 'toggle snap nodes' }))

    await waitFor(() => {
      expect(localStorage.getItem(RELATIONSHIP_LEGEND_VISIBILITY_KEY)).toBe('true')
      expect(localStorage.getItem(DETECTIVE_BOARD_SHOW_GRID_KEY)).toBe('true')
      expect(localStorage.getItem(DETECTIVE_BOARD_SNAP_CONNECTION_LABELS_KEY)).toBe('false')
      expect(localStorage.getItem(DETECTIVE_BOARD_SNAP_NODES_KEY)).toBe('false')
    })
  })

  it('clears relationship editing when the legend is closed or toggled from the workspace button', () => {
    const onRelationshipLegendClosed = vi.fn()

    render(<Harness onRelationshipLegendClosed={onRelationshipLegendClosed} />)

    fireEvent.click(screen.getByRole('button', { name: 'close legend' }))
    expect(screen.getByTestId('legend')).toHaveTextContent('false')
    expect(onRelationshipLegendClosed).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'open legend' }))
    expect(screen.getByTestId('legend')).toHaveTextContent('true')
    expect(onRelationshipLegendClosed).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'toggle legend' }))
    expect(screen.getByTestId('legend')).toHaveTextContent('false')
    expect(onRelationshipLegendClosed).toHaveBeenCalledTimes(2)
  })

  it('positions flyout overlays, keeps only one open, and closes them from outside clicks', () => {
    render(<Harness />)

    setRect(screen.getByTestId('board-container'), { left: 100, top: 50, width: 500, bottom: 650 })
    setRect(screen.getByTestId('board-toolbar'), { top: 30 })
    setRect(screen.getByTestId('board-action-bar'), { bottom: 120 })
    setRect(screen.getByRole('button', { name: 'export' }), { left: 450, bottom: 90 })

    fireEvent.click(screen.getByRole('button', { name: 'board controls' }))
    expect(screen.getByText('controls menu')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('controls-position').textContent || '{}')).toEqual({
      top: 102,
      width: BOARD_CONTROLS_PANEL_MAX_WIDTH,
      maxHeight: 502,
    })

    fireEvent.click(screen.getByRole('button', { name: 'export' }))
    expect(screen.queryByText('controls menu')).not.toBeInTheDocument()
    expect(screen.getByText('export menu')).toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('export-position').textContent || '{}')).toEqual({
      top: 52,
      left: 260,
      width: EXPORT_MENU_WIDTH,
    })

    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('export menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'board controls' }))
    expect(screen.getByText('controls menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'close overlays' }))
    expect(screen.queryByText('controls menu')).not.toBeInTheDocument()
  })

  it('does not open the export menu when export is unavailable', () => {
    render(<Harness canExport={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'export' }))

    expect(screen.queryByText('export menu')).not.toBeInTheDocument()
    expect(JSON.parse(screen.getByTestId('export-position').textContent || '{}')).toEqual({
      top: 0,
      left: 0,
      width: EXPORT_MENU_WIDTH,
    })
  })

  it('uses exported layout constants for board overlay constraints', () => {
    expect(BOARD_CONTROLS_PANEL_MARGIN).toBe(16)
    expect(BOARD_CONTROLS_PANEL_MAX_WIDTH).toBe(416)
    expect(EXPORT_MENU_WIDTH).toBe(224)
  })
})
