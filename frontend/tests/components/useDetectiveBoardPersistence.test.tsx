import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { BOARD_RESTORE_COMPLETE_EVENT, type BoardRestoreCompleteDetail } from '../../src/utils/boardWorkspaceEvents'
import type { PersistedBoardState } from '../../src/utils/hierarchicalCanvas'
import { useDetectiveBoardPersistence } from '../../src/components/useDetectiveBoardPersistence'

const makeNode = (id: string): Node => ({
  id,
  type: 'custom',
  position: { x: 0, y: 0 },
  data: { id, title: id },
})

const makeEdge = (id: string): Edge => ({
  id,
  source: 'node-a',
  target: 'node-b',
})

interface HarnessProps {
  now: () => number
  nodes?: Node[]
  edges?: Edge[]
  shouldSkipAutosave?: () => boolean
  getCachedBoardState?: (investigationId: string) => PersistedBoardState | null
  saveBoardState?: (investigationId: string, state: PersistedBoardState) => void
}

const Harness = ({
  now,
  nodes = [makeNode('node-a')],
  edges = [makeEdge('edge-a')],
  shouldSkipAutosave = () => false,
  getCachedBoardState = () => null,
  saveBoardState = () => undefined,
}: HarnessProps) => {
  const persistence = useDetectiveBoardPersistence({
    investigationId: 'inv-a',
    boardMode: 'strict-grid',
    nodes,
    edges,
    pendingIntegrationNodeIds: ['node-a'],
    isInitialRestoreViewportSettling: false,
    setIsInitialRestoreViewportSettling: vi.fn(),
    pendingInitialRestoreViewportFitRef: { current: null },
    shouldSkipAutosave,
    serializeNodes: (items) => items.map((node) => ({ ...node, data: { id: node.id, persisted: true } })),
    serializeEdges: (items) => items.map((edge) => ({ ...edge, data: { persisted: true } })),
    getCachedBoardState,
    saveBoardState,
    now,
    autosaveDelayMs: 250,
    overlayMinMs: 200,
    overlayMaxMs: 1000,
    initialRestoreViewportFitDelayMs: 50,
  })

  return (
    <div>
      <span data-testid="loaded">{persistence.loadedInvestigationId || 'none'}</span>
      <span data-testid="overlay">{persistence.boardRestoreOverlay?.source || 'none'}</span>
      <button type="button" onClick={() => persistence.markInvestigationLoaded('inv-a')}>
        mark-loaded
      </button>
      <button type="button" onClick={() => persistence.startBoardRestoreLoad('inv-a')}>
        start-restore
      </button>
      <button type="button" onClick={() => persistence.finishBoardRestoreLoad('inv-a', 100, 'memory-cache', 2, 1)}>
        finish-restore
      </button>
      <button type="button" onClick={persistence.persistBoardNow}>
        persist-now
      </button>
      <button type="button" onClick={persistence.clearPendingBoardPersist}>
        clear-pending
      </button>
    </div>
  )
}

describe('useDetectiveBoardPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('publishes restore completion details and clears the restore overlay after the hide delay', async () => {
    let currentNow = 100
    const restoreEvents: BoardRestoreCompleteDetail[] = []
    window.addEventListener(BOARD_RESTORE_COMPLETE_EVENT, ((event: CustomEvent<BoardRestoreCompleteDetail>) => {
      restoreEvents.push(event.detail)
    }) as EventListener)

    render(<Harness now={() => currentNow} />)

    fireEvent.click(screen.getByRole('button', { name: 'start-restore' }))
    expect(screen.getByTestId('overlay')).toHaveTextContent('loading')

    currentNow = 250
    fireEvent.click(screen.getByRole('button', { name: 'finish-restore' }))

    expect(screen.getByTestId('overlay')).toHaveTextContent('memory-cache')
    expect(restoreEvents).toEqual([{
      investigationId: 'inv-a',
      source: 'memory-cache',
      durationMs: 150,
      nodeCount: 2,
      edgeCount: 1,
    }])

    await act(async () => {
      vi.advanceTimersByTime(50)
    })

    expect(screen.getByTestId('overlay')).toHaveTextContent('none')
  })

  it('debounces autosave, preserves synthesis alerts, and can persist immediately', async () => {
    const saveBoardState = vi.fn()
    const getCachedBoardState = vi.fn().mockReturnValue({
      mode: 'strict-grid',
      nodes: [],
      edges: [],
      synthesisAlerts: [{ id: 'alert-a' }],
    })

    render(
      <Harness
        now={() => 100}
        saveBoardState={saveBoardState}
        getCachedBoardState={getCachedBoardState}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'mark-loaded' }))
    expect(screen.getByTestId('loaded')).toHaveTextContent('inv-a')

    await act(async () => {
      vi.advanceTimersByTime(249)
    })
    expect(saveBoardState).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(saveBoardState).toHaveBeenCalledWith('inv-a', {
      mode: 'strict-grid',
      nodes: [{ ...makeNode('node-a'), data: { id: 'node-a', persisted: true } }],
      edges: [{ ...makeEdge('edge-a'), data: { persisted: true } }],
      pendingIntegrationNodeIds: ['node-a'],
      synthesisAlerts: [{ id: 'alert-a' }],
    })

    saveBoardState.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'persist-now' }))
    expect(saveBoardState).toHaveBeenCalledTimes(1)
  })

  it('skips autosave and clears pending saves when persistence is suppressed', async () => {
    const saveBoardState = vi.fn()

    render(
      <Harness
        now={() => 100}
        shouldSkipAutosave={() => true}
        saveBoardState={saveBoardState}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'mark-loaded' }))
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(saveBoardState).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'clear-pending' }))
    fireEvent.click(screen.getByRole('button', { name: 'persist-now' }))
    expect(saveBoardState).toHaveBeenCalledTimes(1)
  })
})
