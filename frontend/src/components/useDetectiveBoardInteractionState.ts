import { useCallback, useEffect, useState, type RefObject } from 'react'

export const RELATIONSHIP_LEGEND_VISIBILITY_KEY = 'detective_board_relationship_legend_visible'
export const DETECTIVE_BOARD_SHOW_GRID_KEY = 'detective_board_show_grid'
export const DETECTIVE_BOARD_SNAP_CONNECTION_LABELS_KEY = 'detective_board_snap_connection_labels'
export const DETECTIVE_BOARD_SNAP_NODES_KEY = 'detective_board_snap_nodes'
export const EXPORT_MENU_WIDTH = 224
export const BOARD_CONTROLS_PANEL_MAX_WIDTH = 416
export const BOARD_CONTROLS_PANEL_MARGIN = 16

interface DetectiveBoardInteractionRefs {
  boardContainerRef: RefObject<HTMLElement | null>
  exportButtonRef: RefObject<HTMLElement | null>
  exportMenuPanelRef: RefObject<HTMLElement | null>
  boardToolbarRef: RefObject<HTMLElement | null>
  boardActionBarRef: RefObject<HTMLElement | null>
  boardControlsButtonRef: RefObject<HTMLElement | null>
  boardControlsPanelRef: RefObject<HTMLElement | null>
}

interface UseDetectiveBoardInteractionStateOptions extends DetectiveBoardInteractionRefs {
  canExport: boolean
  onRelationshipLegendClosed?: () => void
}

export interface ExportMenuPosition {
  top: number
  left: number
  width: number
}

export interface BoardControlsPosition {
  top: number
  width: number
  maxHeight: number
}

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') {
    return fallback
  }

  try {
    const storedValue = window.localStorage.getItem(key)
    return storedValue === null ? fallback : storedValue === 'true'
  } catch {
    return fallback
  }
}

const writeStoredBoolean = (key: string, value: boolean) => {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // Storage can be unavailable in embedded or privacy-restricted contexts.
  }
}

