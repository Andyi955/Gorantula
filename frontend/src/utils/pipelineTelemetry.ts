export interface TokenUsageReport {
  investigationId?: string
  label: string
  callCount: number
  reportedCallCount: number
  estimatedCallCount: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  providerTotals?: Record<string, number>
}

export interface PipelineProgressStepState {
  id: string
  label: string
  status: 'pending' | 'running' | 'complete' | 'error' | 'cancelled'
  startedAt?: string
  completedAt?: string
  durationMs?: number
  detail?: string
  error?: string
}

export interface PipelineProgressPayload {
  runId: string
  vaultId?: string
  mode: string
  stepId: string
  stepLabel: string
  status: 'pending' | 'running' | 'complete' | 'error' | 'cancelled'
  completedSteps: number
  totalSteps: number
  startedAt?: string
  stepStartedAt?: string
  completedAt?: string
  elapsedMs: number
  durationMs?: number
  estimatedRemainingMs?: number
  detail?: string
  error?: string
  steps?: PipelineProgressStepState[]
}

export interface PipelineRunState extends PipelineProgressPayload {
  updatedAt: number
}

export interface PipelineProfileBottleneck {
  kind: 'step' | 'span' | 'token'
  id: string
  label: string
  stepId?: string
  durationMs?: number
  totalTokens?: number
  percentOfTotal?: number
}

export interface PipelineProfileTokenUsage {
  operation: string
  provider: string
  callCount: number
  reportedCallCount?: number
  estimatedCallCount?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens: number
}

export interface PipelinePerformanceProfile {
  runId: string
  vaultId?: string
  mode?: string
  status?: string
  startedAt?: string
  completedAt?: string
  totalElapsedMs: number
  counters?: Record<string, number>
  bottlenecks: PipelineProfileBottleneck[]
  tokenUsage: PipelineProfileTokenUsage[]
}

const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

export const formatCompactTokens = (value: number) => compactTokenFormatter.format(value)

export const getPipelineStepTransitionKey = (runId: string, stepId: string, status: PipelineProgressStepState['status']) =>
  `${runId}:${stepId}:${status}`

export const clampProgressPercent = (completedSteps: number, totalSteps: number) => {
  if (!Number.isFinite(completedSteps) || !Number.isFinite(totalSteps) || totalSteps <= 0) {
    return 0
  }
  return Math.max(0, Math.min(100, Math.round((completedSteps / totalSteps) * 100)))
}

export const formatDuration = (milliseconds?: number | null) => {
  if (!milliseconds || !Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0s'
  }

  const totalSeconds = Math.max(1, Math.round(milliseconds / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) {
    return `${seconds}s`
  }
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export const parseTokenCount = (value: unknown): number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

export const coercePipelineStatus = (value: unknown): PipelineProgressPayload['status'] => {
  if (value === 'pending' || value === 'running' || value === 'complete' || value === 'error' || value === 'cancelled') {
    return value
  }
  return 'running'
}

export const coercePipelineProgressPayload = (payload: unknown): PipelineProgressPayload | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.runId !== 'string' || candidate.runId.trim() === '') {
    return null
  }

  const rawSteps = Array.isArray(candidate.steps) ? candidate.steps : []
  const steps = rawSteps
    .filter((step): step is Record<string, unknown> => Boolean(step) && typeof step === 'object' && !Array.isArray(step))
    .map((step) => ({
      id: typeof step.id === 'string' ? step.id : '',
      label: typeof step.label === 'string' ? step.label : 'Pipeline step',
      status: coercePipelineStatus(step.status),
      startedAt: typeof step.startedAt === 'string' ? step.startedAt : undefined,
      completedAt: typeof step.completedAt === 'string' ? step.completedAt : undefined,
      durationMs: parseTokenCount(step.durationMs),
      detail: typeof step.detail === 'string' ? step.detail : undefined,
      error: typeof step.error === 'string' ? step.error : undefined,
    }))
    .filter((step) => step.id)

  return {
    runId: candidate.runId.trim(),
    vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId : undefined,
    mode: typeof candidate.mode === 'string' ? candidate.mode : 'web',
    stepId: typeof candidate.stepId === 'string' ? candidate.stepId : 'pipeline',
    stepLabel: typeof candidate.stepLabel === 'string' ? candidate.stepLabel : 'Pipeline',
    status: coercePipelineStatus(candidate.status),
    completedSteps: parseTokenCount(candidate.completedSteps),
    totalSteps: Math.max(1, parseTokenCount(candidate.totalSteps)),
    startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : undefined,
    stepStartedAt: typeof candidate.stepStartedAt === 'string' ? candidate.stepStartedAt : undefined,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined,
    elapsedMs: parseTokenCount(candidate.elapsedMs),
    durationMs: parseTokenCount(candidate.durationMs),
    estimatedRemainingMs: parseTokenCount(candidate.estimatedRemainingMs),
    detail: typeof candidate.detail === 'string' ? candidate.detail : undefined,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    steps,
  }
}

export const formatTokenProviderBreakdown = (providerTotals?: Record<string, number>) => {
  const entries = Object.entries(providerTotals || {})
  if (entries.length === 0) {
    return 'No provider totals reported'
  }

  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, total]) => `${provider}: ${total.toLocaleString()}`)
    .join(' | ')
}

export const buildEmptyTokenUsageReport = (label: string): TokenUsageReport => ({
  label,
  callCount: 0,
  reportedCallCount: 0,
  estimatedCallCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  providerTotals: {},
})

