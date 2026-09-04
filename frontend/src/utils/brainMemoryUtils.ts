import type { BrainGateway, BrainRelevance, BrainSignal, MemoryCluster, MemoryLink } from './brainMemory'

export type GatewayFilter = 'all' | 'entity-date' | 'source-domain' | 'relationship-tag' | 'contradiction' | 'pattern' | 'claims' | 'semantic'
export type StrengthFilter = 'all' | 'hot' | 'warm' | 'weak'

export interface BrainSignalGroup {
  key: string
  primary: BrainSignal
  signals: BrainSignal[]
  score: number
  relevance: BrainRelevance
  relevanceLabel: string
  relevanceReason?: string
  reasons: BrainSignal['reasons']
  gateways: BrainGateway[]
}

export interface MemoryLinkGroup {
  key: string
  primary: MemoryLink
  links: MemoryLink[]
  score: number
  reasons: MemoryLink['reasons']
  gateways: BrainGateway[]
  activationCount: number
  promotionType?: string
}

export const gatewayLabels: Record<string, string> = {
  'entity-date': 'Entity/Date',
  'source-domain': 'Source Domain',
  'relationship-tag': 'Relationship',
  'contradiction': 'Contradiction',
  'pattern': 'Recurring Pattern',
  'claims': 'Quantified Claim',
  'semantic': 'Semantic Overlap',
}

export const gatewayClassNames: Record<string, string> = {
  'entity-date': 'forensic-brain-chip-entity',
  'source-domain': 'forensic-brain-chip-source',
  'relationship-tag': 'forensic-brain-chip-relationship',
  'contradiction': 'forensic-brain-chip-contradiction',
  'pattern': 'forensic-brain-chip-pattern',
  'claims': 'forensic-brain-chip-claims',
  'semantic': 'forensic-brain-chip-semantic',
}

export const LOW_PRIORITY_SCORE_THRESHOLD = 0.5

export const relevanceLabels: Record<string, string> = {
  'strong-memory': 'Strong Memory',
  'possible-bridge': 'Possible Bridge',
  'distant-echo': 'Distant Echo',
  'background-noise': 'Background Noise',
}

export const formatGateway = (gateway: BrainGateway) =>
  gatewayLabels[gateway] || String(gateway).replace(/[-_]+/g, ' ')

export const formatScore = (score: number) => `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`

export const normalizeRelevance = (relevance?: BrainRelevance) => (
  relevance === 'strong-memory' ||
  relevance === 'possible-bridge' ||
  relevance === 'distant-echo' ||
  relevance === 'background-noise'
    ? relevance
    : 'possible-bridge'
)

export const formatRelevance = (item: { relevance?: BrainRelevance; relevanceLabel?: string }) =>
  item.relevanceLabel || relevanceLabels[normalizeRelevance(item.relevance)] || 'Possible Bridge'

export const relevanceRank = (relevance?: BrainRelevance) => {
  switch (normalizeRelevance(relevance)) {
  case 'strong-memory':
    return 0
  case 'possible-bridge':
    return 1
  case 'distant-echo':
    return 2
  case 'background-noise':
    return 3
  default:
    return 1
  }
}

export const isSpeculativeRelevance = (relevance?: BrainRelevance) => {
  const normalized = normalizeRelevance(relevance)
  return normalized === 'distant-echo' || normalized === 'background-noise'
}

export const formatActivationCount = (activationCount?: number) => {
  const count = Math.max(1, Math.round(activationCount || 1))
  return `${count} activation${count === 1 ? '' : 's'}`
}

export const formatMemoryLinkType = (promotionType?: string) =>
  promotionType === 'mixed' ? 'Mixed Memory' :
  promotionType === 'auto' ? 'Auto Memory' : 'Manual Memory'

export const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) {
    return 'Not recorded'
  }
  const cleaned = timestamp.replace(/\.\d+Z$/, 'Z')
  const match = cleaned.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  if (match) {
    return `${match[1]} ${match[2]} UTC`
  }
  return timestamp
}

