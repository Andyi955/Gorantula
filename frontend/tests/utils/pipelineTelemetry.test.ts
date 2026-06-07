import { describe, expect, it } from 'vitest'
import {
  accumulateTokenUsage,
  buildEmptyTokenUsageReport,
  clampProgressPercent,
  coercePipelineProgressPayload,
  coercePipelineProfiles,
  coerceTokenUsageReport,
  formatDuration,
  formatPipelinePercent,
  formatTokenProviderBreakdown,
  getPipelineStepTransitionKey,
  getTopPipelineDurationBottleneck,
  getTopPipelineTokenBottleneck,
  getTopPipelineTokenUsage,
} from '../../src/utils/pipelineTelemetry'

describe('pipelineTelemetry', () => {
  it('coerces and accumulates token usage reports', () => {
    const report = coerceTokenUsageReport({
      investigationId: 'inv-123',
      label: 'Board Total',
      callCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      providerTotals: {
        openai: 100,
        gemini: -10,
      },
    })

    expect(report).toEqual({
      investigationId: 'inv-123',
      label: 'Board Total',
      callCount: 2,
      reportedCallCount: 1,
      estimatedCallCount: 1,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      providerTotals: {
        openai: 100,
        gemini: 0,
      },
    })
    expect(coerceTokenUsageReport({ label: '' })).toBeNull()

    const session = accumulateTokenUsage(buildEmptyTokenUsageReport('Session Total'), report!)
    expect(session.totalTokens).toBe(150)
    expect(session.providerTotals).toEqual({ openai: 100, gemini: 0 })
    expect(formatTokenProviderBreakdown({ openai: 1000, gemini: 500 })).toBe('gemini: 500 | openai: 1,000')
  })

  it('coerces pipeline progress payloads and progress helpers', () => {
    const progress = coercePipelineProgressPayload({
      runId: ' run-1 ',
      mode: 'web',
      stepId: 'rank',
      stepLabel: 'Rank facts',
      status: 'complete',
      completedSteps: 3,
      totalSteps: 0,
      elapsedMs: 1250,
      estimatedRemainingMs: -1,
      steps: [
        { id: 'rank', label: 'Rank facts', status: 'complete', durationMs: 500 },
        { id: '', label: 'Ignored', status: 'unknown' },
      ],
    })

    expect(progress?.runId).toBe('run-1')
    expect(progress?.status).toBe('complete')
    expect(progress?.totalSteps).toBe(1)
    expect(progress?.estimatedRemainingMs).toBe(0)
    expect(progress?.steps).toHaveLength(1)
    expect(progress?.steps?.[0].status).toBe('complete')
    expect(clampProgressPercent(3, 4)).toBe(75)
    expect(clampProgressPercent(3, 0)).toBe(0)
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatDuration(900)).toBe('1s')
    expect(formatPipelinePercent(42.4)).toBe('42%')
    expect(getPipelineStepTransitionKey('run-1', 'rank', 'complete')).toBe('run-1:rank:complete')
  })

  it('coerces pipeline profiles and exposes bottleneck helpers', () => {
    const profiles = coercePipelineProfiles([
      {
        runId: 'run-profile',
        vaultId: 'inv-123',
        mode: 'web',
        status: 'complete',
        totalElapsedMs: 6000,
        counters: {
          facts: 4,
          broken: -1,
        },
        bottlenecks: [
          { kind: 'token', id: 'tokens', label: 'Token hot spot', totalTokens: 1200, percentOfTotal: 55 },
          { kind: 'span', id: 'rank', label: 'Fact ranking', durationMs: 2400, percentOfTotal: 40 },
        ],
        tokenUsage: [
          { operation: 'final_report', provider: 'openai', callCount: 1, totalTokens: 900 },
          { operation: 'rank_facts', provider: 'gemini', callCount: 1, totalTokens: 1200 },
        ],
      },
      { runId: '' },
    ])

    expect(profiles).toHaveLength(1)
    expect(profiles[0].counters).toEqual({ facts: 4, broken: 0 })
    expect(getTopPipelineDurationBottleneck(profiles[0])?.id).toBe('rank')
    expect(getTopPipelineTokenBottleneck(profiles[0])?.id).toBe('tokens')
    expect(getTopPipelineTokenUsage(profiles[0])?.operation).toBe('rank_facts')
  })
})
