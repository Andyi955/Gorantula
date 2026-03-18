import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiscoveryPanel from '../../src/components/DiscoveryPanel'

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
})
