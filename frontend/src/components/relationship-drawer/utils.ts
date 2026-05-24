import type { Connector, LibraryElement } from '../../types'
import type { NeighbourNode } from './types'

export function getNeighbourGraph(
  selectedId: number,
  elements: LibraryElement[],
  allConnectors: Connector[],
): NeighbourNode[] {
  const elementMap = new Map<number, LibraryElement>(elements.map((element) => [element.id, element]))
  const related = allConnectors.filter(
    (connector) => connector.source_element_id === selectedId || connector.target_element_id === selectedId,
  )
  const grouped = new Map<number, Connector[]>()
  related.forEach((connector) => {
    const otherId = connector.source_element_id === selectedId ? connector.target_element_id : connector.source_element_id
    if (!grouped.has(otherId)) grouped.set(otherId, [])
    grouped.get(otherId)!.push(connector)
  })

  const result: NeighbourNode[] = []
  grouped.forEach((connectors, otherId) => {
    const element = elementMap.get(otherId)
    if (!element) return

    let hasIncoming = false
    let hasOutgoing = false
    let hasBoth = false
    let hasUndirected = false

    connectors.forEach((connector) => {
      const dir = connector.direction || 'forward'
      if (dir === 'both' || dir === 'bidirectional') hasBoth = true
      else if (dir === 'none') hasUndirected = true
      else if (dir === 'forward') {
        if (connector.source_element_id === selectedId) hasOutgoing = true
        else hasIncoming = true
      } else if (dir === 'backward') {
        if (connector.source_element_id === selectedId) hasIncoming = true
        else hasOutgoing = true
      }
    })

    let position: NeighbourNode['position']
    if (hasBoth) position = 'top'
    else if (hasUndirected) position = 'bottom'
    else if (hasIncoming && hasOutgoing) position = 'top'
    else if (hasIncoming) position = 'left'
    else position = 'right'

    result.push({ element, connectors, position })
  })

  return result
}

export function chunkNodes(nodes: NeighbourNode[], size = 20): NeighbourNode[][] {
  if (nodes.length <= size) return [nodes]

  const chunks: NeighbourNode[][] = []
  for (let index = 0; index < nodes.length; index += size) {
    chunks.push(nodes.slice(index, index + size))
  }
  return chunks
}

export function toCompactLevel(pxPerSlot: number) {
  return pxPerSlot > 160 ? 0 : pxPerSlot > 110 ? 1 : pxPerSlot > 70 ? 2 : 3
}
