import type { Edge, Node, XYPosition } from 'reactflow'
import { BOARD_GRID_SIZE, MIN_NODE_HEIGHT, MIN_NODE_WIDTH, normalizeNodeFrame, snapCoordinateToGrid } from './boardGeometry'

export type EvidenceRole = 'primary' | 'supporting'
export type SupportCluster = 'web' | 'vault' | 'timeline'

export interface SupportingEvidenceBand {
    x: number
    y: number
    width: number
    height: number
    total: number
    counts: Record<SupportCluster, number>
}

export interface SupportTether {
    sourceId: string
    targetId: string
    source: XYPosition
    target: XYPosition
    strength: 'matched' | 'nearest'
    visualOnly: true
}

const SUPPORT_CLUSTER_ORDER: Record<SupportCluster, number> = {
    web: 0,
    vault: 1,
    timeline: 2,
}

export const SUPPORT_NODE_FRAME = normalizeNodeFrame(MIN_NODE_WIDTH, MIN_NODE_HEIGHT)
const SUPPORT_NODE_GAP_X = BOARD_GRID_SIZE * 2
const SUPPORT_NODE_GAP_Y = BOARD_GRID_SIZE * 2
const SUPPORT_BAND_PADDING = BOARD_GRID_SIZE * 2
const SUPPORT_BAND_HEADER_HEIGHT = BOARD_GRID_SIZE * 3
const SUPPORT_BAND_TOP_GAP = BOARD_GRID_SIZE * 5
const SUPPORT_BAND_MAX_COLUMNS = 4

const getNodeWidth = (node: Node) =>
    typeof node.style?.width === 'number'
        ? node.style.width
        : typeof node.width === 'number'
            ? node.width
            : MIN_NODE_WIDTH

const getNodeHeight = (node: Node) =>
    typeof node.style?.height === 'number'
        ? node.style.height
        : typeof node.height === 'number'
            ? node.height
            : MIN_NODE_HEIGHT

const getNodeCenter = (node: Node): XYPosition => ({
    x: node.position.x + getNodeWidth(node) / 2,
    y: node.position.y + getNodeHeight(node) / 2,
})

export const getSupportingEvidenceNodeFrame = (node: Node) =>
    node.data?.expanded
        ? normalizeNodeFrame(getNodeWidth(node), getNodeHeight(node))
        : SUPPORT_NODE_FRAME

const isVisibleRelationshipEdge = (edge: Edge) =>
    edge.hidden !== true && edge.data?.generatedBy !== 'supportEvidenceTether'

const isRabbitHoleNode = (node: Node) =>
    node.data?.origin === 'rabbit-hole' ||
    typeof node.data?.rabbitTool === 'string' ||
    typeof node.data?.rabbitPass === 'number'

export const supportClusterFromRabbitTool = (rabbitTool?: unknown): SupportCluster => {
    const tool = typeof rabbitTool === 'string' ? rabbitTool.toLowerCase() : ''
    if (tool.includes('timeline')) {
        return 'timeline'
    }
    if (tool.includes('vault')) {
        return 'vault'
    }
    return 'web'
}

const connectedNodeIdsFromEdges = (edges: Edge[]) => {
    const connected = new Set<string>()
    edges.filter(isVisibleRelationshipEdge).forEach((edge) => {
        connected.add(edge.source)
        connected.add(edge.target)
    })
    return connected
}

export const classifyRabbitHoleEvidenceNodes = (nodes: Node[], edges: Edge[]): Node[] => {
    const connectedNodeIds = connectedNodeIdsFromEdges(edges)

    return nodes.map((node) => {
        if (!isRabbitHoleNode(node)) {
            const {
                evidenceRole: _evidenceRole,
                supportCluster: _supportCluster,
                isSupportEvidenceCompact: _isSupportEvidenceCompact,
                ...stableData
            } = node.data || {}

            return {
                ...node,
                data: stableData,
            }
        }

        const evidenceRole: EvidenceRole = connectedNodeIds.has(node.id) ? 'primary' : 'supporting'
        const supportCluster = supportClusterFromRabbitTool(node.data?.rabbitTool)

        return {
            ...node,
            data: {
                ...node.data,
                evidenceRole,
                supportCluster,
                isSupportEvidenceCompact: evidenceRole === 'supporting',
            },
        }
    })
}

