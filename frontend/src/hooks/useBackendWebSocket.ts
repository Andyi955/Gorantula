import { useCallback, useEffect, useRef, useState } from 'react'

interface BackendWebSocketState {
  socket: WebSocket | null
  ready: boolean
}

interface UseBackendWebSocketOptions {
  socketUrl: string
  statusEndpoint: string
  reconnectDelayMs: number
  shouldProbeBackend: boolean
  getSyncVaultIds: () => string[]
  debug?: (...args: unknown[]) => void
}

const isOpenOrConnecting = (socket: WebSocket | null) =>
  Boolean(socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN))

const defaultDebug = (...args: unknown[]) => console.debug(...args)

export const useBackendWebSocket = ({
  socketUrl,
  statusEndpoint,
  reconnectDelayMs,
  shouldProbeBackend,
  getSyncVaultIds,
  debug = defaultDebug,
}: UseBackendWebSocketOptions): BackendWebSocketState => {
  const [socketConfig, setSocketConfig] = useState<BackendWebSocketState>({ socket: null, ready: false })
  const reconnectTimeoutRef = useRef<number | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const connectRef = useRef<() => Promise<void>>(async () => {})
  const isUnmountedRef = useRef(false)
  const backendOfflineNoticeShownRef = useRef(false)
  const getSyncVaultIdsRef = useRef(getSyncVaultIds)

  getSyncVaultIdsRef.current = getSyncVaultIds

  const isBackendReachable = useCallback(async () => {
    if (!shouldProbeBackend) {
      return true
    }

    try {
      const response = await fetch(statusEndpoint, { cache: 'no-store' })
      if (!response.ok) {
        return true
      }

      const status = await response.json()
      return status?.ready === true
    } catch {
      return false
    }
  }, [shouldProbeBackend, statusEndpoint])

  const scheduleReconnect = useCallback((delay = reconnectDelayMs) => {
    if (isUnmountedRef.current) {
      return
    }

    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current)
    }

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null
      void connectRef.current()
    }, delay)
  }, [reconnectDelayMs])

  const connect = useCallback(async () => {
    if (isUnmountedRef.current || isOpenOrConnecting(socketRef.current)) {
      return
    }

    const backendReady = await isBackendReachable()
    if (!backendReady) {
      setSocketConfig({ socket: null, ready: false })
      if (!backendOfflineNoticeShownRef.current) {
        debug('[App] Backend offline; staying in local UI mode and retrying quietly.')
        backendOfflineNoticeShownRef.current = true
      }
      scheduleReconnect()
      return
    }

    debug('[App] Connecting to WebSocket...')
    const socket = new WebSocket(socketUrl)
    socketRef.current = socket

    socket.onopen = () => {
      backendOfflineNoticeShownRef.current = false
      debug('[App] WebSocket Connected')
      setSocketConfig({ socket, ready: true })

      const ids = getSyncVaultIdsRef.current()
      if (ids.length > 0) {
        socket.send(JSON.stringify({ type: 'SYNC_VAULTS', payload: ids }))
      }
    }

    socket.onclose = () => {
      setSocketConfig({ socket: null, ready: false })
      socketRef.current = null
      scheduleReconnect()
    }

    socket.onerror = () => {
      if (socket.readyState !== WebSocket.CLOSED) {
        socket.close()
      }
    }
  }, [debug, isBackendReachable, scheduleReconnect, socketUrl])

  connectRef.current = connect

  useEffect(() => {
    isUnmountedRef.current = false
    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null
      void connect()
    }, 0)

    return () => {
      isUnmountedRef.current = true
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current)
      }
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close()
      }
    }
  }, [connect])

  return socketConfig
}
