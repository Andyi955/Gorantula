// Brain Lab mode: when disabled, the Brain subnav collapses to the operator
// surfaces (Pulse + Memory) and the deep diagnostic views (Focus, Next Moves,
// Active Signals, Memory Links, Clusters, Gateway Registry, Autonomy, Memory
// Map) hide behind the Lab toggle. Persisted per machine — the operator's
// choice sticks across reloads. Compact is the default since Phase 3
// increment 3: operator surfaces first, the Lab is for nerds.

const STORAGE_KEY = 'gorantula.brainLab.v1'

export const loadBrainLabEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      // No stored preference yet: compact operator surfaces only.
      return false
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'boolean') {
      return parsed
    }
    // Alien/corrupted payloads fall back to the documented default: compact.
    return false
  } catch {
    return false
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
