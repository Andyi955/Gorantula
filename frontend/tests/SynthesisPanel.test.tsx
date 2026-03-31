import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import SynthesisPanel from '../src/components/SynthesisPanel'

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

    expect(screen.getByText('beta')).toBeInTheDocument()
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
      expect(screen.getAllByText('Newest live alert should remain visible').length).toBeGreaterThan(1)
    })
  })

  it('auto-opens when a new alert arrives for the current investigation', () => {
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

    return waitFor(() => {
      const panel = screen.getByText('GRAND UNIFIED THEORY').closest('.translate-x-0')
      expect(panel).not.toBeNull()
      expect(screen.getByLabelText('Hide synthesis panel')).toBeInTheDocument()
    })
  })

  it('shows a toast for the active investigation and review opens the panel', async () => {
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

    expect(await screen.findByTestId('synthesis-overlap-toast')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /review/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('synthesis-overlap-toast')).not.toBeInTheDocument()
      const panel = screen.getByText('GRAND UNIFIED THEORY').closest('.translate-x-0')
      expect(panel).not.toBeNull()
    })
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
})