export const formatNodeIds = (ids: string[] | null | undefined) => {
  // Persisted reasons can carry null node id lists (e.g. whole-board matchers
  // like the semantic gateway); render defensively instead of crashing.
  const uniqueIds = Array.from(new Set((ids ?? []).filter(Boolean)))
  return uniqueIds.length > 0 ? uniqueIds.join(', ') : 'No matched nodes recorded'
}

export const getScoreTier = (score: number) => {
  if (score >= 0.75) {
    return 'Hot'
  }
  if (score >= LOW_PRIORITY_SCORE_THRESHOLD) {
    return 'Warm'
  }
  return 'Weak'
}

export const getScoreTierKey = (score: number): StrengthFilter => getScoreTier(score).toLocaleLowerCase() as StrengthFilter

export const sortByScore = <T extends { score: number; createdAt?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    const leftRelevance = relevanceRank((left as { relevance?: BrainRelevance }).relevance)
    const rightRelevance = relevanceRank((right as { relevance?: BrainRelevance }).relevance)
    if (leftRelevance !== rightRelevance) {
      return leftRelevance - rightRelevance
    }
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
  })

export const sortClusters = (items: MemoryCluster[]) =>
  [...items].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1
    }
    if (left.hidden !== right.hidden) {
      return left.hidden ? 1 : -1
    }
    const relevanceDelta = relevanceRank(left.relevance) - relevanceRank(right.relevance)
    if (relevanceDelta !== 0) {
      return relevanceDelta
    }
    if (right.score !== left.score) {
      return right.score - left.score
    }
    return left.label.localeCompare(right.label)
  })

const normalizeSignalGroupTitle = (title: string) => title.trim().toLocaleLowerCase().replace(/\s+/g, ' ')

const getSignalGroupKey = (signal: BrainSignal) =>
  normalizeSignalGroupTitle(signal.targetTitle) || signal.targetInvestigationId

const getMemoryLinkGroupKey = (link: MemoryLink) =>
  normalizeSignalGroupTitle(link.toTitle) || link.toInvestigationId

const hasGateway = (gateways: BrainGateway[], reasons: Array<{ gateway: BrainGateway }>, gateway: GatewayFilter) => {
  if (gateway === 'all') {
    return true
  }
  return gateways.includes(gateway) || reasons.some((reason) => reason.gateway === gateway)
}

export const matchesBrainFilters = (
  item: { score: number; gateways: BrainGateway[]; reasons: Array<{ gateway: BrainGateway }> },
  gatewayFilter: GatewayFilter,
  strengthFilter: StrengthFilter,
) => {
  const matchesGateway = hasGateway(item.gateways, item.reasons, gatewayFilter)
  const matchesStrength = strengthFilter === 'all' || getScoreTierKey(item.score) === strengthFilter
  return matchesGateway && matchesStrength
}

const uniqueReasons = (signals: BrainSignal[]) => {
  const seen = new Set<string>()
  const reasons: BrainSignal['reasons'] = []

  signals.forEach((signal) => {
    signal.reasons.forEach((reason) => {
      const key = `${reason.gateway}:${reason.value}:${reason.detail || reason.label}`
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      reasons.push(reason)
    })
  })

  return reasons
}

const uniqueGateways = (signals: BrainSignal[]) => {
  const seen = new Set<string>()
  const gateways: BrainGateway[] = []

  signals.forEach((signal) => {
    const signalGateways = signal.reasons.length > 0
      ? signal.reasons.map((reason) => reason.gateway)
      : signal.gateways

    signalGateways.forEach((gateway) => {
      if (seen.has(gateway)) {
        return
      }
      seen.add(gateway)
      gateways.push(gateway)
    })
  })

  return gateways
}

const uniqueLinkReasons = (links: MemoryLink[]) => {
  const seen = new Set<string>()
  const reasons: MemoryLink['reasons'] = []

  links.forEach((link) => {
    link.reasons.forEach((reason) => {
      const key = `${reason.gateway}:${reason.value}:${reason.detail || reason.label}`
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      reasons.push(reason)
    })
  })

  return reasons
}

