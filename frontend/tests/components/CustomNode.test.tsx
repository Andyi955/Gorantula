import { act, render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CustomNode from '../../src/components/CustomNode'

vi.mock('reactflow', () => ({
  Handle: () => null,
  Position: { Left: 'Left', Right: 'Right', Top: 'Top', Bottom: 'Bottom' },
}))

const { nodeResizerMock, nodeResizeControlMock } = vi.hoisted(() => ({
  nodeResizerMock: vi.fn(),
  nodeResizeControlMock: vi.fn(),
}))

vi.mock('@reactflow/node-resizer', () => ({
  NodeResizer: (props: Record<string, unknown>) => {
    nodeResizerMock(props)
    return null
  },
  NodeResizeControl: (props: Record<string, unknown>) => {
    nodeResizeControlMock(props)
    return null
  },
  ResizeControlVariant: { Line: 'line', Handle: 'handle' },
}))

describe('CustomNode', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

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

  it('shows merged evidence count for squashed duplicate cards', () => {
    render(
      <CustomNode
        id="node-merged-evidence"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-merged-evidence',
          title: 'Merged Evidence Node',
          summary: 'This card represents several duplicate excerpts.',
          evidenceCount: 3,
          mergedSourceURLs: [
            'https://example.com/report',
            'https://mirror.example/report',
            'https://wire.example/report',
          ],
          duplicateNodeIds: ['node-duplicate-a', 'node-duplicate-b'],
          onReadFull: vi.fn(),
        }}
      />,
    )

    expect(screen.getByText('MERGED EVIDENCE 3')).toBeInTheDocument()
    expect(screen.getByTitle('Squashed 3 duplicate evidence items into this card')).toBeInTheDocument()
  })

  it('animates evidence detail expansion without changing the expand callback contract', async () => {
    const user = userEvent.setup()
    const onExpand = vi.fn()

    render(
      <CustomNode
        id="node-expansion"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-expansion',
          title: 'Expandable Node',
          summary: 'Short summary',
          fullText: 'Long detail '.repeat(48),
          onReadFull: vi.fn(),
          onExpand,
        }}
      />,
    )

    const detail = screen.getByTestId('node-detail-motion')
    expect(detail).toHaveClass('forensic-node-detail-motion')
    expect(detail).toHaveClass('forensic-node-detail-collapsed')

    await user.click(screen.getByTitle('Expand'))

    expect(onExpand).toHaveBeenCalledWith('node-expansion', true)
    expect(screen.getByTestId('node-detail-motion')).toHaveClass('forensic-node-detail-expanded')
  })

  it('lets collapsed previews show the seventh and eighth fitted lines', () => {
    render(
      <CustomNode
        id="node-eight-line-preview"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        width={576}
        height={288}
        data={{
          id: 'node-eight-line-preview',
          title: 'Eight Line Preview',
          summary: 'Line one pressure line two pressure line three pressure line four pressure line five pressure line six pressure line seven pressure line eight pressure.',
          onReadFull: vi.fn(),
          onResizeCommit: vi.fn(),
        }}
      />,
    )

    expect(screen.getByTestId('node-detail-motion')).toHaveStyle({
      maxHeight: 'calc(8 * 1.65em + 0.75rem)',
    })
  })

  it('only exposes resize controls that keep the node origin anchored', () => {
    render(
      <CustomNode
        id="node-anchored-resize"
        type="custom"
        selected
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        width={384}
        height={240}
        data={{
          id: 'node-anchored-resize',
          title: 'Anchored Resize',
          summary: 'Resizing should grow or shrink the card from the right and bottom without moving its grid origin.',
          onReadFull: vi.fn(),
          onResizeCommit: vi.fn(),
        }}
      />,
    )

    expect(nodeResizerMock).not.toHaveBeenCalled()

    const positions = nodeResizeControlMock.mock.calls.map(([props]) => props.position)
    expect(positions).toEqual(['right', 'bottom', 'bottom-right'])
    expect(positions).not.toEqual(expect.arrayContaining(['top', 'left', 'top-left', 'top-right', 'bottom-left']))

    const variants = nodeResizeControlMock.mock.calls.map(([props]) => props.variant)
    expect(variants).toEqual(['line', 'line', undefined])

    const classNames = nodeResizeControlMock.mock.calls.map(([props]) => props.className)
    expect(classNames).toEqual([
      'forensic-node-resize-line-zone',
      'forensic-node-resize-line-zone',
      'forensic-node-resize-corner-zone',
    ])
  })

  it('asks the board to widen mounted cards when dense text needs more room', async () => {
    const onResizeCommit = vi.fn()

    render(
      <CustomNode
        id="node-dense-text"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        width={384}
        height={240}
        data={{
          id: 'node-dense-text',
          title: 'Global AI Sentiment Shifts',
          summary: 'Recent surveys from [ORG:PEW RESEARCH CENTER] show global sentiment split across [LOC:MALAYSIA], [LOC:THAILAND], [LOC:INDONESIA], and [LOC:SINGAPORE] while experts forecast adoption by [DATE:2030].',
          onReadFull: vi.fn(),
          onResizeCommit,
        }}
      />,
    )

    await vi.waitFor(() => {
      expect(onResizeCommit).toHaveBeenCalledWith('node-dense-text', expect.any(Number), expect.any(Number))
    })
    expect(onResizeCommit.mock.calls[0][1]).toBeGreaterThan(384)
  })

  it('keeps widening collapsed cards when rendered text still overflows into hidden lines', async () => {
    const onResizeCommit = vi.fn()
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'node-detail-motion' ? 190 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'node-detail-motion' ? 130 : 0
      },
    })

    try {
      render(
        <CustomNode
          id="node-render-overflow"
          type="custom"
          selected={false}
          dragging={false}
          zIndex={1}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          width={432}
          height={240}
          data={{
            id: 'node-render-overflow',
            title: 'Wordy Collapsed Node',
            summary: 'This mounted card already has a reasonable calculated width but the rendered seventh and eighth lines still fall under the collapsed mask.',
            onReadFull: vi.fn(),
            onResizeCommit,
          }}
        />,
      )

      await vi.waitFor(() => {
        expect(onResizeCommit).toHaveBeenCalledWith('node-render-overflow', 480, 240)
      })
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
      } else {
        delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
      }
    }
  })

  it('uses the rendered shell width when older restored nodes do not receive a width prop', async () => {
    const onResizeCommit = vi.fn()
    const originalScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect

    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'node-detail-motion' ? 190 : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'node-detail-motion' ? 130 : 0
      },
    })
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.getAttribute('data-testid') === 'custom-node-shell') {
        return {
          x: 0,
          y: 0,
          width: 384,
          height: 240,
          top: 0,
          right: 384,
          bottom: 240,
          left: 0,
          toJSON: () => ({}),
        } as DOMRect
      }

      return originalGetBoundingClientRect.call(this)
    }

    try {
      render(
        <CustomNode
          id="node-old-restored"
          type="custom"
          selected={false}
          dragging={false}
          zIndex={1}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{
            id: 'node-old-restored',
            title: 'Older Restored Node',
            summary: 'Short restored node text can still clip because the old persisted React Flow wrapper is narrower than the new calculated frame path expects.',
            onReadFull: vi.fn(),
            onResizeCommit,
          }}
        />,
      )

      await vi.waitFor(() => {
        expect(onResizeCommit).toHaveBeenCalledWith('node-old-restored', 432, 240)
      })
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight)
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight)
      } else {
        delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
      }
    }
  })

  it('scrolls expanded evidence detail when the wheel is used over the selected card shell', async () => {
    const user = userEvent.setup()

    render(
      <CustomNode
        id="node-expanded-wheel"
        type="custom"
        selected
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-expanded-wheel',
          title: 'Expanded Wheel Node',
          summary: 'Short summary',
          fullText: 'Long detail '.repeat(120),
          onReadFull: vi.fn(),
        }}
      />,
    )

    await user.click(screen.getByTitle('Expand'))

    const shell = screen.getByTestId('custom-node-shell')
    const detail = screen.getByTestId('node-detail-motion')
    Object.defineProperty(detail, 'scrollHeight', { configurable: true, value: 1200 })
    Object.defineProperty(detail, 'clientHeight', { configurable: true, value: 220 })
    detail.scrollTop = 0

    fireEvent.wheel(shell, { deltaY: 180 })

    expect(detail.scrollTop).toBe(180)
  })

  it('renders detail content without motion classes when reduced motion is preferred', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    render(
      <CustomNode
        id="node-reduced-motion"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-reduced-motion',
          title: 'Reduced Motion Node',
          summary: 'Short summary',
          fullText: 'Long detail',
          onReadFull: vi.fn(),
        }}
      />,
    )

    const detail = screen.getByTestId('node-detail-motion')
    expect(detail).toHaveClass('forensic-node-detail-reduced-motion')
    expect(detail).not.toHaveClass('forensic-node-detail-collapsed')
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

  it('uses the active connection color for hover highlights', () => {
    render(
      <CustomNode
        id="node-connection-highlight"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-connection-highlight',
          title: 'Connected Node',
          summary: 'Connected summary',
          isConnectionHighlighted: true,
          connectionHighlightColor: '#ff5500',
          onReadFull: vi.fn(),
        }}
      />,
    )

    const shell = screen.getByTestId('custom-node-shell')
    expect(shell).toHaveClass('forensic-node-connection-highlight')
    expect(shell).toHaveStyle({ '--connection-highlight-color': '#ff5500' })
  })

  it('renders regular evidence entry animation metadata', () => {
    render(
      <CustomNode
        id="node-entry"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-entry',
          title: 'Entry Node',
          summary: 'Entry summary',
          nodeEntryAnimation: 'evidence',
          nodeEntryDelayMs: 240,
          onReadFull: vi.fn(),
        }}
      />,
    )

    const shell = screen.getByTestId('custom-node-shell')
    expect(shell).toHaveClass('forensic-node-entry')
    expect(shell).toHaveClass('forensic-node-entry-evidence')
    expect(shell).toHaveStyle({ '--node-entry-delay': '240ms' })
  })

  it('renders imported evidence with the warm entry animation', () => {
    render(
      <CustomNode
        id="imported-node-entry"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'imported-node-entry',
          title: '[IMPORTED] Entry Node',
          summary: 'Imported entry summary',
          nodeEntryAnimation: 'imported',
          nodeEntryDelayMs: 120,
          onReadFull: vi.fn(),
        }}
      />,
    )

    const shell = screen.getByTestId('custom-node-shell')
    expect(shell).toHaveClass('forensic-node-entry')
    expect(shell).toHaveClass('forensic-node-entry-imported')
    expect(shell).toHaveStyle({ '--node-entry-delay': '120ms' })
  })

  it('renders persona insight scan styling while scan metadata is active', () => {
    render(
      <CustomNode
        id="node-scan"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-scan',
          title: 'Scanned Node',
          summary: 'Scan summary',
          isPersonaScanActive: true,
          onReadFull: vi.fn(),
        }}
      />,
    )

    const shell = screen.getByTestId('custom-node-shell')
    expect(shell).toHaveClass('forensic-node-persona-scan')
  })

  it('renders layout choreography styling while connect-the-dots is arranging evidence', () => {
    render(
      <CustomNode
        id="node-layout"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-layout',
          title: 'Layout Node',
          summary: 'Layout summary',
          isLayoutChoreographyActive: true,
          onReadFull: vi.fn(),
        }}
      />,
    )

    expect(screen.getByTestId('custom-node-shell')).toHaveClass('forensic-node-layout-choreography')
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
    expect(screen.getByTestId('node-image-preview')).toHaveClass('forensic-node-image-fade')
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

  it('marks visual evidence as loaded after the preview image fades in', () => {
    render(
      <CustomNode
        id="node-image-fade"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-image-fade',
          title: 'Image Fade Node',
          summary: 'Summary',
          onReadFull: vi.fn(),
          images: [
            { id: 'img-fade-1', path: '/evidence/fade.png', caption: 'Fade evidence' },
          ],
        }}
      />,
    )

    const image = screen.getByAltText('Fade evidence')
    expect(image).toHaveClass('forensic-node-image-loading')

    fireEvent.load(image)

    expect(screen.getByAltText('Fade evidence')).toHaveClass('forensic-node-image-loaded')
  })

  it('renders backend-served node images while the websocket reconnects', () => {
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
    expect(screen.getByAltText('Backend evidence')).toHaveAttribute(
      'src',
      'http://localhost:8080/vault-assets/inv-1/images/evidence.jpg',
    )
    expect(screen.queryByText('Backend offline')).not.toBeInTheDocument()
  })

  it('styles the source link as a focused source control while preserving link behavior', () => {
    render(
      <CustomNode
        id="node-source"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-source',
          title: 'Source Node',
          summary: 'Summary',
          sourceURL: 'https://example.com/source, https://example.com/secondary',
          onReadFull: vi.fn(),
        }}
      />,
    )

    const sourceLink = screen.getByTitle('Verify Source')
    expect(sourceLink).toHaveClass('forensic-node-source-link')
    expect(sourceLink).toHaveAttribute('href', 'https://example.com/source')
    expect(sourceLink).toHaveAttribute('target', '_blank')
    expect(sourceLink).toHaveAttribute('rel', 'noreferrer')
  })

  it('reveals persona discussion cards with stagger metadata', async () => {
    const user = userEvent.setup()

    render(
      <CustomNode
        id="node-personas"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-personas',
          title: 'Persona Node',
          summary: 'Summary',
          onReadFull: vi.fn(),
          personaInsights: [
            {
              personaName: 'Connector',
              perspective: 'Pattern finder',
              keyFindings: ['Shared entity'],
              connections: [],
              questions: ['What changed?'],
              confidence: 0.82,
              fullAnalysis: 'Connector analysis',
              nodeIDs: ['node-personas'],
            },
            {
              personaName: 'Skeptic',
              perspective: 'Risk reviewer',
              keyFindings: ['Check source'],
              connections: [],
              questions: [],
              confidence: 0.64,
              fullAnalysis: 'Skeptic analysis',
              nodeIDs: ['node-personas'],
            },
          ],
        }}
      />,
    )

    await user.click(screen.getByTitle('Review Specialist Insights'))

    const cards = screen.getAllByTestId('persona-insight-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveClass('forensic-persona-card-reveal')
    expect(cards[0]).toHaveStyle({ '--persona-card-delay': '0ms' })
    expect(cards[1]).toHaveClass('forensic-persona-card-reveal')
    expect(cards[1]).toHaveStyle({ '--persona-card-delay': '90ms' })
  })

  it('retries backend-served node images before showing an unavailable state', async () => {
    vi.useFakeTimers()

    render(
      <CustomNode
        id="node-backend-retry"
        type="custom"
        selected={false}
        dragging={false}
        zIndex={1}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{
          id: 'node-backend-retry',
          title: 'Retry Image Node',
          summary: 'Summary',
          onReadFull: vi.fn(),
          images: [
            {
              id: 'img-retry',
              path: 'http://localhost:8080/vault-assets/inv-1/images/retry.jpg',
              caption: 'Retry evidence',
            },
          ],
        }}
      />,
    )

    const image = screen.getByAltText('Retry evidence')
    fireEvent.error(image)

    expect(screen.getByText('Retrying evidence image')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(650)
    })

    expect(screen.getByAltText('Retry evidence')).toHaveAttribute(
      'src',
      'http://localhost:8080/vault-assets/inv-1/images/retry.jpg?gorantulaImageRetry=1',
    )

    vi.useRealTimers()
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
