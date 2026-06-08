import { describe, expect, it } from 'vitest'
import type { BrainMapView, BrainSignal, MemoryLink } from '../src/utils/brainMemory'
import { buildBrainMapModel, buildBrainMapModelFromView } from '../src/utils/brainMap'

const reason = {
  gateway: 'entity-date',
  value: 'ORG|Microsoft',
  label: 'Microsoft',
  detail: 'Shared ORG "Microsoft" appears in both investigations.',
  currentNodeIds: ['current-node'],
  targetNodeIds: ['target-node'],
}

const makeSignal = (overrides: Partial<BrainSignal> = {}): BrainSignal => ({
  id: overrides.id || 'brain-signal-a',
  investigationId: 'inv-current',
  investigationTitle: 'Current AI Grid Case',
  targetInvestigationId: overrides.targetInvestigationId || 'inv-older-a',
  targetTitle: overrides.targetTitle || 'Older Energy Case',
  score: overrides.score ?? 0.81,
  gateways: overrides.gateways || ['entity-date'],
  reasons: overrides.reasons || [reason],
  suggestedAction: overrides.suggestedAction || 'Review older case',
  createdAt: overrides.createdAt || '2026-06-05T12:00:00Z',
  updatedAt: overrides.updatedAt || '2026-06-05T12:00:00Z',
  dismissed: false,
  linked: false,
  activationCount: overrides.activationCount,
  lastFiredAt: overrides.lastFiredAt,
})

const makeLink = (overrides: Partial<MemoryLink> = {}): MemoryLink => ({
  id: overrides.id || 'brain-link-a',
  signalId: overrides.signalId || 'brain-signal-a',
  fromInvestigationId: 'inv-current',
  fromTitle: 'Current AI Grid Case',
  toInvestigationId: overrides.toInvestigationId || 'inv-older-a',
  toTitle: overrides.toTitle || 'Older Energy Case',
  score: overrides.score ?? 0.86,
  gateways: overrides.gateways || ['entity-date', 'source-domain'],
  reasons: overrides.reasons || [reason],
  suggestedAction: overrides.suggestedAction || 'Auto-promoted memory link',
  createdAt: overrides.createdAt || '2026-06-05T12:00:00Z',
  updatedAt: overrides.updatedAt,
  lastFiredAt: overrides.lastFiredAt,
  activationCount: overrides.activationCount,
  promotionType: overrides.promotionType,
})

const distanceBetween = (
  left: { x?: number; y?: number },
  right: { x?: number; y?: number },
) => Math.hypot((left.x || 0) - (right.x || 0), (left.y || 0) - (right.y || 0))

