import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react'
import type { CrossBranchContextSettings } from '../../crossBranch/types'
import type { WorkspaceVersionFollowTarget, WorkspaceVersionPreview } from '../../context/WorkspaceVersionContext'
import type { ExploreDiffLens } from '../../utils/exploreDiffLens'
import {
  drawVisibleDirectProxyBadges,
  drawVisibleProxyConnectors,
  type VisibleNodeAnchor,
} from './proxy'
import {
  getCameraRebase,
  getExpandThresholds,
  updateScene,
  type ZUITransitionRebase,
} from './layoutEngine'
import {
  renderFrame,
  setHighlightColor as setRendererHighlightColor,
  setHighlightedTags as setRendererHighlightedTags,
  setHiddenTags as setRendererHiddenTags,
  setOnImageLoadCallback,
  setVersionDiff as setRendererVersionDiff,
  getThemeVars,
  type RenderContext,
} from './renderer'
import { buildSceneGraph, type SceneGraph } from './sceneGraph'
import type { ZUILayout, ZUIViewState } from './types'
import type { ZUIProxyConnectorState } from './useZUIProxyConnectors'

export interface ZUIRenderInvalidator {
  invalidate: () => void
}

function rebaseVisibleNodeAnchors(
  anchors: Map<string, VisibleNodeAnchor>,
  originX: number,
  originY: number,
): Map<string, VisibleNodeAnchor> {
  const rebased = new Map<string, VisibleNodeAnchor>()
  for (const [nodeId, anchor] of anchors) {
    rebased.set(nodeId, {
      ...anchor,
      worldX: anchor.worldX - originX,
      worldY: anchor.worldY - originY,
    })
  }
  return rebased
}

interface UseZUIRenderLoopArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>
  containerRef: RefObject<HTMLDivElement | null>
  initialized: boolean
  setInitialized: Dispatch<SetStateAction<boolean>>
  setContainerSize: Dispatch<SetStateAction<{ w: number; h: number }>>
  fitInitialView: (w: number, h: number) => void
  onReady?: () => void
  layout: ZUILayout
  viewState: ZUIViewState
  viewStateRef: MutableRefObject<ZUIViewState>
  crossBranchSettings: CrossBranchContextSettings
  proxyState: ZUIProxyConnectorState
  highlightedTags?: string[]
  highlightColor?: string
  hiddenTags?: string[]
  versionPreview?: WorkspaceVersionPreview | null
  versionFollowTarget?: WorkspaceVersionFollowTarget | null
  diffLens?: ExploreDiffLens | null
}

