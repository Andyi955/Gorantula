import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BrainSignalsPanel from '../../src/components/BrainSignalsPanel'
import type { BrainSignal, MemoryLink } from '../../src/utils/brainMemory'
import { BOARD_WORKSPACE_STATE_UPDATED_EVENT } from '../../src/utils/boardWorkspaceEvents'

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

const makeLink = (overrides: Partial<MemoryLink> = {}): MemoryLink => {
  const toInvestigationId = overrides.toInvestigationId || 'inv-older'
  const toTitle = overrides.toTitle || 'Older Substation Case'
  const score = overrides.score ?? 0.72

  return {
    ...link,
    id: overrides.id || `brain-link-${toInvestigationId}`,
    signalId: overrides.signalId || `brain-signal-${toInvestigationId}`,
    toInvestigationId,
    toTitle,
    score,
    gateways: overrides.gateways || link.gateways,
    reasons: overrides.reasons || link.reasons,
    suggestedAction: overrides.suggestedAction || link.suggestedAction,
    createdAt: overrides.createdAt || link.createdAt,
    fromInvestigationId: overrides.fromInvestigationId || link.fromInvestigationId,
    fromTitle: overrides.fromTitle || link.fromTitle,
  }
}

const makeSignal = (overrides: Partial<BrainSignal> = {}): BrainSignal => {
  const id = overrides.id || `brain-signal-${overrides.targetInvestigationId || 'case'}`
  const targetInvestigationId = overrides.targetInvestigationId || 'inv-older'
  const targetTitle = overrides.targetTitle || 'Older Substation Case'
  const score = overrides.score ?? 0.72
  const createdAt = overrides.createdAt || '2026-06-05T12:00:00Z'

  return {
    ...signal,
    id,
    targetInvestigationId,
    targetTitle,
    score,
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    reasons: overrides.reasons || [
      {
        ...signal.reasons[0],
        value: `${targetInvestigationId}:entity`,
        label: targetTitle,
        detail: `${targetTitle} overlaps with this investigation.`,
      },
    ],
    suggestedAction: overrides.suggestedAction || signal.suggestedAction,
    gateways: overrides.gateways || signal.gateways,
    dismissed: overrides.dismissed ?? false,
    linked: overrides.linked ?? false,
    linkId: overrides.linkId,
    investigationId: overrides.investigationId || signal.investigationId,
    investigationTitle: overrides.investigationTitle || signal.investigationTitle,
  }
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
    if (method === 'PUT' && url.endsWith('/forget')) {
      return Promise.resolve(jsonResponse(links[0] || link) as Response)
    }

    return Promise.resolve(jsonResponse({}, 404) as Response)
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const openBrainView = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole('button', { name }))
}

