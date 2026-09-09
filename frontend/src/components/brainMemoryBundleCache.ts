import type {
  BrainAttentionSummary,
  BrainAutonomyState,
  BrainFollowUpAction,
  BrainMapView,
  BrainSignal,
  BrainSuggestion,
  MemoryCluster,
  MemoryLink,
} from '../utils/brainMemory'

export type BrainMemoryBundle = {
  signals: BrainSignal[]
  links: MemoryLink[]
  brainMap: BrainMapView | null
  clusters: MemoryCluster[]
  suggestions: BrainSuggestion[]
  followUps: BrainFollowUpAction[]
  autonomy: BrainAutonomyState | null
  attention: BrainAttentionSummary | null
}

const BRAIN_BUNDLE_CACHE_LIMIT = 12

// Stale-while-revalidate cache of the last loaded brain bundle per
// investigation. Module-level on purpose: it survives tab switches so revisiting
// an investigation renders instantly instead of replaying the fetch chain, and
// every load still refreshes from the backend and overwrites the entry.
//
// It lives in its own module rather than inside the panel because a component
// file that also exports a function disables React fast refresh.
const brainBundleCache = new Map<string, BrainMemoryBundle>()

export const readBrainBundleCache = (investigationId: string) =>
  brainBundleCache.get(investigationId)

export const writeBrainBundleCache = (investigationId: string, bundle: BrainMemoryBundle) => {
  if (brainBundleCache.size >= BRAIN_BUNDLE_CACHE_LIMIT) {
    const oldest = brainBundleCache.keys().next().value
    if (oldest !== undefined) {
      brainBundleCache.delete(oldest)
    }
  }
  brainBundleCache.set(investigationId, bundle)
}

// Test hook: the cache intentionally survives panel unmounts and switches, so
// tests reset it in beforeEach to stay hermetic.
export const resetBrainBundleCacheForTests = () => {
  brainBundleCache.clear()
}