export function useZUIRenderLoop({
  canvasRef,
  containerRef,
  initialized,
  setInitialized,
  setContainerSize,
  fitInitialView,
  onReady,
  layout,
  viewState,
  viewStateRef,
  crossBranchSettings,
  proxyState,
  highlightedTags,
  highlightColor,
  hiddenTags,
  versionPreview,
  versionFollowTarget,
  diffLens,
}: UseZUIRenderLoopArgs): ZUIRenderInvalidator {
  const needsRedrawRef = useRef(true)
  const labelBgRef = useRef('#171923')
  const accentRef = useRef('#63b3ed')
  const proxyStateRef = useRef(proxyState)
  proxyStateRef.current = proxyState
  const sceneGraphRef = useRef<SceneGraph | null>(null)
  const transitionRebaseRef = useRef<ZUITransitionRebase>({ preserveChildAlphaNodeIds: new Set() })

  const invalidate = useCallback(() => {
    needsRedrawRef.current = true
  }, [])

  useEffect(() => {
    const update = () => {
      const styles = getComputedStyle(document.documentElement)
      labelBgRef.current = styles.getPropertyValue('--chakra-colors-gray-900').trim() || '#171923'
      accentRef.current = styles.getPropertyValue('--accent').trim() || '#63b3ed'
      invalidate()
    }
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => mo.disconnect()
  }, [invalidate])

  useEffect(() => {
    setOnImageLoadCallback(invalidate)
    return () => setOnImageLoadCallback(null)
  }, [invalidate])

  useEffect(invalidate, [invalidate, viewState, crossBranchSettings])

  useEffect(() => {
    sceneGraphRef.current = buildSceneGraph(layout)
    invalidate()
  }, [layout, invalidate])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    function resize() {
      if (!canvas || !container) return
      const dpr = window.devicePixelRatio || 1
      const w = container.offsetWidth
      const h = container.offsetHeight
      if (w === 0 || h === 0) return

      setContainerSize({ w, h })
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      invalidate()

      if (!initialized && w > 0 && h > 0) {
        fitInitialView(w, h)
        setInitialized(true)
        onReady?.()
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()
    return () => ro.disconnect()
  }, [canvasRef, containerRef, fitInitialView, initialized, invalidate, onReady, setContainerSize, setInitialized])

  useEffect(() => {
    if (!initialized) return

    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    let rafId: number
    let lastView = { x: NaN, y: NaN, zoom: NaN }

    function frame() {
      const ctx = canvas!.getContext('2d')
      if (!ctx) { rafId = requestAnimationFrame(frame); return }

      const dpr = window.devicePixelRatio || 1
      const w = container!.offsetWidth
      const h = container!.offsetHeight
      if (w === 0 || h === 0) { rafId = requestAnimationFrame(frame); return }

      const currentView = viewStateRef.current
      const graph = sceneGraphRef.current
      if (!graph) { rafId = requestAnimationFrame(frame); return }

      const changed =
        lastView.x !== currentView.x ||
        lastView.y !== currentView.y ||
        lastView.zoom !== currentView.zoom ||
        needsRedrawRef.current

      if (changed) {
        const thresholds = getExpandThresholds(w)

        transitionRebaseRef.current = updateScene(graph, currentView, w, h, thresholds)

        ctx.save()
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

        const theme = getThemeVars()
        const renderCtx: RenderContext = {
          canvasBg: theme.canvasBg,
          nodeBg: theme.nodeBg,
          accent: theme.accent,
          labelBg: theme.labelBg,
          canvasW: w,
          canvasH: h,
          thresholds,
        }

        const occupiedLabelRects = renderFrame(ctx, graph, renderCtx, currentView, transitionRebaseRef.current)

        const cameraRebase = getCameraRebase(currentView, w, h)
        const rebasedProxyAnchors = rebaseVisibleNodeAnchors(
          proxyStateRef.current.byNodeId,
          cameraRebase.originX,
          cameraRebase.originY,
        )
        ctx.save()
        ctx.translate(cameraRebase.view.x, cameraRebase.view.y)
        ctx.scale(cameraRebase.view.zoom, cameraRebase.view.zoom)
        drawVisibleProxyConnectors(
          ctx,
          proxyStateRef.current.proxyConnectors,
          rebasedProxyAnchors,
          cameraRebase.view.zoom,
          labelBgRef.current,
          accentRef.current,
          occupiedLabelRects,
        )
        drawVisibleDirectProxyBadges(
          ctx,
          proxyStateRef.current.hiddenProxyBadges,
          rebasedProxyAnchors,
          cameraRebase.view.zoom,
          labelBgRef.current,
          occupiedLabelRects,
        )
        ctx.restore()
        ctx.restore()
        lastView = currentView
        needsRedrawRef.current = false
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [canvasRef, containerRef, initialized, viewStateRef])

  useEffect(() => {
    if (initialized) invalidate()
  }, [initialized, invalidate, layout])

  useEffect(() => {
    setRendererHighlightedTags(new Set(highlightedTags ?? []))
    setRendererHighlightColor(highlightColor ?? '')
    invalidate()
  }, [highlightedTags, highlightColor, invalidate])

  useEffect(() => {
    setRendererHiddenTags(new Set(hiddenTags ?? []))
    invalidate()
  }, [hiddenTags, invalidate])

  useEffect(() => {
    if (diffLens) {
      setRendererVersionDiff(
        diffLens.elementChanges,
        diffLens.connectorChanges,
        diffLens.elementLineDeltas,
        diffLens.contextElementIds,
        diffLens.contextConnectorIds,
        true,
      )
      invalidate()
      return
    }
    const pulsedElementChanges = new Map<number, string>()
    const pulsedElementLineDeltas = new Map<number, { added: number; removed: number }>()
    if (versionFollowTarget?.resourceType === 'element' && versionFollowTarget.resourceId) {
      const change = versionFollowTarget.changeType ?? versionPreview?.elementChanges.get(versionFollowTarget.resourceId)
      if (change) pulsedElementChanges.set(versionFollowTarget.resourceId, change)
    }
    setRendererVersionDiff(
      pulsedElementChanges,
      versionPreview?.connectorChanges ?? new Map(),
      versionPreview?.elementLineDeltas ?? pulsedElementLineDeltas,
    )
    invalidate()
  }, [diffLens, invalidate, versionPreview, versionFollowTarget])

  useEffect(() => {
    return () => {
      setRendererHighlightedTags(new Set())
      setRendererHighlightColor('')
      setRendererHiddenTags(new Set())
      setRendererVersionDiff(new Map(), new Map())
    }
  }, [])

  return { invalidate }
}