describe('BrainSignalsPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders loading and empty states', async () => {
    const user = userEvent.setup()
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
    await openBrainView(user, /active signals view/i)

    expect(screen.getByTestId('brain-loading-state')).toHaveTextContent(/Scanning memory gateways/i)

    resolveSignals(jsonResponse([]) as Response)

    expect(await screen.findByTestId('brain-empty-state')).toHaveTextContent(/No brain signals fired/i)
  })

  it('renders ranked signals, reason chips, and existing links', async () => {
    const user = userEvent.setup()
    installBrainFetch({ signals: [signal], links: [link] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /active signals view/i)

    const card = await screen.findByTestId('brain-signal-card')
    expect(card).toHaveTextContent('Older Substation Case')
    expect(card).toHaveTextContent('92%')
    expect(card).toHaveTextContent('Entity/Date')
    expect(card).toHaveTextContent('Source Domain')
    expect(card).toHaveTextContent(/Northgate Substation A-17 appears in both investigations/i)
    expect(card).toHaveTextContent('Review older case')

    await openBrainView(user, /memory links view/i)

    const linkedMemory = await screen.findByTestId('brain-link-card')
    expect(linkedMemory).toHaveTextContent('Older Substation Case')
    expect(linkedMemory).toHaveTextContent('Entity/Date')
  })

  it('loads links after signal generation so auto-promoted links appear on the first scan', async () => {
    const user = userEvent.setup()
    let signalGenerationComplete = false
    const autoLink = {
      ...makeLink({ id: 'brain-link-auto-first-scan', toTitle: 'Auto Linked Case', score: 0.9 }),
      promotionType: 'auto',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/brain/signals?')) {
        await Promise.resolve()
        signalGenerationComplete = true
        return jsonResponse([]) as Response
      }

      if (url.includes('/api/brain/links?')) {
        return jsonResponse(signalGenerationComplete ? [autoLink] : []) as Response
      }

      return jsonResponse({}, 404) as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    const linkedMemory = await screen.findByTestId('brain-link-card')
    expect(linkedMemory).toHaveTextContent('Auto Linked Case')
    expect(linkedMemory).toHaveTextContent('Auto Memory')
  })

  it('refreshes after the active board persists new content while Brain is open', async () => {
    const user = userEvent.setup()
    let linkAvailable = false
    const autoLink = {
      ...makeLink({ id: 'brain-link-after-board-save', toTitle: 'Fresh Persisted Case', score: 0.9 }),
      promotionType: 'auto',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/brain/signals?')) {
        return jsonResponse([]) as Response
      }

      if (url.includes('/api/brain/links?')) {
        return jsonResponse(linkAvailable ? [autoLink] : []) as Response
      }

      return jsonResponse({}, 404) as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    expect(await screen.findByTestId('brain-links-empty-state')).toHaveTextContent(/No memory links promoted/i)

    linkAvailable = true
    window.dispatchEvent(new CustomEvent(BOARD_WORKSPACE_STATE_UPDATED_EVENT, {
      detail: {
        investigationId: 'inv-current',
        persisted: true,
        contentSignature: 'nodes:2|edges:1|fresh-content',
      },
    }))

    await waitFor(() => {
      const linkedMemory = screen.getByTestId('brain-link-card')
      expect(linkedMemory).toHaveTextContent('Fresh Persisted Case')
      expect(linkedMemory).toHaveTextContent('Auto Memory')
    })
  })

  it('keeps linked memory scannable when promoted links grow', async () => {
    const user = userEvent.setup()
    const links = Array.from({ length: 7 }, (_, index) => makeLink({
      id: `brain-link-${index}`,
      signalId: `brain-signal-link-${index}`,
      toInvestigationId: `inv-linked-${index}`,
      toTitle: `Linked Memory Case ${index}`,
      score: 0.9 - index * 0.04,
      createdAt: `2026-06-05T12:0${index}:00Z`,
    }))

    installBrainFetch({ signals: [], links })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    await waitFor(() => {
      expect(screen.getAllByTestId('brain-link-card')).toHaveLength(5)
    })
    expect(screen.queryByText('Linked Memory Case 5')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show older memory links \(2\)/i }))

    expect(screen.getAllByTestId('brain-link-card')).toHaveLength(7)
    expect(screen.getByText('Linked Memory Case 5')).toBeInTheDocument()
    expect(screen.getByText('Linked Memory Case 6')).toBeInTheDocument()
  })

  it('shows auto-promoted memory strength on linked cards', async () => {
    const user = userEvent.setup()
    const autoLink = {
      ...makeLink({ id: 'brain-link-auto', toTitle: 'Auto Linked Case', score: 0.9 }),
      promotionType: 'auto',
      activationCount: 4,
      lastFiredAt: '2026-06-06T09:00:00Z',
    }
    installBrainFetch({ signals: [], links: [autoLink] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    const card = await screen.findByTestId('brain-link-card')
    expect(card).toHaveTextContent('Auto Memory')
    expect(card).toHaveTextContent('4 activations')
  })

  it('compresses duplicate linked memories by older case title', async () => {
    const user = userEvent.setup()
    const duplicateLinks = [
      {
        ...makeLink({
          id: 'brain-link-duplicate-a',
          toInvestigationId: 'inv-duplicate-a',
          toTitle: 'Repeated AI Case',
          score: 0.86,
          gateways: ['entity-date'],
          reasons: [signal.reasons[0]],
        }),
        activationCount: 2,
      },
      {
        ...makeLink({
          id: 'brain-link-duplicate-b',
          toInvestigationId: 'inv-duplicate-b',
          toTitle: 'Repeated AI Case',
          score: 0.72,
          gateways: ['source-domain'],
          reasons: [signal.reasons[1]],
        }),
        activationCount: 3,
      },
    ]
    installBrainFetch({ signals: [], links: duplicateLinks })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    const card = await screen.findByTestId('brain-link-card')
    expect(screen.getAllByTestId('brain-link-card')).toHaveLength(1)
    expect(card).toHaveTextContent('Repeated AI Case')
    expect(card).toHaveTextContent('+1 related memory')
    expect(card).toHaveTextContent('5 activations')
    expect(card).toHaveTextContent('Entity/Date')
    expect(card).toHaveTextContent('Source Domain')
  })

  it('filters active signals and linked memories by gateway and strength', async () => {
    const user = userEvent.setup()
    const entitySignal = makeSignal({
      id: 'brain-signal-entity-filter',
      targetInvestigationId: 'inv-entity-filter',
      targetTitle: 'Entity Filter Case',
      score: 0.82,
      gateways: ['entity-date'],
      reasons: [signal.reasons[0]],
    })
    const sourceSignal = makeSignal({
      id: 'brain-signal-source-filter',
      targetInvestigationId: 'inv-source-filter',
      targetTitle: 'Source Filter Case',
      score: 0.52,
      gateways: ['source-domain'],
      reasons: [signal.reasons[1]],
      suggestedAction: 'Compare source domain',
    })
    const entityLink = makeLink({
      id: 'brain-link-entity-filter',
      toInvestigationId: 'inv-link-entity-filter',
      toTitle: 'Entity Linked Memory',
      score: 0.82,
      gateways: ['entity-date'],
      reasons: [signal.reasons[0]],
    })
    const sourceLink = makeLink({
      id: 'brain-link-source-filter',
      toInvestigationId: 'inv-link-source-filter',
      toTitle: 'Source Linked Memory',
      score: 0.52,
      gateways: ['source-domain'],
      reasons: [signal.reasons[1]],
    })
    installBrainFetch({ signals: [entitySignal, sourceSignal], links: [entityLink, sourceLink] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /active signals view/i)

    await waitFor(() => {
      expect(screen.getAllByTestId('brain-signal-card')).toHaveLength(2)
    })
    expect(screen.getAllByText('Source Filter Case').length).toBeGreaterThan(0)
    expect(screen.queryByText('Entity Linked Memory')).not.toBeInTheDocument()

    await openBrainView(user, /memory links view/i)

    await waitFor(() => {
      expect(screen.getAllByTestId('brain-link-card')).toHaveLength(2)
    })
    expect(screen.getAllByText('Entity Linked Memory').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Source Linked Memory').length).toBeGreaterThan(0)

    await openBrainView(user, /active signals view/i)
    await user.click(screen.getByRole('button', { name: /source domain filter/i }))

    expect(screen.queryByText('Entity Filter Case')).not.toBeInTheDocument()
    expect(screen.getAllByText('Source Filter Case').length).toBeGreaterThan(0)
    await openBrainView(user, /memory links view/i)
    expect(screen.queryByText('Entity Linked Memory')).not.toBeInTheDocument()
    expect(screen.getAllByText('Source Linked Memory').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /hot filter/i }))

    expect(screen.queryByText('Source Linked Memory')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /all gateways filter/i }))

    expect(screen.getAllByText('Entity Linked Memory').length).toBeGreaterThan(0)
    await openBrainView(user, /active signals view/i)
    expect(screen.getAllByText('Entity Filter Case').length).toBeGreaterThan(0)
    expect(screen.queryByText('Source Filter Case')).not.toBeInTheDocument()
  })

  it('summarizes brain memory health across active and linked memory', async () => {
    const sourceSignal = makeSignal({
      id: 'brain-signal-health-source',
      targetInvestigationId: 'inv-health-source',
      targetTitle: 'Health Source Case',
      score: 0.52,
      gateways: ['source-domain'],
      reasons: [signal.reasons[1]],
      suggestedAction: 'Compare source domain',
    })
    const autoLink = {
      ...makeLink({
        id: 'brain-link-health-auto',
        toInvestigationId: 'inv-health-auto',
        toTitle: 'Health Auto Memory',
        score: 0.88,
        gateways: ['entity-date', 'source-domain'],
        reasons: signal.reasons,
      }),
      promotionType: 'auto',
      activationCount: 3,
    }
    installBrainFetch({ signals: [signal, sourceSignal], links: [autoLink, link] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const health = await screen.findByTestId('brain-health-summary')
    expect(health).toHaveTextContent('2 firing cases')
    expect(health).toHaveTextContent('2 memory groups')
    expect(health).toHaveTextContent('1 auto')
    expect(health).toHaveTextContent('92%')
    expect(health).toHaveTextContent('Entity/Date')
  })

  it('renders a readable brain map with digest and selected memory detail', async () => {
    const user = userEvent.setup()
    const onOpenInvestigation = vi.fn()
    const autoLink = {
      ...makeLink({
        id: 'brain-link-map-auto',
        toInvestigationId: 'inv-map-auto',
        toTitle: 'Auto Linked Case',
        score: 0.88,
        gateways: ['entity-date'],
        reasons: [signal.reasons[0]],
      }),
      promotionType: 'auto',
      activationCount: 3,
    }
    const sourceSignal = makeSignal({
      id: 'brain-signal-map-source',
      targetInvestigationId: 'inv-map-source',
      targetTitle: 'Source Domain Case',
      score: 0.76,
      gateways: ['source-domain'],
      reasons: [signal.reasons[1]],
      lastFiredAt: '2026-06-06T09:00:00Z',
    })
    installBrainFetch({ signals: [sourceSignal], links: [autoLink] })

    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
        onOpenInvestigation={onOpenInvestigation}
      />,
    )

    const radar = await screen.findByTestId('brain-map-radar')
    expect(radar).toHaveTextContent('Memory map')
    expect(radar).toHaveTextContent('Current Grid Case')
    expect(radar).toHaveTextContent('Auto Linked Case')
    expect(radar).toHaveTextContent('Source Domain Case')
    expect(within(radar).getAllByTestId('brain-map-node')).toHaveLength(3)

    const digest = within(radar).getByTestId('brain-map-digest')
    expect(digest).toHaveTextContent('Auto memory created')
    expect(digest).toHaveTextContent('Signal fired')

    await user.click(within(radar).getByRole('button', { name: /select memory auto linked case/i }))

    const detail = within(radar).getByTestId('brain-map-selected-node')
    expect(detail).toHaveTextContent('Auto Linked Case')
    expect(detail).toHaveTextContent('Auto')
    expect(detail).toHaveTextContent('Northgate Substation A-17 appears in both investigations.')

    await user.click(within(detail).getByRole('button', { name: /open radar memory auto linked case/i }))
    expect(onOpenInvestigation).toHaveBeenCalledWith('inv-map-auto')
  })

  it('separates the Brain map, active signal feed, and linked-memory archive into sub-tabs', async () => {
    const user = userEvent.setup()
    installBrainFetch({ signals: [signal], links: [link] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    expect(await screen.findByTestId('brain-map-radar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /memory map view/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-link-card')).not.toBeInTheDocument()

    await openBrainView(user, /active signals view/i)
    expect(await screen.findByTestId('brain-signal-card')).toHaveTextContent('Older Substation Case')
    expect(screen.queryByTestId('brain-map-radar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-link-card')).not.toBeInTheDocument()

    await openBrainView(user, /memory links view/i)
    expect(await screen.findByTestId('brain-link-card')).toHaveTextContent('Older Substation Case')
    expect(screen.queryByTestId('brain-map-radar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
  })

  it('opens a linked memory detail view with evidence and matched node ids', async () => {
    const user = userEvent.setup()
    const onOpenInvestigation = vi.fn()
    const detailedLink = {
      ...makeLink({
        id: 'brain-link-detail',
        toTitle: 'Older Substation Case',
        score: 0.92,
        gateways: ['entity-date', 'source-domain'],
        reasons: signal.reasons,
      }),
      promotionType: 'auto',
      activationCount: 4,
      createdAt: '2026-06-05T12:00:00Z',
      updatedAt: '2026-06-06T08:30:00Z',
      lastFiredAt: '2026-06-06T09:00:00Z',
    }
    installBrainFetch({ signals: [], links: [detailedLink] })

    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
        onOpenInvestigation={onOpenInvestigation}
      />,
    )
    await openBrainView(user, /memory links view/i)

    await user.click(await screen.findByRole('button', { name: /inspect memory link older substation case/i }))

    const detail = await screen.findByTestId('brain-link-detail')
    expect(detail).toHaveTextContent('Current Grid Case')
    expect(detail).toHaveTextContent('Older Substation Case')
    expect(detail).toHaveTextContent('92%')
    expect(detail).toHaveTextContent('Auto Memory')
    expect(detail).toHaveTextContent('4 activations')
    expect(detail).toHaveTextContent('First fired')
    expect(detail).toHaveTextContent('2026-06-05')
    expect(detail).toHaveTextContent('Last fired')
    expect(detail).toHaveTextContent('2026-06-06')
    expect(detail).toHaveTextContent('Entity/Date')
    expect(detail).toHaveTextContent('Source Domain')
    expect(detail).toHaveTextContent('Northgate Substation A-17 appears in both investigations.')
    expect(detail).toHaveTextContent('node-current')
    expect(detail).toHaveTextContent('node-older')

    await user.click(within(detail).getByRole('button', { name: /open memory link older substation case/i }))
    expect(onOpenInvestigation).toHaveBeenCalledWith('inv-older')
  })

  it('forgets a linked memory from the detail view', async () => {
    const user = userEvent.setup()
    const detailedLink = makeLink({
      id: 'brain-link-detail',
      toTitle: 'Older Substation Case',
      score: 0.92,
      gateways: ['entity-date', 'source-domain'],
      reasons: signal.reasons,
    })
    const fetchMock = installBrainFetch({ signals: [], links: [detailedLink] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    await user.click(await screen.findByRole('button', { name: /inspect memory link older substation case/i }))
    const detail = await screen.findByTestId('brain-link-detail')
    await user.click(within(detail).getByRole('button', { name: /forget memory link older substation case/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('brain-link-card')).not.toBeInTheDocument()
    })
    expect(screen.queryByTestId('brain-link-detail')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/links/brain-link-detail/forget',
      expect.objectContaining({ method: 'PUT' }),
    )
  })

  it('groups duplicate older cases and collapses weak or overflow signals', async () => {
    const user = userEvent.setup()
    const duplicateSignal = makeSignal({
      id: 'brain-signal-alpha-duplicate',
      targetInvestigationId: 'inv-older-copy',
      targetTitle: 'Older Substation Case',
      score: 0.74,
      suggestedAction: 'Compare source domain',
      reasons: [
        {
          ...signal.reasons[1],
          detail: 'Both duplicate investigations cite operator.example.',
        },
      ],
    })
    const highSignals = Array.from({ length: 11 }, (_, index) => makeSignal({
      id: `brain-signal-high-${index}`,
      targetInvestigationId: `inv-high-${index}`,
      targetTitle: `High Priority Case ${index}`,
      score: 0.91 - index * 0.01,
    }))
    const weakSignal = makeSignal({
      id: 'brain-signal-weak-domain',
      targetInvestigationId: 'inv-weak-domain',
      targetTitle: 'Weak Domain Case',
      score: 0.24,
      gateways: ['source-domain'],
      reasons: [
        {
          ...signal.reasons[1],
          detail: 'Source domain "example.com" appears in both investigations.',
        },
      ],
      suggestedAction: 'Compare source domain',
    })

    installBrainFetch({ signals: [signal, duplicateSignal, ...highSignals, weakSignal], links: [] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /active signals view/i)

    await waitFor(() => {
      expect(screen.getAllByTestId('brain-signal-card')).toHaveLength(10)
    })

    const visibleCards = screen.getAllByTestId('brain-signal-card')
    const groupedOlderCards = visibleCards.filter((card) => card.textContent?.includes('Older Substation Case'))
    expect(groupedOlderCards).toHaveLength(1)
    expect(groupedOlderCards[0]).toHaveTextContent('+1 related firing')
    expect(groupedOlderCards[0]).toHaveTextContent('92%')
    expect(groupedOlderCards[0]).toHaveTextContent('Hot')
    expect(groupedOlderCards[0]).toHaveTextContent('Why it fired')
    expect(groupedOlderCards[0]).toHaveTextContent('Northgate Substation A-17, operator.example')
    const gatewayRow = within(groupedOlderCards[0]).getByLabelText('Signal gateways')
    expect(within(gatewayRow).getAllByText('Entity/Date')).toHaveLength(1)
    expect(within(gatewayRow).getAllByText('Source Domain x2')).toHaveLength(1)
    expect(screen.queryByText('Weak Domain Case')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show lower-priority signals \(3\)/i }))

    expect(screen.getByText('Weak Domain Case')).toBeInTheDocument()
    expect(screen.getAllByTestId('brain-signal-card')).toHaveLength(13)
  })

  it('dismisses every signal in a grouped older case', async () => {
    const user = userEvent.setup()
    const duplicateSignal = makeSignal({
      id: 'brain-signal-alpha-duplicate',
      targetInvestigationId: 'inv-older-copy',
      targetTitle: 'Older Substation Case',
      score: 0.74,
    })
    const fetchMock = installBrainFetch({ signals: [signal, duplicateSignal], links: [] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /active signals view/i)

    const card = await screen.findByTestId('brain-signal-card')
    await user.click(within(card).getByRole('button', { name: /dismiss signal for older substation case/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/signals/brain-signal-alpha/dismiss',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/signals/brain-signal-alpha-duplicate/dismiss',
      expect.objectContaining({ method: 'PUT' }),
    )
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
    await openBrainView(user, /active signals view/i)

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

    cleanup()
    installBrainFetch({ signals: [signal], links: [], promoteLink: link })
    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
      />,
    )
    await openBrainView(user, /active signals view/i)

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
