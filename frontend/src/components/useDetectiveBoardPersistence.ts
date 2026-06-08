import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { Edge, Node } from 'reactflow'
import type { BoardMode } from './boardGeometry'
import type { PersistedBoardState } from '../utils/hierarchicalCanvas'
import { BOARD_RESTORE_COMPLETE_EVENT, type BoardRestoreCompleteDetail } from '../utils/boardWorkspaceEvents'
import {
    getCachedBoardStateForInvestigation,
    saveBoardStateForInvestigation,
} from '../utils/investigationPersistence'

export interface BoardRestoreOverlayState {
    investigationId: string;
    startedAt: number;
    source: string;
}

interface UseDetectiveBoardPersistenceOptions {
    investigationId?: string | null;
    boardMode: BoardMode;
    nodes: Node[];
    edges: Edge[];
    pendingIntegrationNodeIds: string[];
    isInitialRestoreViewportSettling: boolean;
    setIsInitialRestoreViewportSettling: Dispatch<SetStateAction<boolean>>;
    pendingInitialRestoreViewportFitRef: MutableRefObject<string | null>;
    shouldSkipAutosave?: () => boolean;
    serializeNodes?: (nodes: Node[]) => Node[];
    serializeEdges?: (edges: Edge[]) => Edge[];
    getCachedBoardState?: (investigationId: string) => PersistedBoardState | null;
    saveBoardState?: (investigationId: string, state: PersistedBoardState) => unknown | Promise<unknown>;
    now?: () => number;
    autosaveDelayMs?: number;
    overlayMinMs?: number;
    overlayMaxMs?: number;
    initialRestoreViewportFitDelayMs?: number;
}

const defaultNow = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()

const identityNodes = (nodes: Node[]) => nodes
const identityEdges = (edges: Edge[]) => edges

