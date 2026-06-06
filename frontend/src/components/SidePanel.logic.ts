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
  view: string;
  isExternal: boolean;
}

export type SortCol = 'Direction' | 'Target' | 'Type' | 'View';

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
