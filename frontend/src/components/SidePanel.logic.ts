import { DiagramData } from '../data/types';
import { getDescendantRefs } from '../data/loader';

const RELATIONSHIP_VERBS: Record<string, string> = {
  dependency: 'depends on',
  inheritance: 'inherits',
};

export interface ConnectorRow {
  id: string;
  direction: 'Inbound' | 'Outbound';
  target: string;
  targetRef: string;
  targetHasView: boolean;
  type: string;
  module: string;
  view: string;
  isExternal: boolean;
}

export type SortCol = 'Direction' | 'Target' | 'Type' | 'Module' | 'View';

/**
 * Walk up placements from `elementRef` to find the direct child of root
 * that contains (or is) the element. Returns the name of that top-level node.
 */
function resolveTopLevelModule(data: DiagramData, elementRef: string): string {
  let current = elementRef;
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);
    const elem = data.elements.get(current);
    if (!elem) return elementRef;

    const parentRef = elem.placements[0]?.parent ?? 'root';
    if (parentRef === 'root') {
      return elem.name;
    }
    current = parentRef;
  }
  return elementRef; // cycle guard
}

export function resolveConnectors(
  data: DiagramData,
  selectedNode: string,
  currentView: string
): { connectors: ConnectorRow[], inboundCount: number, outboundCount: number } {
  // Build the set of refs that belong to this node (itself + all descendants).
  // For leaf nodes the set is just {selectedNode}, so behaviour is unchanged.
  const descendants = getDescendantRefs(data, selectedNode);
  const memberRefs = new Set<string>([selectedNode, ...descendants]);

  // Build view membership set: the current view + all its descendants.
  // A connector is "external" when the other endpoint is outside this set.
  const viewDescendants = getDescendantRefs(data, currentView);
  const viewMembers = new Set<string>([currentView, ...viewDescendants]);

  const rows: ConnectorRow[] = [];
  let inCount = 0;
  let outCount = 0;

  for (const conn of data.connectors) {
    const sourceInside = memberRefs.has(conn.source);
    const targetInside = memberRefs.has(conn.target);

    // Only include connectors that cross the boundary of this node/group.
    // Both inside = internal wiring, skip. Neither inside = unrelated, skip.
    if (sourceInside === targetInside) continue;

    const isOutgoing = sourceInside;
    const otherRef = isOutgoing ? conn.target : conn.source;
    const otherElem = data.elements.get(otherRef);

    // External = the other endpoint is not within the current view's subtree.
    const isExternal = !viewMembers.has(otherRef);

    if (isOutgoing) outCount++;
    else inCount++;

    rows.push({
      id: conn.id || `${conn.source}-${conn.target}`,
      direction: isOutgoing ? 'Outbound' : 'Inbound',
      target: otherElem?.name || otherRef,
      targetRef: otherRef,
      targetHasView: otherElem?.has_view ?? false,
      type: conn.relationship || conn.label || '',
      module: resolveTopLevelModule(data, otherRef),
      view: conn.view,
      isExternal,
    });
  }

  return { connectors: rows, inboundCount: inCount, outboundCount: outCount };
}

export function sortConnectors(
  connectors: ConnectorRow[],
  sortCol: SortCol,
  sortDesc: boolean
): ConnectorRow[] {
  return [...connectors].sort((a, b) => {
    let aVal = '';
    let bVal = '';
    switch (sortCol) {
      case 'Direction':
        aVal = a.direction;
        bVal = b.direction;
        break;
      case 'Target':
        aVal = a.target.toLowerCase();
        bVal = b.target.toLowerCase();
        break;
      case 'Type':
        aVal = a.type.toLowerCase();
        bVal = b.type.toLowerCase();
        break;
      case 'Module':
        aVal = a.module.toLowerCase();
        bVal = b.module.toLowerCase();
        break;
      case 'View':
        aVal = a.view.toLowerCase();
        bVal = b.view.toLowerCase();
        break;
    }
    if (aVal < bVal) return sortDesc ? 1 : -1;
    if (aVal > bVal) return sortDesc ? -1 : 1;
    return 0;
  });
}
