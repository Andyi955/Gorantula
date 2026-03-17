import {
  BOARD_GRID_SIZE,
  MIN_NODE_HEIGHT,
  MIN_NODE_WIDTH,
  buildStrictGridRoute,
  calculateNodeFrame,
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

    expect(collapsed.width).toBeGreaterThanOrEqual(MIN_NODE_WIDTH)
    expect(collapsed.height).toBeGreaterThanOrEqual(MIN_NODE_HEIGHT)
    expect(expanded.width).toBeGreaterThanOrEqual(collapsed.width)
    expect(expanded.height).toBeGreaterThan(collapsed.height)
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
})
