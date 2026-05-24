import type { Connector, LibraryElement, ViewTreeNode } from '../../types'
import type { InventoryRow } from '../../pages/inventoryData'

export interface NeighbourNode {
  element: LibraryElement
  connectors: Connector[]
  position: 'left' | 'right' | 'top' | 'bottom'
}

export interface RelationshipDrawerProps {
  selectedRow: InventoryRow | null
  elements: LibraryElement[]
  views: ViewTreeNode[]
  connectors: Connector[]
  placementByViewElement: Record<string, { x: number; y: number }>
  onSelectRow: (key: string) => void
}
