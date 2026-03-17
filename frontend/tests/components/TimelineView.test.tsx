import { render, screen } from '@testing-library/react'
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

  it('renders extracted timeline events from saved investigation data', async () => {
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

    render(<TimelineView investigationId="inv-1" />)

    expect(await screen.findByText('Shipment departed')).toBeInTheDocument()
    expect(screen.getByText('2024-01-15')).toBeInTheDocument()
  })
})
