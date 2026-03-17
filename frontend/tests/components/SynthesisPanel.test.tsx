import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SynthesisPanel from '../../src/components/SynthesisPanel'

describe('SynthesisPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('stays hidden when there are no saved alerts', () => {
    const { container } = render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId={null}
        returnVaultId={null}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('loads saved alerts and can clear them', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'gorantula_synthesis_alerts_by_investigation',
      JSON.stringify({
        'inv-1': [
          {
            type: 'overlap',
            entity: 'ACME',
            currentVaultId: 'inv-1',
            connectedCases: ['inv-1'],
            nodes: [],
            analysis: 'Linked across cases',
            timestamp: '2026-03-17',
          },
        ],
      }),
    )

    render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-1"
        returnVaultId={null}
      />,
    )

    expect(await screen.findByText('ACME')).toBeInTheDocument()
    await user.click(screen.getByText('CLEAR'))
    await waitFor(() => {
      expect(localStorage.getItem('gorantula_synthesis_alerts_by_investigation')).toBe('{}')
    })
  })
})
