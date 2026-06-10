import { expect, test } from '@playwright/test'
import {
  createSmokeNode,
  emitBackendMessage,
  expectNoExternalNetworkRequests,
  openSmokeApp,
  outboundTypeCount,
  switchToBoard,
  waitForBoardPersistence,
  waitForRenderedBoardNodes,
  waitForOutboundMessage,
  seedBrowserQaData,
} from './helpers'

const crawlConsole = (page: import('@playwright/test').Page) =>
  page.getByTestId('spider-crawl-console')

type BrainSignalReason = {
  gateway: string
  value: string
  label: string
  detail: string
  currentNodeIds: string[]
  targetNodeIds: string[]
}

type BrainSignalPayload = {
  id: string
  investigationId: string
  investigationTitle: string
  targetInvestigationId: string
  targetTitle: string
  score: number
  gateways: string[]
  reasons: BrainSignalReason[]
  suggestedAction: string
  createdAt: string
  updatedAt: string
  dismissed: boolean
  linked: boolean
  linkId?: string
}

type MemoryLinkPayload = {
  id: string
  signalId: string
  fromInvestigationId: string
  fromTitle: string
  toInvestigationId: string
  toTitle: string
  score: number
  gateways: string[]
  reasons: BrainSignalReason[]
  suggestedAction: string
  createdAt: string
  updatedAt?: string
  lastFiredAt?: string
  activationCount?: number
  promotionType?: string
}

type MemoryClusterPayload = {
  id: string
  label: string
  summary: string
  score: number
  status: string
  dominantGateway: string
  gatewayCounts: Record<string, number>
  memberInvestigationIds: string[]
  members: Array<{ investigationId: string; title: string; role: string }>
  signalIds: string[]
  memoryLinkIds: string[]
  reasonSamples: BrainSignalReason[]
  pinned: boolean
  hidden: boolean
  createdAt: string
  updatedAt: string
  lastActivatedAt: string
}

type BrainSuggestionPayload = {
  id: string
  investigationId: string
  kind: string
  status: string
  title: string
  summary: string
  suggestedAction: string
  score: number
  thinkingGateway?: string
  thinkingLabel?: string
  thinkingReason?: string
  actionMode?: string
  priority: string
  reason: string
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  relatedClusterIds: string[]
  targetInvestigationIds: string[]
  createdAt: string
  updatedAt: string
  dismissedAt?: string
  reviewedAt?: string
}

type BrainFollowUpPayload = {
  id: string
  investigationId: string
  investigationTitle: string
  sourceId: string
  sourceKind: string
  status: string
  title: string
  summary: string
  prompt: string
  suggestedAction: string
  descentMode: string
  targetInvestigationIds: string[]
  relatedSignalIds: string[]
  relatedMemoryLinkIds: string[]
  relatedClusterIds: string[]
  reasonSamples: BrainSignalReason[]
  createdAt: string
  updatedAt: string
  launchedAt?: string
  cancelledAt?: string
}

