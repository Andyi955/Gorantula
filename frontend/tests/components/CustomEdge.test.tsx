import { fireEvent, render, screen } from '@testing-library/react'
import CustomEdge from '../../src/components/CustomEdge'

const setEdges = vi.fn()

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
  }),
}))

describe('CustomEdge', () => {
  beforeEach(() => {
    setEdges.mockClear()
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
})
