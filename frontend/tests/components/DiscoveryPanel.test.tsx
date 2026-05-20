import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import DiscoveryPanel from '../../src/components/DiscoveryPanel'
import { BOARD_TOGGLE_DISCOVERY_PANEL_EVENT } from '../../src/utils/boardWorkspaceEvents'

const discovery = {
  id: 'discovery-inv-1-0',
  title: 'Cross-study bottleneck',
  claim: 'Two studies identify the same production bottleneck.',
  impact: 'This would redirect mitigation work toward the bottleneck immediately.',
  confidence: 0.94,
  sourceNodeIDs: ['node-1', 'node-2'],
  sourceVaultID: 'inv-1',
  createdAt: '2026-03-17T10:00:00Z',
  nodeKind: 'discovery',
}

describe('DiscoveryPanel', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stays available with an empty state when no discoveries are approved', async () => {
    const user = userEvent.setup()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[]}
        evidenceByNodeId={{}}
        hasCompletedReview
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(screen.getByText(/Discovery review finished with no approved discoveries/i)).toBeInTheDocument()
    expect(screen.getByTestId('discovery-empty-state')).toHaveClass('forensic-discovery-empty-complete')
    expect(screen.getByTestId('discovery-empty-state')).toHaveClass('forensic-discovery-empty-complete-sweep')
  })

  it('does not animate incomplete empty discovery state as review complete', async () => {
    const user = userEvent.setup()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[]}
        evidenceByNodeId={{}}
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(screen.getByTestId('discovery-empty-state')).not.toHaveClass('forensic-discovery-empty-complete-sweep')
    expect(screen.getByText(/No approved discoveries yet/i)).toBeInTheDocument()
  })

  it('renders completed empty discovery state statically for reduced motion', async () => {
    const user = userEvent.setup()
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
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[]}
        evidenceByNodeId={{}}
        hasCompletedReview
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(screen.getByTestId('discovery-empty-state')).toHaveClass('forensic-discovery-empty-complete')
    expect(screen.getByTestId('discovery-empty-state')).not.toHaveClass('forensic-discovery-empty-complete-sweep')
  })

  it('opens discoveries and routes to supporting evidence', async () => {
    const user = userEvent.setup()
    const onOpenDiscovery = vi.fn()
    const onMarkRead = vi.fn()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[discovery]}
        evidenceByNodeId={{
          'node-1': {
            id: 'node-1',
            title: 'Manufacturing source',
            summary: 'The first source describes the shared production bottleneck.',
            sourceURL: 'https://example.com/source-1',
          },
          'node-2': {
            id: 'node-2',
            title: 'Logistics source',
            summary: 'The second source links the same bottleneck to shipping delays.',
            sourceURL: 'https://example.com/source-2',
          },
        }}
        hasUnread
        onOpenDiscovery={onOpenDiscovery}
        onClear={vi.fn()}
        onMarkRead={onMarkRead}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(onMarkRead).toHaveBeenCalled()
    expect(screen.getByText('Cross-study bottleneck')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show 2 supporting evidence nodes/i })).toBeInTheDocument()
    expect(screen.queryByText('node-1')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /show 2 supporting evidence nodes/i }))
    expect(screen.getByText('Manufacturing source')).toBeInTheDocument()
    expect(screen.getByText(/first source describes/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open evidence manufacturing source/i }))
    expect(onOpenDiscovery).toHaveBeenCalledWith('node-1')
  })

  it('reveals newly arrived discoveries and counts confidence up when the panel is open', async () => {
    vi.useFakeTimers()
    const onMarkRead = vi.fn()

    const { rerender } = render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[]}
        evidenceByNodeId={{}}
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={onMarkRead}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /open discoveries/i }))

    rerender(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[discovery]}
        evidenceByNodeId={{}}
        hasUnread
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={onMarkRead}
      />,
    )

    const card = screen.getByTestId('discovery-card-discovery-inv-1-0')
    expect(card).toHaveClass('forensic-discovery-card-reveal')
    expect(screen.getByTestId('discovery-confidence-discovery-inv-1-0')).toHaveTextContent('0%')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1440)
    })

    expect(screen.getByTestId('discovery-confidence-discovery-inv-1-0')).toHaveTextContent('94%')
  })

  it('does not replay reveal animation for discoveries present on initial load', async () => {
    const user = userEvent.setup()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[discovery]}
        evidenceByNodeId={{}}
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(screen.getByTestId('discovery-card-discovery-inv-1-0')).not.toHaveClass('forensic-discovery-card-reveal')
    expect(screen.getByTestId('discovery-confidence-discovery-inv-1-0')).toHaveTextContent('94%')
  })

  it('shows final confidence immediately when reduced motion is preferred', async () => {
    const user = userEvent.setup()
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

    const { rerender } = render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[]}
        evidenceByNodeId={{}}
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    rerender(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[discovery]}
        evidenceByNodeId={{}}
        hasUnread
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    expect(screen.getByTestId('discovery-confidence-discovery-inv-1-0')).toHaveTextContent('94%')
  })

  it('uses smooth accordion state classes for supporting evidence', async () => {
    const user = userEvent.setup()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[discovery]}
        evidenceByNodeId={{
          'node-1': {
            id: 'node-1',
            title: 'Manufacturing source',
            summary: 'The first source describes the shared production bottleneck.',
          },
        }}
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    const toggle = screen.getByRole('button', { name: /show 2 supporting evidence nodes/i })
    const panel = screen.getByTestId('discovery-evidence-panel-discovery-inv-1-0')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toHaveClass('forensic-discovery-evidence-panel-closed')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(panel).toHaveClass('forensic-discovery-evidence-panel-open')
    expect(screen.getByText('Manufacturing source')).toBeInTheDocument()
  })

  it('marks discoveries read from board toggle events without render-phase parent updates', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Harness = () => {
      const [isRead, setIsRead] = useState(false)

      return (
        <DiscoveryPanel
          currentInvestigationId="inv-1"
          discoveries={[discovery]}
          evidenceByNodeId={{}}
          hasUnread={!isRead}
          onOpenDiscovery={vi.fn()}
          onClear={vi.fn()}
          onMarkRead={() => setIsRead(true)}
        />
      )
    }

    render(<Harness />)

    act(() => {
      window.dispatchEvent(new Event(BOARD_TOGGLE_DISCOVERY_PANEL_EVENT))
    })

    expect(screen.getByText('Cross-study bottleneck')).toBeInTheDocument()
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Cannot update a component'),
    )

    consoleError.mockRestore()
  })
})
