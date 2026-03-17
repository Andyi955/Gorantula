import { fireEvent, render, screen } from '@testing-library/react'
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

    expect(screen.getByText('alice')).toBeInTheDocument()
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

  it('stores incoming alerts in the owning investigation bucket and hides when selected bucket is empty', () => {
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

    expect(screen.queryByText('GRAND UNIFIED THEORY')).not.toBeInTheDocument()

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

    expect(screen.getByText('alice')).toBeInTheDocument()
  })
})
