import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.getByText('Shipment departed.').closest('article')).toHaveClass('forensic-timeline-event-entering')
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
    expect(screen.getByText('Shipment departed.').closest('article')).not.toHaveClass('forensic-timeline-event-entering')
    expect(screen.getByText('Governance rules changed.')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/timeline event type/i), 'date-tag')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    await waitFor(() => expect(screen.queryByText('Shipment departed.')).not.toBeInTheDocument())
    expect(screen.getByText('Governance rules changed.')).toBeInTheDocument()
    expect(screen.getByText('Governance rules changed.').closest('article')).toHaveClass('forensic-timeline-event-reordering')

    await user.selectOptions(screen.getByLabelText(/timeline source/i), 'node-1')
    await user.click(screen.getByRole('button', { name: /apply filters/i }))

    expect(await screen.findByText(/no matching timeline events/i)).toBeInTheDocument()
  })

  it('jumps to the beginning and end of the visible dated timeline', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-jump',
          events: [
            {
              id: 'event-first',
              timestamp: '2024-01-15',
              event: 'First dated event.',
              sourceNodeId: 'node-1',
              sourceTitle: 'First Node',
              provenance: 'persona',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
            {
              id: 'event-last',
              timestamp: '2026-05-13',
              event: 'Last dated event.',
              sourceNodeId: 'node-2',
              sourceTitle: 'Last Node',
              provenance: 'date-tag',
              parsedDate: 1778630400000,
              datePrecision: 'day',
            },
            {
              id: 'event-unknown',
              timestamp: 'Later',
              event: 'Undated context stays in the side tray.',
              sourceNodeId: 'node-3',
              sourceTitle: 'Unknown Node',
              provenance: 'text-date',
              parsedDate: null,
              datePrecision: 'unknown',
            },
          ],
        },
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    expect(await screen.findByText('First dated event.')).toBeInTheDocument()
    const jumpToEnd = screen.getByRole('button', { name: /jump to end/i })
    const jumpToBeginning = screen.getByRole('button', { name: /jump to beginning/i })
    const canvas = screen.getByTestId('timeline-canvas')
    const track = screen.getByTestId('timeline-track')
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 600 })
    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 1800 })

    await user.click(jumpToEnd)

    await waitFor(() => {
      expect(track).toHaveStyle({ transform: 'translateX(-1200px) scale(1)' })
    })

    await user.click(jumpToBeginning)

    await waitFor(() => {
      expect(track).toHaveStyle({ transform: 'translateX(0px) scale(1)' })
    })

    fireEvent.keyDown(canvas, { key: 'End' })

    await waitFor(() => {
      expect(track).toHaveStyle({ transform: 'translateX(-1200px) scale(1)' })
    })

    fireEvent.keyDown(canvas, { key: 'Home' })

    await waitFor(() => {
      expect(track).toHaveStyle({ transform: 'translateX(0px) scale(1)' })
    })
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

  it('does not cross-highlight related events or source rows while hovering a timeline card', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
        timelineSnapshot: {
          generatedAt: '2026-05-14T12:00:00.000Z',
          sourceFingerprint: 'tl-related',
          events: [
            {
              id: 'event-alpha-a',
              timestamp: '2024-01-15',
              event: 'Alpha source event one.',
              sourceNodeId: 'node-alpha',
              sourceTitle: 'Alpha Node',
              provenance: 'persona',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
            {
              id: 'event-alpha-b',
              timestamp: '2024-01-16',
              event: 'Alpha source event two.',
              sourceNodeId: 'node-alpha',
              sourceTitle: 'Alpha Node',
              provenance: 'date-tag',
              parsedDate: 1705363200000,
              datePrecision: 'day',
            },
            {
              id: 'event-date-match',
              timestamp: '2024-01-15',
              event: 'Different source same date.',
              sourceNodeId: 'node-beta',
              sourceTitle: 'Beta Node',
              provenance: 'text-date',
              parsedDate: 1705276800000,
              datePrecision: 'day',
            },
          ],
        },
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    const hoveredArticle = (await screen.findByText('Alpha source event one.')).closest('article')!
    const hoveredCard = hoveredArticle.querySelector('.forensic-timeline-event-card')!
    await user.hover(hoveredCard)

    expect(hoveredArticle).not.toHaveClass('forensic-timeline-event-hovered')
    expect(screen.getByText('Alpha source event two.').closest('article')).not.toHaveClass('forensic-timeline-event-related-active')
    expect(screen.getByText('Alpha source event two.').closest('article')).not.toHaveClass('forensic-timeline-event-related-source')
    expect(screen.getByText('Different source same date.').closest('article')).not.toHaveClass('forensic-timeline-event-related-date')
    expect(screen.getByTestId('timeline-source-row-node-alpha')).not.toHaveClass('forensic-timeline-source-row-related')
    expect(screen.getByTestId('timeline-source-row-node-alpha')).not.toHaveClass('forensic-timeline-source-row-related-source')
    expect(screen.getByTestId('timeline-source-row-node-beta')).not.toHaveClass('forensic-timeline-source-row-related-date')

    await user.unhover(hoveredCard)
    expect(hoveredArticle).not.toHaveClass('forensic-timeline-event-hovered')
  })

  it('renders generated timeline events without motion classes when reduced motion is preferred', async () => {
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
            },
          },
        ],
        edges: [],
      }),
    )

    render(<TimelineView investigationId="inv-1" investigationTitle="Case Alpha" />)

    await user.click(await screen.findByRole('button', { name: /generate timeline/i }))

    const eventArticle = (await screen.findByText('Governance rules changed.')).closest('article')
    expect(eventArticle).not.toHaveClass('forensic-timeline-event-entering')
    expect(eventArticle).not.toHaveClass('forensic-timeline-event-reordering')
  })

  it('animates browser QA timeline snapshots without saving them as real board data', async () => {
    localStorage.setItem(
      'inv_data_inv-1',
      JSON.stringify({
        mode: 'strict-grid',
        nodes: [],
        edges: [],
      }),
    )

    render(
      <TimelineView
        investigationId="inv-1"
        investigationTitle="Case Alpha"
        qaTimelineDemoSnapshot={{
          generatedAt: '2026-05-20T12:00:00.000Z',
          sourceFingerprint: 'qa-timeline-demo',
          events: [
            {
              id: 'qa-timeline-event-1',
              timestamp: '2026-05-13',
              event: 'QA grid alert opened.',
              sourceNodeId: 'qa-source-1',
              sourceTitle: 'QA Grid Alert',
              provenance: 'persona',
              parsedDate: 1778630400000,
              datePrecision: 'day',
            },
          ],
        }}
      />,
    )

    const eventArticle = (await screen.findByText('QA grid alert opened.')).closest('article')
    expect(eventArticle).toHaveClass('forensic-timeline-event-entering')
    expect(localStorage.getItem('inv_data_inv-1')).not.toContain('QA grid alert opened.')
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
