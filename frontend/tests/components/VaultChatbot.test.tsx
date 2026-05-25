import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VaultChatbot, { VAULT_READY_QUESTIONS_QA_INVESTIGATION_ID } from '../../src/components/VaultChatbot'

describe('VaultChatbot', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads vault files and sends a chat request with selected files', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => [
          {
            fileName: 'case-1.md',
            filePath: '/vault/case-1.md',
            modTime: '2026-03-17T00:00:00Z',
          },
        ],
      }),
    )

    const sharedSocket = {
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    render(<VaultChatbot sharedSocket={sharedSocket} />)

    await user.click(await screen.findByRole('button', { name: /select vault file case-1\.md/i }))
    await user.type(screen.getByPlaceholderText(/ask across selected evidence/i), 'What changed?')
    await user.click(screen.getByRole('button', { name: /interrogate/i }))

    expect(sharedSocket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'CHAT_RAG',
        payload: {
          query: 'What changed?',
          files: ['/vault/case-1.md'],
        },
      }),
    )
  })

  it('builds ready questions from the active investigation context', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => [],
      }),
    )
    const sharedSocket = {
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    render(
      <VaultChatbot
        sharedSocket={sharedSocket}
        investigationContext={{
          investigationId: 'inv-rivergate',
          title: 'Rivergate Cooling Contract',
          summary: 'Briarline Cooling Cooperative and Northgate Substation A-17 recur across permit and operator evidence.',
          hasTheoryReport: true,
          evidenceCount: 2,
          relationshipCount: 1,
          relationshipLabels: ['Pressure Point'],
          evidence: [
            {
              id: 'node-contract',
              title: 'Rivergate cooling contract',
              summary: 'Briarline Cooling Cooperative names Northgate Substation A-17 as the load constraint.',
            },
            {
              id: 'node-note',
              title: 'Operator note',
              summary: 'Northgate Substation A-17 shows a transformer warning after the Briarline dispatch.',
            },
          ],
          discoveries: [
            {
              title: 'Cooling cooperative overlap',
              claim: 'Briarline and Northgate appear in both evidence cards.',
              impact: 'The shared entities suggest a concrete infrastructure pressure point.',
            },
          ],
        }}
      />,
    )

    const entityQuestion = await screen.findByRole('button', {
      name: /Briarline Cooling Cooperative.*Northgate Substation A-17/i,
    })

    expect(entityQuestion).toHaveTextContent(/Rivergate Cooling Contract/i)
    expect(screen.getByRole('button', { name: /Pressure Point/i })).toBeInTheDocument()

    await user.click(entityQuestion)

    expect(screen.getByPlaceholderText(/select vault evidence/i)).toHaveValue(entityQuestion.textContent)
    expect(sharedSocket.send).not.toHaveBeenCalled()
  })

  it('hides QA ready question loader on normal investigations', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => [],
      }),
    )
    const sharedSocket = {
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    render(
      <VaultChatbot
        sharedSocket={sharedSocket}
        investigationContext={{
          investigationId: 'inv-rivergate',
          title: 'Rivergate Cooling Contract',
          summary: 'Briarline Cooling Cooperative and Northgate Substation A-17 recur across permit and operator evidence.',
        }}
      />,
    )

    expect(screen.queryByRole('button', { name: /load qa ready questions/i })).not.toBeInTheDocument()
  })

  it('loads QA ready questions only on the QA investigation without backend messages', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => [],
      }),
    )
    const sharedSocket = {
      send: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as WebSocket

    render(
      <VaultChatbot
        sharedSocket={sharedSocket}
        investigationContext={{
          investigationId: VAULT_READY_QUESTIONS_QA_INVESTIGATION_ID,
          title: 'QA Ready Questions',
          summary: 'Dedicated QA case for ready-question behavior.',
        }}
      />,
    )

    await user.click(await screen.findByRole('button', { name: /load qa ready questions/i }))

    expect(screen.getAllByRole('button', { name: /Briarline Cooling Cooperative/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: /Northgate Substation A-17/i }).length).toBeGreaterThan(0)
    expect(sharedSocket.send).not.toHaveBeenCalled()
  })
})
