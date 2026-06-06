import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BrainSignalsPanel from '../../src/components/BrainSignalsPanel'
import type { BrainSignal, MemoryLink } from '../../src/utils/brainMemory'

const signal: BrainSignal = {
  id: 'brain-signal-alpha',
  investigationId: 'inv-current',
  investigationTitle: 'Current Grid Case',
  targetInvestigationId: 'inv-older',
  targetTitle: 'Older Substation Case',
  score: 0.92,
  gateways: ['entity-date', 'source-domain'],
  reasons: [
    {
      gateway: 'entity-date',
      value: 'northgate substation a-17',
      label: 'Northgate Substation A-17',
      detail: 'Northgate Substation A-17 appears in both investigations.',
      currentNodeIds: ['node-current'],
      targetNodeIds: ['node-older'],
    },
    {
      gateway: 'source-domain',
      value: 'operator.example',
      label: 'operator.example',
      detail: 'Both investigations cite operator.example.',
      currentNodeIds: ['node-current'],
      targetNodeIds: ['node-domain'],
    },
  ],
  suggestedAction: 'Review older case',
  createdAt: '2026-06-05T12:00:00Z',
  updatedAt: '2026-06-05T12:00:00Z',
  dismissed: false,
  linked: false,
}

const link: MemoryLink = {
  id: 'brain-link-alpha',
  signalId: signal.id,
  fromInvestigationId: 'inv-current',
  fromTitle: 'Current Grid Case',
  toInvestigationId: 'inv-older',
  toTitle: 'Older Substation Case',
  score: 0.92,
  gateways: ['entity-date'],
  reasons: [signal.reasons[0]],
  suggestedAction: 'Review older case',
  createdAt: '2026-06-05T12:00:00Z',
}

const jsonResponse = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
})

const installBrainFetch = ({
  signals = [],
  links = [],
  promoteLink = link,
}: {
  signals?: BrainSignal[]
  links?: MemoryLink[]
  promoteLink?: MemoryLink
} = {}) => {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'

    if (url.includes('/api/brain/signals?')) {
      return Promise.resolve(jsonResponse(signals) as Response)
    }
    if (url.includes('/api/brain/links?')) {
      return Promise.resolve(jsonResponse(links) as Response)
    }
    if (method === 'PUT' && url.endsWith('/dismiss')) {
      return Promise.resolve(jsonResponse({ ...signal, dismissed: true }) as Response)
    }
    if (method === 'PUT' && url.endsWith('/link')) {
      return Promise.resolve(jsonResponse(promoteLink) as Response)
    }

    return Promise.resolve(jsonResponse({}, 404) as Response)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('BrainSignalsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders loading and empty states', async () => {
    let resolveSignals: (response: Response) => void = () => {}
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (String(input).includes('/api/brain/signals?')) {
        return new Promise<Response>((resolve) => {
          resolveSignals = resolve
        })
      }
      return Promise.resolve(jsonResponse([]) as Response)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    expect(screen.getByTestId('brain-loading-state')).toHaveTextContent(/Scanning memory gateways/i)

    resolveSignals(jsonResponse([]) as Response)

    expect(await screen.findByTestId('brain-empty-state')).toHaveTextContent(/No brain signals fired/i)
  })

  it('renders ranked signals, reason chips, and existing links', async () => {
    installBrainFetch({ signals: [signal], links: [link] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const card = await screen.findByTestId('brain-signal-card')
    expect(card).toHaveTextContent('Older Substation Case')
    expect(card).toHaveTextContent('92%')
    expect(card).toHaveTextContent('Entity/Date')
    expect(card).toHaveTextContent('Source Domain')
    expect(card).toHaveTextContent(/Northgate Substation A-17 appears in both investigations/i)
    expect(card).toHaveTextContent('Review older case')

    const linkedMemory = await screen.findByTestId('brain-link-card')
    expect(linkedMemory).toHaveTextContent('Older Substation Case')
    expect(linkedMemory).toHaveTextContent('Entity/Date')
  })

  it('opens, dismisses, and promotes signals through the expected actions', async () => {
    const user = userEvent.setup()
    const fetchMock = installBrainFetch({ signals: [signal], links: [] })
    const onOpenInvestigation = vi.fn()

    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
        onOpenInvestigation={onOpenInvestigation}
      />,
    )

    const card = await screen.findByTestId('brain-signal-card')
    await user.click(within(card).getByRole('button', { name: /open investigation older substation case/i }))
    expect(onOpenInvestigation).toHaveBeenCalledWith('inv-older')

    await user.click(within(card).getByRole('button', { name: /dismiss signal for older substation case/i }))
    await waitFor(() => {
      expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/signals/brain-signal-alpha/dismiss',
      expect.objectContaining({ method: 'PUT' }),
    )

    installBrainFetch({ signals: [signal], links: [], promoteLink: link })
    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
      />,
    )

    const nextCard = await screen.findByTestId('brain-signal-card')
    await user.click(within(nextCard).getByRole('button', { name: /promote signal for older substation case/i }))
    await waitFor(() => {
      expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    })
    expect(await screen.findByTestId('brain-link-card')).toHaveTextContent('Older Substation Case')
  })

  it('renders backend errors without crashing the tab', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'missing' }, 500)))

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    expect(await screen.findByTestId('brain-error-state')).toHaveTextContent(/Brain signals unavailable/i)
  })
})
