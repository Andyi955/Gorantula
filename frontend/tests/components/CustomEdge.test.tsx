import { fireEvent, render, screen } from '@testing-library/react'
import CustomEdge from '../../src/components/CustomEdge'

const setEdges = vi.fn()

vi.mock('reactflow', () => ({
  BaseEdge: () => <path data-testid="base-edge" />,
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
})
