import { fireEvent, render, screen } from '@testing-library/react'
import CustomEdge from '../../src/components/CustomEdge'

const setEdges = vi.fn()
const getNodes = vi.fn(() => [])
const getTransform = (testId: string) => screen.getByTestId(testId).getAttribute('style') || ''

vi.mock('reactflow', () => ({
  BaseEdge: ({ style }: { style?: React.CSSProperties }) => (
    <path
      data-testid="base-edge"
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
})