const uniqueLinkGateways = (links: MemoryLink[]) => {
  const seen = new Set<string>()
  const gateways: BrainGateway[] = []

  links.forEach((link) => {
    const linkGateways = link.reasons.length > 0
      ? link.reasons.map((reason) => reason.gateway)
      : link.gateways

    linkGateways.forEach((gateway) => {
      if (seen.has(gateway)) {
        return
      }
      seen.add(gateway)
      gateways.push(gateway)
    })
  })

  return gateways
}

const memoryGroupActivationCount = (links: MemoryLink[]) =>
  links.reduce((total, link) => total + Math.max(1, Math.round(link.activationCount || 1)), 0)

const memoryGroupPromotionType = (links: MemoryLink[]) => {
  const types = new Set(links.map((link) => link.promotionType || 'manual'))
  if (types.size > 1) {
    return 'mixed'
  }
  return links[0]?.promotionType || 'manual'
}

export const groupSignalsByOlderCase = (signals: BrainSignal[]): BrainSignalGroup[] => {
  const grouped = new Map<string, BrainSignal[]>()

  sortByScore(signals).forEach((signal) => {
    const key = getSignalGroupKey(signal)
    grouped.set(key, [...(grouped.get(key) || []), signal])
  })

  return Array.from(grouped.entries())
    .map(([key, groupSignals]) => {
      const rankedGroupSignals = sortByScore(groupSignals)
      const primary = rankedGroupSignals[0]

      return {
        key,
        primary,
        signals: rankedGroupSignals,
        score: primary.score,
        relevance: normalizeRelevance(primary.relevance),
        relevanceLabel: formatRelevance(primary),
        relevanceReason: primary.relevanceReason,
        reasons: uniqueReasons(rankedGroupSignals),
        gateways: uniqueGateways(rankedGroupSignals),
      }
    })
    .sort((left, right) => {
      const relevanceDelta = relevanceRank(left.relevance) - relevanceRank(right.relevance)
      if (relevanceDelta !== 0) {
        return relevanceDelta
      }
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.primary.targetTitle.localeCompare(right.primary.targetTitle)
    })
}

export const groupMemoryLinksByOlderCase = (links: MemoryLink[]): MemoryLinkGroup[] => {
  const grouped = new Map<string, MemoryLink[]>()

  sortByScore(links).forEach((link) => {
    const key = getMemoryLinkGroupKey(link)
    grouped.set(key, [...(grouped.get(key) || []), link])
  })

  return Array.from(grouped.entries())
    .map(([key, groupLinks]) => {
      const rankedGroupLinks = sortByScore(groupLinks)
      const primary = rankedGroupLinks[0]

      return {
        key,
        primary,
        links: rankedGroupLinks,
        score: primary.score,
        reasons: uniqueLinkReasons(rankedGroupLinks),
        gateways: uniqueLinkGateways(rankedGroupLinks),
        activationCount: memoryGroupActivationCount(rankedGroupLinks),
        promotionType: memoryGroupPromotionType(rankedGroupLinks),
      }
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.primary.toTitle.localeCompare(right.primary.toTitle)
    })
}

export const getRelatedFiringText = (count: number) => {
  const relatedCount = count - 1
  if (relatedCount <= 0) {
    return null
  }
  return `+${relatedCount} related firing${relatedCount === 1 ? '' : 's'}`
}

export const getRelatedMemoryText = (count: number) => {
  const relatedCount = count - 1
  if (relatedCount <= 0) {
    return null
  }
  return `+${relatedCount} related memor${relatedCount === 1 ? 'y' : 'ies'}`
}

export const formatCountLabel = (count: number, singular: string) =>
  `${count} ${singular}${count === 1 ? '' : 's'}`

