// Brain seen-state: tracks which brain signals the operator has already
// reviewed so the Brain tab badge can report "new or strengthened overlaps
// since you last looked" instead of counting raw re-activation events.
// Persisted in localStorage: the count survives page refreshes, and repeated
// board saves never inflate it (counts are recomputed against the snapshot,
// not accumulated).

const STORAGE_KEY = 'gorantula.brainSeen.v1'

// A signal counts as "strengthened" when its score climbed at least this much
// since it was last seen. Pure re-fires (same score) stay quiet.
export const BRAIN_STRENGTHEN_DELTA = 0.05

type BrainSeenStore = Record<string, Record<string, number>>

const readStore = (): BrainSeenStore => {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed as BrainSeenStore
  } catch {
    return {}
  }
}

const writeStore = (store: BrainSeenStore) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage unavailable (private mode/quota): seen-state is best-effort.
  }
}

const normalizeInvestigationId = (investigationId: string) => investigationId.trim()

// Snapshot of known signal scores for one investigation (id -> score).
export const loadSeenBrainSignalScores = (investigationId: string): Record<string, number> => {
  const id = normalizeInvestigationId(investigationId)
  if (!id) {
    return {}
  }
  return { ...(readStore()[id] ?? {}) }
}

export const markBrainSignalsSeen = (
  investigationId: string,
  signals: Array<{ id?: string; score?: number }>,
) => {
  const id = normalizeInvestigationId(investigationId)
  if (!id) {
    return
  }
  const store = readStore()
  const scores: Record<string, number> = {}
  for (const signal of signals) {
    if (signal && typeof signal.id === 'string' && signal.id && typeof signal.score === 'number') {
      scores[signal.id] = signal.score
    }
  }
  store[id] = scores
  writeStore(store)
}

export const countUnseenBrainSignals = (
  investigationId: string,
  signals: Array<{ id?: string; score?: number }>,
): number => {
  const id = normalizeInvestigationId(investigationId)
  if (!id) {
    return 0
  }
  const seen = readStore()[id] ?? {}
  return signals.reduce((count, signal) => {
    if (!signal || typeof signal.id !== 'string' || !signal.id) {
      return count
    }
    const knownScore = seen[signal.id]
    if (knownScore === undefined) {
      return count + 1
    }
    if (typeof signal.score === 'number' && signal.score - knownScore >= BRAIN_STRENGTHEN_DELTA) {
      return count + 1
    }
    return count
  }, 0)
}