export const coerceTokenUsageReport = (payload: unknown): TokenUsageReport | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.label !== 'string' || candidate.label.trim() === '') {
    return null
  }

  const rawProviderTotals = candidate.providerTotals && typeof candidate.providerTotals === 'object' && !Array.isArray(candidate.providerTotals)
    ? candidate.providerTotals as Record<string, unknown>
    : {}

  const providerTotals = Object.entries(rawProviderTotals).reduce<Record<string, number>>((totals, [provider, total]) => {
    totals[provider] = parseTokenCount(total)
    return totals
  }, {})

  return {
    investigationId: typeof candidate.investigationId === 'string' && candidate.investigationId.trim() !== '' ? candidate.investigationId : undefined,
    label: candidate.label,
    callCount: parseTokenCount(candidate.callCount),
    reportedCallCount: parseTokenCount(candidate.reportedCallCount),
    estimatedCallCount: parseTokenCount(candidate.estimatedCallCount),
    promptTokens: parseTokenCount(candidate.promptTokens),
    completionTokens: parseTokenCount(candidate.completionTokens),
    totalTokens: parseTokenCount(candidate.totalTokens),
    providerTotals,
  }
}

export const coercePipelineProfile = (payload: unknown): PipelinePerformanceProfile | null => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const candidate = payload as Record<string, unknown>
  if (typeof candidate.runId !== 'string' || candidate.runId.trim() === '') {
    return null
  }

  const rawCounters = candidate.counters && typeof candidate.counters === 'object' && !Array.isArray(candidate.counters)
    ? candidate.counters as Record<string, unknown>
    : {}
  const counters = Object.entries(rawCounters).reduce<Record<string, number>>((accumulator, [key, value]) => {
    accumulator[key] = parseTokenCount(value)
    return accumulator
  }, {})

  const bottlenecks = (Array.isArray(candidate.bottlenecks) ? candidate.bottlenecks : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item): PipelineProfileBottleneck => ({
      kind: item.kind === 'step' || item.kind === 'span' || item.kind === 'token' ? item.kind : 'span',
      id: typeof item.id === 'string' ? item.id : '',
      label: typeof item.label === 'string' && item.label.trim() ? item.label : 'Pipeline bottleneck',
      stepId: typeof item.stepId === 'string' ? item.stepId : undefined,
      durationMs: parseTokenCount(item.durationMs),
      totalTokens: parseTokenCount(item.totalTokens),
      percentOfTotal: parseTokenCount(item.percentOfTotal),
    }))
    .filter((item) => item.id || item.label)

  const tokenUsage = (Array.isArray(candidate.tokenUsage) ? candidate.tokenUsage : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({
      operation: typeof item.operation === 'string' && item.operation.trim() ? item.operation : 'unknown',
      provider: typeof item.provider === 'string' && item.provider.trim() ? item.provider : 'unknown',
      callCount: parseTokenCount(item.callCount),
      reportedCallCount: parseTokenCount(item.reportedCallCount),
      estimatedCallCount: parseTokenCount(item.estimatedCallCount),
      promptTokens: parseTokenCount(item.promptTokens),
      completionTokens: parseTokenCount(item.completionTokens),
      totalTokens: parseTokenCount(item.totalTokens),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens)

  return {
    runId: candidate.runId.trim(),
    vaultId: typeof candidate.vaultId === 'string' ? candidate.vaultId : undefined,
    mode: typeof candidate.mode === 'string' ? candidate.mode : undefined,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    startedAt: typeof candidate.startedAt === 'string' ? candidate.startedAt : undefined,
    completedAt: typeof candidate.completedAt === 'string' ? candidate.completedAt : undefined,
    totalElapsedMs: parseTokenCount(candidate.totalElapsedMs),
    counters,
    bottlenecks,
    tokenUsage,
  }
}

export const coercePipelineProfiles = (payload: unknown): PipelinePerformanceProfile[] => {
  if (!Array.isArray(payload)) {
    return []
  }
  return payload
    .map(coercePipelineProfile)
    .filter((profile): profile is PipelinePerformanceProfile => Boolean(profile))
}

export const getTopPipelineDurationBottleneck = (profile?: PipelinePerformanceProfile | null) =>
  profile?.bottlenecks.find((bottleneck) => bottleneck.kind === 'span' || bottleneck.kind === 'step') || null

export const getTopPipelineTokenBottleneck = (profile?: PipelinePerformanceProfile | null) =>
  profile?.bottlenecks.find((bottleneck) => bottleneck.kind === 'token' && (bottleneck.totalTokens || 0) > 0) || null

export const getTopPipelineTokenUsage = (profile?: PipelinePerformanceProfile | null) =>
  profile?.tokenUsage[0] || null

export const formatPipelinePercent = (value?: number | null) => {
  if (!value || !Number.isFinite(value)) {
    return '0%'
  }
  return `${Math.round(value)}%`
}

export const accumulateTokenUsage = (base: TokenUsageReport, incoming: TokenUsageReport): TokenUsageReport => {
  const providerTotals: Record<string, number> = { ...(base.providerTotals || {}) }
  for (const [provider, total] of Object.entries(incoming.providerTotals || {})) {
    providerTotals[provider] = (providerTotals[provider] || 0) + total
  }

  return {
    investigationId: base.investigationId,
    label: base.label,
    callCount: base.callCount + incoming.callCount,
    reportedCallCount: base.reportedCallCount + incoming.reportedCallCount,
    estimatedCallCount: base.estimatedCallCount + incoming.estimatedCallCount,
    promptTokens: base.promptTokens + incoming.promptTokens,
    completionTokens: base.completionTokens + incoming.completionTokens,
    totalTokens: base.totalTokens + incoming.totalTokens,
    providerTotals,
  }
}