export const dominantGatewayLabel = (signalGroups: BrainSignalGroup[], linkGroups: MemoryLinkGroup[]) => {
  const counts = new Map<BrainGateway, number>()

  const countGateways = (gateways: BrainGateway[]) => {
    gateways.forEach((gateway) => counts.set(gateway, (counts.get(gateway) || 0) + 1))
  }

  signalGroups.forEach((group) => countGateways(group.gateways))
  linkGroups.forEach((group) => countGateways(group.gateways))

  const dominant = Array.from(counts.entries()).sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1]
    }
    return gatewayRank(left[0]) - gatewayRank(right[0])
  })[0]?.[0]

  return dominant ? formatGateway(dominant) : 'None'
}

const gatewayRank = (gateway: BrainGateway) => {
  switch (gateway) {
  case 'entity-date':
    return 0
  case 'source-domain':
    return 1
  case 'relationship-tag':
    return 2
  case 'contradiction':
    return 3
  case 'pattern':
    return 4
  case 'claims':
    return 5
  case 'semantic':
    return 6
  default:
    return 9
  }
}

export const getGatewayCounts = (group: BrainSignalGroup) =>
  group.gateways.map((gateway) => {
    const reasonCount = group.reasons.filter((reason) => reason.gateway === gateway).length
    const signalGatewayCount = group.signals.filter((signal) => signal.gateways.includes(gateway)).length

    return {
      gateway,
      count: Math.max(1, reasonCount || signalGatewayCount),
    }
  })

export const formatGatewayCount = ({ gateway, count }: { gateway: BrainGateway; count: number }) =>
  count > 1 ? `${formatGateway(gateway)} x${count}` : formatGateway(gateway)

export const buildSignalSummary = (group: BrainSignalGroup) => {
  const labels: string[] = []
  const seen = new Set<string>()

  group.reasons.forEach((reason) => {
    const label = (reason.label || reason.value || '').trim()
    if (!label) {
      return
    }
    const key = label.toLocaleLowerCase()
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    labels.push(label)
  })

  if (labels.length === 0) {
    return group.primary.suggestedAction
  }

  const visibleLabels = labels.slice(0, 3)
  const hiddenCount = labels.length - visibleLabels.length
  return `${visibleLabels.join(', ')}${hiddenCount > 0 ? ` +${hiddenCount} more` : ''}`
}

export const formatClusterStatus = (status: string) => {
  const normalized = status.trim().toLocaleLowerCase()
  if (!normalized) {
    return 'Dormant'
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export const formatClusterGatewayCount = (cluster: MemoryCluster) => {
  const count = cluster.gatewayCounts?.[cluster.dominantGateway] || cluster.memberInvestigationIds.length
  return count > 1 ? `${formatGateway(cluster.dominantGateway)} x${count}` : formatGateway(cluster.dominantGateway)
}

export const formatClusterMemberCount = (cluster: MemoryCluster) =>
  formatCountLabel(cluster.memberInvestigationIds.length || cluster.members.length, 'case')

export const getClusterSignalCount = (cluster: MemoryCluster) => cluster.signalIds.length

export const getClusterLinkCount = (cluster: MemoryCluster) => cluster.memoryLinkIds.length

export const clusterMatchesFilters = (
  cluster: MemoryCluster,
  gatewayFilter: GatewayFilter,
  strengthFilter: StrengthFilter,
) => matchesBrainFilters(
  {
    score: cluster.score,
    gateways: [cluster.dominantGateway],
    reasons: cluster.reasonSamples,
  },
  gatewayFilter,
  strengthFilter,
)

export const relatedClustersForSignalGroup = (group: BrainSignalGroup, clusters: MemoryCluster[]) => {
  const signalIds = new Set(group.signals.map((signal) => signal.id))
  return clusters.filter((cluster) => !cluster.hidden && cluster.signalIds.some((signalId) => signalIds.has(signalId))).slice(0, 2)
}

export const relatedClustersForLinkGroup = (group: MemoryLinkGroup, clusters: MemoryCluster[]) => {
  const linkIds = new Set(group.links.map((link) => link.id))
  return clusters.filter((cluster) => !cluster.hidden && cluster.memoryLinkIds.some((linkId) => linkIds.has(linkId))).slice(0, 2)
}
