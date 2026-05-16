/**
 * VS Code webview transport.
 *
 * Uses the local tld CLI HTTP server URL injected by the extension host.
 */
import { createConnectTransport } from '@connectrpc/connect-web'

declare global {
  interface Window {
    __TLD_SERVER_URL__?: string
    __TLD_DIAGRAM_ID__?: number
  }
}

const serverUrl = (window.__TLD_SERVER_URL__ ?? 'http://127.0.0.1:8060').replace(/\/$/, '')

export const transport = createConnectTransport({
  baseUrl: `${serverUrl}/api`,
  fetch: (input, init) => fetch(input, init),
})
