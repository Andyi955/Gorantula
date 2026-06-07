import { describe, expect, it } from 'vitest'
import type { BrainGateway, BrainSignal, MemoryCluster, MemoryLink } from '../../src/utils/brainMemory'
import {
  buildSignalSummary,
  clusterMatchesFilters,
  formatActivationCount,
  formatClusterGatewayCount,
  formatClusterMemberCount,
  formatClusterStatus,
  formatGateway,
  formatMemoryLinkType,
  formatScore,
  formatTimestamp,
  getClusterLinkCount,
  getClusterSignalCount,
  getRelatedFiringText,
  getRelatedMemoryText,
  getScoreTier,
  groupMemoryLinksByOlderCase,
  groupSignalsByOlderCase,
  matchesBrainFilters,
  relatedClustersForLinkGroup,
  relatedClustersForSignalGroup,
  sortByScore,
} from '../../src/utils/brainMemoryUtils'

const baseReason = {
  gateway: 'entity-date' as BrainGateway,
  value: 'northgate',
  label: 'Northgate',
  detail: 'Northgate appears in both investigations.',
  currentNodeIds: ['node-current'],
  targetNodeIds: ['node-target'],
}

const sourceReason = {
  ...baseReason,
  gateway: 'source-domain' as BrainGateway,
  value: 'operator.example',
  label: 'operator.example',
  detail: 'operator.example appears in both investigations.',
}

const makeSignal = (overrides: Partial<BrainSignal> = {}): BrainSignal => ({
  id: overrides.id || 'signal-a',
  investigationId: overrides.investigationId || 'inv-current',
  investigationTitle: overrides.investigationTitle || 'Current Case',
  targetInvestigationId: overrides.targetInvestigationId || 'inv-old',
  targetTitle: overrides.targetTitle || 'Older Case',
  score: overrides.score ?? 0.8,
  gateways: overrides.gateways || ['entity-date'],
  reasons: overrides.reasons || [baseReason],
  suggestedAction: overrides.suggestedAction || 'Review older case',
  createdAt: overrides.createdAt || '2026-06-05T12:00:00Z',
  updatedAt: overrides.updatedAt || '2026-06-05T12:00:00Z',
  dismissed: overrides.dismissed ?? false,
  linked: overrides.linked ?? false,
  linkId: overrides.linkId,
  activationCount: overrides.activationCount,
  lastFiredAt: overrides.lastFiredAt,
})

const makeLink = (overrides: Partial<MemoryLink> = {}): MemoryLink => ({
  id: overrides.id || 'link-a',
  signalId: overrides.signalId || 'signal-a',
  fromInvestigationId: overrides.fromInvestigationId || 'inv-current',
  fromTitle: overrides.fromTitle || 'Current Case',
  toInvestigationId: overrides.toInvestigationId || 'inv-old',
  toTitle: overrides.toTitle || 'Older Case',
  score: overrides.score ?? 0.8,
  gateways: overrides.gateways || ['entity-date'],
  reasons: overrides.reasons || [baseReason],
  suggestedAction: overrides.suggestedAction || 'Review older case',
  createdAt: overrides.createdAt || '2026-06-05T12:00:00Z',
  updatedAt: overrides.updatedAt,
  lastFiredAt: overrides.lastFiredAt,
  activationCount: overrides.activationCount,
  promotionType: overrides.promotionType,
})

const makeCluster = (overrides: Partial<MemoryCluster> = {}): MemoryCluster => ({
  id: overrides.id || 'cluster-a',
  label: overrides.label || 'Acme Grid',
  summary: overrides.summary || 'Acme Grid links investigations.',
  score: overrides.score ?? 0.86,
  status: overrides.status || 'active',
  dominantGateway: overrides.dominantGateway || 'entity-date',
  gatewayCounts: overrides.gatewayCounts || { 'entity-date': 3 },
  memberInvestigationIds: overrides.memberInvestigationIds || ['inv-current', 'inv-old'],
  members: overrides.members || [],
  signalIds: overrides.signalIds || ['signal-a'],
  memoryLinkIds: overrides.memoryLinkIds || ['link-a'],
  reasonSamples: overrides.reasonSamples || [baseReason],
  pinned: overrides.pinned ?? false,
  hidden: overrides.hidden ?? false,
  createdAt: overrides.createdAt || '2026-06-05T12:00:00Z',
  updatedAt: overrides.updatedAt || '2026-06-05T12:00:00Z',
  lastActivatedAt: overrides.lastActivatedAt || '2026-06-06T09:00:00Z',
})