export const useDetectiveBoardInteractionState = ({
  canExport,
  boardContainerRef,
  exportButtonRef,
  exportMenuPanelRef,
  boardToolbarRef,
  boardActionBarRef,
  boardControlsButtonRef,
  boardControlsPanelRef,
  onRelationshipLegendClosed,
}: UseDetectiveBoardInteractionStateOptions) => {
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [exportMenuPosition, setExportMenuPosition] = useState<ExportMenuPosition>({
    top: 0,
    left: 0,
    width: EXPORT_MENU_WIDTH,
  })
  const [showBoardControls, setShowBoardControls] = useState(false)
  const [boardControlsPosition, setBoardControlsPosition] = useState<BoardControlsPosition>({
    top: 0,
    width: BOARD_CONTROLS_PANEL_MAX_WIDTH,
    maxHeight: 520,
  })
  const [showRelationshipLegend, setShowRelationshipLegend] = useState(() => (
    readStoredBoolean(RELATIONSHIP_LEGEND_VISIBILITY_KEY, true)
  ))
  const [showGrid, setShowGrid] = useState(() => (
    readStoredBoolean(DETECTIVE_BOARD_SHOW_GRID_KEY, true)
  ))
  const [snapNodes, setSnapNodes] = useState(() => (
    readStoredBoolean(DETECTIVE_BOARD_SNAP_NODES_KEY, false)
  ))
  const [snapConnectionLabels, setSnapConnectionLabels] = useState(() => (
    readStoredBoolean(DETECTIVE_BOARD_SNAP_CONNECTION_LABELS_KEY, false)
  ))

  const closeExportMenu = useCallback(() => {
    setShowExportMenu(false)
  }, [])

  const closeBoardControls = useCallback(() => {
    setShowBoardControls(false)
  }, [])

  const closeBoardOverlays = useCallback(() => {
    setShowExportMenu(false)
    setShowBoardControls(false)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const targetNode = event.target as globalThis.Node
      const clickedExportButton = exportButtonRef.current?.contains(targetNode)
      const clickedExportPanel = exportMenuPanelRef.current?.contains(targetNode)
      if (!clickedExportButton && !clickedExportPanel) {
        setShowExportMenu(false)
      }

      const clickedBoardControlsButton = boardControlsButtonRef.current?.contains(targetNode)
      const clickedBoardControlsPanel = boardControlsPanelRef.current?.contains(targetNode)
      if (!clickedBoardControlsButton && !clickedBoardControlsPanel) {
        setShowBoardControls(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [boardControlsButtonRef, boardControlsPanelRef, exportButtonRef, exportMenuPanelRef])

  const updateExportMenuPosition = useCallback(() => {
    const container = boardContainerRef.current
    const button = exportButtonRef.current
    if (!container || !button) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const buttonRect = button.getBoundingClientRect()
    const availableWidth = Math.max(180, Math.min(EXPORT_MENU_WIDTH, containerRect.width - (BOARD_CONTROLS_PANEL_MARGIN * 2)))
    const unclampedLeft = buttonRect.left - containerRect.left
    const maxLeft = Math.max(BOARD_CONTROLS_PANEL_MARGIN, containerRect.width - availableWidth - BOARD_CONTROLS_PANEL_MARGIN)
    const nextLeft = Math.min(Math.max(unclampedLeft, BOARD_CONTROLS_PANEL_MARGIN), maxLeft)
    const nextTop = buttonRect.bottom - containerRect.top + 12

    setExportMenuPosition({
      top: nextTop,
      left: nextLeft,
      width: availableWidth,
    })
  }, [boardContainerRef, exportButtonRef])

  const updateBoardControlsPosition = useCallback(() => {
    const container = boardContainerRef.current
    const actionBar = boardActionBarRef.current
    const positioningRoot = boardToolbarRef.current
    if (!container || !actionBar || !positioningRoot) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const actionBarRect = actionBar.getBoundingClientRect()
    const positioningRootRect = positioningRoot.getBoundingClientRect()
    const availableWidth = Math.max(280, Math.min(BOARD_CONTROLS_PANEL_MAX_WIDTH, containerRect.width - (BOARD_CONTROLS_PANEL_MARGIN * 2)))
    const nextTop = actionBarRect.bottom - positioningRootRect.top + 12
    const availableHeight = Math.max(0, containerRect.bottom - actionBarRect.bottom - 12 - BOARD_CONTROLS_PANEL_MARGIN)

    setBoardControlsPosition({
      top: nextTop,
      width: availableWidth,
      maxHeight: availableHeight,
    })
  }, [boardActionBarRef, boardContainerRef, boardToolbarRef])

  useEffect(() => {
    if (!showExportMenu) {
      return
    }

    updateExportMenuPosition()

    const handleViewportChange = () => updateExportMenuPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [showExportMenu, updateExportMenuPosition])

  useEffect(() => {
    if (!showBoardControls) {
      return
    }

    updateBoardControlsPosition()

    const handleViewportChange = () => updateBoardControlsPosition()
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)

    return () => {
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [showBoardControls, updateBoardControlsPosition])

  const toggleExportMenu = useCallback(() => {
    if (!canExport) {
      return
    }

    setShowBoardControls(false)
    updateExportMenuPosition()
    setShowExportMenu((current) => !current)
  }, [canExport, updateExportMenuPosition])

  const toggleBoardControlsPanel = useCallback(() => {
    setShowExportMenu(false)
    updateBoardControlsPosition()
    setShowBoardControls((current) => !current)
  }, [updateBoardControlsPosition])

  const closeRelationshipLegend = useCallback(() => {
    setShowRelationshipLegend(false)
    onRelationshipLegendClosed?.()
  }, [onRelationshipLegendClosed])

  const openRelationshipLegend = useCallback(() => {
    setShowRelationshipLegend(true)
  }, [])

  const toggleRelationshipWorkspacePanel = useCallback(() => {
    onRelationshipLegendClosed?.()
    setShowRelationshipLegend((current) => !current)
  }, [onRelationshipLegendClosed])

  const toggleShowGrid = useCallback(() => {
    setShowGrid((current) => {
      const next = !current
      console.debug('[DetectiveBoard] Grid toggle clicked. Next state:', next)
      return next
    })
  }, [])

  const toggleSnapNodes = useCallback(() => {
    setSnapNodes((current) => !current)
  }, [])

  const toggleSnapConnectionLabels = useCallback(() => {
    setSnapConnectionLabels((current) => !current)
  }, [])

  useEffect(() => {
    writeStoredBoolean(RELATIONSHIP_LEGEND_VISIBILITY_KEY, showRelationshipLegend)
  }, [showRelationshipLegend])

  useEffect(() => {
    console.debug('[DetectiveBoard] Grid visibility changed:', showGrid)
    writeStoredBoolean(DETECTIVE_BOARD_SHOW_GRID_KEY, showGrid)
  }, [showGrid])

  useEffect(() => {
    writeStoredBoolean(DETECTIVE_BOARD_SNAP_CONNECTION_LABELS_KEY, snapConnectionLabels)
  }, [snapConnectionLabels])

  useEffect(() => {
    writeStoredBoolean(DETECTIVE_BOARD_SNAP_NODES_KEY, snapNodes)
  }, [snapNodes])

  return {
    showExportMenu,
    exportMenuPosition,
    showBoardControls,
    boardControlsPosition,
    showRelationshipLegend,
    showGrid,
    snapNodes,
    snapConnectionLabels,
    closeExportMenu,
    closeBoardControls,
    closeBoardOverlays,
    closeRelationshipLegend,
    openRelationshipLegend,
    toggleRelationshipWorkspacePanel,
    toggleExportMenu,
    toggleBoardControlsPanel,
    toggleShowGrid,
    toggleSnapNodes,
    toggleSnapConnectionLabels,
  }
}
