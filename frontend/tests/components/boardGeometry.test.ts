import {
  BOARD_GRID_SIZE,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  assignStrictGridPorts,
  buildStrictGridRoute,
  calculateNodeFrame,
  getPortById,
  getPortSlotsForDimensions,
  normalizeNodeFrame,
  snapCoordinateToGrid,
} from '../../src/components/boardGeometry'

const expectOrthogonalPoints = (points: Array<{ x: number; y: number }>) => {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const current = points[index]
    expect(previous.x === current.x || previous.y === current.y).toBe(true)
  }
}

const node = (id: string, x: number, y: number, width = 288, height = 192) => ({
  id,
  position: { x, y },
  style: { width, height },
}) as any

const edge = (id: string, source: string, target: string, extra: Record<string, unknown> = {}) => ({
  id,
  source,
  target,
  ...extra,
}) as any

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom })

const segmentIntersectsRect = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  obstacle: { left: number; top: number; right: number; bottom: number },
) => {
  if (start.x === end.x) {
    const minY = Math.min(start.y, end.y)
    const maxY = Math.max(start.y, end.y)
    return start.x >= obstacle.left && start.x <= obstacle.right && maxY >= obstacle.top && minY <= obstacle.bottom
  }

  if (start.y === end.y) {
    const minX = Math.min(start.x, end.x)
    const maxX = Math.max(start.x, end.x)
    return start.y >= obstacle.top && start.y <= obstacle.bottom && maxX >= obstacle.left && minX <= obstacle.right
  }

  throw new Error('Expected orthogonal route segment')
}

const routePathPoints = (route: any, sourceNode: any, targetNode: any) => {
  const sourcePort = getPortById(sourceNode, route.sourcePortId)
  const targetPort = getPortById(targetNode, route.targetPortId)
  if (!sourcePort || !targetPort) {
    throw new Error('Route ports not found')
  }

  return [sourcePort, ...route.points, targetPort]
}

const routeIntersectsRect = (
  route: any,
  sourceNode: any,
  targetNode: any,
  obstacle: { left: number; top: number; right: number; bottom: number },
) => {
  const points = routePathPoints(route, sourceNode, targetNode)

  return points.slice(1).some((point, index) => segmentIntersectsRect(points[index], point, obstacle))
}

const pointIsOnRoute = (point: { x: number; y: number }, route: any, sourceNode: any, targetNode: any) => {
  const points = routePathPoints(route, sourceNode, targetNode)

  return points.slice(1).some((nextPoint, index) => {
    const previousPoint = points[index]
    if (previousPoint.x === nextPoint.x) {
      return point.x === previousPoint.x &&
        point.y >= Math.min(previousPoint.y, nextPoint.y) &&
        point.y <= Math.max(previousPoint.y, nextPoint.y)
    }

    if (previousPoint.y === nextPoint.y) {
      return point.y === previousPoint.y &&
        point.x >= Math.min(previousPoint.x, nextPoint.x) &&
        point.x <= Math.max(previousPoint.x, nextPoint.x)
    }

    return false
  })
}

const expectPointOutsideRects = (
  point: { x: number; y: number },
  rects: Array<{ left: number; top: number; right: number; bottom: number }>,
) => {
  rects.forEach((bounds) => {
    expect(
      point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom,
      JSON.stringify({ point, bounds }),
    ).toBe(true)
  })
}

