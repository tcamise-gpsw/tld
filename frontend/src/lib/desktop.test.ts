import { beforeEach, describe, expect, it, vi } from 'vitest'

function installWindow(overrides: Record<string, unknown> = {}) {
  const open = vi.fn()
  const body = {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'http://localhost:5173/views/1' },
      open,
      ...overrides,
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: vi.fn(() => ({ click: vi.fn(), href: '', download: '' })),
      body,
    },
  })
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:test'),
  })
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  return { open, body }
}

describe('desktop helpers', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('opens external urls through window.open in browser mode', async () => {
    const { open } = installWindow()
    const { openExternalUrl } = await import('./desktop')

    openExternalUrl('https://example.com/docs')

    expect(open).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer')
  })

  it('opens external urls through Wails runtime in desktop mode', async () => {
    const browserOpen = vi.fn()
    installWindow({ __TLD_APP__: true, runtime: { BrowserOpenURL: browserOpen } })
    const { openExternalUrl } = await import('./desktop')

    openExternalUrl('https://example.com/docs')

    expect(browserOpen).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('saves blobs through the desktop bridge in Wails mode', async () => {
    const saveFile = vi.fn().mockResolvedValue({ path: '/tmp/diagram.mmd', canceled: false })
    installWindow({ __TLD_APP__: true, go: { main: { DesktopBridge: { SaveFile: saveFile } } } })
    const { saveBlobAs } = await import('./desktop')

    const result = await saveBlobAs(new Blob(['flowchart LR']), 'diagram.mmd', [
      { displayName: 'Mermaid Files (*.mmd)', pattern: '*.mmd' },
    ])

    expect(result).toEqual({ path: '/tmp/diagram.mmd', canceled: false })
    expect(saveFile).toHaveBeenCalledWith(
      'diagram.mmd',
      [{ displayName: 'Mermaid Files (*.mmd)', pattern: '*.mmd' }],
      'Zmxvd2NoYXJ0IExS',
    )
  })

  it('returns canceled open results from the desktop bridge', async () => {
    const openText = vi.fn().mockResolvedValue({ path: '', content: '', canceled: true })
    installWindow({ __TLD_APP__: true, go: { main: { DesktopBridge: { OpenTextFile: openText } } } })
    const { openTextFile } = await import('./desktop')

    await expect(openTextFile()).resolves.toEqual({ path: '', content: '', canceled: true })
  })
})
