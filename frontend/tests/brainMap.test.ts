import { describe, expect, it } from 'vitest'
import type { BrainSignal, MemoryLink } from '../src/utils/brainMemory'
import { buildBrainMapModel } from '../src/utils/brainMap'

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
})
