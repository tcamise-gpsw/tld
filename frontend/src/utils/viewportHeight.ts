export const APP_VIEWPORT_HEIGHT_CSS_VAR = "--app-viewport-height"

type ViewportHeightSource = Pick<Window, "innerHeight"> & {
  visualViewport?: Pick<VisualViewport, "height"> | null
}

type ViewportHeightWindow = Pick<Window, "innerHeight" | "requestAnimationFrame" | "cancelAnimationFrame" | "addEventListener" | "removeEventListener"> & {
  document: Pick<Document, "documentElement">
  visualViewport?: (Pick<VisualViewport, "height" | "addEventListener" | "removeEventListener">) | null
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function getAppViewportHeight(win: ViewportHeightSource): number {
  const visualViewportHeight = win.visualViewport?.height
  const height = isPositiveFiniteNumber(visualViewportHeight) ? visualViewportHeight : win.innerHeight
  return Math.max(1, Math.floor(height))
}

export function installAppViewportHeight(win: ViewportHeightWindow = window): () => void {
  const root = win.document.documentElement
  let animationFrame: number | null = null

  const updateViewportHeight = () => {
    animationFrame = null
    root.style.setProperty(APP_VIEWPORT_HEIGHT_CSS_VAR, `${getAppViewportHeight(win)}px`)
  }

  const scheduleViewportHeightUpdate = () => {
    if (animationFrame !== null) return
    animationFrame = win.requestAnimationFrame(updateViewportHeight)
  }

  updateViewportHeight()

  win.addEventListener("resize", scheduleViewportHeightUpdate)
  win.addEventListener("orientationchange", scheduleViewportHeightUpdate)
  win.visualViewport?.addEventListener("resize", scheduleViewportHeightUpdate)
  win.visualViewport?.addEventListener("scroll", scheduleViewportHeightUpdate)

  return () => {
    if (animationFrame !== null) {
      win.cancelAnimationFrame(animationFrame)
    }
    win.removeEventListener("resize", scheduleViewportHeightUpdate)
    win.removeEventListener("orientationchange", scheduleViewportHeightUpdate)
    win.visualViewport?.removeEventListener("resize", scheduleViewportHeightUpdate)
    win.visualViewport?.removeEventListener("scroll", scheduleViewportHeightUpdate)
  }
}