const compareSupportingNodes = (a: Node, b: Node) => {
    const passA = typeof a.data?.rabbitPass === 'number' ? a.data.rabbitPass : Number.MAX_SAFE_INTEGER
    const passB = typeof b.data?.rabbitPass === 'number' ? b.data.rabbitPass : Number.MAX_SAFE_INTEGER
    if (passA !== passB) {
        return passA - passB
    }

    const clusterA = supportClusterFromRabbitTool(a.data?.rabbitTool)
    const clusterB = supportClusterFromRabbitTool(b.data?.rabbitTool)
    if (SUPPORT_CLUSTER_ORDER[clusterA] !== SUPPORT_CLUSTER_ORDER[clusterB]) {
        return SUPPORT_CLUSTER_ORDER[clusterA] - SUPPORT_CLUSTER_ORDER[clusterB]
    }

    return String(a.data?.title || a.id).localeCompare(String(b.data?.title || b.id))
}

const getNodeBounds = (nodes: Node[]) => {
    if (nodes.length === 0) {
        return { left: 0, top: 0, right: 0, bottom: 0 }
    }

    return nodes.reduce((bounds, node) => {
        const width = getNodeWidth(node)
        const height = getNodeHeight(node)
        return {
            left: Math.min(bounds.left, node.position.x),
            top: Math.min(bounds.top, node.position.y),
            right: Math.max(bounds.right, node.position.x + width),
            bottom: Math.max(bounds.bottom, node.position.y + height),
        }
    }, {
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
    })
}

export const layoutSupportingEvidenceNodes = (nodes: Node[], edges: Edge[]) => {
    const previouslySupportingNodeIds = new Set(
        nodes
            .filter((node) => node.data?.evidenceRole === 'supporting')
            .map((node) => node.id)
    )
    const classifiedNodes = classifyRabbitHoleEvidenceNodes(nodes, edges)
    const supportingNodes = classifiedNodes
        .filter((node) => node.data?.evidenceRole === 'supporting')
        .sort(compareSupportingNodes)

    if (supportingNodes.length === 0) {
        return { nodes: classifiedNodes, band: null as SupportingEvidenceBand | null }
    }

    const supportingNodeIds = new Set(supportingNodes.map((node) => node.id))
    const primaryNodes = classifiedNodes.filter((node) => !supportingNodeIds.has(node.id))
    const hasPrimaryAnchorNodes = primaryNodes.length > 0
    const anchorBounds = getNodeBounds(hasPrimaryAnchorNodes ? primaryNodes : supportingNodes)
    const hasNewSupportingNodes = supportingNodes.some((node) => !previouslySupportingNodeIds.has(node.id))
    const columns = Math.min(SUPPORT_BAND_MAX_COLUMNS, Math.max(1, supportingNodes.length))
    const rows = Math.ceil(supportingNodes.length / columns)
    const supportFrames = supportingNodes.map(getSupportingEvidenceNodeFrame)
    const columnWidths = Array.from({ length: columns }, () => SUPPORT_NODE_FRAME.width)
    const rowHeights = Array.from({ length: rows }, () => SUPPORT_NODE_FRAME.height)

    supportingNodes.forEach((_, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const frame = supportFrames[index] || SUPPORT_NODE_FRAME
        columnWidths[column] = Math.max(columnWidths[column], frame.width)
        rowHeights[row] = Math.max(rowHeights[row], frame.height)
    })

    const mergePositionedSupportingNodes = (positionedSupportingNodes: Node[], band: SupportingEvidenceBand) => {
        const positionedById = new Map(positionedSupportingNodes.map((node) => [node.id, node]))

        return {
            nodes: classifiedNodes
                .filter((node) => !supportingNodeIds.has(node.id))
                .concat(positionedSupportingNodes)
                .sort((a, b) => {
                    const originalA = nodes.findIndex((node) => node.id === a.id)
                    const originalB = nodes.findIndex((node) => node.id === b.id)
                    if (positionedById.has(a.id) && positionedById.has(b.id)) {
                        return positionedSupportingNodes.findIndex((node) => node.id === a.id) - positionedSupportingNodes.findIndex((node) => node.id === b.id)
                    }
                    return originalA - originalB
                }),
            band,
        }
    }

    if (!hasNewSupportingNodes) {
        const positionedSupportingNodes = supportingNodes.map((node) => ({
            ...node,
            style: {
                ...node.style,
                ...getSupportingEvidenceNodeFrame(node),
            },
        }))
        const supportBounds = getNodeBounds(positionedSupportingNodes)

        return mergePositionedSupportingNodes(positionedSupportingNodes, {
            x: snapCoordinateToGrid(supportBounds.left - SUPPORT_BAND_PADDING),
            y: snapCoordinateToGrid(supportBounds.top - SUPPORT_BAND_HEADER_HEIGHT),
            width: snapCoordinateToGrid((supportBounds.right - supportBounds.left) + (SUPPORT_BAND_PADDING * 2)),
            height: snapCoordinateToGrid(SUPPORT_BAND_HEADER_HEIGHT + (supportBounds.bottom - supportBounds.top) + SUPPORT_BAND_PADDING),
            total: supportingNodes.length,
            counts: supportingNodes.reduce<Record<SupportCluster, number>>((nextCounts, node) => {
                nextCounts[supportClusterFromRabbitTool(node.data?.rabbitTool)] += 1
                return nextCounts
            }, { web: 0, vault: 0, timeline: 0 }),
        })
    }

    const bandX = snapCoordinateToGrid(hasPrimaryAnchorNodes
        ? anchorBounds.left
        : anchorBounds.left - SUPPORT_BAND_PADDING)
    const bandY = snapCoordinateToGrid(hasPrimaryAnchorNodes
        ? anchorBounds.bottom + SUPPORT_BAND_TOP_GAP
        : anchorBounds.top - SUPPORT_BAND_HEADER_HEIGHT)
    const bandWidth = (SUPPORT_BAND_PADDING * 2) + columnWidths.reduce((sum, width) => sum + width, 0) + ((columns - 1) * SUPPORT_NODE_GAP_X)
    const bandHeight = SUPPORT_BAND_HEADER_HEIGHT + SUPPORT_BAND_PADDING + rowHeights.reduce((sum, height) => sum + height, 0) + ((rows - 1) * SUPPORT_NODE_GAP_Y)

    const counts: Record<SupportCluster, number> = { web: 0, vault: 0, timeline: 0 }
    supportingNodes.forEach((node) => {
        counts[supportClusterFromRabbitTool(node.data?.rabbitTool)] += 1
    })

    const positionedSupportingNodes = supportingNodes.map((node, index) => {
        const column = index % columns
        const row = Math.floor(index / columns)
        const columnOffset = columnWidths.slice(0, column).reduce((sum, width) => sum + width + SUPPORT_NODE_GAP_X, 0)
        const rowOffset = rowHeights.slice(0, row).reduce((sum, height) => sum + height + SUPPORT_NODE_GAP_Y, 0)
        const frame = supportFrames[index] || SUPPORT_NODE_FRAME

        return {
            ...node,
            position: {
                x: snapCoordinateToGrid(bandX + SUPPORT_BAND_PADDING + columnOffset),
                y: snapCoordinateToGrid(bandY + SUPPORT_BAND_HEADER_HEIGHT + rowOffset),
            },
            style: {
                ...node.style,
                ...frame,
            },
        }
    })

    return mergePositionedSupportingNodes(
        positionedSupportingNodes,
        {
            x: bandX,
            y: bandY,
            width: snapCoordinateToGrid(bandWidth),
            height: snapCoordinateToGrid(bandHeight),
            total: supportingNodes.length,
            counts,
        }
    )
}

