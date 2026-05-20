import { useState, useEffect, useRef } from 'react'
import type { Node } from 'reactflow'

const NODE_W = 200
const NODE_H = 120
const MIN_OVERLAP_PERCENT = 0.5
const STORAGE_KEY = 'diag:overlapSuggestionDismissed'

export function useOverlapDetection(nodes: Node[], viewId: number | null) {
  const [hasSignificantOverlaps, setHasSignificantOverlaps] = useState(false)
  const [isDismissed, setIsDismissed] = useState(false)
  
  // Track which viewId we've already scanned for this session/load
  const scannedViewIdRef = useRef<number | null>(null)

  useEffect(() => {
    // Reset if we move to a view we haven't scanned or if viewId becomes null
    if (viewId === null) {
      setHasSignificantOverlaps(false)
      setIsDismissed(false)
      scannedViewIdRef.current = null
      return
    }

    const dismissed = localStorage.getItem(`${STORAGE_KEY}:${viewId}`) === 'true'
    setIsDismissed(dismissed)

    // If already dismissed for this view, or we already scanned this view in this session, skip
    if (dismissed || scannedViewIdRef.current === viewId) {
      if (dismissed) setHasSignificantOverlaps(false)
      return
    }

    // Only scan when we actually have nodes (data is hydrated)
    if (nodes.length >= 2) {
      const rects = nodes.map(n => ({
        id: n.id,
        x1: n.position.x,
        y1: n.position.y,
        x2: n.position.x + (n.width ?? NODE_W),
        y2: n.position.y + (n.height ?? NODE_H),
        area: (n.width ?? NODE_W) * (n.height ?? NODE_H)
      }))

      const overlappingElements = new Set<string>()

      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]
          const b = rects[j]

          const ix1 = Math.max(a.x1, b.x1)
          const iy1 = Math.max(a.y1, b.y1)
          const ix2 = Math.min(a.x2, b.x2)
          const iy2 = Math.min(a.y2, b.y2)

          const iw = Math.max(0, ix2 - ix1)
          const ih = Math.max(0, iy2 - iy1)
          const overlapArea = iw * ih

          if (overlapArea > 0) {
            if (overlapArea >= a.area * MIN_OVERLAP_PERCENT || overlapArea >= b.area * MIN_OVERLAP_PERCENT) {
              overlappingElements.add(a.id)
              overlappingElements.add(b.id)
            }
          }
        }
      }

      if (overlappingElements.size > 2) {
        setHasSignificantOverlaps(true)
      } else {
        setHasSignificantOverlaps(false)
      }
      
      // Mark as scanned so it doesn't re-run during drags/edits
      scannedViewIdRef.current = viewId
    }
  }, [viewId, nodes]) // nodes is needed to catch the first hydration

  const dismiss = () => {
    if (viewId !== null) {
      localStorage.setItem(`${STORAGE_KEY}:${viewId}`, 'true')
      setIsDismissed(true)
      setHasSignificantOverlaps(false)
    }
  }

  return { hasSignificantOverlaps: hasSignificantOverlaps && !isDismissed, dismiss }
}