const installBrainMemoryApi = async (page: import('@playwright/test').Page) => {
  const signal: BrainSignalPayload = {
    id: 'brain-signal-smoke-qa',
    investigationId: 'qa-browser-target',
    investigationTitle: 'QA: Imported Target',
    targetInvestigationId: 'qa-browser-source',
    targetTitle: 'QA: Source Case',
    score: 0.88,
    gateways: ['entity-date', 'source-domain', 'relationship-tag'],
    reasons: [
      {
        gateway: 'entity-date',
        value: 'grid reliability signal',
        label: 'Grid reliability signal',
        detail: 'Grid reliability signal appears in QA: Imported Target and QA: Source Case.',
        currentNodeIds: ['qa-target-existing'],
        targetNodeIds: ['qa-source-lead'],
      },
      {
        gateway: 'source-domain',
        value: 'example.com',
        label: 'example.com',
        detail: 'Both investigations cite example.com evidence.',
        currentNodeIds: ['qa-target-existing'],
        targetNodeIds: ['qa-source-lead'],
      },
      {
        gateway: 'relationship-tag',
        value: 'SUPPORTS',
        label: 'SUPPORTS',
        detail: 'A repeated SUPPORTS relationship appears across the QA memory cases.',
        currentNodeIds: ['qa-target-existing'],
        targetNodeIds: ['qa-source-lead'],
      },
    ],
    suggestedAction: 'Review older case',
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-05T12:00:00Z',
    dismissed: false,
    linked: false,
  }

  const link: MemoryLinkPayload = {
    id: 'brain-link-smoke-qa',
    signalId: signal.id,
    fromInvestigationId: signal.investigationId,
    fromTitle: signal.investigationTitle,
    toInvestigationId: signal.targetInvestigationId,
    toTitle: signal.targetTitle,
    score: signal.score,
    gateways: signal.gateways,
    reasons: signal.reasons,
    suggestedAction: signal.suggestedAction,
    createdAt: '2026-06-05T12:01:00Z',
    updatedAt: '2026-06-05T12:01:00Z',
    lastFiredAt: '2026-06-05T12:01:00Z',
    activationCount: 1,
    promotionType: 'manual',
  }

  let promoted = false
  let forgotten = false
  let clusterPinned = false
  let clusterHidden = false
  let suggestionDismissed = false
  let suggestionReviewed = false
  let preparedFollowUp: BrainFollowUpPayload | null = null

  const clusterPayload = (): MemoryClusterPayload => ({
    id: 'brain-cluster-smoke-grid',
    label: 'Grid reliability signal',
    summary: 'Grid reliability signal links 2 investigations through entity/date recall with QA evidence.',
    score: 0.86,
    status: 'active',
    dominantGateway: 'entity-date',
    gatewayCounts: {
      'entity-date': 2,
    },
    memberInvestigationIds: [signal.investigationId, signal.targetInvestigationId],
    members: [
      { investigationId: signal.investigationId, title: signal.investigationTitle, role: 'current' },
      { investigationId: signal.targetInvestigationId, title: signal.targetTitle, role: 'memory' },
    ],
    signalIds: promoted || forgotten ? [] : [signal.id],
    memoryLinkIds: promoted && !forgotten ? [link.id] : [],
    reasonSamples: [signal.reasons[0]],
    pinned: clusterPinned,
    hidden: clusterHidden,
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-05T12:01:00Z',
    lastActivatedAt: '2026-06-05T12:01:00Z',
  })

  const suggestionPayload = (): BrainSuggestionPayload => ({
    id: 'brain-suggestion-smoke-next-move',
    investigationId: signal.investigationId,
    kind: 'cluster-review',
    status: suggestionReviewed ? 'reviewed' : 'active',
    title: 'Review active memory cluster',
    summary: 'Grid reliability signal has an active memory cluster worth checking before the next investigation step.',
    suggestedAction: 'Inspect recurring memory cluster',
    score: 0.86,
    thinkingGateway: 'inspect-pattern',
    thinkingLabel: 'Inspect pattern',
    thinkingReason: 'This memory region is strong enough for a user-approved focused Rabbit Hole pass.',
    actionMode: 'launch-follow-up',
    priority: 'high',
    reason: 'Grid reliability signal is an active cluster with 2 related investigations.',
    relatedSignalIds: promoted || forgotten ? [] : [signal.id],
    relatedMemoryLinkIds: promoted && !forgotten ? [link.id] : [],
    relatedClusterIds: [clusterPayload().id],
    targetInvestigationIds: [signal.targetInvestigationId],
    createdAt: '2026-06-05T12:00:00Z',
    updatedAt: '2026-06-05T12:01:00Z',
    dismissedAt: suggestionDismissed ? '2026-06-05T12:03:00Z' : undefined,
    reviewedAt: suggestionReviewed ? '2026-06-05T12:02:00Z' : undefined,
  })

  const followUpPayload = (status: 'prepared' | 'launched' | 'cancelled' = 'prepared'): BrainFollowUpPayload => ({
    id: 'brain-followup-smoke-next-move',
    investigationId: signal.investigationId,
    investigationTitle: signal.investigationTitle,
    sourceId: suggestionPayload().id,
    sourceKind: 'suggestion',
    status,
    title: 'Review active memory cluster',
    summary: 'Run a focused Rabbit Hole pass on the repeated Grid reliability signal memory.',
    prompt: [
      'Focused Rabbit Hole follow-up.',
      '',
      'Current investigation: QA: Imported Target.',
      'Suggested next move: Review active memory cluster.',
      '',
      'Why this matters:',
      'Grid reliability signal is an active cluster with 2 related investigations.',
      '',
      'Repeated clues:',
      '- Grid reliability signal appears in QA: Imported Target and QA: Source Case.',
      '',
      'Use Guided mode and return only evidence that confirms, weakens, or explains this repeated pattern.',
    ].join('\n'),
    suggestedAction: 'Launch focused Rabbit Hole',
    descentMode: 'guided',
    targetInvestigationIds: [signal.targetInvestigationId],
    relatedSignalIds: [signal.id],
    relatedMemoryLinkIds: promoted && !forgotten ? [link.id] : [],
    relatedClusterIds: [clusterPayload().id],
    reasonSamples: [signal.reasons[0]],
    createdAt: '2026-06-05T12:04:00Z',
    updatedAt: status === 'prepared' ? '2026-06-05T12:04:00Z' : '2026-06-05T12:05:00Z',
    launchedAt: status === 'launched' ? '2026-06-05T12:05:00Z' : undefined,
    cancelledAt: status === 'cancelled' ? '2026-06-05T12:05:00Z' : undefined,
  })

  const brainMapPayload = () => {
    const cluster = clusterPayload()
    const activeMemoryNode = promoted && !forgotten
      ? {
          id: `brain-map-link-${link.id}`,
          kind: 'memory',
          title: link.toTitle,
          subtitle: link.reasons[0].detail,
          score: link.score,
          status: 'linked',
          gateway: link.gateways[0],
          badges: ['Manual', `${link.activationCount || 1} activation`],
          investigationId: link.toInvestigationId,
          targetInvestigationId: link.toInvestigationId,
          clusterId: cluster.id,
          linkId: link.id,
          relatedSignalIds: [signal.id],
          relatedMemoryLinkIds: [link.id],
          memberInvestigationIds: cluster.memberInvestigationIds,
          reasonSamples: link.reasons,
          x: 76,
          y: 58,
        }
      : {
          id: `brain-map-signal-${signal.id}`,
          kind: 'signal',
          title: signal.targetTitle,
          subtitle: signal.reasons[0].detail,
          score: signal.score,
          status: 'firing',
          gateway: signal.gateways[0],
          badges: ['Signal'],
          investigationId: signal.targetInvestigationId,
          targetInvestigationId: signal.targetInvestigationId,
          clusterId: cluster.id,
          signalId: signal.id,
          relatedSignalIds: [signal.id],
          relatedMemoryLinkIds: [],
          memberInvestigationIds: cluster.memberInvestigationIds,
          reasonSamples: signal.reasons,
          x: 76,
          y: 58,
        }

    return {
      investigationId: signal.investigationId,
      investigationTitle: signal.investigationTitle,
      generatedAt: '2026-06-05T12:01:00Z',
      nodes: [
        {
          id: 'brain-map-current',
          kind: 'current',
          title: signal.investigationTitle,
          subtitle: 'Current investigation focus',
          score: 1,
          status: 'focus',
          badges: ['Current'],
          investigationId: signal.investigationId,
          relatedSignalIds: [],
          relatedMemoryLinkIds: [],
          memberInvestigationIds: [signal.investigationId],
          reasonSamples: [],
          x: 50,
          y: 50,
        },
        {
          id: `brain-map-cluster-${cluster.id}`,
          kind: 'cluster',
          title: cluster.label,
          subtitle: cluster.summary,
          score: cluster.score,
          status: cluster.status,
          gateway: cluster.dominantGateway,
          badges: ['Active', 'Entity/date'],
          investigationId: signal.investigationId,
          clusterId: cluster.id,
          relatedSignalIds: cluster.signalIds,
          relatedMemoryLinkIds: cluster.memoryLinkIds,
          memberInvestigationIds: cluster.memberInvestigationIds,
          reasonSamples: cluster.reasonSamples,
          x: 28,
          y: 36,
        },
        activeMemoryNode,
      ],
      edges: [
        {
          id: `brain-map-edge-cluster-${cluster.id}`,
          kind: 'cluster',
          from: 'brain-map-current',
          to: `brain-map-cluster-${cluster.id}`,
          label: 'Memory cluster',
          score: cluster.score,
          gateway: cluster.dominantGateway,
          clusterId: cluster.id,
        },
        {
          id: `brain-map-edge-memory-${cluster.id}`,
          kind: promoted && !forgotten ? 'link' : 'signal',
          from: `brain-map-cluster-${cluster.id}`,
          to: activeMemoryNode.id,
          label: promoted && !forgotten ? 'Durable memory' : 'Active signal',
          score: signal.score,
          gateway: signal.gateways[0],
          clusterId: cluster.id,
          signalId: promoted && !forgotten ? undefined : signal.id,
          linkId: promoted && !forgotten ? link.id : undefined,
        },
      ],
      regions: [
        {
          id: `brain-map-region-${cluster.id}`,
          clusterId: cluster.id,
          label: cluster.label,
          status: cluster.status,
          score: cluster.score,
          gateway: cluster.dominantGateway,
          nodeIds: [`brain-map-cluster-${cluster.id}`, activeMemoryNode.id],
          memberInvestigationIds: cluster.memberInvestigationIds,
          x: 28,
          y: 36,
        },
      ],
      digest: [
        promoted && !forgotten
          ? {
              id: 'brain-map-digest-link',
              tone: 'hot',
              title: 'Memory promoted',
              detail: `${link.toTitle} became a durable memory link.`,
            }
          : {
              id: 'brain-map-digest-signal',
              tone: 'cool',
              title: 'Signal fired',
              detail: `${signal.targetTitle} fired through Entity/Date.`,
            },
      ],
      summary: {
        visibleNodeCount: 3,
        edgeCount: 2,
        clusterCount: 1,
        linkedMemoryCount: promoted && !forgotten ? 1 : 0,
        activeSignalCount: promoted || forgotten ? 0 : 1,
        suggestionCount: suggestionDismissed ? 0 : 1,
        strongestScore: signal.score,
      },
    }
  }

  const attentionPayload = () => ({
    investigationId: signal.investigationId,
    investigationTitle: signal.investigationTitle,
    generatedAt: '2026-06-05T12:02:00Z',
    overallScore: promoted && !forgotten ? 0.94 : 0.86,
    dominantState: promoted && !forgotten ? 'reinforced' : 'hot',
    counts: {
      activeSignals: promoted || forgotten ? 0 : 1,
      linkedMemories: promoted && !forgotten ? 1 : 0,
      memoryClusters: forgotten ? 0 : 1,
      activeNextMoves: suggestionDismissed ? 0 : 1,
      reviewedNextMoves: suggestionReviewed ? 1 : 0,
      reinforcedMemories: promoted && !forgotten ? 1 : 0,
      dormantMemories: 0,
      autoLinkedMemories: promoted && !forgotten ? 1 : 0,
      manualLinkedMemory: 0,
    },
    memoryStrengths: [
      promoted && !forgotten
        ? {
            id: 'brain-strength-smoke-link',
            kind: 'memory-link',
            title: link.toTitle,
            score: 0.94,
            state: 'reinforced',
            targetInvestigationId: link.toInvestigationId,
            linkId: link.id,
            gateway: 'entity-date',
            gateways: link.gateways,
            reasonSamples: link.reasons,
            activationCount: 4,
            signalCount: 0,
            memoryLinkCount: 1,
            clusterMemberCount: 0,
            lastActivatedAt: '2026-06-05T12:02:00Z',
            suggestedAction: 'Compare linked memory',
            relatedSignalIds: [signal.id],
            relatedMemoryLinkIds: [link.id],
            memberInvestigationIds: [],
          }
        : {
            id: 'brain-strength-smoke-signal',
            kind: 'active-signal',
            title: signal.targetTitle,
            score: 0.86,
            state: 'hot',
            targetInvestigationId: signal.targetInvestigationId,
            signalId: signal.id,
            gateway: 'entity-date',
            gateways: signal.gateways,
            reasonSamples: signal.reasons,
            activationCount: 1,
            signalCount: 1,
            memoryLinkCount: 0,
            clusterMemberCount: 0,
            lastActivatedAt: '2026-06-05T12:02:00Z',
            suggestedAction: signal.suggestedAction,
            relatedSignalIds: [signal.id],
            relatedMemoryLinkIds: [],
            memberInvestigationIds: [],
          },
    ],
    items: [
      promoted && !forgotten
        ? {
            id: 'brain-attention-smoke-link',
            kind: 'memory-reinforced',
            tone: 'reinforced',
            title: 'Memory reinforced',
            detail: `${link.toTitle} has fired 4 time(s).`,
            score: 0.94,
            suggestedAction: 'Compare linked memory',
            targetInvestigationId: link.toInvestigationId,
            linkId: link.id,
            relatedSignalIds: [signal.id],
            relatedMemoryLinkIds: [link.id],
            relatedClusterIds: [],
            memberInvestigationIds: [],
            reasonSamples: link.reasons,
            updatedAt: '2026-06-05T12:02:00Z',
          }
        : {
            id: 'brain-attention-smoke-signal',
            kind: 'signal-firing',
            tone: 'hot',
            title: 'Signal firing',
            detail: `${signal.targetTitle} is firing through entity/date.`,
            score: 0.86,
            suggestedAction: signal.suggestedAction,
            targetInvestigationId: signal.targetInvestigationId,
            signalId: signal.id,
            relatedSignalIds: [signal.id],
            relatedMemoryLinkIds: [],
            relatedClusterIds: [],
            memberInvestigationIds: [],
            reasonSamples: signal.reasons,
            updatedAt: '2026-06-05T12:02:00Z',
          },
    ],
    focus: promoted && !forgotten
      ? {
          headline: `${link.toTitle} is the strongest remembered case right now`,
          summary: `${signal.investigationTitle} is strongly connected to older memory ${link.toTitle} through entity/date recall.`,
          whyItMatters: 'Repeated clues include Grid reliability signal. It has fired 4 times.',
          recommendedAction: 'Compare linked memory',
          supportingFacts: ['94% attention strength', 'Strongest gateway: entity/date', '1 durable memory'],
          guidance: [
            {
              kind: 'next-action',
              tone: 'primary',
              title: 'Best next move',
              detail: 'Compare linked memory',
              actionLabel: 'Compare linked memory',
              targetInvestigationId: link.toInvestigationId,
              linkId: link.id,
            },
            {
              kind: 'evidence-trail',
              tone: 'context',
              title: 'Why this fired',
              detail: 'Repeated clues include Grid reliability signal. It has fired 4 times.',
              actionLabel: 'Inspect reason trail',
              targetInvestigationId: link.toInvestigationId,
              linkId: link.id,
            },
            {
              kind: 'follow-up',
              tone: 'primary',
              title: 'Focused follow-up ready',
              detail: 'This memory is strong enough to justify a user-approved focused Rabbit Hole pass on the repeated pattern.',
              actionLabel: 'Prepare focused Rabbit Hole',
              targetInvestigationId: link.toInvestigationId,
              linkId: link.id,
            },
          ],
          primaryKind: 'memory-link',
          primaryTitle: link.toTitle,
          primaryGateway: 'entity-date',
          targetInvestigationId: link.toInvestigationId,
          linkId: link.id,
        }
      : {
          headline: `${signal.targetTitle} is the strongest older case firing right now`,
          summary: `${signal.investigationTitle} is firing against older case ${signal.targetTitle} through entity/date recall.`,
          whyItMatters: 'Repeated clues include Grid reliability signal.',
          recommendedAction: signal.suggestedAction,
          supportingFacts: ['86% attention strength', 'Strongest gateway: entity/date', '1 active firing'],
          guidance: [
            {
              kind: 'next-action',
              tone: 'primary',
              title: 'Best next move',
              detail: signal.suggestedAction,
              actionLabel: 'Compare or promote',
              targetInvestigationId: signal.targetInvestigationId,
              signalId: signal.id,
            },
            {
              kind: 'evidence-trail',
              tone: 'context',
              title: 'Why this fired',
              detail: 'Repeated clues include Grid reliability signal.',
              actionLabel: 'Inspect reason trail',
              targetInvestigationId: signal.targetInvestigationId,
              signalId: signal.id,
            },
            {
              kind: 'gap',
              tone: 'caution',
              title: 'Needs bridge evidence',
              detail: 'This memory shares broad context, but not enough bridge evidence yet.',
              actionLabel: 'Find bridge evidence',
              targetInvestigationId: signal.targetInvestigationId,
              signalId: signal.id,
            },
          ],
          primaryKind: 'active-signal',
          primaryTitle: signal.targetTitle,
          primaryGateway: 'entity-date',
          targetInvestigationId: signal.targetInvestigationId,
          signalId: signal.id,
        },
  })

  await page.route('http://localhost:8080/api/brain/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())

    if (request.method() === 'GET' && url.pathname.endsWith('/signals')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && !promoted && !forgotten ? [signal] : []),
      })
      return
    }

    if (request.method() === 'GET' && url.pathname.endsWith('/links')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && promoted && !forgotten ? [link] : []),
      })
      return
    }

    if (request.method() === 'GET' && url.pathname.endsWith('/clusters')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && !forgotten ? [clusterPayload()] : []),
      })
      return
    }

    if (request.method() === 'GET' && url.pathname.endsWith('/suggestions')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && !suggestionDismissed ? [suggestionPayload()] : []),
      })
      return
    }

    if (request.method() === 'GET' && url.pathname.endsWith('/followups')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && preparedFollowUp ? [preparedFollowUp] : []),
      })
      return
    }

    if (request.method() === 'GET' && url.pathname.endsWith('/map')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && !forgotten ? brainMapPayload() : {
          investigationId: investigationId || '',
          investigationTitle: '',
          generatedAt: '2026-06-05T12:01:00Z',
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
        }),
      })
      return
    }

    if (request.method() === 'GET' && url.pathname.endsWith('/attention')) {
      const investigationId = url.searchParams.get('investigationId')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(investigationId === signal.investigationId && !forgotten ? attentionPayload() : {
          investigationId: investigationId || '',
          investigationTitle: '',
          generatedAt: '2026-06-05T12:02:00Z',
          overallScore: 0,
          dominantState: 'dormant',
          counts: {
            activeSignals: 0,
            linkedMemories: 0,
            memoryClusters: 0,
            activeNextMoves: 0,
            reviewedNextMoves: 0,
            reinforcedMemories: 0,
            dormantMemories: 0,
            autoLinkedMemories: 0,
            manualLinkedMemory: 0,
          },
          memoryStrengths: [],
          items: [],
        }),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/followups/prepare')) {
      preparedFollowUp = followUpPayload('prepared')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(preparedFollowUp),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/followups/brain-followup-smoke-next-move/launch')) {
      preparedFollowUp = followUpPayload('launched')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(preparedFollowUp),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/followups/brain-followup-smoke-next-move/cancel')) {
      preparedFollowUp = followUpPayload('cancelled')
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(preparedFollowUp),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith(`/${signal.id}/link`)) {
      promoted = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(link),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith(`/${link.id}/forget`)) {
      promoted = false
      forgotten = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(link),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/suggestions/brain-suggestion-smoke-next-move/review')) {
      suggestionReviewed = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(suggestionPayload()),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/suggestions/brain-suggestion-smoke-next-move/dismiss')) {
      suggestionDismissed = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...suggestionPayload(), status: 'dismissed' }),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/clusters/brain-cluster-smoke-grid/pin')) {
      clusterPinned = !clusterPinned
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(clusterPayload()),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/clusters/brain-cluster-smoke-grid/hide')) {
      clusterHidden = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(clusterPayload()),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith('/clusters/brain-cluster-smoke-grid/unhide')) {
      clusterHidden = false
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(clusterPayload()),
      })
      return
    }

    if (request.method() === 'PUT' && url.pathname.endsWith(`/${signal.id}/dismiss`)) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...signal, dismissed: true }),
      })
      return
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'unexpected brain smoke route' }),
    })
  })
}

