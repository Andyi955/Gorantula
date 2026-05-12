import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SettingsDashboard from '../../src/components/SettingsDashboard'
import {
  BROWSER_QA_SEEDED_EVENT,
  BROWSER_QA_TARGET_INVESTIGATION_ID,
} from '../../src/utils/browserQaSeed'

describe('SettingsDashboard', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads settings and saves updated values', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({ keys: { OPENAI_API_KEY: 'masked-key', DEFAULT_SEARCH_MODEL: 'openai' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        json: async () => ({ keys: { OPENAI_API_KEY: 'remasked', DEFAULT_SEARCH_MODEL: 'openai' } }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsDashboard />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByText(/model provider uplink/i)).toBeInTheDocument()

    const passwordInput = document.querySelector('input[value="masked-key"]') as HTMLInputElement
    expect(passwordInput).not.toBeNull()
    await user.type(passwordInput, '-updated')
    await user.click(screen.getByRole('button', { name: /commit settings/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    expect(screen.getByText(/settings saved successfully/i)).toBeInTheDocument()
  })

  it('seeds browser QA data from the local QA tools panel', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ keys: {} }),
    })
    const eventSpy = vi.fn()

    vi.stubGlobal('fetch', fetchMock)
    window.addEventListener(BROWSER_QA_SEEDED_EVENT, eventSpy as EventListener)

    render(<SettingsDashboard />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    await user.click(screen.getByRole('button', { name: /load browser test data/i }))

    expect(screen.getByText(/browser qa data loaded/i)).toBeInTheDocument()
    const investigations = JSON.parse(localStorage.getItem('gorantula_investigations') || '[]')
    expect(investigations.some((entry: { id: string }) => entry.id === BROWSER_QA_TARGET_INVESTIGATION_ID)).toBe(true)
    expect(eventSpy).toHaveBeenCalledTimes(1)

    window.removeEventListener(BROWSER_QA_SEEDED_EVENT, eventSpy as EventListener)
  })
})
