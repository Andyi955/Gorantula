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
        json: async () => ({
          keys: {
            OPENAI_API_KEY: 'masked-key',
            DEFAULT_SEARCH_MODEL: 'openai',
            DEEPSEEK_MODEL: 'deepseek-v4-flash',
            OLLAMA_HOST: 'http://localhost:11434',
            LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          keys: {
            OPENAI_API_KEY: 'remasked',
            DEFAULT_SEARCH_MODEL: 'openai',
            DEEPSEEK_MODEL: 'deepseek-v4-flash',
            OLLAMA_HOST: 'http://localhost:11434',
            LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',
          },
        }),
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
    const deepseekModelInput = screen.getByPlaceholderText('deepseek-v4-flash') as HTMLInputElement
    await user.clear(deepseekModelInput)
    await user.type(deepseekModelInput, 'deepseek-v4-pro')
    await user.click(screen.getByRole('button', { name: /commit settings/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('deepseek-v4-pro')
    expect(screen.getByText(/settings saved successfully/i)).toBeInTheDocument()
  })

  it('disables provider routes until the matching setup exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        keys: {
          ZHIPUAI_API_KEY: '',
          MOONSHOT_API_KEY: '',
          LMSTUDIO_BASE_URL: '',
          ANTHROPIC_API_KEY: '',
          GEMINI_API_KEY: 'gem-key',
          OLLAMA_HOST: 'http://localhost:11434',
        },
      }),
    })

    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsDashboard />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.getAllByRole('option', { name: /glm \(zhipu ai\) \(requires setup\)/i })).toSatisfy(
      (options) => options.length === 2 && options.every((option) => (option as HTMLOptionElement).disabled),
    )
    expect(screen.getAllByRole('option', { name: /kimi \(moonshot\) \(requires setup\)/i })).toSatisfy(
      (options) => options.length === 2 && options.every((option) => (option as HTMLOptionElement).disabled),
    )
    expect(screen.getAllByRole('option', { name: /lm studio local \(requires setup\)/i })).toSatisfy(
      (options) => options.length === 2 && options.every((option) => (option as HTMLOptionElement).disabled),
    )
    expect(screen.getAllByRole('option', { name: /anthropic claude \(requires setup\)/i })).toSatisfy(
      (options) => options.length === 2 && options.every((option) => (option as HTMLOptionElement).disabled),
    )
    expect(screen.getAllByRole('option', { name: /^google gemini$/i })).toSatisfy(
      (options) => options.length === 2 && options.every((option) => !(option as HTMLOptionElement).disabled),
    )
    expect(screen.getAllByRole('option', { name: /^ollama local$/i })).toSatisfy(
      (options) => options.length === 2 && options.every((option) => !(option as HTMLOptionElement).disabled),
    )
  })

  it('shows provider activation switches and saves them with settings', async () => {
    const user = userEvent.setup()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => ({
          keys: {
            DEEPSEEK_ENABLED: 'true',
            DEEPSEEK_API_KEY: 'ds...ey',
            GEMINI_ENABLED: 'false',
            DEFAULT_SEARCH_MODEL: 'deepseek',
            DEFAULT_PERSONA_MODEL: 'deepseek',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        json: async () => ({
          keys: {
            DEEPSEEK_ENABLED: 'true',
            GEMINI_ENABLED: 'true',
            DEFAULT_SEARCH_MODEL: 'deepseek',
            DEFAULT_PERSONA_MODEL: 'deepseek',
          },
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    render(<SettingsDashboard />)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByText(/provider activation/i)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /deepseek enabled/i })).toBeChecked()
    const geminiSwitch = screen.getByRole('switch', { name: /google gemini disabled/i })
    expect(geminiSwitch).not.toBeChecked()

    await user.click(geminiSwitch)
    await user.click(screen.getByRole('button', { name: /commit settings/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('"GEMINI_ENABLED":"true"')
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
