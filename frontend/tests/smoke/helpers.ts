import { expect, type Page } from '@playwright/test'

export interface SmokeBackendMessage {
  type: string
  payload?: unknown
  vaultId?: string
  runId?: string
  [key: string]: unknown
}

interface BrowserQaSeedResult {
  focusInvestigationId: string
  investigationIds: string[]
}

type BoardPersistenceExpectation = {
  nodeIds: string[]
  edgeCount?: number
}

type SmokeNetworkViolation = {
  url: string
  method: string
  resourceType: string
}

const blockedNetworkRequestsByPage = new WeakMap<Page, SmokeNetworkViolation[]>()

const isLocalSmokeUrl = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl)
    if (url.protocol === 'about:' || url.protocol === 'blob:' || url.protocol === 'data:') {
      return true
    }

    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      return false
    }

    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export const installSmokeNetworkGuard = async (page: Page) => {
  const blockedRequests: SmokeNetworkViolation[] = []
  blockedNetworkRequestsByPage.set(page, blockedRequests)

  await page.route('**/*', async (route) => {
    const request = route.request()
    if (isLocalSmokeUrl(request.url())) {
      await route.continue()
      return
    }

    blockedRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
    })
    await route.abort('blockedbyclient')
  })

  page.on('websocket', (webSocket) => {
    if (isLocalSmokeUrl(webSocket.url())) {
      return
    }

    blockedRequests.push({
      url: webSocket.url(),
      method: 'WEBSOCKET',
      resourceType: 'websocket',
    })
  })
}

export const expectNoExternalNetworkRequests = (page: Page) => {
  const blockedRequests = blockedNetworkRequestsByPage.get(page) || []
  expect(blockedRequests, `Smoke tests must not reach non-local network URLs: ${JSON.stringify(blockedRequests, null, 2)}`).toEqual([])
}

export const installFakeBackend = async (page: Page) => {
  await page.addInitScript(() => {
    type WireMessage = Record<string, unknown> & { type?: string }

    const state = {
      messages: [] as WireMessage[],
      sockets: [] as Array<EventTarget & {
        readyState: number
        send(data: string): void
        close(): void
        __emit(message: WireMessage): void
      }>,
    }

    class FakeWebSocket extends EventTarget {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSING = 2
      static readonly CLOSED = 3

      readonly url: string
      readonly protocol = ''
      readonly extensions = ''
      binaryType: BinaryType = 'blob'
      bufferedAmount = 0
      readyState = FakeWebSocket.CONNECTING
      onopen: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null

      constructor(url: string) {
        super()
        this.url = url
        state.sockets.push(this)

        window.setTimeout(() => {
          if (this.readyState !== FakeWebSocket.CONNECTING) {
            return
          }
          this.readyState = FakeWebSocket.OPEN
          const event = new Event('open')
          this.onopen?.(event)
          this.dispatchEvent(event)
        }, 0)
      }

      send(data: string) {
        try {
          state.messages.push(JSON.parse(data) as WireMessage)
        } catch {
          state.messages.push({ type: 'RAW', payload: data })
        }
      }

      close() {
        if (this.readyState === FakeWebSocket.CLOSED) {
          return
        }
        this.readyState = FakeWebSocket.CLOSED
        const event = new CloseEvent('close')
        this.onclose?.(event)
        this.dispatchEvent(event)
      }

      __emit(message: WireMessage) {
        const event = new MessageEvent('message', {
          data: JSON.stringify(message),
        })
        this.onmessage?.(event)
        this.dispatchEvent(event)
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    })

    Object.defineProperty(window, '__gorantulaSmokeBackend', {
      configurable: true,
      value: {
        messages: state.messages,
        get socketCount() {
          return state.sockets.length
        },
        get openSocketCount() {
          return state.sockets.filter((socket) => socket.readyState === FakeWebSocket.OPEN).length
        },
        emit(message: WireMessage) {
          const openSockets = state.sockets.filter((socket) => socket.readyState === FakeWebSocket.OPEN)
          const socket = openSockets[openSockets.length - 1] || state.sockets[state.sockets.length - 1]
          if (!socket) {
            throw new Error('No fake WebSocket is available')
          }
          socket.__emit(message)
        },
      },
    })
  })
}

