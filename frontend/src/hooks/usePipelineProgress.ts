import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import {
  coercePipelineProfiles,
  getPipelineStepTransitionKey,
  type PipelinePerformanceProfile,
  type PipelineProgressPayload,
  type PipelineProgressStepState,
  type PipelineRunState,
} from '../utils/pipelineTelemetry'

type PipelineStepTransitions = Record<string, PipelineProgressStepState['status']>

interface UsePipelineProgressOptions {
  profilesEndpoint: string
  profileLimit?: number
  stepTransitionMs: number
  shouldFetchProfiles?: () => boolean
  now?: () => number
  debug?: (message: string, error: unknown) => void
}

interface UsePipelineProgressResult {
  pipelineRunsById: Record<string, PipelineRunState>
  pipelineRuns: PipelineRunState[]
  pipelineProfiles: PipelinePerformanceProfile[]
  pipelineProfilesByRunId: Record<string, PipelinePerformanceProfile>
  activePipelineRunId: string | null
  activePipelineRun: PipelineRunState | null
  activePipelineProfile: PipelinePerformanceProfile | null
  comparisonPipelineProfile: PipelinePerformanceProfile | null
  isPipelineDrawerOpen: boolean
  dismissedPipelineChipRuns: Record<string, boolean>
  pipelineStepTransitions: PipelineStepTransitions
  setPipelineProfiles: Dispatch<SetStateAction<PipelinePerformanceProfile[]>>
  setActivePipelineRunId: Dispatch<SetStateAction<string | null>>
  setIsPipelineDrawerOpen: Dispatch<SetStateAction<boolean>>
  setDismissedPipelineChipRuns: Dispatch<SetStateAction<Record<string, boolean>>>
  refreshPipelineProfiles: () => Promise<void>
  clearPipelineStepTransitions: () => void
  applyPipelineProgress: (progress: PipelineProgressPayload) => void
  closePipelineDrawer: () => void
}

const defaultNow = () => Date.now()

const defaultShouldFetchProfiles = () => {
  if (import.meta.env.MODE !== 'test') {
    return true
  }
  return Boolean((fetch as unknown as { mock?: unknown }).mock)
}

const defaultDebug = (message: string, error: unknown) => {
  if (import.meta.env.DEV) {
    console.debug(message, error)
  }
}

const buildProfileHistoryUrl = (profilesEndpoint: string, limit: number) => {
  const separator = profilesEndpoint.includes('?') ? '&' : '?'
  return `${profilesEndpoint}${separator}limit=${encodeURIComponent(String(limit))}`
}