const runWebInvestigation = async (page: import('@playwright/test').Page, topic = 'smoke grid reliability') => {
  const console = crawlConsole(page)
  const previousCount = await outboundTypeCount(page, 'CRAWL')
  await console.getByRole('button', { name: 'WEB' }).click()
  await console.getByPlaceholder(/enter a topic or url to crawl the web/i).fill(topic)
  await console.getByRole('button', { name: /^execute$/i }).click()
  return waitForOutboundMessage(page, 'CRAWL', previousCount)
}

const runRabbitHoleInvestigation = async (
  page: import('@playwright/test').Page,
  descentMode: 'guided' | 'max',
) => {
  const console = crawlConsole(page)
  const previousCount = await outboundTypeCount(page, 'CRAWL_RABBIT_HOLE')
  await console.getByRole('button', { name: 'RABBIT HOLE' }).click()
  if (descentMode === 'max') {
    await console.getByRole('button', { name: /max descent/i }).click()
  } else {
    await console.getByRole('button', { name: /^guided$/i }).click()
  }
  await console.getByPlaceholder(/enter a topic for rabbit hole mode/i).fill(`smoke rabbit ${descentMode}`)
  await console.getByRole('button', { name: /^execute$/i }).click()
  return waitForOutboundMessage(page, 'CRAWL_RABBIT_HOLE', previousCount)
}

