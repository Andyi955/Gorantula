import { render, screen } from '@testing-library/react'
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
      'gorantula_synthesis_alerts',
      JSON.stringify([
        {
          type: 'overlap',
          entity: 'ACME',
          connectedCases: ['inv-1'],
          nodes: [],
          analysis: 'Linked across cases',
          timestamp: '2026-03-17',
        },
      ]),
    )

    render(
      <SynthesisPanel
        sharedSocket={null}
        currentInvestigationId="inv-1"
        returnVaultId={null}
      />,
    )

    await user.click(screen.getAllByRole('button')[0])

    expect(screen.getByText('GRAND UNIFIED THEORY')).toBeInTheDocument()
    expect(screen.getByText('ACME')).toBeInTheDocument()

    await user.click(screen.getByText('CLEAR'))

    expect(localStorage.getItem('gorantula_synthesis_alerts')).toBeNull()
  })
})
