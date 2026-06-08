import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BrainSignalsPanel from '../../src/components/BrainSignalsPanel'
import type { BrainSignal, BrainSuggestion, MemoryCluster, MemoryLink } from '../../src/utils/brainMemory'
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

const cluster: MemoryCluster = {
  id: 'brain-cluster-acme',
  label: 'Acme Grid',
  summary: 'Acme Grid links 3 investigations through entity/date recall with 1 active signal and 1 durable memory link.',
  score: 0.86,
  status: 'active',
  dominantGateway: 'entity-date',
  gatewayCounts: {
    'entity-date': 3,
  },
  memberInvestigationIds: ['inv-current', 'inv-older', 'inv-third'],
  members: [
    { investigationId: 'inv-current', title: 'Current Grid Case', role: 'current' },
    { investigationId: 'inv-older', title: 'Older Substation Case', role: 'memory' },
    { investigationId: 'inv-third', title: 'Third Grid Case', role: 'memory' },
  ],
  signalIds: [signal.id],
  memoryLinkIds: [link.id],
  reasonSamples: [signal.reasons[0]],
  pinned: false,
  hidden: false,
  createdAt: '2026-06-05T12:00:00Z',
  updatedAt: '2026-06-05T12:00:00Z',
  lastActivatedAt: '2026-06-06T09:00:00Z',
}

const suggestion: BrainSuggestion = {
  id: 'brain-suggestion-next-move',
  investigationId: 'inv-current',
  kind: 'cluster-review',
  status: 'active',
  title: 'Review active memory cluster',
  summary: 'Acme Grid has an active memory cluster worth checking.',
  suggestedAction: 'Inspect recurring memory cluster',
  score: 0.86,
  priority: 'high',
  reason: 'Acme Grid is an active cluster with 3 related investigations.',
  relatedSignalIds: [signal.id],
  relatedMemoryLinkIds: [link.id],
  relatedClusterIds: [cluster.id],
  targetInvestigationIds: ['inv-older'],
  createdAt: '2026-06-05T12:00:00Z',
  updatedAt: '2026-06-05T12:00:00Z',
}

const backendBrainMap = {
  investigationId: 'inv-current',
  investigationTitle: 'Current Grid Case',
  generatedAt: '2026-06-08T10:00:00Z',
  nodes: [
    {
      id: 'brain-map-current',
      kind: 'current',
      title: 'Current Grid Case',
      subtitle: 'Current investigation focus',
      score: 1,
      status: 'focus',
      badges: ['Current'],
      investigationId: 'inv-current',
      relatedSignalIds: [],
      relatedMemoryLinkIds: [],
      memberInvestigationIds: [],
      reasonSamples: [],
      x: 50,
      y: 50,
    },
    {
      id: 'brain-map-cluster-backend',
      kind: 'cluster',
      title: 'Backend Cluster Region',
      subtitle: 'Backend map payload controls this visible region.',
      score: 0.88,
      status: 'active',
      gateway: 'entity-date',
      badges: ['Active', 'Entity/date'],
      clusterId: 'cluster-backend',
      relatedSignalIds: [signal.id],
      relatedMemoryLinkIds: [link.id],
      memberInvestigationIds: ['inv-current', 'inv-older'],
      reasonSamples: [signal.reasons[0]],
      x: 22,
      y: 34,
    },
  ],
  edges: [
    {
      id: 'brain-map-edge-backend',
      kind: 'cluster',
      from: 'brain-map-current',
      to: 'brain-map-cluster-backend',
      label: 'Memory cluster',
      score: 0.88,
      gateway: 'entity-date',
      clusterId: 'cluster-backend',
    },
  ],
  regions: [
    {
      id: 'brain-map-region-backend',
      clusterId: 'cluster-backend',
      label: 'Backend Cluster Region',
      status: 'active',
      score: 0.88,
      gateway: 'entity-date',
      nodeIds: ['brain-map-cluster-backend'],
      memberInvestigationIds: ['inv-current', 'inv-older'],
      x: 22,
      y: 34,
    },
  ],
  digest: [
    {
      id: 'brain-map-digest-backend',
      tone: 'hot',
      title: 'Backend map loaded',
      detail: 'The Memory Map is using backend graph data.',
    },
  ],
  summary: {
    visibleNodeCount: 2,
    edgeCount: 1,
    clusterCount: 1,
    linkedMemoryCount: 1,
    activeSignalCount: 1,
    suggestionCount: 1,
    strongestScore: 0.88,
  },
}

