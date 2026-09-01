// Brain Lab mode: when disabled, the Brain subnav collapses to the operator
// surfaces (Pulse + Memory Map) and the deep diagnostic views (Focus, Next
// Moves, Active Signals, Memory Links, Clusters, Gateway Registry, Autonomy)
// hide behind the Lab toggle. Persisted per machine — the operator's choice
// sticks across reloads.

const STORAGE_KEY = 'gorantula.brainLab.v1'

export const loadBrainLabEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return true
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      // No stored preference yet: keep every view visible (today's behavior).
      // The default flips to the compact Pulse-only layout once the Radar and
      // Memory surfaces land (Phase 3 increment 3).
      return true
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'boolean') {
      return parsed
    }
    // Alien/corrupted payloads fall back to the documented default: lab on.
    return true
  } catch {
    return true
  }
}

export const saveBrainLabEnabled = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled))
  } catch {
    // Storage unavailable (private mode/quota): lab preference is best-effort.
  }
}
