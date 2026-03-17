const mocks = vi.hoisted(() => ({
  toPng: vi.fn(),
  toSvg: vi.fn(),
  saveAs: vi.fn(),
}))

vi.mock('html-to-image', () => ({
  toPng: mocks.toPng,
  toSvg: mocks.toSvg,
}))

vi.mock('file-saver', () => ({
  saveAs: mocks.saveAs,
}))

vi.mock('jspdf', () => ({
  jsPDF: vi.fn(),
}))

import { exportAsPng, exportAsSvg } from '../../src/utils/ExportUtils'

describe('ExportUtils', () => {
  beforeEach(() => {
    mocks.toPng.mockReset()
    mocks.toSvg.mockReset()
    mocks.saveAs.mockReset()
    document.body.innerHTML = ''
  })

  it('does nothing when exporting PNG without a target element', async () => {
    await exportAsPng('missing')

    expect(mocks.toPng).not.toHaveBeenCalled()
    expect(mocks.saveAs).not.toHaveBeenCalled()
  })

  it('exports SVG when the target element exists', async () => {
    document.body.innerHTML = '<div id="board"></div>'
    mocks.toSvg.mockResolvedValue('data:image/svg+xml;base64,abc')

    await exportAsSvg('board')

    expect(mocks.toSvg).toHaveBeenCalled()
    expect(mocks.saveAs).toHaveBeenCalled()
  })
})
