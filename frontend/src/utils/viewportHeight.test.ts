import { describe, expect, it, vi } from "vitest"
import { APP_VIEWPORT_HEIGHT_CSS_VAR, getAppViewportHeight, installAppViewportHeight } from "./viewportHeight"

describe("viewportHeight", () => {
  it("prefers the visual viewport height when available", () => {
    expect(getAppViewportHeight({
      innerHeight: 900,
      visualViewport: { height: 744.9 },
    } as Window)).toBe(744)
  })

  it("falls back to innerHeight when visual viewport height is unavailable", () => {
    expect(getAppViewportHeight({
      innerHeight: 900,
      visualViewport: null,
    } as Window)).toBe(900)

    expect(getAppViewportHeight({
      innerHeight: 900,
      visualViewport: { height: 0 },
    } as Window)).toBe(900)
  })

  it("updates the root CSS variable on viewport changes", () => {
    const windowListeners = new Map<string, EventListener>()
    const visualViewportListeners = new Map<string, EventListener>()
    const setProperty = vi.fn()
    const cancelAnimationFrame = vi.fn()
    let pendingFrame: FrameRequestCallback | null = null

    const fakeWindow = {
      innerHeight: 900,
      document: {
        documentElement: {
          style: { setProperty },
        },
      },
      visualViewport: {
        height: 812,
        addEventListener: (type: string, listener: EventListener) => {
          visualViewportListeners.set(type, listener)
        },
        removeEventListener: (type: string) => {
          visualViewportListeners.delete(type)
        },
      },
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        pendingFrame = callback
        return 7
      },
      cancelAnimationFrame,
      addEventListener: (type: string, listener: EventListener) => {
        windowListeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        windowListeners.delete(type)
      },
    }

    const cleanup = installAppViewportHeight(fakeWindow as unknown as Window)
    expect(setProperty).toHaveBeenLastCalledWith(APP_VIEWPORT_HEIGHT_CSS_VAR, "812px")

    fakeWindow.visualViewport.height = 700
    visualViewportListeners.get("resize")?.(new Event("resize"))
    expect(setProperty).toHaveBeenCalledTimes(1)

    pendingFrame?.(0)
    expect(setProperty).toHaveBeenLastCalledWith(APP_VIEWPORT_HEIGHT_CSS_VAR, "700px")

    windowListeners.get("orientationchange")?.(new Event("orientationchange"))
    cleanup()
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7)
    expect(windowListeners.size).toBe(0)
    expect(visualViewportListeners.size).toBe(0)
  })
})
