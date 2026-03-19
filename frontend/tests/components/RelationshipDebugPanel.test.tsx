import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RelationshipDebugPanel from '../../src/components/RelationshipDebugPanel'

const debugRun = {
  vaultId: 'inv-1',
  createdAt: '2026-03-18T11:00:00Z',
  stage: 'completed',
  notes: ['accepted_connections=1', 'candidate_count=2'],
  candidates: [
    {
      source: 'node-1',
      target: 'node-2',
      tag: 'OUTPERFORMS',
      reasoning: 'RAG-sequence outperforms T5-11B on open-domain QA.',
      qualityScore: 0.91,
      validationStatus: 'accepted',
      supportingPersonas: ['Connector', 'Skeptic'],
    },
    {
      source: 'node-2',
      target: 'node-3',
      tag: 'RELATED',
      reasoning: 'These seem related.',
      qualityScore: 0.42,
      validationStatus: 'rejected',
      rejectionReason: 'generic_relationship',
      supportingPersonas: ['Connector'],
    },
  ],
  finalConnections: [
    {
      source: 'node-1',
      target: 'node-2',
      tag: 'OUTPERFORMS',
      reasoning: 'RAG-sequence outperforms T5-11B on open-domain QA.',
      qualityScore: 0.91,
      validationStatus: 'accepted',
      supportingPersonas: ['Connector', 'Skeptic'],
    },
  ],
}

describe('RelationshipDebugPanel', () => {
  it('opens and shows accepted and rejected candidates', async () => {
    const user = userEvent.setup()

    render(
      <RelationshipDebugPanel
        investigationId="inv-1"
        debugRun={debugRun}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open relationship debug/i }))

    expect(screen.getByText('Relationship Debug')).toBeInTheDocument()
    expect(screen.getAllByText('OUTPERFORMS').length).toBeGreaterThan(0)
    expect(screen.getByText(/Rejected: generic_relationship/i)).toBeInTheDocument()
    expect(screen.getByText(/accepted_connections=1/i)).toBeInTheDocument()
  })
})
