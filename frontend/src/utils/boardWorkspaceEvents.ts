export const BOARD_TOGGLE_DISCOVERY_PANEL_EVENT = 'gorantula:board-toggle-discovery-panel'
export const BOARD_TOGGLE_SYNTHESIS_PANEL_EVENT = 'gorantula:board-toggle-synthesis-panel'
export const BOARD_WORKSPACE_STATE_UPDATED_EVENT = 'gorantula:board-workspace-state-updated'

export const emitBoardWorkspaceEvent = (eventName: string) => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(eventName))
}