export const openSmokeApp = async (page: Page) => {
  await installSmokeNetworkGuard(page)
  await installFakeBackend(page)
  await page.goto('/')
  await page.evaluate(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })
  await page.reload()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await page.waitForFunction(() => {
    const backend = (window as Window & {
      __gorantulaSmokeBackend?: { openSocketCount: number }
    }).__gorantulaSmokeBackend
    return Boolean(backend && backend.openSocketCount > 0)
  })
}

export const getOutboundMessages = async (page: Page) =>
  page.evaluate(() => {
    const backend = (window as Window & {
      __gorantulaSmokeBackend?: { messages: SmokeBackendMessage[] }
    }).__gorantulaSmokeBackend
    return backend?.messages || []
  })

export const outboundTypeCount = async (page: Page, type: string) => {
  const messages = await getOutboundMessages(page)
  return messages.filter((message) => message.type === type).length
}

export const waitForOutboundMessage = async (
  page: Page,
  type: string,
  previousCount = 0,
) => {
  await expect.poll(async () => outboundTypeCount(page, type)).toBeGreaterThan(previousCount)
  const messages = await getOutboundMessages(page)
  const matching = messages.filter((message) => message.type === type)
  return matching[previousCount] as SmokeBackendMessage
}

export const emitBackendMessage = async (page: Page, message: SmokeBackendMessage) => {
  await page.evaluate((messageToEmit) => {
    const backend = (window as Window & {
      __gorantulaSmokeBackend?: { emit(message: SmokeBackendMessage): void }
    }).__gorantulaSmokeBackend
    if (!backend) {
      throw new Error('Fake backend is not installed')
    }
    backend.emit(messageToEmit)
  }, message)
}

export const seedBrowserQaData = async (page: Page): Promise<BrowserQaSeedResult> =>
  page.evaluate(async () => {
    const qa = await import('/src/utils/browserQaSeed.ts')
    const result = qa.seedBrowserQaData()
    window.dispatchEvent(new CustomEvent(qa.BROWSER_QA_SEEDED_EVENT, { detail: result }))
    return result
  })

export const switchToBoard = async (page: Page) => {
  await page.getByRole('button', { name: /detective board/i }).click()
  await expect(page.getByTestId('board-toolbar-shell')).toBeVisible()
  await expect(page.locator('#detective-board-flow')).toBeVisible()
}

export const waitForBoardPersistence = async (
  page: Page,
  vaultId: string,
  expectation: BoardPersistenceExpectation,
) => {
  await page.waitForFunction(
    ({ targetVaultId, nodeIds, edgeCount }) => {
      const raw = window.localStorage.getItem(`inv_data_${targetVaultId}`)
      if (!raw) {
        return false
      }

      try {
        const state = JSON.parse(raw) as {
          nodes?: Array<{ id?: string }>
          edges?: unknown[]
        }
        const persistedNodeIds = new Set((state.nodes || []).map((node) => node.id))
        const hasNodes = nodeIds.every((nodeId) => persistedNodeIds.has(nodeId))
        const hasEdges = typeof edgeCount === 'number'
          ? (state.edges || []).length >= edgeCount
          : true
        return hasNodes && hasEdges
      } catch {
        return false
      }
    },
    {
      targetVaultId: vaultId,
      nodeIds: expectation.nodeIds,
      edgeCount: expectation.edgeCount,
    },
  )
}

export const createSmokeNode = (
  id: string,
  title: string,
  summary: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  title,
  summary,
  fullText: summary,
  sourceURL: `https://example.com/${id}`,
  ...extra,
})