describe('brain map model', () => {
  it('keeps the current investigation centered and prioritizes linked memories before active signals', () => {
    const model = buildBrainMapModel({
      currentInvestigationId: 'inv-current',
      currentInvestigationTitle: 'AI data centers buying power plants',
      signals: [
        makeSignal({ id: 'signal-hot', targetTitle: 'Hot Signal Case', score: 0.92 }),
        makeSignal({ id: 'signal-warm', targetTitle: 'Warm Signal Case', score: 0.63 }),
      ],
      links: [
        makeLink({ id: 'link-a', toTitle: 'Linked Energy Case', score: 0.88, promotionType: 'auto' }),
        makeLink({ id: 'link-b', toTitle: 'Linked Chip Case', score: 0.76, activationCount: 4 }),
      ],
    })

    expect(model.nodes[0]).toMatchObject({
      id: 'brain-map-current',
      kind: 'current',
      title: 'Current investigation',
      subtitle: 'AI data centers buying power plants',
      slot: 'center',
    })
    expect(model.nodes.slice(1).map((node) => node.title)).toEqual([
      'Linked Energy Case',
      'Linked Chip Case',
      'Hot Signal Case',
      'Warm Signal Case',
    ])
    expect(model.edges).toHaveLength(4)
    expect(model.nodes.find((node) => node.title === 'Linked Energy Case')?.badges).toContain('Auto')
  })

  it('limits visible memory nodes and summarizes hidden map items', () => {
    const model = buildBrainMapModel({
      currentInvestigationId: 'inv-current',
      currentInvestigationTitle: 'Current Case',
      signals: Array.from({ length: 4 }, (_, index) => makeSignal({
        id: `signal-${index}`,
        targetTitle: `Signal Case ${index}`,
        score: 0.82 - index * 0.03,
      })),
      links: Array.from({ length: 6 }, (_, index) => makeLink({
        id: `link-${index}`,
        toTitle: `Linked Case ${index}`,
        score: 0.91 - index * 0.04,
      })),
    })

    expect(model.nodes).toHaveLength(6)
    expect(model.hiddenCount).toBe(5)
    expect(model.summary.visibleCount).toBe(5)
    expect(model.summary.strongestScore).toBe('91%')
  })

  it('builds a what-changed digest from auto memories and recent firings', () => {
    const model = buildBrainMapModel({
      currentInvestigationId: 'inv-current',
      currentInvestigationTitle: 'Current Case',
      signals: [
        makeSignal({ id: 'signal-recent', targetTitle: 'Fresh Signal Case', lastFiredAt: '2026-06-06T09:00:00Z' }),
      ],
      links: [
        makeLink({ id: 'link-auto', toTitle: 'Auto Linked Case', promotionType: 'auto', activationCount: 3 }),
        makeLink({ id: 'link-reinforced', toTitle: 'Reinforced Case', activationCount: 5 }),
      ],
    })

    expect(model.digest.map((item) => item.title)).toEqual([
      'Auto memory created',
      'Memory reinforced',
      'Signal fired',
    ])
    expect(model.digest[0].detail).toContain('Auto Linked Case')
    expect(model.digest[1].detail).toContain('5 activations')
    expect(model.digest[2].detail).toContain('Fresh Signal Case')
  })

  it('normalizes backend graph coordinates into non-overlapping memory orbits', () => {
    const view: BrainMapView = {
      investigationId: 'inv-current',
      investigationTitle: 'Current Case',
      generatedAt: '2026-06-08T12:00:00Z',
      nodes: [
        {
          id: 'brain-map-current',
          kind: 'current',
          title: 'Current Case',
          subtitle: 'Current investigation focus',
          score: 1,
          status: 'focus',
          badges: ['Current'],
          investigationId: 'inv-current',
          relatedSignalIds: [],
          relatedMemoryLinkIds: [],
          memberInvestigationIds: [],
          reasonSamples: [],
          x: 9,
          y: 91,
        },
        {
          id: 'brain-map-cluster-a',
          kind: 'cluster',
          title: 'Cluster A',
          subtitle: 'First cluster',
          score: 0.92,
          status: 'active',
          gateway: 'entity-date',
          badges: ['Active'],
          investigationId: 'inv-current',
          clusterId: 'cluster-a',
          relatedSignalIds: ['signal-a'],
          relatedMemoryLinkIds: ['link-a'],
          memberInvestigationIds: ['inv-current', 'inv-a'],
          reasonSamples: [reason],
          x: 50,
          y: 50,
        },
        {
          id: 'brain-map-cluster-b',
          kind: 'cluster',
          title: 'Cluster B',
          subtitle: 'Second cluster',
          score: 0.82,
          status: 'active',
          gateway: 'source-domain',
          badges: ['Active'],
          investigationId: 'inv-current',
          clusterId: 'cluster-b',
          relatedSignalIds: ['signal-b'],
          relatedMemoryLinkIds: [],
          memberInvestigationIds: ['inv-current', 'inv-b'],
          reasonSamples: [reason],
          x: 50,
          y: 50,
        },
        {
          id: 'brain-map-signal-a',
          kind: 'signal',
          title: 'Signal A',
          subtitle: 'Signal connected to cluster A',
          score: 0.78,
          status: 'firing',
          gateway: 'entity-date',
          badges: ['Signal'],
          investigationId: 'inv-a',
          targetInvestigationId: 'inv-a',
          clusterId: 'cluster-a',
          signalId: 'signal-a',
          relatedSignalIds: ['signal-a'],
          relatedMemoryLinkIds: [],
          memberInvestigationIds: ['inv-current', 'inv-a'],
          reasonSamples: [reason],
          x: 50,
          y: 50,
        },
        {
          id: 'brain-map-link-a',
          kind: 'memory',
          title: 'Link A',
          subtitle: 'Memory connected to cluster A',
          score: 0.7,
          status: 'linked',
          gateway: 'entity-date',
          badges: ['Auto'],
          investigationId: 'inv-a',
          targetInvestigationId: 'inv-a',
          clusterId: 'cluster-a',
          linkId: 'link-a',
          relatedSignalIds: [],
          relatedMemoryLinkIds: ['link-a'],
          memberInvestigationIds: ['inv-current', 'inv-a'],
          reasonSamples: [reason],
          x: 50,
          y: 50,
        },
        {
          id: 'brain-map-signal-b',
          kind: 'signal',
          title: 'Signal B',
          subtitle: 'Signal connected to cluster B',
          score: 0.66,
          status: 'firing',
          gateway: 'source-domain',
          badges: ['Signal'],
          investigationId: 'inv-b',
          targetInvestigationId: 'inv-b',
          clusterId: 'cluster-b',
          signalId: 'signal-b',
          relatedSignalIds: ['signal-b'],
          relatedMemoryLinkIds: [],
          memberInvestigationIds: ['inv-current', 'inv-b'],
          reasonSamples: [reason],
          x: 50,
          y: 50,
        },
      ],
      edges: [],
      regions: [
        {
          id: 'brain-map-region-a',
          clusterId: 'cluster-a',
          label: 'Cluster A',
          status: 'active',
          score: 0.92,
          gateway: 'entity-date',
          nodeIds: ['brain-map-cluster-a', 'brain-map-signal-a', 'brain-map-link-a'],
          memberInvestigationIds: ['inv-current', 'inv-a'],
          x: 50,
          y: 50,
        },
        {
          id: 'brain-map-region-b',
          clusterId: 'cluster-b',
          label: 'Cluster B',
          status: 'active',
          score: 0.82,
          gateway: 'source-domain',
          nodeIds: ['brain-map-cluster-b', 'brain-map-signal-b'],
          memberInvestigationIds: ['inv-current', 'inv-b'],
          x: 50,
          y: 50,
        },
      ],
      digest: [],
      summary: {
        visibleNodeCount: 6,
        edgeCount: 0,
        clusterCount: 2,
        linkedMemoryCount: 1,
        activeSignalCount: 2,
        suggestionCount: 0,
        strongestScore: 0.92,
      },
    }

    const model = buildBrainMapModelFromView(view)
    const current = model.nodes.find((node) => node.kind === 'current')
    const clusterA = model.nodes.find((node) => node.clusterId === 'cluster-a' && node.kind === 'cluster')
    const clusterB = model.nodes.find((node) => node.clusterId === 'cluster-b' && node.kind === 'cluster')
    const signalA = model.nodes.find((node) => node.signalId === 'signal-a')
    const signalB = model.nodes.find((node) => node.signalId === 'signal-b')

    expect(current).toMatchObject({ x: 50, y: 50 })
    expect(model.nodes.slice(1).every((node) => (node.x || 0) >= 12 && (node.x || 0) <= 88)).toBe(true)
    expect(model.nodes.slice(1).every((node) => (node.y || 0) >= 12 && (node.y || 0) <= 88)).toBe(true)
    expect(distanceBetween(clusterA!, clusterB!)).toBeGreaterThanOrEqual(20)
    expect(distanceBetween(signalA!, clusterA!)).toBeLessThan(distanceBetween(signalA!, clusterB!))
    expect(distanceBetween(signalB!, clusterB!)).toBeLessThan(distanceBetween(signalB!, clusterA!))

    for (const [index, node] of model.nodes.slice(1).entries()) {
      for (const other of model.nodes.slice(index + 2)) {
        expect(distanceBetween(node, other)).toBeGreaterThanOrEqual(8)
      }
    }
  })
})
