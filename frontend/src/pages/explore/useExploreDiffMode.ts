import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import type { Location, NavigateFunction } from 'react-router-dom'
import { api } from '../../api/client'
import type { ZUICanvasHandle } from '../../components/ZUI'
import {
  buildExploreDiffLens,
  type ExploreDiffDetail,
  type ExploreDiffLens,
  type ExploreDiffTarget,
} from '../../utils/exploreDiffLens'
import type { ExploreData } from '../../types'
import { getSourceEditor } from '../../utils/sourceEditor'
import { toast } from '../../utils/toast'

export interface ExploreDiffModeState {
  diffVersionId: number
  diffLens: ExploreDiffLens | null
  diffLoading: boolean
  activeDiffTarget: ExploreDiffTarget | null
  activeDiffTargetIndex: number
  navigateDiffTarget: (offset: number) => void
  exitDiffMode: () => void
  openDiffSource: (detail: ExploreDiffDetail) => void
}

export function getExploreDiffVersionId(search: string, sharedToken?: string): number {
  if (sharedToken) return 0
  const value = Number(new URLSearchParams(search).get('diffVersion') ?? 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function useExploreDiffMode({
  data,
  sharedToken,
  location,
  navigate,
  canvasReady,
  zuiRef,
}: {
  data: ExploreData | null
  sharedToken?: string
  location: Location
  navigate: NavigateFunction
  canvasReady: boolean
  zuiRef: RefObject<ZUICanvasHandle | null>
}): ExploreDiffModeState {
  const diffVersionId = useMemo(() => getExploreDiffVersionId(location.search, sharedToken), [location.search, sharedToken])
  const [diffLens, setDiffLens] = useState<ExploreDiffLens | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [activeDiffTargetIndex, setActiveDiffTargetIndex] = useState(0)

  useEffect(() => {
    if (!data || !diffVersionId) {
      setDiffLens(null)
      setDiffLoading(false)
      setActiveDiffTargetIndex(0)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    api.watch.diffs(diffVersionId)
      .then((diffs) => {
        if (cancelled) return
        setDiffLens(buildExploreDiffLens(data, diffs, diffVersionId))
        setActiveDiffTargetIndex(0)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDiffLens(null)
        toast({
          title: 'Could not load diff map',
          description: error instanceof Error ? error.message : 'The selected watch diff could not be loaded.',
          status: 'error',
        })
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false)
      })
    return () => { cancelled = true }
  }, [data, diffVersionId])

  const activeDiffTarget = diffLens?.orderedTargets[activeDiffTargetIndex] ?? null

  const focusDiffTarget = useCallback((target: ExploreDiffTarget | null | undefined) => {
    if (!target?.viewId) return false
    if (target.resourceType === 'element' && target.resourceId) {
      return zuiRef.current?.focusElement(target.viewId, target.resourceId) ?? false
    }
    return zuiRef.current?.focusDiagram(target.viewId) ?? false
  }, [zuiRef])

  useEffect(() => {
    if (!canvasReady || !activeDiffTarget) return
    const timer = window.setTimeout(() => {
      focusDiffTarget(activeDiffTarget)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeDiffTarget, canvasReady, focusDiffTarget])

  const navigateDiffTarget = useCallback((offset: number) => {
    const count = diffLens?.orderedTargets.length ?? 0
    if (count === 0) return
    setActiveDiffTargetIndex((index) => (index + offset + count) % count)
  }, [diffLens])

  const exitDiffMode = useCallback(() => {
    const params = new URLSearchParams(location.search)
    params.set('view', 'explore')
    params.delete('diffVersion')
    params.delete('focus')
    params.delete('element')
    const suffix = params.toString()
    navigate(`${location.pathname}${suffix ? `?${suffix}` : ''}`, { replace: true })
  }, [location.pathname, location.search, navigate])

  const openDiffSource = useCallback((detail: ExploreDiffDetail) => {
    if (!detail.sourcePath) return
    api.editor.open({
      editor: getSourceEditor(),
      file_path: detail.sourcePath,
      line: detail.line ?? null,
    }).catch((error: unknown) => {
      toast({
        title: 'Could not open source',
        description: error instanceof Error ? error.message : 'The source editor command failed.',
        status: 'error',
      })
    })
  }, [])

  return {
    diffVersionId,
    diffLens,
    diffLoading,
    activeDiffTarget,
    activeDiffTargetIndex,
    navigateDiffTarget,
    exitDiffMode,
    openDiffSource,
  }
}
