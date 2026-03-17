import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CustomNode from '../../src/components/CustomNode'

vi.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Left: 'Left', Right: 'Right', Top: 'Top', Bottom: 'Bottom' },
}))

vi.mock('@reactflow/node-resizer', () => ({
  NodeResizer: () => null,
}))

describe('CustomNode', () => {
  it('fires read and expand actions from the footer and header', async () => {
    const user = userEvent.setup()
    const onReadFull = vi.fn()
    const onExpand = vi.fn()

    render(
      <CustomNode
        id="node-1"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-1',
          title: 'Node Title',
          summary: 'Short summary',
          onReadFull,
          onExpand,
        }}
      />,
    )

    await user.click(screen.getByTitle('Expand'))
    await user.click(screen.getByTitle('Open Dossier'))

    expect(onExpand).toHaveBeenCalledWith('node-1', true)
    expect(onReadFull).toHaveBeenCalled()
  })

  it('shows a visible selected highlight when the node is selected', () => {
    render(
      <CustomNode
        id="node-2"
        type="custom"
        selected
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-2',
          title: 'Selected Node',
          summary: 'Selected summary',
          onReadFull: vi.fn(),
        }}
      />,
    )

    expect(screen.getByTestId('custom-node-shell').className).toContain('ring-2')
    expect(screen.getByTestId('custom-node-shell').className).toContain('ring-cyber-cyan')
  })
})
