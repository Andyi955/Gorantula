export const BOARD_TOGGLE_DISCOVERY_PANEL_EVENT = 'gorantula:board-toggle-discovery-panel'
export const BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT = 'gorantula:board-toggle-synthesis-panel'
export const BOARD_RESTORE_COMPLETE_EVENT = 'gorantula:board-restore-complete'
export const BOARD_WORKSPACE_STATE_UPDATED_EVENT = 'gorantula:board-workspace-state-updated'

export interface BoardWorkspaceStateUpdatedDetail {
  investigationId?: string
  persisted?: boolean
  source?: 'memory-cache' | 'backend' | 'browser-local' | 'browser-shadow'
  nodeCount?: number
  edgeCount?: number
  contentSignature?: string
}

export interface BoardRestoreCompleteDetail {
  investigationId: string
  source: string
  durationMs: number
  nodeCount: number
  edgeCount: number
}

export const emitBoardWorkspaceEvent = (
  eventName: string,
  detail?: BoardWorkspaceStateUpdatedDetail,
) => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(eventName, detail ? { detail } : undefined))
}