export const useDetectiveBoardPersistence = ({
    investigationId,
    boardMode,
    nodes,
    edges,
    pendingIntegrationNodeIds,
    isInitialRestoreViewportSettling,
    setIsInitialRestoreViewportSettling,
    pendingInitialRestoreViewportFitRef,
    shouldSkipAutosave = () => false,
    serializeNodes = identityNodes,
    serializeEdges = identityEdges,
    getCachedBoardState = getCachedBoardStateForInvestigation,
    saveBoardState = saveBoardStateForInvestigation,
    now = defaultNow,
    autosaveDelayMs = 250,
    overlayMinMs = 380,
    overlayMaxMs = 1600,
    initialRestoreViewportFitDelayMs = 80,
}: UseDetectiveBoardPersistenceOptions) => {
    const [loadedInvestigationId, setLoadedInvestigationId] = useState<string | null>(null)
    const loadedInvestigationIdRef = useRef<string | null>(null)
    const [boardRestoreOverlay, setBoardRestoreOverlay] = useState<BoardRestoreOverlayState | null>(null)
    const persistTimerRef = useRef<number | null>(null)
    const boardRestoreOverlayTimeoutRef = useRef<number | null>(null)
    const boardRestoreWatchdogTimeoutRef = useRef<number | null>(null)
    const nodesRef = useRef(nodes)
    const edgesRef = useRef(edges)
    const pendingIntegrationNodeIdsRef = useRef(pendingIntegrationNodeIds)

    nodesRef.current = nodes
    edgesRef.current = edges
    pendingIntegrationNodeIdsRef.current = pendingIntegrationNodeIds

    const clearPendingBoardPersist = useCallback(() => {
        if (persistTimerRef.current) {
            window.clearTimeout(persistTimerRef.current)
            persistTimerRef.current = null
        }
    }, [])

    const buildPersistedState = useCallback((
        nodesToPersist: Node[],
        edgesToPersist: Edge[],
        pendingIds: string[],
    ): PersistedBoardState => {
        const existingState = investigationId ? getCachedBoardState(investigationId) : null
        return {
            mode: boardMode,
            nodes: serializeNodes(nodesToPersist),
            edges: serializeEdges(edgesToPersist),
            pendingIntegrationNodeIds: pendingIds,
            synthesisAlerts: existingState?.synthesisAlerts || [],
        }
    }, [boardMode, getCachedBoardState, investigationId, serializeEdges, serializeNodes])

    const persistBoardNow = useCallback(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) {
            return
        }

        clearPendingBoardPersist()
        void saveBoardState(
            investigationId,
            buildPersistedState(nodesRef.current, edgesRef.current, pendingIntegrationNodeIdsRef.current),
        )
    }, [buildPersistedState, clearPendingBoardPersist, investigationId, loadedInvestigationId, saveBoardState])

    const markInvestigationLoaded = useCallback((nextInvestigationId: string) => {
        loadedInvestigationIdRef.current = nextInvestigationId
        setLoadedInvestigationId(nextInvestigationId)
    }, [])

    const startBoardRestoreLoad = useCallback((nextInvestigationId: string) => {
        const startedAt = now()

        if (boardRestoreOverlayTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreOverlayTimeoutRef.current)
            boardRestoreOverlayTimeoutRef.current = null
        }

        setBoardRestoreOverlay({
            investigationId: nextInvestigationId,
            startedAt,
            source: 'loading',
        })
        console.debug('[BoardLoad] started', { investigationId: nextInvestigationId })

        return startedAt
    }, [now])

    const finishBoardRestoreLoad = useCallback((
        nextInvestigationId: string,
        startedAt: number,
        source: string,
        nodeCount: number,
        edgeCount: number,
    ) => {
        const durationMs = Math.max(0, Math.round(now() - startedAt))
        console.info('[BoardLoad] restored', {
            investigationId: nextInvestigationId,
            source,
            durationMs,
            nodeCount,
            edgeCount,
        })
        window.dispatchEvent(new CustomEvent<BoardRestoreCompleteDetail>(BOARD_RESTORE_COMPLETE_EVENT, {
            detail: {
                investigationId: nextInvestigationId,
                source,
                durationMs,
                nodeCount,
                edgeCount,
            },
        }))

        const hideDelayMs = Math.min(
            overlayMaxMs,
            Math.max(overlayMinMs - durationMs, initialRestoreViewportFitDelayMs),
        )

        setBoardRestoreOverlay({
            investigationId: nextInvestigationId,
            startedAt,
            source,
        })

        if (boardRestoreOverlayTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreOverlayTimeoutRef.current)
        }

        boardRestoreOverlayTimeoutRef.current = window.setTimeout(() => {
            boardRestoreOverlayTimeoutRef.current = null
            setBoardRestoreOverlay((current) => (
                current?.investigationId === nextInvestigationId && current.startedAt === startedAt
                    ? null
                    : current
            ))
        }, hideDelayMs)
    }, [initialRestoreViewportFitDelayMs, now, overlayMaxMs, overlayMinMs])

    useEffect(() => {
        if (!investigationId || loadedInvestigationId !== investigationId) {
            return
        }
        if (nodes.length === 0 && edges.length === 0) {
            return
        }
        if (shouldSkipAutosave()) {
            clearPendingBoardPersist()
            return
        }

        clearPendingBoardPersist()
        persistTimerRef.current = window.setTimeout(() => {
            void saveBoardState(
                investigationId,
                buildPersistedState(nodes, edges, pendingIntegrationNodeIds),
            )
            persistTimerRef.current = null
        }, autosaveDelayMs)

        return clearPendingBoardPersist
    }, [
        autosaveDelayMs,
        buildPersistedState,
        clearPendingBoardPersist,
        edges,
        investigationId,
        loadedInvestigationId,
        nodes,
        pendingIntegrationNodeIds,
        saveBoardState,
        shouldSkipAutosave,
    ])

    useEffect(() => {
        if (!boardRestoreOverlay) {
            if (boardRestoreWatchdogTimeoutRef.current !== null) {
                window.clearTimeout(boardRestoreWatchdogTimeoutRef.current)
                boardRestoreWatchdogTimeoutRef.current = null
            }
            return
        }

        const isLoadedInvestigation = loadedInvestigationId === boardRestoreOverlay.investigationId
        if (!isLoadedInvestigation) {
            return
        }

        if (boardRestoreWatchdogTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreWatchdogTimeoutRef.current)
            boardRestoreWatchdogTimeoutRef.current = null
        }

        const elapsedMs = Math.max(0, now() - boardRestoreOverlay.startedAt)
        const clearDelayMs = isInitialRestoreViewportSettling
            ? Math.max(0, overlayMaxMs - elapsedMs)
            : Math.max(0, Math.min(overlayMinMs - elapsedMs, 120))

        boardRestoreWatchdogTimeoutRef.current = window.setTimeout(() => {
            boardRestoreWatchdogTimeoutRef.current = null
            if (pendingInitialRestoreViewportFitRef.current === boardRestoreOverlay.investigationId) {
                pendingInitialRestoreViewportFitRef.current = null
            }
            setIsInitialRestoreViewportSettling(false)
            setBoardRestoreOverlay((current) => (
                current?.investigationId === boardRestoreOverlay.investigationId &&
                    current.startedAt === boardRestoreOverlay.startedAt
                    ? null
                    : current
            ))
        }, clearDelayMs)

        return () => {
            if (boardRestoreWatchdogTimeoutRef.current !== null) {
                window.clearTimeout(boardRestoreWatchdogTimeoutRef.current)
                boardRestoreWatchdogTimeoutRef.current = null
            }
        }
    }, [
        boardRestoreOverlay,
        isInitialRestoreViewportSettling,
        loadedInvestigationId,
        now,
        overlayMaxMs,
        overlayMinMs,
        pendingInitialRestoreViewportFitRef,
        setIsInitialRestoreViewportSettling,
    ])

    useEffect(() => () => {
        clearPendingBoardPersist()
        if (boardRestoreOverlayTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreOverlayTimeoutRef.current)
            boardRestoreOverlayTimeoutRef.current = null
        }
        if (boardRestoreWatchdogTimeoutRef.current !== null) {
            window.clearTimeout(boardRestoreWatchdogTimeoutRef.current)
            boardRestoreWatchdogTimeoutRef.current = null
        }
    }, [clearPendingBoardPersist])

    return {
        loadedInvestigationId,
        loadedInvestigationIdRef,
        boardRestoreOverlay,
        markInvestigationLoaded,
        setLoadedInvestigationId,
        startBoardRestoreLoad,
        finishBoardRestoreLoad,
        persistBoardNow,
        clearPendingBoardPersist,
    }
}
