import { beforeEach, describe, expect, it, vi } from 'vitest'

function installWindow(overrides: Record<string, unknown> = {}) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'https://app.example.com/views/1' },
      ...overrides,
    },
  })
}

describe('watchWebSocketUrl', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('resolves from the browser location outside Wails', async () => {
    installWindow()
    const { watchWebSocketUrl } = await import('./client')

    expect(watchWebSocketUrl()).toBe('wss://app.example.com/api/watch/ws')
  })

  it('resolves from the injected server URL in Wails', async () => {
    installWindow({ __TLD_APP__: true, __TLD_SERVER_URL__: 'http://127.0.0.1:9123' })
    const { watchWebSocketUrl } = await import('./client')

    expect(watchWebSocketUrl()).toBe('ws://127.0.0.1:9123/api/watch/ws')
  })

  it('fails in Wails when the injected server URL is missing', async () => {
    installWindow({ __TLD_APP__: true })
    const { watchWebSocketUrl } = await import('./client')

    expect(() => watchWebSocketUrl()).toThrow('Desktop server URL is not configured')
  })
})