const emitNormalBoard = async (page: import('@playwright/test').Page, vaultId: string, runId?: string) => {
  await emitBackendMessage(page, {
    type: 'MEMORY_NODE_GATHERED',
    payload: {
      vaultId,
      node: createSmokeNode(
        'smoke-grid-load',
        'Smoke Grid Load Spike',
        'A utility report flags a smoke-test load spike near clustered compute demand.',
      ),
    },
  })
  await expect(page.getByText('Smoke Grid Load Spike')).toBeVisible()
  await waitForRenderedBoardNodes(page, ['smoke-grid-load'])
  await waitForBoardPersistence(page, vaultId, {
    nodeIds: ['smoke-grid-load'],
  })

  await emitBackendMessage(page, {
    type: 'MEMORY_NODE_GATHERED',
    payload: {
      vaultId,
      node: createSmokeNode(
        'smoke-cooling-alert',
        'Smoke Cooling Alert',
        'A facilities note ties emergency cooling draw to the same smoke-test substation corridor.',
      ),
    },
  })
  await expect(page.getByText('Smoke Cooling Alert')).toBeVisible()
  await waitForRenderedBoardNodes(page, ['smoke-grid-load', 'smoke-cooling-alert'])
  await waitForBoardPersistence(page, vaultId, {
    nodeIds: ['smoke-grid-load', 'smoke-cooling-alert'],
  })

  await emitBackendMessage(page, {
    type: 'CONNECTIONS_FOUND',
    payload: {
      vaultId,
      runId,
      connections: [
        {
          source: 'smoke-grid-load',
          target: 'smoke-cooling-alert',
          tag: 'INFRASTRUCTURE_STRESS',
          reasoning: 'The load spike and cooling alert point to the same infrastructure stress pattern.',
          confidence: 0.86,
        },
      ],
    },
  })
  await waitForBoardPersistence(page, vaultId, {
    nodeIds: ['smoke-grid-load', 'smoke-cooling-alert'],
    edgeCount: 1,
  })
}

