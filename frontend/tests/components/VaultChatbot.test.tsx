import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VaultChatbot from '../../src/components/VaultChatbot'

describe('VaultChatbot', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

    await user.click(screen.getByRole('button', { name: /files selected for context/i }))
    await user.click(await screen.findByText('case-1.md'))
    await user.type(screen.getByPlaceholderText(/ask a question mapping the selected intelligence/i), 'What changed?')
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
})
