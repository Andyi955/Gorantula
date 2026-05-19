import { fireEvent, render, screen } from '@testing-library/react'
import CustomEdge from '../../src/components/CustomEdge'

const setEdges = vi.fn()
const getNodes = vi.fn(() => [])
const getTransform = (testId: string) => screen.getByTestId(testId).getAttribute('style') || ''

vi.mock('reactflow', () => ({
  BaseEdge: ({ className, path, style }: { className?: string; path?: string; style?: React.CSSProperties }) => (
    <path
      data-testid="base-edge"
      className={className}
      data-path={path}
      data-stroke-dasharray={style?.strokeDasharray}
      data-stroke-linecap={style?.strokeLinecap}
    />
  ),
  EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  getSmoothStepPath: () => ['M 0 0 L 100 100', 50, 50],
  useReactFlow: () => ({
    setEdges,
    getViewport: () => ({ zoom: 1 }),
    getNodes,
  }),
}))

describe('CustomEdge', () => {
  beforeEach(() => {
    setEdges.mockClear()
    getNodes.mockReset()
    getNodes.mockReturnValue([])
  })

  it('renders the label and allows resetting the label position', () => {
    render(
      <CustomEdge
        id="edge-1"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={100}
        sourcePosition="Right"
        targetPosition="Left"
        label="RELATED"
        data={{}}
      />,
    )

    const label = screen.getByText('RELATED')
    fireEvent.doubleClick(label)

    expect(screen.getByTestId('base-edge')).toBeInTheDocument()
    expect(setEdges).toHaveBeenCalled()
  })

  it('applies shared relationship pattern visuals from edge data', () => {
    render(
      <CustomEdge
        id="edge-2"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={100}
        sourcePosition="Right"
        targetPosition="Left"
        label="FUNDED_BY"
        data={{ pattern: 'dash-dot', color: '#00ffaa' }}
      />,
    )

    const edge = screen.getByTestId('base-edge')
    expect(edge).toHaveAttribute('data-stroke-dasharray', '10 4 2 4')
    expect(edge).toHaveAttribute('data-stroke-linecap', 'round')
  })

  it('uses the selected line shape to change dash geometry rather than rendering markers', () => {
    render(
      <CustomEdge
        id="edge-3"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={100}
        sourcePosition="Right"
        targetPosition="Left"
        label="SEEN_WITH"
        data={{ pattern: 'dotted', shape: 'square', color: '#00ffaa' }}
      />,
    )

    const edge = screen.getByTestId('base-edge')
    expect(edge).toHaveAttribute('data-stroke-dasharray', '1 7')
    expect(edge).toHaveAttribute('data-stroke-linecap', 'square')
  })

  it('nudges default legacy labels away from overlapping node boxes', () => {
    getNodes.mockReturnValue([
      {
        id: 'blocker',
        position: { x: 20, y: 20 },
        style: { width: 60, height: 60 },
      },
    ])

    render(
      <CustomEdge
        id="edge-4"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={100}
        sourcePosition="Right"
        targetPosition="Left"
        label="RELATED"
        data={{}}
      />,
    )

    expect(getTransform('edge-label-edge-4')).not.toContain('translate(50px, 50px)')
  })

  it('keeps manually placed labels where the operator dragged them', () => {
    getNodes.mockReturnValue([
      {
        id: 'blocker',
        position: { x: 20, y: 20 },
        style: { width: 60, height: 60 },
      },
    ])

    render(
      <CustomEdge
        id="edge-5"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={100}
        sourcePosition="Right"
        targetPosition="Left"
        label="RELATED"
        data={{ customX: 50, customY: 50, routeMode: 'free' }}
      />,
    )

    expect(getTransform('edge-label-edge-5')).toContain('translate(50px, 50px)')
  })

  it('nudges default strict-grid labels away from overlapping node boxes', () => {
    getNodes.mockReturnValue([
      {
        id: 'blocker',
        position: { x: 35, y: 35 },
        style: { width: 50, height: 50 },
      },
    ])

    render(
      <CustomEdge
        id="edge-6"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        targetX={120}
        targetY={120}
        sourcePosition="Right"
        targetPosition="Left"
        label="SEEN_WITH"
        data={{
          boardMode: 'strict-grid',
          routePoints: [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 120 },
            { x: 120, y: 120 },
          ],
        }}
      />,
    )

    expect(getTransform('edge-label-edge-6')).not.toContain('translate(60px, 60px)')
  })

  it('uses strict-grid route anchors instead of stale React Flow handle coordinates', () => {
    render(
      <CustomEdge
        id="edge-anchored"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={0}
        sourcePosition="Right"
        targetPosition="Left"
        label="RELATED"
        data={{
          boardMode: 'strict-grid',
          sourcePortSide: 'right',
          targetPortSide: 'left',
          routeSourcePoint: { x: 320, y: 96 },
          routeTargetPoint: { x: 672, y: 96 },
          routePoints: [
            { x: 344, y: 96 },
            { x: 648, y: 96 },
          ],
        }}
      />,
    )

    expect(screen.getByTestId('base-edge')).toHaveAttribute(
      'data-path',
      'M 320 96 L 344 96 L 648 96 L 672 96',
    )
  })

  it('renders a reveal overlay and reports hover state for new connections', () => {
    const onConnectionHover = vi.fn()

    render(
      <CustomEdge
        id="edge-7"
        source="source-node"
        target="target-node"
        sourceX={0}
        sourceY={0}
        targetX={100}
        targetY={100}
        sourcePosition="Right"
        targetPosition="Left"
        label="RELATED"
        data={{
          color: '#00ffaa',
          isConnectionRevealing: true,
          onConnectionHover,
        }}
      />,
    )

    expect(screen.getByTestId('edge-reveal-overlay-edge-7')).toBeInTheDocument()
    expect(screen.getByTestId('edge-label-edge-7').firstElementChild).toHaveClass('forensic-edge-label-reveal')

    fireEvent.mouseEnter(screen.getByTestId('edge-hover-target-edge-7'))
    expect(onConnectionHover).toHaveBeenLastCalledWith({
      edgeId: 'edge-7',
      source: 'source-node',
      target: 'target-node',
      color: '#00ffaa',
      active: true,
    })

    fireEvent.mouseLeave(screen.getByTestId('edge-hover-target-edge-7'))
    expect(onConnectionHover).toHaveBeenLastCalledWith({
      edgeId: 'edge-7',
      source: 'source-node',
      target: 'target-node',
      color: '#00ffaa',
      active: false,
    })
  })
})