const emptyBackendBrainMap = {
  ...backendBrainMap,
  nodes: [],
  edges: [],
  regions: [],
  digest: [],
  summary: {
    visibleNodeCount: 0,
    edgeCount: 0,
    clusterCount: 0,
    linkedMemoryCount: 0,
    activeSignalCount: 0,
    suggestionCount: 0,
    strongestScore: 0,
  },
}

const crowdedBackendBrainMap = {
  ...backendBrainMap,
  nodes: [
    backendBrainMap.nodes[0],
    ...Array.from({ length: 12 }, (_, index) => ({
      ...backendBrainMap.nodes[1],
      id: `brain-map-crowded-${index}`,
      kind: index % 3 === 0 ? 'cluster' : index % 3 === 1 ? 'memory' : 'signal',
      title: `Crowded Memory ${index}`,
      subtitle: `Crowded memory node ${index}`,
      score: 0.94 - index * 0.03,
      clusterId: `crowded-cluster-${Math.floor(index / 3)}`,
      signalId: index % 3 === 2 ? `crowded-signal-${index}` : undefined,
      linkId: index % 3 === 1 ? `crowded-link-${index}` : undefined,
      relatedSignalIds: [`crowded-signal-${index}`],
      relatedMemoryLinkIds: [`crowded-link-${index}`],
      x: 50,
      y: 50,
    })),
  ],
  edges: Array.from({ length: 12 }, (_, index) => ({
    ...backendBrainMap.edges[0],
    id: `brain-map-crowded-edge-${index}`,
    to: `brain-map-crowded-${index}`,
    kind: index % 3 === 0 ? 'cluster' : index % 3 === 1 ? 'link' : 'signal',
    score: 0.94 - index * 0.03,
  })),
  regions: Array.from({ length: 4 }, (_, index) => ({
    ...backendBrainMap.regions[0],
    id: `brain-map-crowded-region-${index}`,
    clusterId: `crowded-cluster-${index}`,
    label: `Crowded Region ${index}`,
    score: 0.94 - index * 0.06,
    nodeIds: [`brain-map-crowded-${index * 3}`, `brain-map-crowded-${index * 3 + 1}`, `brain-map-crowded-${index * 3 + 2}`],
    x: 50,
    y: 50,
  })),
  summary: {
    ...backendBrainMap.summary,
    visibleNodeCount: 13,
    edgeCount: 12,
    clusterCount: 4,
    linkedMemoryCount: 4,
    activeSignalCount: 4,
    strongestScore: 0.94,
  },
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

const makeCluster = (overrides: Partial<MemoryCluster> = {}): MemoryCluster => ({
  ...cluster,
  ...overrides,
  gatewayCounts: overrides.gatewayCounts || cluster.gatewayCounts,
  memberInvestigationIds: overrides.memberInvestigationIds || cluster.memberInvestigationIds,
  members: overrides.members || cluster.members,
  signalIds: overrides.signalIds || cluster.signalIds,
  memoryLinkIds: overrides.memoryLinkIds || cluster.memoryLinkIds,
  reasonSamples: overrides.reasonSamples || cluster.reasonSamples,
})

const makeSuggestion = (overrides: Partial<BrainSuggestion> = {}): BrainSuggestion => ({
  ...suggestion,
  ...overrides,
  relatedSignalIds: overrides.relatedSignalIds || suggestion.relatedSignalIds,
  relatedMemoryLinkIds: overrides.relatedMemoryLinkIds || suggestion.relatedMemoryLinkIds,
  relatedClusterIds: overrides.relatedClusterIds || suggestion.relatedClusterIds,
  targetInvestigationIds: overrides.targetInvestigationIds || suggestion.targetInvestigationIds,
})

const jsonResponse = (payload: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
})

