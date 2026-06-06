const API_BASE = 'http://localhost:8080/api/brain'

export type BrainGateway = 'entity-date' | 'source-domain' | 'relationship-tag' | string

export interface BrainSignalReason {
  gateway: BrainGateway
  value: string
  label: string
  detail: string
  currentNodeIds: string[]
  targetNodeIds: string[]
}

export interface BrainSignal {
  id: string
  investigationId: string
  investigationTitle: string
  targetInvestigationId: string
  targetTitle: string
  score: number
  gateways: BrainGateway[]
  reasons: BrainSignalReason[]
  suggestedAction: string
  createdAt: string
  updatedAt: string
  dismissed: boolean
  linked: boolean
  linkId?: string
  activationCount?: number
  lastFiredAt?: string
}

export interface MemoryLink {
  id: string
  signalId: string
  fromInvestigationId: string
  fromTitle: string
  toInvestigationId: string
  toTitle: string
  score: number
  gateways: BrainGateway[]
  reasons: BrainSignalReason[]
  suggestedAction: string
  createdAt: string
  updatedAt?: string
  lastFiredAt?: string
  activationCount?: number
  promotionType?: 'manual' | 'auto' | string
}

export interface MemoryClusterMember {
  investigationId: string
  title: string
  role: 'current' | 'memory' | string
}

export interface MemoryCluster {
  id: string
  label: string
  summary: string
  score: number
  status: 'active' | 'warm' | 'dormant' | string
  dominantGateway: BrainGateway
  gatewayCounts: Record<string, number>
  memberInvestigationIds: string[]
  members: MemoryClusterMember[]
  signalIds: string[]
  memoryLinkIds: string[]
  reasonSamples: BrainSignalReason[]
  pinned: boolean
  hidden: boolean
  createdAt: string
  updatedAt: string
  lastActivatedAt: string
}

const requestJSON = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Brain memory request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const fetchBrainSignals = (investigationId: string) =>
  requestJSON<BrainSignal[]>(`${API_BASE}/signals?investigationId=${encodeURIComponent(investigationId)}`)

export const fetchBrainLinks = (investigationId: string) =>
  requestJSON<MemoryLink[]>(`${API_BASE}/links?investigationId=${encodeURIComponent(investigationId)}`)

export const fetchBrainClusters = (investigationId: string) =>
  requestJSON<MemoryCluster[]>(`${API_BASE}/clusters?investigationId=${encodeURIComponent(investigationId)}`)

export const dismissBrainSignal = (signalId: string) =>
  requestJSON<BrainSignal>(`${API_BASE}/signals/${encodeURIComponent(signalId)}/dismiss`, {
    method: 'PUT',
  })

export const promoteBrainSignal = (signalId: string) =>
  requestJSON<MemoryLink>(`${API_BASE}/signals/${encodeURIComponent(signalId)}/link`, {
    method: 'PUT',
  })

export const forgetBrainLink = (linkId: string) =>
  requestJSON<MemoryLink>(`${API_BASE}/links/${encodeURIComponent(linkId)}/forget`, {
    method: 'PUT',
  })

export const toggleBrainClusterPin = (clusterId: string) =>
  requestJSON<MemoryCluster>(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/pin`, {
    method: 'PUT',
  })

export const hideBrainCluster = (clusterId: string) =>
  requestJSON<MemoryCluster>(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/hide`, {
    method: 'PUT',
  })

export const unhideBrainCluster = (clusterId: string) =>
  requestJSON<MemoryCluster>(`${API_BASE}/clusters/${encodeURIComponent(clusterId)}/unhide`, {
    method: 'PUT',
  })
