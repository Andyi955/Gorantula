import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBackendWebSocket } from '../../src/hooks/useBackendWebSocket'

class WebSocketMock {
  static instances: WebSocketMock[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = WebSocketMock.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = WebSocketMock.CLOSED
  })

  constructor(public url: string) {
    WebSocketMock.instances.push(this)
  }
}

const Harness = ({
  ids = ['inv-a', 'inv-b'],
  shouldProbeBackend = false,
}: {
  ids?: string[]
  shouldProbeBackend?: boolean
}) => {
  const socketConfig = useBackendWebSocket({
    socketUrl: 'ws://localhost:8080/ws',
    statusEndpoint: '/__gorantula_backend_status',
    reconnectDelayMs: 50,
    shouldProbeBackend,
    getSyncVaultIds: () => ids,
  })

  return (
    <div>
      <span data-testid="ready">{socketConfig.ready ? 'ready' : 'offline'}</span>
      <span data-testid="socket-url">{socketConfig.socket ? (socketConfig.socket as unknown as WebSocketMock).url : 'none'}</span>
    </div>
  )
}

describe('useBackendWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    WebSocketMock.instances = []
    vi.stubGlobal('WebSocket', WebSocketMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('connects and syncs active vault ids when the socket opens', async () => {
    render(<Harness />)

    await act(async () => {
      vi.runOnlyPendingTimers()
    })

    expect(WebSocketMock.instances).toHaveLength(1)
    const socket = WebSocketMock.instances[0]

    act(() => {
      socket.readyState = WebSocketMock.OPEN
      socket.onopen?.()
    })

    expect(screen.getByTestId('ready')).toHaveTextContent('ready')
    expect(screen.getByTestId('socket-url')).toHaveTextContent('ws://localhost:8080/ws')
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'SYNC_VAULTS', payload: ['inv-a', 'inv-b'] }))
  })

  it('marks the socket offline and reconnects after close', async () => {
    render(<Harness ids={[]} />)

    await act(async () => {
      vi.runOnlyPendingTimers()
    })
    const firstSocket = WebSocketMock.instances[0]

    act(() => {
      firstSocket.readyState = WebSocketMock.OPEN
      firstSocket.onopen?.()
    })
    expect(screen.getByTestId('ready')).toHaveTextContent('ready')

    act(() => {
      firstSocket.readyState = WebSocketMock.CLOSED
      firstSocket.onclose?.()
    })
    expect(screen.getByTestId('ready')).toHaveTextContent('offline')

    await act(async () => {
      vi.advanceTimersByTime(50)
    })

    expect(WebSocketMock.instances).toHaveLength(2)
  })

  it('stays in offline mode when the backend probe reports not ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ready: false }),
    }))

    render(<Harness shouldProbeBackend />)

    await act(async () => {
      vi.runOnlyPendingTimers()
      await Promise.resolve()
    })

    expect(screen.getByTestId('ready')).toHaveTextContent('offline')
    expect(WebSocketMock.instances).toHaveLength(0)
  })
})
