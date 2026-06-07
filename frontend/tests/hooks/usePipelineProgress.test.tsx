import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePipelineProgress } from '../../src/hooks/usePipelineProgress'
import { getPipelineStepTransitionKey, type PipelineProgressPayload } from '../../src/utils/pipelineTelemetry'

const makeProgress = (
  runId: string,
  stepStatus: PipelineProgressPayload['status'],
  overrides: Partial<PipelineProgressPayload> = {},
): PipelineProgressPayload => ({
  runId,
  vaultId: 'inv-a',
  mode: 'web',
  stepId: 'rank',
  stepLabel: 'Rank facts',
  status: stepStatus,
  completedSteps: stepStatus === 'pending' ? 0 : 1,
  totalSteps: 2,
  elapsedMs: 100,
  steps: [
    {
      id: 'rank',
      label: 'Rank facts',
      status: stepStatus,
    },
  ],
  ...overrides,
})

const Harness = ({
  now,
  transitionMs = 50,
  shouldFetchProfiles = () => true,
}: {
  now: () => number
  transitionMs?: number
  shouldFetchProfiles?: () => boolean
}) => {
  const pipeline = usePipelineProgress({
    profilesEndpoint: '/api/pipeline-runs',
    stepTransitionMs: transitionMs,
    shouldFetchProfiles,
    now,
  })

  return (
    <div>
      <span data-testid="active-run">{pipeline.activePipelineRun?.runId || 'none'}</span>
      <span data-testid="runs">{pipeline.pipelineRuns.map((run) => `${run.runId}:${run.updatedAt}`).join('|')}</span>
      <span data-testid="transitions">{Object.keys(pipeline.pipelineStepTransitions).sort().join('|')}</span>
      <span data-testid="drawer">{pipeline.isPipelineDrawerOpen ? 'open' : 'closed'}</span>
      <span data-testid="profile">{pipeline.activePipelineProfile?.runId || 'none'}</span>
      <button type="button" onClick={() => pipeline.applyPipelineProgress(makeProgress('run-a', 'pending'))}>
        apply-a-pending
      </button>
      <button type="button" onClick={() => pipeline.applyPipelineProgress(makeProgress('run-a', 'running'))}>
        apply-a-running
      </button>
      <button type="button" onClick={() => pipeline.applyPipelineProgress(makeProgress('run-b', 'running'))}>
        apply-b-running
      </button>
      <button type="button" onClick={() => pipeline.setIsPipelineDrawerOpen(true)}>
        open-drawer
      </button>
      <button type="button" onClick={pipeline.closePipelineDrawer}>
        close-drawer
      </button>
      <button type="button" onClick={() => void pipeline.refreshPipelineProfiles()}>
        refresh-profiles
      </button>
    </div>
  )
}

describe('usePipelineProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stores progress by run id and sorts the newest run first', () => {
    let currentNow = 1000
    render(<Harness now={() => currentNow} shouldFetchProfiles={() => false} />)

    fireEvent.click(screen.getByRole('button', { name: 'apply-a-pending' }))
    expect(screen.getByTestId('active-run')).toHaveTextContent('run-a')
    expect(screen.getByTestId('runs')).toHaveTextContent('run-a:1000')

    currentNow = 1500
    fireEvent.click(screen.getByRole('button', { name: 'apply-b-running' }))

    expect(screen.getByTestId('active-run')).toHaveTextContent('run-b')
    expect(screen.getByTestId('runs')).toHaveTextContent('run-b:1500|run-a:1000')
  })

  it('records changed step statuses and clears them after the transition window or drawer close', async () => {
    render(<Harness now={() => 1000} transitionMs={50} shouldFetchProfiles={() => false} />)
    const transitionKey = getPipelineStepTransitionKey('run-a', 'rank', 'running')

    fireEvent.click(screen.getByRole('button', { name: 'apply-a-pending' }))
    expect(screen.getByTestId('transitions')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'apply-a-running' }))
    expect(screen.getByTestId('transitions')).toHaveTextContent(transitionKey)

    await act(async () => {
      vi.advanceTimersByTime(50)
    })
    expect(screen.getByTestId('transitions')).toHaveTextContent('')

    fireEvent.click(screen.getByRole('button', { name: 'apply-a-pending' }))
    fireEvent.click(screen.getByRole('button', { name: 'apply-a-running' }))
    fireEvent.click(screen.getByRole('button', { name: 'open-drawer' }))
    expect(screen.getByTestId('drawer')).toHaveTextContent('open')

    fireEvent.click(screen.getByRole('button', { name: 'close-drawer' }))
    expect(screen.getByTestId('drawer')).toHaveTextContent('closed')
    expect(screen.getByTestId('transitions')).toHaveTextContent('')
  })

  it('refreshes profile history and resolves the active profile from the selected run', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          runId: 'run-a',
          vaultId: 'inv-a',
          mode: 'web',
          status: 'complete',
          totalElapsedMs: 1200,
        },
      ],
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<Harness now={() => 1000} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'refresh-profiles' }))
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/pipeline-runs?limit=20', { cache: 'no-store' })
    expect(screen.getByTestId('profile')).toHaveTextContent('run-a')

    fireEvent.click(screen.getByRole('button', { name: 'apply-a-running' }))
    expect(screen.getByTestId('active-run')).toHaveTextContent('run-a')
    expect(screen.getByTestId('profile')).toHaveTextContent('run-a')
  })
})