const tokenize = (text: string) =>
    new Set(
        text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((token) => token.length >= 4)
    )

const nodeSearchText = (node: Node) => [
    node.data?.title,
    node.data?.summary,
    node.data?.fullText,
].filter((value): value is string => typeof value === 'string').join(' ')

const tokenOverlapScore = (a: Node, b: Node) => {
    const aTokens = tokenize(nodeSearchText(a))
    const bTokens = tokenize(nodeSearchText(b))
    let score = 0
    aTokens.forEach((token) => {
        if (bTokens.has(token)) {
            score += 1
        }
    })
    return score
}

const distanceBetweenNodes = (a: Node, b: Node) => {
    const centerA = getNodeCenter(a)
    const centerB = getNodeCenter(b)
    return Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y)
}

export const buildSupportTethers = (nodes: Node[], supportNodeId: string, limit = 2): SupportTether[] => {
    const source = nodes.find((node) => node.id === supportNodeId && node.data?.evidenceRole === 'supporting')
    if (!source) {
        return []
    }

    const primaryNodes = nodes.filter((node) => node.data?.evidenceRole === 'primary')
    if (primaryNodes.length === 0) {
        return []
    }

    const ranked = primaryNodes
        .map((target) => ({
            target,
            score: tokenOverlapScore(source, target),
            distance: distanceBetweenNodes(source, target),
        }))
        .sort((a, b) => {
            if (a.score !== b.score) {
                return b.score - a.score
            }
            return a.distance - b.distance
        })

    return ranked.slice(0, Math.max(1, limit)).map(({ target, score }) => ({
        sourceId: source.id,
        targetId: target.id,
        source: getNodeCenter(source),
        target: getNodeCenter(target),
        strength: score > 0 ? 'matched' : 'nearest',
        visualOnly: true,
    }))
}