const installBrainFetch = ({
  signals = [],
  links = [],
  clusters = [],
  suggestions = [],
  brainMap = emptyBackendBrainMap,
  promoteLink = link,
}: {
  signals?: BrainSignal[]
  links?: MemoryLink[]
  clusters?: MemoryCluster[]
  suggestions?: BrainSuggestion[]
  brainMap?: typeof backendBrainMap
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
    if (url.includes('/api/brain/map?')) {
      return Promise.resolve(jsonResponse(brainMap) as Response)
    }
    if (url.includes('/api/brain/clusters?')) {
      return Promise.resolve(jsonResponse(clusters) as Response)
    }
    if (url.includes('/api/brain/suggestions?')) {
      return Promise.resolve(jsonResponse(suggestions) as Response)
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
    if (method === 'PUT' && url.includes('/api/brain/clusters/') && url.endsWith('/pin')) {
      const target = clusters.find((candidate) => url.includes(candidate.id)) || cluster
      return Promise.resolve(jsonResponse({ ...target, pinned: !target.pinned }) as Response)
    }
    if (method === 'PUT' && url.includes('/api/brain/clusters/') && url.endsWith('/hide')) {
      const target = clusters.find((candidate) => url.includes(candidate.id)) || cluster
      return Promise.resolve(jsonResponse({ ...target, hidden: true }) as Response)
    }
    if (method === 'PUT' && url.includes('/api/brain/clusters/') && url.endsWith('/unhide')) {
      const target = clusters.find((candidate) => url.includes(candidate.id)) || cluster
      return Promise.resolve(jsonResponse({ ...target, hidden: false }) as Response)
    }
    if (method === 'PUT' && url.includes('/api/brain/suggestions/') && url.endsWith('/dismiss')) {
      const target = suggestions.find((candidate) => url.includes(candidate.id)) || suggestion
      return Promise.resolve(jsonResponse({ ...target, status: 'dismissed', dismissedAt: '2026-06-06T10:00:00Z' }) as Response)
    }
    if (method === 'PUT' && url.includes('/api/brain/suggestions/') && url.endsWith('/review')) {
      const target = suggestions.find((candidate) => url.includes(candidate.id)) || suggestion
      return Promise.resolve(jsonResponse({ ...target, status: 'reviewed', reviewedAt: '2026-06-06T10:00:00Z' }) as Response)
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
    vi.useRealTimers()
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

  it('renders next moves from brain suggestions', async () => {
    const user = userEvent.setup()
    installBrainFetch({ signals: [signal], links: [link], clusters: [cluster], suggestions: [suggestion] })

    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
      />,
    )
    await openBrainView(user, /next moves view/i)

    const card = await screen.findByTestId('brain-suggestion-card')
    expect(card).toHaveTextContent('Review active memory cluster')
    expect(card).toHaveTextContent('Cluster Review')
    expect(card).toHaveTextContent('Inspect recurring memory cluster')
    expect(card).toHaveTextContent('Acme Grid is an active cluster')
    expect(card).toHaveTextContent('1 cluster')
    expect(card).toHaveTextContent('1 signal')
    expect(card).toHaveTextContent('1 link')
  })

  it('does not crash when suggestion relationship arrays are null', async () => {
    const user = userEvent.setup()
    const nullableSuggestion = {
      ...suggestion,
      relatedSignalIds: null as unknown as string[],
      relatedMemoryLinkIds: null as unknown as string[],
      relatedClusterIds: null as unknown as string[],
      targetInvestigationIds: null as unknown as string[],
    }
    installBrainFetch({ suggestions: [nullableSuggestion] })

    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
      />,
    )
    await openBrainView(user, /next moves view/i)

    const card = await screen.findByTestId('brain-suggestion-card')
    expect(card).toHaveTextContent('Review active memory cluster')
    expect(card).not.toHaveTextContent('1 cluster')
    expect(within(card).getByRole('button', { name: /^open$/i })).toBeDisabled()
  })

  it('marks next moves reviewed and dismisses them', async () => {
    const user = userEvent.setup()
    const fetchMock = installBrainFetch({ suggestions: [suggestion] })

    render(
      <BrainSignalsPanel
        currentInvestigationId="inv-current"
        currentInvestigationTitle="Current Grid Case"
      />,
    )
    await openBrainView(user, /next moves view/i)

    const card = await screen.findByTestId('brain-suggestion-card')
    await user.click(within(card).getByRole('button', { name: /mark reviewed/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/suggestions/brain-suggestion-next-move/review',
      expect.objectContaining({ method: 'PUT' }),
    )

    const reviewedSection = await screen.findByText(/reviewed context/i)
    expect(reviewedSection).toBeInTheDocument()
    expect(await screen.findByTestId('brain-suggestion-card')).toHaveTextContent('Reviewed')

    await user.click(within(screen.getByTestId('brain-suggestion-card')).getByRole('button', { name: /dismiss/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/suggestions/brain-suggestion-next-move/dismiss',
      expect.objectContaining({ method: 'PUT' }),
    )
    await waitFor(() => {
      expect(screen.queryByTestId('brain-suggestion-card')).not.toBeInTheDocument()
    })
  })

  it('caps active next moves and folds lower-priority suggestions', async () => {
    const user = userEvent.setup()
    const suggestions = Array.from({ length: 9 }, (_, index) => makeSuggestion({
      id: `brain-suggestion-${index}`,
      title: `Next Move Case ${index}`,
      score: 0.95 - index * 0.04,
      priority: index < 3 ? 'high' : index < 7 ? 'medium' : 'low',
      reason: `Next move ${index} has supporting memory context.`,
      targetInvestigationIds: [`inv-target-${index}`],
    }))
    installBrainFetch({ suggestions })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /next moves view/i)

    await waitFor(() => {
      expect(screen.getAllByTestId('brain-suggestion-card')).toHaveLength(7)
    })
    expect(screen.getByText('Next Move Case 0')).toBeInTheDocument()
    expect(screen.queryByText('Next Move Case 7')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show lower-priority moves \(2\)/i }))

    expect(screen.getAllByTestId('brain-suggestion-card')).toHaveLength(9)
    expect(screen.getByText('Next Move Case 7')).toBeInTheDocument()
    expect(screen.getByText('Next Move Case 8')).toBeInTheDocument()
  })

  it('jumps from next moves to related brain sections', async () => {
    const user = userEvent.setup()
    const clusterSuggestion = makeSuggestion({
      id: 'brain-suggestion-cluster-jump',
      title: 'Jump to cluster context',
      relatedClusterIds: [cluster.id],
      relatedMemoryLinkIds: [],
      relatedSignalIds: [],
    })
    const linkSuggestion = makeSuggestion({
      id: 'brain-suggestion-link-jump',
      kind: 'memory-link-compare',
      title: 'Jump to linked memory',
      relatedClusterIds: [],
      relatedMemoryLinkIds: [link.id],
      relatedSignalIds: [],
    })
    const signalSuggestion = makeSuggestion({
      id: 'brain-suggestion-signal-jump',
      kind: 'source-review',
      title: 'Jump to active signal',
      relatedClusterIds: [],
      relatedMemoryLinkIds: [],
      relatedSignalIds: [signal.id],
    })
    installBrainFetch({
      signals: [signal],
      links: [link],
      clusters: [cluster],
      suggestions: [clusterSuggestion, linkSuggestion, signalSuggestion],
    })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /next moves view/i)

    const clusterMove = screen.getByText('Jump to cluster context').closest('article') as HTMLElement
    await user.click(within(clusterMove).getByRole('button', { name: /view cluster/i }))
    expect(await screen.findByTestId('brain-cluster-detail')).toHaveAttribute(
      'aria-label',
      'Memory cluster detail for Acme Grid',
    )

    await openBrainView(user, /next moves view/i)
    const linkMove = screen.getByText('Jump to linked memory').closest('article') as HTMLElement
    await user.click(within(linkMove).getByRole('button', { name: /view link/i }))
    expect(await screen.findByTestId('brain-link-detail')).toHaveAttribute(
      'aria-label',
      'Memory link detail for Older Substation Case',
    )

    await openBrainView(user, /next moves view/i)
    const signalMove = screen.getByText('Jump to active signal').closest('article') as HTMLElement
    await user.click(within(signalMove).getByRole('button', { name: /view signal/i }))
    expect(await screen.findByTestId('brain-signal-card')).toHaveTextContent('Older Substation Case')
  })

  it('jumps from a next move to the related living map node', async () => {
    const user = userEvent.setup()
    const mapSuggestion = makeSuggestion({
      id: 'brain-suggestion-map-jump',
      title: 'Jump to living map',
      relatedClusterIds: ['cluster-backend'],
      relatedMemoryLinkIds: [],
      relatedSignalIds: [],
    })
    installBrainFetch({ suggestions: [mapSuggestion], brainMap: backendBrainMap })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /next moves view/i)

    const mapMove = screen.getByText('Jump to living map').closest('article') as HTMLElement
    await user.click(within(mapMove).getByRole('button', { name: /view map/i }))

    const radar = await screen.findByTestId('brain-map-radar')
    const selectedNode = within(radar).getByTestId('brain-map-selected-node')
    expect(selectedNode).toHaveTextContent('Memory cluster')
    expect(selectedNode).toHaveTextContent('Backend Cluster Region')
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
      if (url.includes('/api/brain/clusters?')) {
        return jsonResponse([]) as Response
      }
      if (url.includes('/api/brain/suggestions?')) {
        return jsonResponse([]) as Response
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

  it('keeps checking briefly so delayed auto-promoted links appear without manual refresh', async () => {
    const user = userEvent.setup()
    let linkAvailable = false
    const delayedLink = {
      ...makeLink({ id: 'brain-link-delayed-auto', toTitle: 'Delayed Auto Memory', score: 0.9 }),
      promotionType: 'auto',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/brain/signals?')) {
        return jsonResponse([]) as Response
      }

      if (url.includes('/api/brain/links?')) {
        return jsonResponse(linkAvailable ? [delayedLink] : []) as Response
      }
      if (url.includes('/api/brain/clusters?')) {
        return jsonResponse([]) as Response
      }
      if (url.includes('/api/brain/suggestions?')) {
        return jsonResponse([]) as Response
      }

      return jsonResponse({}, 404) as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory links view/i)

    expect(await screen.findByTestId('brain-links-empty-state')).toHaveTextContent(/No memory links promoted/i)

    linkAvailable = true
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 1250))
    })

    await waitFor(() => {
      const linkedMemory = screen.getByTestId('brain-link-card')
      expect(linkedMemory).toHaveTextContent('Delayed Auto Memory')
      expect(linkedMemory).toHaveTextContent('Auto Memory')
    }, { timeout: 2500 })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/brain/links?')).length)
      .toBeGreaterThanOrEqual(2)
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
      if (url.includes('/api/brain/clusters?')) {
        return jsonResponse([]) as Response
      }
      if (url.includes('/api/brain/suggestions?')) {
        return jsonResponse([]) as Response
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

  it('renders the backend Brain Map graph when available', async () => {
    installBrainFetch({ brainMap: backendBrainMap })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const radar = await screen.findByTestId('brain-map-radar')
    expect(radar).toHaveTextContent('Backend Cluster Region')
    expect(radar).toHaveTextContent('Backend map loaded')
    expect(within(radar).getAllByTestId('brain-map-node')).toHaveLength(2)
  })

  it('renders living map regions and pathways from backend graph coordinates', async () => {
    installBrainFetch({ brainMap: backendBrainMap })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const radar = await screen.findByTestId('brain-map-radar')
    expect(within(radar).getByTestId('brain-map-graph-region')).toHaveTextContent('Backend Cluster Region')
    expect(within(radar).getByTestId('brain-map-graph-edge')).toHaveAttribute('data-edge-kind', 'cluster')

    await userEvent.click(within(radar).getByRole('button', { name: /select cluster backend cluster region/i }))
    expect(within(radar).getByTestId('brain-map-selected-node')).toHaveTextContent('Memory cluster')
  })

  it('expands and collapses the living brain map workspace', async () => {
    const user = userEvent.setup()
    installBrainFetch({ brainMap: backendBrainMap })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const radar = await screen.findByTestId('brain-map-radar')
    const canvas = within(radar).getByTestId('brain-map-canvas')
    expect(radar).not.toHaveClass('is-expanded')

    await user.click(within(canvas).getByRole('button', { name: /expand brain map/i }))
    expect(radar).toHaveClass('is-expanded')
    expect(within(canvas).getByRole('button', { name: /collapse brain map/i })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(canvas).getByRole('button', { name: /collapse brain map/i }))
    expect(radar).not.toHaveClass('is-expanded')
  })

  it('keeps crowded maps focused until the map is expanded', async () => {
    const user = userEvent.setup()
    installBrainFetch({ brainMap: crowdedBackendBrainMap })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const radar = await screen.findByTestId('brain-map-radar')
    const canvas = within(radar).getByTestId('brain-map-canvas')
    expect(within(radar).getAllByTestId('brain-map-node')).toHaveLength(8)
    expect(within(radar).queryByText('Crowded Memory 11')).not.toBeInTheDocument()
    expect(within(radar).getByRole('button', { name: /select cluster crowded memory 9/i })).toHaveAttribute('data-map-density', 'marker')

    await user.click(within(canvas).getByRole('button', { name: /expand brain map/i }))

    expect(within(radar).getAllByTestId('brain-map-node')).toHaveLength(13)
    expect(within(radar).getByText('Crowded Memory 11')).toBeInTheDocument()
    expect(within(radar).getByRole('button', { name: /select focus current investigation focus/i })).toHaveAttribute('data-map-density', 'card')
    expect(within(radar).getByRole('button', { name: /select signal crowded memory 11/i })).toHaveAttribute('data-map-density', 'marker')
    expect(within(radar).getByRole('button', { name: /select signal crowded memory 11/i })).toHaveClass('forensic-brain-map-node-spatial')
  })

  it('supports drag panning and wheel zoom in the expanded brain map', async () => {
    const user = userEvent.setup()
    installBrainFetch({ brainMap: crowdedBackendBrainMap })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    const radar = await screen.findByTestId('brain-map-radar')
    const canvas = within(radar).getByTestId('brain-map-canvas')
    await user.click(within(canvas).getByRole('button', { name: /expand brain map/i }))

    const viewport = within(canvas).getByTestId('brain-map-viewport')
    expect(within(canvas).queryByRole('button', { name: /pan brain map/i })).not.toBeInTheDocument()

    fireEvent.wheel(canvas, { deltaY: -78 })
    expect(viewport).toHaveStyle({ '--brain-map-scale': '1.12' })

    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 800,
      width: 1000,
      height: 800,
      toJSON: () => ({}),
    } as DOMRect)
    Object.assign(canvas, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
    })

    fireEvent.pointerDown(canvas, { pointerId: 7, button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(canvas, { pointerId: 7, clientX: 180, clientY: 140 })
    expect(viewport).toHaveStyle({ '--brain-map-pan-x': '8%' })
    expect(viewport).toHaveStyle({ '--brain-map-pan-y': '5%' })

    fireEvent.pointerUp(canvas, { pointerId: 7, clientX: 180, clientY: 140 })
    fireEvent.doubleClick(canvas)
    expect(viewport).toHaveStyle({
      '--brain-map-scale': '1',
      '--brain-map-pan-x': '0%',
      '--brain-map-pan-y': '0%',
    })
  })

  it('separates the Brain map, active signal feed, linked-memory archive, and clusters into sub-tabs', async () => {
    const user = userEvent.setup()
    installBrainFetch({ signals: [signal], links: [link], clusters: [cluster] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)

    expect(await screen.findByTestId('brain-map-radar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /memory map view/i })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-link-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-cluster-card')).not.toBeInTheDocument()

    await openBrainView(user, /active signals view/i)
    expect(await screen.findByTestId('brain-signal-card')).toHaveTextContent('Older Substation Case')
    expect(screen.queryByTestId('brain-map-radar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-link-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-cluster-card')).not.toBeInTheDocument()

    await openBrainView(user, /memory links view/i)
    expect(await screen.findByTestId('brain-link-card')).toHaveTextContent('Older Substation Case')
    expect(screen.queryByTestId('brain-map-radar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-cluster-card')).not.toBeInTheDocument()

    await openBrainView(user, /memory clusters view/i)
    expect(await screen.findByTestId('brain-cluster-card')).toHaveTextContent('Acme Grid')
    expect(screen.queryByTestId('brain-map-radar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-signal-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('brain-link-card')).not.toBeInTheDocument()
  })

  it('renders memory clusters with drill-down and a collapsed hidden section', async () => {
    const user = userEvent.setup()
    const hiddenCluster = makeCluster({
      id: 'brain-cluster-hidden-domain',
      label: 'hidden.example',
      summary: 'hidden.example links 2 investigations through source-domain recall.',
      score: 0.44,
      status: 'dormant',
      dominantGateway: 'source-domain',
      gatewayCounts: {
        'source-domain': 2,
      },
      hidden: true,
      signalIds: [],
      memoryLinkIds: [],
      reasonSamples: [
        {
          ...signal.reasons[1],
          label: 'hidden.example',
          value: 'hidden.example',
          detail: 'Source domain "hidden.example" recurs in an older case.',
        },
      ],
    })
    installBrainFetch({ signals: [signal], links: [link], clusters: [cluster, hiddenCluster] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory clusters view/i)

    const card = await screen.findByTestId('brain-cluster-card')
    expect(card).toHaveTextContent('Acme Grid')
    expect(card).toHaveTextContent('86%')
    expect(card).toHaveTextContent('Active')
    expect(card).toHaveTextContent('Entity/Date x3')
    expect(card).toHaveTextContent('1 signal')
    expect(card).toHaveTextContent('1 memory link')
    expect(screen.queryByText('hidden.example')).not.toBeInTheDocument()

    await user.click(within(card).getByRole('button', { name: /inspect cluster acme grid/i }))

    const detail = await screen.findByTestId('brain-cluster-detail')
    expect(detail).toHaveTextContent('Current Grid Case')
    expect(detail).toHaveTextContent('Older Substation Case')
    expect(detail).toHaveTextContent('Third Grid Case')
    expect(detail).toHaveTextContent('Northgate Substation A-17 appears in both investigations.')

    await user.click(screen.getByRole('button', { name: /show hidden clusters \(1\)/i }))
    expect(screen.getByText('hidden.example')).toBeInTheDocument()
  })

  it('pins, hides, and unhides memory clusters through backend actions', async () => {
    const user = userEvent.setup()
    const fetchMock = installBrainFetch({ signals: [], links: [], clusters: [cluster] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory clusters view/i)

    const card = await screen.findByTestId('brain-cluster-card')
    await user.click(within(card).getByRole('button', { name: /pin cluster acme grid/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/clusters/brain-cluster-acme/pin',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(await screen.findByTestId('brain-cluster-card')).toHaveTextContent('Pinned')

    await user.click(within(screen.getByTestId('brain-cluster-card')).getByRole('button', { name: /hide cluster acme grid/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/clusters/brain-cluster-acme/hide',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(screen.queryByTestId('brain-cluster-card')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show hidden clusters \(1\)/i }))
    const hiddenCard = await screen.findByTestId('brain-hidden-cluster-card')
    expect(hiddenCard).toHaveTextContent('Acme Grid')

    await user.click(within(hiddenCard).getByRole('button', { name: /unhide cluster acme grid/i }))
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/api/brain/clusters/brain-cluster-acme/unhide',
      expect.objectContaining({ method: 'PUT' }),
    )
    expect(await screen.findByTestId('brain-cluster-card')).toHaveTextContent('Acme Grid')
  })

  it('shows cluster chips on related active signals and memory links', async () => {
    const user = userEvent.setup()
    installBrainFetch({ signals: [signal], links: [link], clusters: [cluster] })

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /active signals view/i)

    expect(await screen.findByTestId('brain-signal-card')).toHaveTextContent('Cluster: Acme Grid')

    await openBrainView(user, /memory links view/i)

    expect(await screen.findByTestId('brain-link-card')).toHaveTextContent('Cluster: Acme Grid')
  })

  it('refreshes memory clusters after persisted board updates while Brain is open', async () => {
    const user = userEvent.setup()
    let clusterAvailable = false
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.includes('/api/brain/signals?')) {
        return jsonResponse([]) as Response
      }
      if (url.includes('/api/brain/links?')) {
        return jsonResponse([]) as Response
      }
      if (url.includes('/api/brain/clusters?')) {
        return jsonResponse(clusterAvailable ? [cluster] : []) as Response
      }
      if (url.includes('/api/brain/suggestions?')) {
        return jsonResponse([]) as Response
      }

      return jsonResponse({}, 404) as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BrainSignalsPanel currentInvestigationId="inv-current" currentInvestigationTitle="Current Grid Case" />)
    await openBrainView(user, /memory clusters view/i)

    expect(await screen.findByTestId('brain-clusters-empty-state')).toHaveTextContent(/No memory clusters yet/i)

    clusterAvailable = true
    window.dispatchEvent(new CustomEvent(BOARD_WORKSPACE_STATE_UPDATED_EVENT, {
      detail: {
        investigationId: 'inv-current',
        persisted: true,
        contentSignature: 'nodes:3|edges:2|fresh-cluster',
      },
    }))

    await waitFor(() => {
      expect(screen.getByTestId('brain-cluster-card')).toHaveTextContent('Acme Grid')
    })
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/api/brain/clusters?')).length)
      .toBeGreaterThanOrEqual(2)
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
