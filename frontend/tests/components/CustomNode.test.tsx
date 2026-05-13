import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
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

  it('renders a compact image preview and opens the board viewer callback', async () => {
    const user = userEvent.setup()
    const onViewImages = vi.fn()

    render(
      <CustomNode
        id="node-3"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-3',
          title: 'Visual Node',
          summary: 'Summary',
          onReadFull: vi.fn(),
          onViewImages,
          images: [
            { id: 'img-1', path: '/evidence/one.png', caption: 'Primary image' },
            { id: 'img-2', path: '/evidence/two.png', caption: 'Secondary image' },
          ],
        }}
      />,
    )

    expect(screen.getByTestId('node-image-preview')).toBeInTheDocument()
    expect(screen.getByTestId('node-image-count')).toHaveTextContent('+1')

    await user.click(screen.getByTestId('node-image-preview'))

    expect(onViewImages).toHaveBeenCalledWith(
      [
        { id: 'img-1', path: '/evidence/one.png', caption: 'Primary image' },
        { id: 'img-2', path: '/evidence/two.png', caption: 'Secondary image' },
      ],
      0,
      'Visual Node',
      'node-3',
    )
  })

  it('does not request backend-served node images while the backend is offline', () => {
    render(
      <CustomNode
        id="node-backend-image"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-backend-image',
          title: 'Offline Image Node',
          summary: 'Summary',
          onReadFull: vi.fn(),
          images: [
            {
              id: 'img-backend',
              path: 'http://localhost:8080/vault-assets/inv-1/images/evidence.jpg',
              caption: 'Backend evidence',
            },
          ],
        }}
      />,
    )

    expect(screen.getByTestId('node-image-preview')).toBeInTheDocument()
    expect(screen.getByText('Backend offline')).toBeInTheDocument()
    expect(screen.queryByAltText('Backend evidence')).not.toBeInTheDocument()
  })

  it('shows attach and remove image controls while editing', async () => {
    const user = userEvent.setup()
    const onAttachImage = vi.fn().mockResolvedValue(undefined)
    const onRemoveImage = vi.fn()

    const { container } = render(
      <CustomNode
        id="node-4"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-4',
          title: 'Editable Node',
          summary: 'Editable summary',
          fullText: 'Editable summary',
          onReadFull: vi.fn(),
          onAttachImage,
          onRemoveImage,
          onViewImages: vi.fn(),
          isEditing: true,
          images: [
            { id: 'img-edit-1', path: '/evidence/editable.png', caption: 'Editable image' },
          ],
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /attach image/i }))

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['image-bytes'], 'evidence.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    expect(onAttachImage).toHaveBeenCalledWith('node-4', file)

    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onRemoveImage).toHaveBeenCalledWith('node-4', 'img-edit-1')
  })

  it('renders separate analyse and plain save actions in edit mode', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <CustomNode
        id="node-5"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-5',
          title: 'Editable Node',
          summary: 'Editable summary',
          fullText: 'Editable summary',
          onReadFull: vi.fn(),
          onSave,
          isEditing: true,
        }}
      />,
    )

    expect(screen.getByRole('button', { name: /analyse & save/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onSave).toHaveBeenCalledWith('node-5', 'Editable Node', 'Editable summary', 'save')
  })

  it('passes analyze-and-save mode through the explicit save callback', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()

    render(
      <CustomNode
        id="node-6"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-6',
          title: 'Editable Node',
          summary: 'Editable summary',
          fullText: 'Editable summary',
          onReadFull: vi.fn(),
          onSave,
          isEditing: true,
        }}
      />,
    )

    await user.click(screen.getByRole('button', { name: /analyse & save/i }))
    expect(onSave).toHaveBeenCalledWith('node-6', 'Editable Node', 'Editable summary', 'analyze-and-save')
  })
})
