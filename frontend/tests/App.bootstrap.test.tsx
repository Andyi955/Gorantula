import { vi } from 'vitest'

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock('react-dom/client', () => ({
  createRoot: createRootMock,
}))

vi.mock('../src/App.tsx', () => ({
  default: () => <div>App</div>,
}))

describe('main bootstrap', () => {
  it('mounts the app into the root element', async () => {
    document.body.innerHTML = '<div id="root"></div>'

    await import('../src/main.tsx')

    expect(createRootMock).toHaveBeenCalled()
    expect(renderMock).toHaveBeenCalled()
  })
})
