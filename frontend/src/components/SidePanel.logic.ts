import { DiagramData, Connector } from '../data/types';
import { getNodeConnectors, isExternalToView } from '../data/loader';

export interface ConnectorRow {
  id: string;
  direction: 'Inbound' | 'Outbound';
  target: string;
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
  const nodeConnectors = getNodeConnectors(data, selectedNode);
  const rows: ConnectorRow[] = [];
  let inCount = 0;
  let outCount = 0;

  for (const conn of nodeConnectors) {
    const isExternal = isExternalToView(conn, currentView, data);
    const isOutgoing = conn.source === selectedNode;
    const otherRef = isOutgoing ? conn.target : conn.source;
    const otherElem = data.elements.get(otherRef);

    if (isOutgoing) outCount++;
    else inCount++;

    rows.push({
      id: conn.id || `${conn.source}-${conn.target}`,
      direction: isOutgoing ? 'Outbound' : 'Inbound',
      target: otherElem?.name || otherRef,
      type: conn.relationship || conn.style || '',
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
