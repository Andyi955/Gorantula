import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LandingExperience from '../src/components/LandingExperience'

// jsdom has no canvas implementation; the component guards against a null context,
// and stubbing it here keeps the test output free of "not implemented" noise.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterAll(() => {
  vi.restoreAllMocks()
})

describe('LandingExperience', () => {
  it('renders the hero title and all five workspace cards', () => {
    render(<LandingExperience onEnter={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Gorantula' })).toBeInTheDocument()
    expect(screen.getByTestId('landing-card-spider')).toBeInTheDocument()
    expect(screen.getByTestId('landing-card-board')).toBeInTheDocument()
    expect(screen.getByTestId('landing-card-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('landing-card-brain')).toBeInTheDocument()
    expect(screen.getByTestId('landing-card-chat')).toBeInTheDocument()
  })

  it('enters the default workspace from the primary call to action', async () => {
    const user = userEvent.setup()
    const onEnter = vi.fn()
    render(<LandingExperience onEnter={onEnter} />)

    await user.click(screen.getByTestId('landing-enter-button'))

    expect(onEnter).toHaveBeenCalledTimes(1)
    expect(onEnter).toHaveBeenCalledWith()
  })

  it('deep-links into a workspace when a feature card is clicked', async () => {
    const user = userEvent.setup()
    const onEnter = vi.fn()
    render(<LandingExperience onEnter={onEnter} />)

    await user.click(screen.getByTestId('landing-card-board'))
    expect(onEnter).toHaveBeenCalledWith('board')

    await user.click(screen.getByTestId('landing-card-brain'))
    expect(onEnter).toHaveBeenCalledWith('brain')
  })

  it('enters when the Enter key is pressed', () => {
    const onEnter = vi.fn()
    render(<LandingExperience onEnter={onEnter} />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('shows live vault stats when investigations exist', () => {
    render(
      <LandingExperience
        onEnter={() => {}}
        stats={{ investigations: 3, evidence: 42, relationships: 17 }}
      />,
    )

    expect(screen.getByTestId('landing-stats')).toBeInTheDocument()
    expect(screen.getByText('Active cases')).toBeInTheDocument()
    expect(screen.getByText('Evidence items')).toBeInTheDocument()
    expect(screen.getByText('Relationships')).toBeInTheDocument()
  })

  it('hides the stats row when there are no investigations', () => {
    render(
      <LandingExperience
        onEnter={() => {}}
        stats={{ investigations: 0, evidence: 0, relationships: 0 }}
      />,
    )

    expect(screen.queryByTestId('landing-stats')).not.toBeInTheDocument()
  })
})