describe('brainMemoryUtils', () => {
  it('formats memory labels without rendering the panel', () => {
    expect(formatGateway('entity-date')).toBe('Entity/Date')
    expect(formatGateway('unknown-gateway')).toBe('unknown gateway')
    expect(formatScore(1.4)).toBe('100%')
    expect(formatScore(-0.2)).toBe('0%')
    expect(formatActivationCount(3)).toBe('3 activations')
    expect(formatMemoryLinkType('auto')).toBe('Auto Memory')
    expect(formatMemoryLinkType('manual')).toBe('Manual Memory')
    expect(formatMemoryLinkType('mixed')).toBe('Mixed Memory')
    expect(formatTimestamp('2026-06-05T12:34:56.000Z')).toBe('2026-06-05 12:34 UTC')
  })

  it('sorts, tiers, filters, and groups active signals by older case title', () => {
    const duplicate = makeSignal({
      id: 'signal-b',
      targetInvestigationId: 'inv-old-copy',
      targetTitle: 'Older Case',
      score: 0.62,
      gateways: ['source-domain'],
      reasons: [sourceReason],
    })
    const weak = makeSignal({ id: 'signal-c', targetTitle: 'Weak Case', score: 0.2 })

    expect(sortByScore([weak, duplicate])[0].id).toBe('signal-b')
    expect(getScoreTier(0.8)).toBe('Hot')
    expect(getScoreTier(0.55)).toBe('Warm')
    expect(getScoreTier(0.2)).toBe('Weak')
    expect(matchesBrainFilters(duplicate, 'source-domain', 'warm')).toBe(true)
    expect(matchesBrainFilters(duplicate, 'relationship-tag', 'warm')).toBe(false)

    const groups = groupSignalsByOlderCase([duplicate, weak, makeSignal()])
    expect(groups).toHaveLength(2)
    expect(groups[0].primary.targetTitle).toBe('Older Case')
    expect(groups[0].signals).toHaveLength(2)
    expect(groups[0].gateways).toEqual(['entity-date', 'source-domain'])
    expect(getRelatedFiringText(groups[0].signals.length)).toBe('+1 related firing')
    expect(buildSignalSummary(groups[0])).toContain('Northgate')
  })

  it('groups linked memories by older case and aggregates activations', () => {
    const links = [
      makeLink({ id: 'link-a', toTitle: 'Repeated Case', score: 0.91, activationCount: 2, promotionType: 'auto' }),
      makeLink({
        id: 'link-b',
        signalId: 'signal-b',
        toInvestigationId: 'inv-copy',
        toTitle: 'Repeated Case',
        score: 0.6,
        activationCount: 3,
        promotionType: 'manual',
      }),
    ]

    const groups = groupMemoryLinksByOlderCase(links)
    expect(groups).toHaveLength(1)
    expect(groups[0].activationCount).toBe(5)
    expect(groups[0].promotionType).toBe('mixed')
    expect(getRelatedMemoryText(groups[0].links.length)).toBe('+1 related memory')
  })

  it('formats and filters memory clusters', () => {
    const cluster = makeCluster()

    expect(formatClusterStatus('active')).toBe('Active')
    expect(formatClusterStatus('')).toBe('Dormant')
    expect(formatClusterGatewayCount(cluster)).toBe('Entity/Date x3')
    expect(formatClusterMemberCount(cluster)).toBe('2 cases')
    expect(getClusterSignalCount(cluster)).toBe(1)
    expect(getClusterLinkCount(cluster)).toBe(1)
    expect(clusterMatchesFilters(cluster, 'entity-date', 'hot')).toBe(true)
    expect(clusterMatchesFilters(cluster, 'source-domain', 'hot')).toBe(false)
  })

  it('finds visible clusters related to grouped signals and links', () => {
    const signalGroup = groupSignalsByOlderCase([makeSignal({ id: 'signal-a' })])[0]
    const linkGroup = groupMemoryLinksByOlderCase([makeLink({ id: 'link-a' })])[0]
    const visible = makeCluster({ id: 'cluster-visible' })
    const hidden = makeCluster({ id: 'cluster-hidden', hidden: true })

    expect(relatedClustersForSignalGroup(signalGroup, [visible, hidden]).map((item) => item.id))
      .toEqual(['cluster-visible'])
    expect(relatedClustersForLinkGroup(linkGroup, [visible, hidden]).map((item) => item.id))
      .toEqual(['cluster-visible'])
  })
})
