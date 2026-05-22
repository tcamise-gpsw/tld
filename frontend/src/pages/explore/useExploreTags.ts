import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { api } from '../../api/client'
import type { ExploreData, Tag, ViewLayer } from '../../types'

export interface ExploreTagsState {
  allTags: string[]
  tagCounts: Record<string, number>
  tagColors: Record<string, Tag>
  layers: ViewLayer[]
  layerElementCounts: Record<number, number>
  highlightedTags: string[]
  setHighlightedTags: Dispatch<SetStateAction<string[]>>
  highlightColor: string
  setHighlightColor: Dispatch<SetStateAction<string>>
  hiddenTags: string[]
  toggleLayerVisibility: (layer: ViewLayer) => void
  toggleTagVisibility: (tag: string) => void
}

export function deriveExploreTagMetrics(data: ExploreData | null, layers: ViewLayer[]): {
  allTags: string[]
  tagCounts: Record<string, number>
  layerElementCounts: Record<number, number>
} {
  if (!data || !data.views) {
    return { allTags: [], tagCounts: {}, layerElementCounts: {} }
  }

  const tagSet = new Set<string>()
  const tagCounts: Record<string, number> = {}
  Object.values(data.views).forEach((view) => {
    (view?.placements ?? []).forEach((placement) => {
      (placement.tags ?? []).forEach((tag) => {
        tagSet.add(tag)
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
      })
    })
  })

  const layerElementCounts: Record<number, number> = {}
  for (const layer of layers) {
    let count = 0
    Object.values(data.views).forEach((view) => {
      (view?.placements ?? []).forEach((placement) => {
        if ((placement.tags ?? []).some((tag) => layer.tags.includes(tag))) count++
      })
    })
    layerElementCounts[layer.id] = count
  }

  return {
    allTags: Array.from(tagSet).sort(),
    tagCounts,
    layerElementCounts,
  }
}

export function useExploreTags(data: ExploreData | null, sharedToken?: string): ExploreTagsState {
  const [tagColors] = useState<Record<string, Tag>>({})
  const [layers, setLayers] = useState<ViewLayer[]>([])
  const [highlightedTags, setHighlightedTags] = useState<string[]>([])
  const [highlightColor, setHighlightColor] = useState('')
  const [hiddenTags, setHiddenTags] = useState<string[]>([])

  useEffect(() => {
    if (!data || sharedToken) return
    let cancelled = false
    const rootIds = (data.tree ?? []).map((node) => node.id)
    const fetchTagData = async () => {
      try {
        const diagramLayers = await Promise.all(
          rootIds.map((id) => api.workspace.views.layers.list(id)),
        )
        if (!cancelled) {
          // Layers are fetched from root diagrams only; dedupe protects the UI if an API response overlaps.
          const seen = new Set<number>()
          const unique = diagramLayers.flat().filter((layer) => seen.has(layer.id) ? false : (seen.add(layer.id), true))
          setLayers(unique)
        }
      } catch {
        // Public shared pages do not expose layer metadata.
      }
    }
    void fetchTagData()
    return () => { cancelled = true }
  }, [data, sharedToken])

  const metrics = useMemo(() => deriveExploreTagMetrics(data, layers), [data, layers])

  const toggleLayerVisibility = useCallback((layer: ViewLayer) => {
    if (layer.tags.length === 0) return
    setHiddenTags((prev) => {
      const allHidden = layer.tags.every((tag) => prev.includes(tag))
      return allHidden
        ? prev.filter((tag) => !layer.tags.includes(tag))
        : Array.from(new Set([...prev, ...layer.tags]))
    })
  }, [])

  const toggleTagVisibility = useCallback((tag: string) => {
    setHiddenTags((prev) => prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag])
  }, [])

  return {
    ...metrics,
    tagColors,
    layers,
    highlightedTags,
    setHighlightedTags,
    highlightColor,
    setHighlightColor,
    hiddenTags,
    toggleLayerVisibility,
    toggleTagVisibility,
  }
}
