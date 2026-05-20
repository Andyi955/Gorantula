import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { vi } from 'vitest'
import SynthesisPanel from '../src/components/SynthesisPanel'
import { BOARD_WORKSPACE_STATE_UPDATED_EVENT } from '../src/utils/boardWorkspaceEvents'

class SocketMock {
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>()

  readyState = WebSocket.OPEN

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) || new Set()
    current.add(listener)
    this.listeners.set(type, current)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

describe('SynthesisPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows alerts only for the selected investigation and clears only that bucket', () => {
    localStorage.setItem('gorantula_synthesis_alerts_by_investigation', JSON.stringify({
      'inv-a': [
        {
          type: 'synthesis_alert',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a', 'inv-b'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
          analysis: 'Alert A',
          timestamp: '12:00:00',
        },
      ],
      'merge-1': [
        {
          type: 'synthesis_alert',
          entity: 'beta',
          currentVaultId: 'merge-1',
          connectedCases: ['merge-1', 'inv-b'],
          nodes: [{ vaultId: 'merge-1', nodeId: 'node-m', summary: 'Beta mention' }],
          analysis: 'Alert Merge',
          timestamp: '12:05:00',
        },
      ],
    }))

    const { rerender } = render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
          { id: 'merge-1', topic: 'Merged Child' },
          { id: 'inv-b', topic: 'Investigation B' },
        ]}
      />,
    )

    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
    expect(screen.queryByText('beta')).not.toBeInTheDocument()

    rerender(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="merge-1"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
          { id: 'merge-1', topic: 'Merged Child' },
          { id: 'inv-b', topic: 'Investigation B' },
        ]}
      />,
    )

    expect(screen.getAllByText('beta').length).toBeGreaterThan(0)
    expect(screen.queryByText('alice')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('CLEAR'))

    expect(screen.queryByText('beta')).not.toBeInTheDocument()

    const persisted = JSON.parse(localStorage.getItem('gorantula_synthesis_alerts_by_investigation') || '{}')
    expect(persisted['merge-1']).toBeUndefined()
    expect(persisted['inv-a']).toHaveLength(1)
  })

  it('stores incoming alerts in the owning investigation bucket and keeps the synthesis handle available when selected bucket is empty', () => {
    const socket = new SocketMock() as unknown as WebSocket
    const { rerender } = render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
          { id: 'inv-b', topic: 'Investigation B' },
        ]}
      />,
    )

    expect(screen.getByLabelText('Show synthesis panel')).toBeInTheDocument()
    expect(screen.getByText('GRAND UNIFIED THEORY')).toBeInTheDocument()
    expect(screen.getByText(/No cross-investigation overlaps yet/i)).toBeInTheDocument()

    ;(socket as unknown as SocketMock).emit('message', {
      type: 'SYNTHESIS_ALERT',
      payload: {
        type: 'synthesis_alert',
        entity: 'alice',
        currentVaultId: 'inv-b',
        connectedCases: ['inv-b', 'inv-a'],
        nodes: [{ vaultId: 'inv-b', nodeId: 'node-b', summary: 'Alice mention' }],
        analysis: 'Alert B',
        timestamp: '12:10:00',
      },
    })

    expect(screen.queryByText('alice')).not.toBeInTheDocument()

    rerender(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-b"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
          { id: 'inv-b', topic: 'Investigation B' },
        ]}
      />,
    )

    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
  })

  it('shows the selected investigation theory report when there are no overlap alerts', () => {
    render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
        ]}
        currentTheoryReport="Saved final synthesis for this selected investigation."
      />,
    )

    expect(screen.getByText(/Saved final synthesis for this selected investigation/i)).toBeInTheDocument()
    expect(screen.queryByText(/No cross-investigation overlaps yet/i)).not.toBeInTheDocument()
  })

  it('rehydrates synthesis alerts from persisted board state on investigation load', async () => {
    localStorage.setItem('inv_data_inv-a', JSON.stringify({
      mode: 'strict-grid',
      nodes: [],
      edges: [],
      synthesisAlerts: [
        {
          type: 'synthesis_alert',
          alertKey: 'inv-a::alice::inv-a|inv-b',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a', 'inv-b'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
          analysis: 'Recovered from board state',
          timestamp: '12:00:00',
        },
      ],
    }))

    render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
        ]}
      />,
    )

    await waitFor(() => {
      expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
      expect(screen.getByText('Recovered from board state')).toBeInTheDocument()
    })
  })

  it('keeps legacy alert buckets when a board was saved before alert snapshots existed', async () => {
    localStorage.setItem('gorantula_synthesis_alerts_by_investigation', JSON.stringify({
      'inv-b': [
        {
          type: 'synthesis_alert',
          alertKey: 'inv-b::stale::inv-b',
          entity: 'stale-entity',
          currentVaultId: 'inv-b',
          connectedCases: ['inv-b'],
          nodes: [{ vaultId: 'inv-b', nodeId: 'node-stale', summary: 'Stale mention' }],
          analysis: 'This legacy alert should survive the older board snapshot',
          timestamp: '12:00:00',
        },
      ],
    }))
    localStorage.setItem('inv_data_inv-b', JSON.stringify({
      mode: 'strict-grid',
      nodes: [],
      edges: [],
    }))

    render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-b"
        returnVaultId={null}
        investigations={[
          { id: 'inv-b', topic: 'Investigation B' },
        ]}
      />,
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getAllByText('stale-entity').length).toBeGreaterThan(0)
      expect(screen.getByText('This legacy alert should survive the older board snapshot')).toBeInTheDocument()
    })
  })

  it('deduplicates incoming alerts by alert key', async () => {
    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
          { id: 'inv-b', topic: 'Investigation B' },
        ]}
      />,
    )

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          alertKey: 'inv-a::alice::inv-a|inv-b',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a', 'inv-b'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
          analysis: 'First analysis',
          timestamp: '12:10:00',
        },
      })
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          alertKey: 'inv-a::alice::inv-a|inv-b',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a', 'inv-b'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention refreshed' }],
          analysis: 'Updated analysis',
          timestamp: '12:11:00',
        },
      })
    })

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem('gorantula_synthesis_alerts_by_investigation') || '{}')
      expect(persisted['inv-a']).toHaveLength(1)
      expect(persisted['inv-a'][0].analysis).toBe('Updated analysis')
    })
  })

  it('keeps the live investigation alert visible even when storage pruning trims older buckets', async () => {
    const seededBuckets = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => {
        const investigationId = `seed-${index}`
        return [
          investigationId,
          [
            {
              type: 'synthesis_alert',
              alertKey: `${investigationId}::seed-${index}::${investigationId}`,
              entity: `seed-${index}`,
              currentVaultId: investigationId,
              connectedCases: [investigationId],
              nodes: [{ vaultId: investigationId, nodeId: `node-${index}`, summary: `Seed alert ${index}` }],
              analysis: `Stored alert ${index}`,
              timestamp: '12:00:00',
            },
          ],
        ]
      }),
    )

    localStorage.setItem('gorantula_synthesis_alerts_by_investigation', JSON.stringify(seededBuckets))

    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-live"
        returnVaultId={null}
        investigations={[
          { id: 'inv-live', topic: 'Live Investigation' },
        ]}
      />,
    )

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          alertKey: 'inv-live::live-entity::inv-live|seed-1',
          entity: 'live-entity',
          currentVaultId: 'inv-live',
          connectedCases: ['inv-live', 'seed-1'],
          nodes: [{ vaultId: 'inv-live', nodeId: 'node-live', summary: 'Live overlap context' }],
          analysis: 'Newest live alert should remain visible',
          timestamp: '12:30:00',
        },
      })
    })

    await waitFor(() => {
      expect(screen.getAllByText('live-entity').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Newest live alert should remain visible').length).toBeGreaterThan(0)
    })
  })

  it('keeps the synthesis panel closed and unread when a new alert arrives for the current investigation', async () => {
    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
        ]}
      />,
    )

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
          analysis: 'Alert A',
          timestamp: '12:10:00',
        },
      })
    })

    const card = await screen.findByTestId('synthesis-alert-card-inv-a::alice::inv-a')
    expect(card).toHaveTextContent('Alert A')

    const panel = screen.getByText('GRAND UNIFIED THEORY').closest('.translate-x-full')
    expect(panel).not.toBeNull()
    expect(screen.getByLabelText('Show synthesis panel')).toBeInTheDocument()
    expect(screen.getByText('!')).toBeInTheDocument()
  })

  it('animates a new synthesis alert without rendering a duplicate constellation graphic', async () => {
    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
          { id: 'inv-b', topic: 'Investigation B' },
          { id: 'inv-c', topic: 'Investigation C' },
        ]}
      />,
    )

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          alertKey: 'inv-a::nvidia::inv-a|inv-b|inv-c',
          entity: 'nvidia',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a', 'inv-b', 'inv-c'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Nvidia context' }],
          analysis: 'Signal links several AI infrastructure investigations.',
          timestamp: '12:20:00',
        },
      })
    })

    const card = await screen.findByTestId('synthesis-alert-card-inv-a::nvidia::inv-a|inv-b|inv-c')
    expect(card).toHaveClass('forensic-synthesis-alert-reveal')
    expect(screen.queryByTestId('synthesis-overlap-toast')).not.toBeInTheDocument()
    expect(screen.queryByTestId('synthesis-constellation-inv-a::nvidia::inv-a|inv-b|inv-c')).not.toBeInTheDocument()
    expect(screen.getByText('Connected Vaults')).toBeInTheDocument()
    expect(screen.getAllByText('Investigation B').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Investigation C').length).toBeGreaterThan(0)
  })

  it('does not replay alert reveal animation for persisted synthesis alerts', async () => {
    localStorage.setItem('gorantula_synthesis_alerts_by_investigation', JSON.stringify({
      'inv-a': [
        {
          type: 'synthesis_alert',
          alertKey: 'inv-a::alice::inv-a|inv-b',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a', 'inv-b'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
          analysis: 'Persisted synthesis alert',
          timestamp: '12:00:00',
        },
      ],
    }))

    render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[{ id: 'inv-a', topic: 'Investigation A' }]}
      />,
    )

    const card = await screen.findByTestId('synthesis-alert-card-inv-a::alice::inv-a|inv-b')
    expect(card).not.toHaveClass('forensic-synthesis-alert-reveal')
  })

  it('does not reanimate deduped synthesis alerts with the same alert key', async () => {
    vi.useFakeTimers()
    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[{ id: 'inv-a', topic: 'Investigation A' }]}
      />,
    )

    const alertPayload = {
      type: 'synthesis_alert',
      alertKey: 'inv-a::acme::inv-a',
      entity: 'ACME',
      currentVaultId: 'inv-a',
      connectedCases: ['inv-a'],
      nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'ACME mention' }],
      analysis: 'First analysis',
      timestamp: '12:10:00',
    }

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: alertPayload,
      })
    })

    const card = screen.getByTestId('synthesis-alert-card-inv-a::acme::inv-a')
    expect(card).toHaveClass('forensic-synthesis-alert-reveal')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800)
    })
    expect(card).not.toHaveClass('forensic-synthesis-alert-reveal')

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          ...alertPayload,
          analysis: 'Updated analysis',
          timestamp: '12:11:00',
        },
      })
    })

    expect(screen.getAllByText('Updated analysis').length).toBeGreaterThan(0)
    expect(screen.getByTestId('synthesis-alert-card-inv-a::acme::inv-a')).not.toHaveClass('forensic-synthesis-alert-reveal')
  })

  it('renders final synthesis signal state immediately when reduced motion is preferred', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[{ id: 'inv-a', topic: 'Investigation A' }]}
      />,
    )

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          alertKey: 'inv-a::reduced::inv-a',
          entity: 'reduced',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a'],
          nodes: [],
          analysis: 'Reduced motion alert',
          timestamp: '12:10:00',
        },
      })
    })

    const card = await screen.findByTestId('synthesis-alert-card-inv-a::reduced::inv-a')
    expect(card).not.toHaveClass('forensic-synthesis-alert-reveal')
    expect(screen.queryByTestId('synthesis-overlap-toast')).not.toBeInTheDocument()
  })

  it('reveals new theory report sections progressively but keeps initial theory calm', () => {
    const { rerender } = render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[{ id: 'inv-a', topic: 'Investigation A' }]}
        currentTheoryReport={'Initial theory section.\n\nInitial second section.'}
      />,
    )

    expect(screen.getByTestId('synthesis-theory-section-0')).not.toHaveClass('forensic-synthesis-theory-section-reveal')

    rerender(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[{ id: 'inv-a', topic: 'Investigation A' }]}
        currentTheoryReport={'New theory section.\n\nSecond new section.'}
      />,
    )

    expect(screen.getByTestId('synthesis-theory-section-0')).toHaveClass('forensic-synthesis-theory-section-reveal')
    expect(screen.getByTestId('synthesis-theory-section-1')).toHaveClass('forensic-synthesis-theory-section-reveal')
  })

  it('keeps the synthesis panel closed for active investigation alerts without the legacy toast', async () => {
    const socket = new SocketMock() as unknown as WebSocket

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
        ]}
      />,
    )

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          alertKey: 'inv-a::acme::inv-a',
          entity: 'ACME',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'ACME mention' }],
          analysis: 'Overlap ready for review',
          timestamp: '12:10:00',
        },
      })
    })

    const card = await screen.findByTestId('synthesis-alert-card-inv-a::acme::inv-a')
    expect(card).toHaveTextContent('Overlap ready for review')

    expect(screen.queryByTestId('synthesis-overlap-toast')).not.toBeInTheDocument()
    const panel = screen.getByText('GRAND UNIFIED THEORY').closest('.translate-x-full')
    expect(panel).not.toBeNull()
    expect(screen.getByLabelText('Show synthesis panel')).toBeInTheDocument()
  })

  it('does not crash when localStorage quota is exceeded', () => {
    const socket = new SocketMock() as unknown as WebSocket
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    render(
      <SynthesisPanel
        sharedSocket={socket}
        currentInvestigationId="inv-a"
        returnVaultId={null}
        investigations={[
          { id: 'inv-a', topic: 'Investigation A' },
        ]}
      />,
    )

    expect(() => {
      act(() => {
        ;(socket as unknown as SocketMock).emit('message', {
          type: 'SYNTHESIS_ALERT',
          payload: {
            type: 'synthesis_alert',
            entity: 'alice',
            currentVaultId: 'inv-a',
            connectedCases: ['inv-a'],
            nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
            analysis: 'Alert A',
            timestamp: '12:10:00',
          },
        })
      })
    }).not.toThrow()

    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)

    setItemSpy.mockRestore()
  })

  it('persists incoming alerts without updating parents during render', () => {
    localStorage.setItem('inv_data_inv-a', JSON.stringify({ mode: 'strict-grid', nodes: [], edges: [] }))
    const socket = new SocketMock() as unknown as WebSocket
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Harness = () => {
      const [revision, setRevision] = useState(0)

      useEffect(() => {
        const handleBoardUpdate = () => setRevision((current) => current + 1)
        window.addEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardUpdate)
        return () => window.removeEventListener(BOARD_WORKSPACE_STATE_UPDATED_EVENT, handleBoardUpdate)
      }, [])

      return (
        <>
          <span data-testid="revision">{revision}</span>
          <SynthesisPanel
            sharedSocket={socket}
            currentInvestigationId="inv-a"
            returnVaultId={null}
            investigations={[{ id: 'inv-a', topic: 'Investigation A' }]}
          />
        </>
      )
    }

    render(<Harness />)

    act(() => {
      ;(socket as unknown as SocketMock).emit('message', {
        type: 'SYNTHESIS_ALERT',
        payload: {
          type: 'synthesis_alert',
          entity: 'alice',
          currentVaultId: 'inv-a',
          connectedCases: ['inv-a'],
          nodes: [{ vaultId: 'inv-a', nodeId: 'node-a', summary: 'Alice mention' }],
          analysis: 'Alert A',
          timestamp: '12:10:00',
        },
      })
    })

    expect(screen.getAllByText('alice').length).toBeGreaterThan(0)
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Cannot update a component'),
      expect.anything(),
      expect.anything(),
    )

    consoleError.mockRestore()
  })
})
