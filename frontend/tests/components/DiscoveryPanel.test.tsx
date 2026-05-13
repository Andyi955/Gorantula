import { act, render, screen } from '@testing-library/react'
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
  it('stays available with an empty state when no discoveries are approved', async () => {
    const user = userEvent.setup()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[]}
        hasUnread={false}
        onOpenDiscovery={vi.fn()}
        onClear={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(screen.getByText(/No approved discoveries yet for this investigation/i)).toBeInTheDocument()
  })

  it('opens discoveries and routes to supporting evidence', async () => {
    const user = userEvent.setup()
    const onOpenDiscovery = vi.fn()
    const onMarkRead = vi.fn()

    render(
      <DiscoveryPanel
        currentInvestigationId="inv-1"
        discoveries={[discovery]}
        hasUnread
        onOpenDiscovery={onOpenDiscovery}
        onClear={vi.fn()}
        onMarkRead={onMarkRead}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open discoveries/i }))

    expect(onMarkRead).toHaveBeenCalled()
    expect(screen.getByText('Cross-study bottleneck')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /node-1/i }))
    expect(onOpenDiscovery).toHaveBeenCalledWith('node-1')
  })

  it('marks discoveries read from board toggle events without render-phase parent updates', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const Harness = () => {
      const [isRead, setIsRead] = useState(false)

      return (
        <DiscoveryPanel
          currentInvestigationId="inv-1"
          discoveries={[discovery]}
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
