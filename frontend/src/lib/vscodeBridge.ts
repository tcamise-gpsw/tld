import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../types/vscode-messages'

declare global {
  interface Window {
    __TLD_VSCODE_API__?: {
      postMessage: (msg: unknown) => void
    }
  }
}

// Runtime-aware bridge. It is a no-op in web/native builds, but works when the
// core UI is bundled directly into the VS Code webview.
export const vscodeBridge = {
  postMessage: (msg: WebviewToExtensionMessage) => {
    window.__TLD_VSCODE_API__?.postMessage(msg)
  },
  onMessage: (handler: (msg: ExtensionToWebviewMessage) => void): (() => void) => {
    const listener = (event: MessageEvent) => {
      if (event.data && typeof event.data === 'object' && 'type' in event.data) {
        handler(event.data as ExtensionToWebviewMessage)
      }
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  },
}