test.describe('Gorantula smoke flows', () => {
  test.beforeEach(async ({ page }) => {
    await openSmokeApp(page)
  })

  test.afterEach(async ({ page }) => {
    expectNoExternalNetworkRequests(page)
  })

  test('normal web investigation creates board nodes and relationships', async ({ page }) => {
    const crawl = await runWebInvestigation(page)
    expect(crawl.payload).toBe('smoke grid reliability')

    const vaultId = String(crawl.vaultId)
    await switchToBoard(page)
    await emitNormalBoard(page, vaultId, String(crawl.runId || ''))

    await expect(page.getByText('Smoke Grid Load Spike')).toBeVisible()
    await expect(page.getByText('Smoke Cooling Alert')).toBeVisible()
    await expect(page.locator('[data-testid^="edge-label-"]').filter({ hasText: /pressure point/i })).toBeVisible()
  })

  test('Rabbit Hole Guided pass continues with prior findings', async ({ page }) => {
    const crawl = await runRabbitHoleInvestigation(page, 'guided')
    expect(crawl.descentMode).toBe('guided')

    await emitBackendMessage(page, {
      type: 'RABBIT_HOLE_GATEKEEPER',
      payload: {
        runId: crawl.runId,
        vaultId: crawl.vaultId,
        pass: 1,
        descentMode: 'guided',
        prompt: crawl.payload,
        result: 'Rabbit Hole pass one synthesis.',
        decision: {
          continue: true,
          reason: 'Two credible open angles remain.',
          noveltyScore: 0.81,
          suggestedQueries: ['smoke query continuation'],
        },
      },
    })

    const gatekeeper = page.getByTestId('rabbit-hole-gatekeeper-panel')
    await expect(gatekeeper).toContainText('Gatekeeper')
    await expect(gatekeeper).toContainText('Pass 1')
    await expect(gatekeeper).toContainText('Continue recommended')

    const previousCount = await outboundTypeCount(page, 'CRAWL_RABBIT_HOLE')
    await gatekeeper.getByRole('button', { name: /continue rabbit hole descent/i }).click()
    const continuation = await waitForOutboundMessage(page, 'CRAWL_RABBIT_HOLE', previousCount)

    expect(continuation.descentMode).toBe('guided')
    expect(continuation.append).toBe(true)
    expect(continuation.continuationPass).toBe(2)
    expect(continuation.priorFindings).toEqual(['Pass 1 summary:\nRabbit Hole pass one synthesis.'])
  })

  test('Rabbit Hole Max promotes evidence and moves unconnected leads into support', async ({ page }) => {
    const crawl = await runRabbitHoleInvestigation(page, 'max')
    expect(crawl.descentMode).toBe('max')
    const vaultId = String(crawl.vaultId)

    await switchToBoard(page)
    const emitRabbitNodeAndWait = async (
      id: string,
      title: string,
      summary: string,
      extra: Record<string, unknown>,
    ) => {
      await emitBackendMessage(page, {
        type: 'MEMORY_NODE_GATHERED',
        payload: {
          vaultId,
          node: createSmokeNode(id, title, summary, extra),
        },
      })
      await waitForRenderedBoardNodes(page, [id])
      await page.waitForTimeout(100)
    }

    await emitRabbitNodeAndWait(
      'smoke-rabbit-web',
      'Smoke Rabbit Web Lead',
      'A Rabbit Hole web lead follows a live smoke-test evidence trail.',
      { origin: 'rabbit-hole', rabbitState: 'provisional', rabbitTool: 'web_search', rabbitPass: 1 },
    )
    await emitRabbitNodeAndWait(
      'smoke-rabbit-vault',
      'Smoke Rabbit Vault Echo',
      'A Rabbit Hole vault echo finds a related older smoke-test case.',
      { origin: 'rabbit-hole', rabbitState: 'provisional', rabbitTool: 'vault_search', rabbitPass: 1 },
    )
    await emitRabbitNodeAndWait(
      'smoke-rabbit-support',
      'Smoke Rabbit Support Evidence',
      'A Rabbit Hole support lead remains useful but unconnected after relationship synthesis.',
      { origin: 'rabbit-hole', rabbitState: 'provisional', rabbitTool: 'timeline_context', rabbitPass: 1 },
    )
    await waitForBoardPersistence(page, vaultId, {
      nodeIds: ['smoke-rabbit-web', 'smoke-rabbit-vault', 'smoke-rabbit-support'],
    })
    await waitForRenderedBoardNodes(page, ['smoke-rabbit-web', 'smoke-rabbit-vault', 'smoke-rabbit-support'])

    await emitBackendMessage(page, {
      type: 'RABBIT_HOLE_NODE_UPDATE',
      payload: {
        vaultId,
        nodeIds: ['smoke-rabbit-web', 'smoke-rabbit-vault', 'smoke-rabbit-support'],
        rabbitState: 'promoted',
      },
    })
    await emitBackendMessage(page, {
      type: 'CONNECTIONS_FOUND',
      payload: {
        vaultId,
        runId: crawl.runId,
        connections: [
          {
            source: 'smoke-rabbit-web',
            target: 'smoke-rabbit-vault',
            tag: 'HIDDEN_CONNECTION',
            reasoning: 'The web lead and vault echo share the same smoke-test trail.',
            confidence: 0.82,
          },
        ],
      },
    })

    await expect(page.locator('[data-testid^="edge-label-"]').filter({ hasText: /hidden connection/i })).toBeVisible()
    await expect(page.getByTestId('supporting-evidence-layer')).toBeVisible()
    await expect(page.getByTestId('supporting-evidence-layer')).toContainText(/Supporting Evidence\s*1/)
    await expect(page.getByTestId('supporting-evidence-layer')).toContainText(/Timeline\s*1/)
  })

  test('normal synthesis exposes theory state without Rabbit Hole theme leakage', async ({ page }) => {
    const crawl = await runWebInvestigation(page, 'smoke normal synthesis')
    const vaultId = String(crawl.vaultId)

    await switchToBoard(page)
    await emitNormalBoard(page, vaultId, String(crawl.runId || ''))
    await emitBackendMessage(page, {
      type: 'SYNTHESIS_COMPLETE',
      payload: {
        vaultId,
        runId: crawl.runId,
        result: '# Grand Unified Theory\n\nNormal smoke unified theory stays in the standard investigation theme.',
        append: false,
      },
    })
    await expect(page.getByTestId('app-shell')).not.toHaveClass(/forensic-rabbit-context/)
    await expect(page.getByRole('button', { name: /grand unified theory ready/i })).toBeVisible()
  })

  test('board restore after refresh keeps nodes and relationship visible inside the viewport', async ({ page }) => {
    const crawl = await runWebInvestigation(page, 'smoke restore board')
    const vaultId = String(crawl.vaultId)

    await switchToBoard(page)
    await emitNormalBoard(page, vaultId, String(crawl.runId || ''))
    await expect(page.locator('[data-testid^="edge-label-"]').filter({ hasText: /pressure point/i })).toBeVisible()
    await waitForBoardPersistence(page, vaultId, {
      nodeIds: ['smoke-grid-load', 'smoke-cooling-alert'],
      edgeCount: 1,
    })

    await page.reload()
    await expect(page.getByTestId('app-shell')).toBeVisible()
    await page.waitForFunction(() => {
      const backend = (window as Window & {
        __gorantulaSmokeBackend?: { openSocketCount: number }
      }).__gorantulaSmokeBackend
      return Boolean(backend && backend.openSocketCount > 0)
    })
    await switchToBoard(page)

    await expect(page.getByTestId('board-restore-loading')).toBeHidden()
    await expect(page.getByText('Smoke Grid Load Spike')).toBeVisible()
    await expect(page.getByText('Smoke Cooling Alert')).toBeVisible()
    await expect(page.locator('[data-testid^="edge-label-"]').filter({ hasText: /pressure point/i })).toBeVisible()

    const boardBox = await page.locator('#detective-board-flow').boundingBox()
    expect(boardBox).not.toBeNull()
    const boardBounds = {
      left: boardBox!.x,
      right: boardBox!.x + boardBox!.width,
      top: boardBox!.y,
      bottom: boardBox!.y + boardBox!.height,
    }
    const nodeBoxes = await page.getByTestId('custom-node-shell').evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }
      }),
    )

    expect(nodeBoxes.length).toBeGreaterThanOrEqual(2)
    for (const nodeBox of nodeBoxes.slice(0, 2)) {
      expect(nodeBox.width).toBeGreaterThan(0)
      expect(nodeBox.height).toBeGreaterThan(0)
      expect(nodeBox.right).toBeGreaterThan(boardBounds.left)
      expect(nodeBox.left).toBeLessThan(boardBounds.right)
      expect(nodeBox.bottom).toBeGreaterThan(boardBounds.top)
      expect(nodeBox.top).toBeLessThan(boardBounds.bottom)
    }
  })

  test('Brain Signals promote into a memory link that remains after reload', async ({ page }) => {
    await installBrainMemoryApi(page)
    await seedBrowserQaData(page)

    await page.getByRole('button', { name: /^brain$/i }).click()
    await expect(page.getByTestId('brain-signals-panel')).toBeVisible()
    await expect(page.getByRole('button', { name: /focus view/i })).toHaveAttribute('aria-pressed', 'true')
    const focusView = page.getByTestId('brain-focus-view')
    await expect(focusView).toContainText('QA: Source Case is the strongest older case firing right now')
    await expect(focusView).toContainText('Grid reliability signal')
    await expect(focusView).toContainText('86% attention strength')
    await expect(focusView).toContainText('Brain guidance')
    await expect(focusView).toContainText('Needs bridge evidence')
    await page.getByRole('button', { name: /memory map view/i }).click()
    await expect(page.getByTestId('brain-health-summary')).toContainText('1 firing case')
    await expect(page.getByTestId('brain-health-summary')).toContainText('1 next move')
    await expect(page.getByRole('button', { name: /show brain attention summary/i })).toContainText('Hot')
    await page.getByRole('button', { name: /show brain attention summary/i }).click()
    await expect(page.getByTestId('brain-attention-summary')).toContainText('Hot memory attention')
    await expect(page.getByTestId('brain-attention-summary')).toContainText('Signal firing')
    await page.getByRole('button', { name: /close brain attention summary/i }).click()

    await page.getByRole('button', { name: /next moves view/i }).click()
    const suggestionCard = page.getByTestId('brain-suggestion-card').filter({ hasText: 'Review active memory cluster' })
    await expect(suggestionCard).toContainText('Cluster Review')
    await expect(suggestionCard).toContainText('Inspect recurring memory cluster')
    await expect(suggestionCard).toContainText('Grid reliability signal is an active cluster')
    await suggestionCard.getByRole('button', { name: /compare next move review active memory cluster/i }).click()
    const compareWorkspace = page.getByTestId('brain-compare-workspace')
    await expect(compareWorkspace).toContainText('Brain Compare')
    await expect(compareWorkspace).toContainText('Review active memory cluster')
    await expect(compareWorkspace).toContainText('QA: Imported Target')
    await expect(compareWorkspace).toContainText('QA: Source Case')
    await expect(compareWorkspace).toContainText('Grid reliability signal appears in QA: Imported Target and QA: Source Case.')
    await compareWorkspace.getByRole('button', { name: /close brain compare/i }).click()
    await expect(compareWorkspace).toHaveCount(0)
    const radar = page.getByTestId('brain-map-radar')
    await suggestionCard.getByRole('button', { name: /view map/i }).click()
    await expect(radar).toBeVisible()
    await expect(radar.getByTestId('brain-map-graph-region')).toContainText('Grid reliability signal')
    await expect(radar.locator('[data-testid="brain-map-graph-edge"][data-edge-kind="cluster"]')).toHaveCount(1)
    await expect(radar.getByTestId('brain-map-selected-node')).toContainText('Memory cluster')

    await radar.getByRole('button', { name: /collapse brain map/i }).click()
    await expect(radar).not.toHaveClass(/is-expanded/)
    await page.getByRole('button', { name: /next moves view/i }).click()
    await suggestionCard.getByRole('button', { name: /mark reviewed/i }).click()
    await expect(page.getByText(/reviewed context/i)).toBeVisible()
    await expect(page.getByTestId('brain-suggestion-card')).toContainText('Reviewed')
    await page.getByTestId('brain-suggestion-card').getByRole('button', { name: /dismiss/i }).click()
    await expect(page.getByTestId('brain-suggestion-card')).toHaveCount(0)

    await page.getByRole('button', { name: /memory map view/i }).click()
    await expect(radar).toBeVisible()
    await expect(radar).toContainText('Memory map')
    await expect(radar).toContainText('QA: Imported Target')
    await expect(radar).toContainText('QA: Source Case')
    await expect(radar.getByTestId('brain-map-node')).toHaveCount(3)
    await expect(radar.getByTestId('brain-map-digest')).toContainText('Signal fired')

    await radar.getByRole('button', { name: /select signal qa: source case/i }).click()
    await expect(radar.getByTestId('brain-map-selected-node')).toContainText('Grid reliability signal')

    await page.getByRole('button', { name: /active signals view/i }).click()
    const signalCard = page.getByTestId('brain-signal-card').filter({ hasText: 'QA: Source Case' })
    await expect(signalCard).toContainText('Grid reliability signal')
    await expect(signalCard).toContainText('Entity/Date')
    await expect(signalCard).toContainText('Source Domain')
    await expect(signalCard).toContainText('Relationship')
    await expect(signalCard).toContainText('Cluster: Grid reliability signal')

    await page.getByRole('button', { name: /memory clusters view/i }).click()
    const clusterCard = page.getByTestId('brain-cluster-card').filter({ hasText: 'Grid reliability signal' })
    await expect(clusterCard).toContainText('86%')
    await expect(clusterCard).toContainText('Active')
    await expect(clusterCard).toContainText('Entity/Date x2')
    await expect(clusterCard).toContainText('1 signal')
    await clusterCard.getByRole('button', { name: /inspect cluster grid reliability signal/i }).click()
    await expect(page.getByTestId('brain-cluster-detail')).toContainText('QA: Source Case')
    await expect(page.getByTestId('brain-cluster-detail')).toContainText('qa-target-existing')
    await clusterCard.getByRole('button', { name: /pin cluster grid reliability signal/i }).click()
    await expect(clusterCard).toContainText('Pinned')

    await page.getByRole('button', { name: /memory map view/i }).click()
    await radar
      .getByTestId('brain-map-selected-node')
      .getByRole('button', { name: /promote radar signal qa: source case/i })
      .click()

    await expect(page.getByTestId('brain-signal-card')).toHaveCount(0)
    await expect(page.getByTestId('brain-link-card')).toContainText('QA: Source Case')
    await expect(page.getByTestId('brain-link-card')).toContainText('Grid reliability signal')
    await expect(page.getByTestId('brain-link-card')).toContainText('Cluster: Grid reliability signal')
    await page.getByRole('button', { name: /memory map view/i }).click()
    await expect(page.getByTestId('brain-health-summary')).toContainText('1 memory group')
    await expect(page.getByTestId('brain-health-summary')).toContainText('Reinforced')
    await page.getByRole('button', { name: /show brain attention summary/i }).click()
    await expect(page.getByTestId('brain-attention-summary')).toContainText('Reinforced memory attention')
    await expect(page.getByTestId('brain-attention-summary')).toContainText('QA: Source Case has fired 4 time(s).')
    await page.getByRole('button', { name: /close brain attention summary/i }).click()
    await expect(radar.getByRole('button', { name: /select memory qa: source case/i })).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('app-shell')).toBeVisible()
    await page.waitForFunction(() => {
      const backend = (window as Window & {
        __gorantulaSmokeBackend?: { openSocketCount: number }
      }).__gorantulaSmokeBackend
      return Boolean(backend && backend.openSocketCount > 0)
    })

    await page.getByRole('button', { name: /^brain$/i }).click()
    await expect(page.getByTestId('brain-signals-panel')).toBeVisible()
    await expect(page.getByTestId('brain-focus-view')).toContainText('Focused follow-up ready')
    await expect(page.getByTestId('brain-signal-card')).toHaveCount(0)
    await page.getByRole('button', { name: /next moves view/i }).click()
    await expect(page.getByTestId('brain-suggestion-card')).toHaveCount(0)
    await expect(page.getByTestId('brain-suggestions-empty-state')).toContainText(/No next moves yet/i)
    await page.getByRole('button', { name: /memory links view/i }).click()
    await expect(page.getByTestId('brain-link-card')).toContainText('QA: Source Case')
    await expect(page.getByTestId('brain-link-card')).toContainText('Grid reliability signal')
    await expect(page.getByTestId('brain-link-card')).toContainText('Cluster: Grid reliability signal')
    await page.getByRole('button', { name: /show brain attention summary/i }).click()
    await expect(page.getByTestId('brain-attention-summary')).toContainText('Reinforced memory attention')
    await page.getByRole('button', { name: /close brain attention summary/i }).click()
    await page.getByRole('button', { name: /memory clusters view/i }).click()
    const restoredCluster = page.getByTestId('brain-cluster-card').filter({ hasText: 'Grid reliability signal' })
    await expect(restoredCluster).toContainText('Pinned')
    await restoredCluster.getByRole('button', { name: /hide cluster grid reliability signal/i }).click()
    await expect(page.getByTestId('brain-cluster-card')).toHaveCount(0)
    await page.getByRole('button', { name: /show hidden clusters \(1\)/i }).click()
    const hiddenCluster = page.getByTestId('brain-hidden-cluster-card').filter({ hasText: 'Grid reliability signal' })
    await expect(hiddenCluster).toBeVisible()
    await hiddenCluster.getByRole('button', { name: /unhide cluster grid reliability signal/i }).click()
    await expect(page.getByTestId('brain-cluster-card')).toContainText('Grid reliability signal')
    await page.getByRole('button', { name: /memory map view/i }).click()
    const restoredRadar = page.getByTestId('brain-map-radar')
    await expect(restoredRadar).toContainText('QA: Source Case')
    await expect(restoredRadar.getByRole('button', { name: /select memory qa: source case/i })).toBeVisible()

    await page.getByRole('button', { name: /memory links view/i }).click()
    await page.getByRole('button', { name: /source domain filter/i }).click()
    await expect(page.getByTestId('brain-link-card')).toContainText('QA: Source Case')
    await page.getByRole('button', { name: /relationship filter/i }).click()
    await expect(page.getByTestId('brain-link-card')).toContainText('QA: Source Case')

    await page.getByRole('button', { name: /memory map view/i }).click()
    await restoredRadar.getByRole('button', { name: /select memory qa: source case/i }).click()
    await restoredRadar.getByRole('button', { name: /inspect radar memory qa: source case/i }).click()
    const detail = page.getByTestId('brain-link-detail')
    await expect(detail).toContainText('qa-target-existing')
    await expect(detail).toContainText('qa-source-lead')

    await detail.getByRole('button', { name: /forget memory link qa: source case/i }).click()
    await expect(page.getByTestId('brain-link-card')).toHaveCount(0)
  })

  test('Brain follow-up launcher starts a guided Rabbit Hole from a prepared next move', async ({ page }) => {
    await installBrainMemoryApi(page)
    await seedBrowserQaData(page)

    await page.getByRole('button', { name: /^brain$/i }).click()
    await expect(page.getByTestId('brain-signals-panel')).toBeVisible()

    await page.getByRole('button', { name: /next moves view/i }).click()
    const suggestionCard = page.getByTestId('brain-suggestion-card').filter({ hasText: 'Review active memory cluster' })
    await expect(suggestionCard).toContainText('Inspect recurring memory cluster')
    await suggestionCard.getByRole('button', { name: /prepare focused rabbit hole review active memory cluster/i }).click()

    const launcher = page.getByTestId('brain-followup-launcher')
    await expect(launcher).toContainText('Prepared follow-up')
    await expect(launcher).toContainText('Review active memory cluster')
    await expect(launcher).toContainText('Focused Rabbit Hole follow-up.')
    await expect(launcher).toContainText('guided')

    const previousCount = await outboundTypeCount(page, 'CRAWL_RABBIT_HOLE')
    await launcher.getByRole('button', { name: /launch guided rabbit hole/i }).click()
    const crawl = await waitForOutboundMessage(page, 'CRAWL_RABBIT_HOLE', previousCount)

    expect(crawl.descentMode).toBe('guided')
    expect(crawl.payload).toContain('Focused Rabbit Hole follow-up.')
    expect(crawl.payload).toContain('Grid reliability signal')
    const console = crawlConsole(page)
    await expect(console.getByTestId('brain-followup-spider-handoff')).toContainText('Brain follow-up active')
    await expect(console.getByTestId('brain-followup-spider-handoff')).toContainText('Guided Rabbit Hole')
    await expect(console.getByRole('button', { name: /^guided$/i })).toHaveClass(/forensic-spider-guided-followup-active/)
  })

  test('backend error clears the active run and allows a new web investigation', async ({ page }) => {
    test.setTimeout(60_000)

    const crawl = await runWebInvestigation(page, 'smoke backend error recovery')

    await emitBackendMessage(page, {
      type: 'PIPELINE_PROGRESS',
      payload: {
        runId: crawl.runId,
        vaultId: crawl.vaultId,
        mode: 'web',
        stepId: 'crawl',
        stepLabel: 'Discovery crawl',
        status: 'running',
        completedSteps: 1,
        totalSteps: 4,
        detail: 'Smoke backend crawl running.',
      },
    })

    const pipelineChip = page.getByTestId('pipeline-progress-chip')
    await expect(pipelineChip).toBeVisible()
    await expect(pipelineChip).toContainText('Discovery crawl')
    await expect(page.getByRole('button', { name: /stop current investigation/i })).toBeVisible()

    await emitBackendMessage(page, {
      type: 'PIPELINE_PROGRESS',
      payload: {
        runId: crawl.runId,
        vaultId: crawl.vaultId,
        mode: 'web',
        stepId: 'crawl',
        stepLabel: 'Discovery crawl',
        status: 'error',
        completedSteps: 1,
        totalSteps: 4,
        error: 'Smoke backend timeout',
        steps: [
          {
            id: 'crawl',
            label: 'Discovery crawl',
            status: 'error',
            error: 'Smoke backend timeout',
          },
        ],
      },
    })

    await expect(pipelineChip).toHaveClass(/forensic-pipeline-chip-error/)
    await expect(page.getByRole('button', { name: /stop current investigation/i })).toBeHidden()

    const recovery = await runWebInvestigation(page, 'smoke recovery second pass')
    expect(recovery.payload).toBe('smoke recovery second pass')
    expect(recovery.type).toBe('CRAWL')
    expect(recovery.runId).not.toBe(crawl.runId)
  })

  test('switching from Rabbit Hole back to Web sends normal crawl without Rabbit UI state', async ({ page }) => {
    const rabbit = await runRabbitHoleInvestigation(page, 'guided')
    expect(rabbit.descentMode).toBe('guided')
    await expect(page.getByTestId('app-shell')).toHaveClass(/forensic-rabbit-context/)
    await expect(page.getByTestId('rabbit-hole-entrance')).toBeVisible()

    const rabbitCount = await outboundTypeCount(page, 'CRAWL_RABBIT_HOLE')
    const web = await runWebInvestigation(page, 'smoke web after rabbit hole')

    expect(web.type).toBe('CRAWL')
    expect(web.payload).toBe('smoke web after rabbit hole')
    expect(web.vaultId).not.toBe(rabbit.vaultId)
    expect('descentMode' in web).toBe(false)
    expect('continuationPass' in web).toBe(false)
    expect(await outboundTypeCount(page, 'CRAWL_RABBIT_HOLE')).toBe(rabbitCount)

    await expect(page.getByTestId('app-shell')).not.toHaveClass(/forensic-rabbit-context/)
    await expect(page.getByTestId('rabbit-hole-entrance')).toBeHidden()
    await expect(page.getByRole('button', { name: /^guided$/i })).toBeHidden()
    await expect(page.getByRole('button', { name: /max descent/i })).toBeHidden()
    await expect(page.getByTestId('rabbit-hole-gatekeeper-panel')).toBeHidden()
  })

})