describe('boardGeometry', () => {
  it('snaps coordinates to the board grid', () => {
    expect(snapCoordinateToGrid(13)).toBe(24)
    expect(snapCoordinateToGrid(36)).toBe(48)
    expect(Math.abs(snapCoordinateToGrid(-11))).toBe(0)
  })

  it('normalizes node frames to minimum snapped dimensions', () => {
    expect(normalizeNodeFrame(120, 100)).toEqual({
      width: MIN_NODE_WIDTH,
      height: MIN_NODE_HEIGHT,
    })

    expect(normalizeNodeFrame(337, 241)).toEqual({
      width: 384,
      height: 288,
    })
  })

  it('calculates larger expanded frames for longer content', () => {
    const collapsed = calculateNodeFrame('short summary', '', false)
    const expanded = calculateNodeFrame('short summary', 'x'.repeat(900), true)
    const withImage = calculateNodeFrame('short summary', '', false, true)
    const withTaggedEntities = calculateNodeFrame(
      'Following [PERSON:Yann LeCun] and [ORG:AMI Labs] in [LOC:Paris] through [DATE:2027-12-31].',
      '',
      false,
    )

    expect(collapsed.width).toBeGreaterThanOrEqual(MIN_NODE_WIDTH)
    expect(collapsed.height).toBeGreaterThanOrEqual(MIN_NODE_HEIGHT)
    expect(expanded.width).toBeGreaterThanOrEqual(collapsed.width)
    expect(expanded.height).toBeGreaterThan(collapsed.height)
    expect(withImage.height).toBeGreaterThan(collapsed.height)
    expect(withTaggedEntities.width).toBeGreaterThanOrEqual(collapsed.width)
  })

  it('creates stable strict-grid port slots for a given frame', () => {
    const slots = getPortSlotsForDimensions(384, 288)

    expect(slots.top[0]).toMatchObject({ id: 'port-top-0', side: 'top', offset: BOARD_GRID_SIZE })
    expect(slots.bottom[0]).toMatchObject({ id: 'port-bottom-0', side: 'bottom', offset: BOARD_GRID_SIZE })
    expect(slots.left[0]).toMatchObject({ id: 'port-left-0', side: 'left', offset: BOARD_GRID_SIZE })
    expect(slots.right[0]).toMatchObject({ id: 'port-right-0', side: 'right', offset: BOARD_GRID_SIZE })
    expect(slots.top.length).toBeGreaterThan(1)
    expect(slots.left.length).toBeGreaterThan(1)
  })

  it('builds orthogonal right-to-left routes for horizontally separated nodes', () => {
    const sourceNode = {
      id: 'source',
      position: { x: 0, y: 0 },
      style: { width: 384, height: 288 },
    } as any
    const targetNode = {
      id: 'target',
      position: { x: 720, y: 0 },
      style: { width: 384, height: 288 },
    } as any

    const route = buildStrictGridRoute(sourceNode, targetNode)

    expect(route.sourcePortId.startsWith('port-right-')).toBe(true)
    expect(route.targetPortId.startsWith('port-left-')).toBe(true)
    expect(route.points.length).toBeGreaterThanOrEqual(2)
    expectOrthogonalPoints(route.points)
  })

  it('builds orthogonal bottom-to-top routes for vertically separated nodes', () => {
    const sourceNode = {
      id: 'source',
      position: { x: 0, y: 0 },
      style: { width: 384, height: 288 },
    } as any
    const targetNode = {
      id: 'target',
      position: { x: 0, y: 720 },
      style: { width: 384, height: 288 },
    } as any

    const route = buildStrictGridRoute(sourceNode, targetNode)

    expect(route.sourcePortId.startsWith('port-bottom-')).toBe(true)
    expect(route.targetPortId.startsWith('port-top-')).toBe(true)
    expect(route.points.length).toBeGreaterThanOrEqual(2)
    expectOrthogonalPoints(route.points)
  })

  it('keeps the fast direct strategy for simple clear horizontal routes', () => {
    const sourceNode = node('source', 0, 0)
    const targetNode = node('target', 720, 0)
    const assignments = assignStrictGridPorts([edge('edge-1', 'source', 'target')], [sourceNode, targetNode])
    const route = assignments.get('edge-1')?.route

    expect(route).toBeDefined()
    expect(route?.strategy).toBe('direct')
    expect(route?.sourcePortId.startsWith('port-right-')).toBe(true)
    expect(route?.targetPortId.startsWith('port-left-')).toBe(true)
  })

  it('falls back to a maze route around an intervening card', () => {
    const sourceNode = node('source', 0, 0)
    const targetNode = node('target', 960, 0)
    const blockerNode = node('blocker', 432, 0)
    const blockerRect = rect(432 - BOARD_GRID_SIZE, 0 - BOARD_GRID_SIZE, 720 + BOARD_GRID_SIZE, 192 + BOARD_GRID_SIZE)
    const assignments = assignStrictGridPorts([edge('edge-1', 'source', 'target')], [sourceNode, targetNode, blockerNode])
    const route = assignments.get('edge-1')?.route

    expect(route).toBeDefined()
    expect(route?.strategy).toBe('maze')
    expect(routeIntersectsRect(route, sourceNode, targetNode, blockerRect)).toBe(false)
    expectOrthogonalPoints(routePathPoints(route, sourceNode, targetNode))
  })

  it('spreads crowded relationship labels away from cards and each other', () => {
    const sourceNode = node('source', 360, 288)
    const topNode = node('top', 360, -24)
    const rightNode = node('right', 792, 288)
    const bottomNode = node('bottom', 360, 600)
    const leftNode = node('left', -72, 288)
    const assignments = assignStrictGridPorts([
      edge('edge-top', 'source', 'top'),
      edge('edge-right', 'source', 'right'),
      edge('edge-bottom', 'source', 'bottom'),
      edge('edge-left', 'source', 'left'),
    ], [sourceNode, topNode, rightNode, bottomNode, leftNode])
    const labelPoints = Array.from(assignments.values()).map((assignment) => assignment.route.labelPoint)

    expect(labelPoints.every(Boolean)).toBe(true)
    expect(new Set(labelPoints.map((point) => `${point?.x}:${point?.y}`)).size).toBe(labelPoints.length)
    labelPoints.forEach((point) => {
      expectPointOutsideRects(point!, [
        rect(360 - BOARD_GRID_SIZE, 288 - BOARD_GRID_SIZE, 648 + BOARD_GRID_SIZE, 480 + BOARD_GRID_SIZE),
        rect(360 - BOARD_GRID_SIZE, -24 - BOARD_GRID_SIZE, 648 + BOARD_GRID_SIZE, 168 + BOARD_GRID_SIZE),
        rect(792 - BOARD_GRID_SIZE, 288 - BOARD_GRID_SIZE, 1080 + BOARD_GRID_SIZE, 480 + BOARD_GRID_SIZE),
        rect(360 - BOARD_GRID_SIZE, 600 - BOARD_GRID_SIZE, 648 + BOARD_GRID_SIZE, 792 + BOARD_GRID_SIZE),
        rect(-72 - BOARD_GRID_SIZE, 288 - BOARD_GRID_SIZE, 216 + BOARD_GRID_SIZE, 480 + BOARD_GRID_SIZE),
      ])
    })
  })

  it('keeps automatic label points anchored on the routed line', () => {
    const sourceNode = node('source', 0, 0)
    const targetNode = node('target', 720, 0)
    const assignments = assignStrictGridPorts([
      edge('edge-1', 'source', 'target'),
      edge('edge-2', 'source', 'target'),
      edge('edge-3', 'source', 'target'),
    ], [sourceNode, targetNode])

    Array.from(assignments.values()).forEach(({ route }) => {
      expect(route.labelPoint).toBeDefined()
      expect(pointIsOnRoute(route.labelPoint!, route, sourceNode, targetNode)).toBe(true)
    })
  })

  it('reroutes stale automatic side handles to vertical ports for stacked nodes', () => {
    const sourceNode = node('source', 0, 0)
    const targetNode = node('target', 0, 528)
    const assignments = assignStrictGridPorts([
      edge('edge-1', 'source', 'target', {
        sourceHandle: 'port-right-4',
        targetHandle: 'port-left-4',
      }),
    ], [sourceNode, targetNode])
    const route = assignments.get('edge-1')?.route

    expect(route).toBeDefined()
    expect(route?.sourcePortId.startsWith('port-bottom-')).toBe(true)
    expect(route?.targetPortId.startsWith('port-top-')).toBe(true)
    expect(route?.labelPoint).toBeDefined()
    expect(pointIsOnRoute(route!.labelPoint!, route, sourceNode, targetNode)).toBe(true)
  })

  it('reroutes stale automatic handles when their route now crosses a card', () => {
    const sourceNode = node('source', 0, 0)
    const targetNode = node('target', 960, 0)
    const blockerNode = node('blocker', 432, 0)
    const blockerRect = rect(432 - BOARD_GRID_SIZE, 0 - BOARD_GRID_SIZE, 720 + BOARD_GRID_SIZE, 192 + BOARD_GRID_SIZE)
    const assignments = assignStrictGridPorts([
      edge('edge-1', 'source', 'target', {
        sourceHandle: 'port-right-4',
        targetHandle: 'port-left-4',
      }),
    ], [sourceNode, targetNode, blockerNode])
    const route = assignments.get('edge-1')?.route

    expect(route).toBeDefined()
    expect(route?.strategy).toBe('maze')
    expect(route?.sourcePortId).not.toBe('port-right-4')
    expect(route?.targetPortId).not.toBe('port-left-4')
    expect(routeIntersectsRect(route, sourceNode, targetNode, blockerRect)).toBe(false)
  })
})