export const usePipelineProgress = ({
  profilesEndpoint,
  profileLimit = 20,
  stepTransitionMs,
  shouldFetchProfiles = defaultShouldFetchProfiles,
  now = defaultNow,
  debug = defaultDebug,
}: UsePipelineProgressOptions): UsePipelineProgressResult => {
  const [pipelineRunsById, setPipelineRunsById] = useState<Record<string, PipelineRunState>>({})
  const [pipelineProfiles, setPipelineProfiles] = useState<PipelinePerformanceProfile[]>([])
  const [activePipelineRunId, setActivePipelineRunId] = useState<string | null>(null)
  const [isPipelineDrawerOpen, setIsPipelineDrawerOpen] = useState(false)
  const [dismissedPipelineChipRuns, setDismissedPipelineChipRuns] = useState<Record<string, boolean>>({})
  const [pipelineStepTransitions, setPipelineStepTransitions] = useState<PipelineStepTransitions>({})
  const pipelineRunsByIdRef = useRef<Record<string, PipelineRunState>>({})
  const pipelineStepTransitionTimeoutsRef = useRef<Record<string, number>>({})

  useEffect(() => {
    pipelineRunsByIdRef.current = pipelineRunsById
  }, [pipelineRunsById])

  const refreshPipelineProfiles = useCallback(async () => {
    if (!shouldFetchProfiles()) {
      return
    }
    try {
      const response = await fetch(buildProfileHistoryUrl(profilesEndpoint, profileLimit), { cache: 'no-store' })
      if (!response.ok) {
        return
      }
      const data = await response.json()
      setPipelineProfiles(coercePipelineProfiles(data))
    } catch (error) {
      debug('[App] Pipeline profile history unavailable', error)
    }
  }, [debug, profileLimit, profilesEndpoint, shouldFetchProfiles])

  const clearPipelineStepTransitions = useCallback(() => {
    Object.values(pipelineStepTransitionTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    pipelineStepTransitionTimeoutsRef.current = {}
    setPipelineStepTransitions({})
  }, [])

  const recordPipelineStepTransitions = useCallback((progress: PipelineProgressPayload) => {
    const previousRun = pipelineRunsByIdRef.current[progress.runId]
    const previousSteps = new Map((previousRun?.steps || []).map((step) => [step.id, step.status]))
    const transitions: PipelineStepTransitions = {}

    ;(progress.steps || []).forEach((step) => {
      const previousStatus = previousSteps.get(step.id)
      const isNewActiveStep = !previousStatus && step.status !== 'pending'
      const changedStatus = Boolean(previousStatus && previousStatus !== step.status)
      if (!isNewActiveStep && !changedStatus) {
        return
      }
      transitions[getPipelineStepTransitionKey(progress.runId, step.id, step.status)] = step.status
    })

    const transitionKeys = Object.keys(transitions)
    if (transitionKeys.length === 0) {
      return
    }

    setPipelineStepTransitions((current) => ({
      ...current,
      ...transitions,
    }))

    transitionKeys.forEach((key) => {
      const existingTimeout = pipelineStepTransitionTimeoutsRef.current[key]
      if (existingTimeout) {
        window.clearTimeout(existingTimeout)
      }
      pipelineStepTransitionTimeoutsRef.current[key] = window.setTimeout(() => {
        delete pipelineStepTransitionTimeoutsRef.current[key]
        setPipelineStepTransitions((current) => {
          if (!current[key]) {
            return current
          }
          const next = { ...current }
          delete next[key]
          return next
        })
      }, stepTransitionMs)
    })
  }, [stepTransitionMs])

  const applyPipelineProgress = useCallback((progress: PipelineProgressPayload) => {
    recordPipelineStepTransitions(progress)
    setPipelineRunsById((current) => {
      const next = {
        ...current,
        [progress.runId]: {
          ...(current[progress.runId] || {}),
          ...progress,
          updatedAt: now(),
        },
      }
      pipelineRunsByIdRef.current = next
      return next
    })
    setActivePipelineRunId(progress.runId)
  }, [now, recordPipelineStepTransitions])

  const closePipelineDrawer = useCallback(() => {
    setIsPipelineDrawerOpen(false)
    clearPipelineStepTransitions()
  }, [clearPipelineStepTransitions])

  useEffect(() => () => {
    Object.values(pipelineStepTransitionTimeoutsRef.current).forEach((timeoutId) => {
      window.clearTimeout(timeoutId)
    })
    pipelineStepTransitionTimeoutsRef.current = {}
  }, [])

  const pipelineRuns = useMemo(
    () => Object.values(pipelineRunsById).sort((left, right) => right.updatedAt - left.updatedAt),
    [pipelineRunsById],
  )

  const activePipelineRun = activePipelineRunId ? pipelineRunsById[activePipelineRunId] || null : pipelineRuns[0] || null

  const pipelineProfilesByRunId = useMemo(() => {
    return pipelineProfiles.reduce<Record<string, PipelinePerformanceProfile>>((profiles, profile) => {
      profiles[profile.runId] = profile
      return profiles
    }, {})
  }, [pipelineProfiles])

  const activePipelineProfile = activePipelineRun
    ? pipelineProfilesByRunId[activePipelineRun.runId] || null
    : pipelineProfiles[0] || null

  const comparisonPipelineProfile = activePipelineProfile
    ? pipelineProfiles.find((profile) => (
      profile.runId !== activePipelineProfile.runId &&
      profile.vaultId === activePipelineProfile.vaultId &&
      profile.mode === activePipelineProfile.mode
    )) || null
    : null

  return {
    pipelineRunsById,
    pipelineRuns,
    pipelineProfiles,
    pipelineProfilesByRunId,
    activePipelineRunId,
    activePipelineRun,
    activePipelineProfile,
    comparisonPipelineProfile,
    isPipelineDrawerOpen,
    dismissedPipelineChipRuns,
    pipelineStepTransitions,
    setPipelineProfiles,
    setActivePipelineRunId,
    setIsPipelineDrawerOpen,
    setDismissedPipelineChipRuns,
    refreshPipelineProfiles,
    clearPipelineStepTransitions,
    applyPipelineProgress,
    closePipelineDrawer,
  }
}
