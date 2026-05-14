import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TimelineView from '../../src/components/TimelineView'

describe('TimelineView', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the empty state when no investigation is selected', () => {
    render(<TimelineView investigationId={null} />)

    expect(screen.getByText(/no investigation selected/i)).toBeInTheDocument()
  })

  it('shows a manual generation CTA when an investigation has no timeline snapshot', async () => {
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        nodes: [
          {
            id: 'node-1',
            data: {
              title: 'Intel Node',
              personaInsights: [
                {
                  timelineEvents: [
                    {
                      timestamp: '2024-01-15',
                      event: 'Shipment departed',
                      sourceNodeId: 'node-1',
                    },
                  ],
                },
              ],
            },
          },
        ],
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    expect(await screen.findByText(/Generate Timeline/i)).toBeInTheDocument()
    expect(screen.queryByText('Shipment departed')).not.toBeInTheDocument()
    expect(screen.queryByText(/automatically populate/i)).not.toBeInTheDocument()
  })

  it('generates and persists timeline events from saved board data only after the user clicks', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-1',
            data: {
              title: 'Intel Node',
              summary: '[DATE:2026-05-13] Governance rules changed.',
              personaInsights: [
                {
                  timelineEvents: [
                    {
                      timestamp: '2024-01-15',
                      event: 'Shipment departed.',
                      sourceNodeId: 'node-1',
                    },
                  ],
                },
              ],
            },
          },
        ],
        edges: [],
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    await user.click(await screen.findByRole('button', { name: /generate timeline/i }))

    expect(await screen.findByText('Shipment departed.')).toBeInTheDocument()
    expect(screen.getAllByText('2026-05-13').length).toBeGreaterThan(0)
    const saved = JSON.parse(localStorage.getItem('inv_data_inv-1') || '{}')
    expect(saved.timelineSnapshot.events).toHaveLength(2)
  })

  it('applies the forensic filter panel to visible timeline events', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-filtered',
          events: [
            {
              id: 'event-persona',
              timestamp: '2024-01-15',
              event: 'Shipment departed.',
              sourceNodeId: 'node-1',
              sourceTitle: 'Logistics Node',
              provenance: 'persona',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
            {
              id: 'event-date-tag',
              timestamp: '2026-05-13',
              event: 'Governance rules changed.',
              sourceNodeId: 'node-2',
              sourceTitle: 'Policy Node',
              provenance: 'date-tag',
              parsedDate: 1778630400000,
              datePrecision: 'day',
            },
          ],
        },
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    expect(await screen.findByText('Shipment departed.')).toBeInTheDocument()
    expect(screen.getByText('Governance rules changed.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/timeline event type/i), 'date-tag')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => expect(screen.queryByText('Shipment departed.')).not.toBeInTheDocument())
    expect(screen.getByText('Governance rules changed.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/timeline source/i), 'node-1')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    expect(await screen.findByText(/no matching timeline events/i)).toBeInTheDocument()
  })

  it('switches investigations without leaking timeline events', async () => {
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-empty',
          events: [
            {
              id: 'event-1',
              timestamp: '2024-01-15',
              event: 'Alpha event',
              sourceNodeId: 'node-1',
              sourceTitle: 'Alpha Node',
              provenance: 'persona',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
          ],
        },
      }),
    )
    localStorage.setItem(
      'inv_data_inv-2',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-empty',
          events: [
            {
              id: 'event-2',
              timestamp: '2025-02-20',
              event: 'Beta event',
              sourceNodeId: 'node-2',
              sourceTitle: 'Beta Node',
              provenance: 'persona',
              parsedDate: 1740009600000,
              datePrecision: 'day',
            },
          ],
        },
      }),
    )

    const { rerender } = render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    expect(await screen.findByText('Alpha event')).toBeInTheDocument()

    rerender(<TimelineView investigationId="inv-2" investigationTitle="Case Beta" />)

    expect(await screen.findByText('Beta event')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Alpha event')).not.toBeInTheDocument())
  })

  it('marks a generated timeline as needing refresh when board evidence changes', async () => {
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [
          {
            id: 'node-1',
            data: { title: 'Intel Node', summary: 'Filed on 2024-01-15.' },
          },
        ],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-stale',
          events: [
            {
              id: 'event-1',
              timestamp: '2024-01-15',
              event: 'Filed on 2024-01-15.',
              sourceNodeId: 'node-1',
              sourceTitle: 'Intel Node',
              provenance: 'text-date',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
          ],
        },
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    expect(await screen.findByText(/Needs Refresh/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /refresh timeline/i })).toBeInTheDocument()
  })

  it('navigates to the source node from a timeline event', async () => {
    const user = userEvent.setup()
    const onNavigateToNode = vi.fn()
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-empty',
          events: [
            {
              id: 'event-1',
              timestamp: '2024-01-15',
              event: 'Shipment departed.',
              sourceNodeId: 'node-1',
              sourceTitle: 'Intel Node',
              provenance: 'persona',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
          ],
        },
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" onNavigateToNode={onNavigateToNode} />)

    await user.click(await screen.findByRole('button', { name: /source intel node/i }))

    expect(onNavigateToNode).toHaveBeenCalledWith('node-1')
  })

  it('widens only verbose event cards so long evidence snippets do not show a clipped extra line', async () => {
    const longEvent = 'SpaceX conducted five Starship flight tests in 2025, the first three of which ended in disaster when the vehicle met a premature fiery demise before completing the planned sequence.'
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-empty',
          events: [
            {
              id: 'event-short',
              timestamp: '2024-01-15',
              event: 'Shipment departed.',
              sourceNodeId: 'node-1',
              sourceTitle: 'Intel Node',
              provenance: 'persona',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
            {
              id: 'event-long',
              timestamp: '2025',
              event: longEvent,
              sourceNodeId: 'node-2',
              sourceTitle: 'Starship Launch Delayed Again',
              provenance: 'text-date',
              parsedDate: 1735689600000,
              datePrecision: 'year',
            },
          ],
        },
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    const shortCard = await screen.findByText('Shipment departed.')
    const longCard = await screen.findByText(longEvent)

    expect(shortCard.closest('article')).not.toHaveClass('forensic-timeline-event-wide')
    expect(longCard.closest('article')).toHaveClass('forensic-timeline-event-wide')
  })
})
