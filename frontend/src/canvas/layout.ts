import * as dagre from 'dagre';
import { Element, Connector } from '../data/types';
import { NODE_WIDTH, NODE_HEIGHT } from '../theme';

export interface LayoutNode {
  ref: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isGroup: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
  points: { x: number; y: number }[];
  label?: string;
}

export interface ViewLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

const layoutCache = new Map<string, ViewLayout>();

export function computeLayout(elements: Element[], connectors: Connector[]): ViewLayout {
  if (elements.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 80, edgesep: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes (use ref as node ID, not name)
  for (const elem of elements) {
    g.setNode(elem.ref, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges (only between nodes that are both in this layout)
  const nodeRefSet = new Set(elements.map(e => e.ref));
  const connectorByEdge = new Map<string, Connector>();
  for (const conn of connectors) {
    if (nodeRefSet.has(conn.source) && nodeRefSet.has(conn.target)) {
      g.setEdge(conn.source, conn.target);
      connectorByEdge.set(`${conn.source}|${conn.target}`, conn);
    }
  }

  // Run layout
  dagre.layout(g);

  // Extract positioned nodes
  const nodes: LayoutNode[] = [];
  g.nodes().forEach((nodeId) => {
    const node = g.node(nodeId);
    const elem = elements.find((e) => e.ref === nodeId);
    if (elem) {
      nodes.push({
        ref: elem.ref,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        isGroup: elem.has_view,
      });
    }
  });

  // Extract edges with waypoints
  const edges: LayoutEdge[] = [];
  g.edges().forEach((edge) => {
    const edgeData = g.edge(edge);
    const conn = connectorByEdge.get(`${edge.v}|${edge.w}`);
    edges.push({
      source: edge.v,
      target: edge.w,
      points: edgeData.points || [],
      label: conn?.relationship || conn?.label || undefined,
    });
  });

  // Compute layout bounds
  let minX = nodes[0]?.x || 0;
  let maxX = nodes[0]?.x || 0;
  let minY = nodes[0]?.y || 0;
  let maxY = nodes[0]?.y || 0;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.width / 2);
    maxX = Math.max(maxX, node.x + node.width / 2);
    minY = Math.min(minY, node.y - node.height / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);

  return { nodes, edges, width, height };
}

export function getOrComputeLayout(viewRef: string, elements: Element[], connectors: Connector[]): ViewLayout {
  if (layoutCache.has(viewRef)) {
    return layoutCache.get(viewRef)!;
  }

  const layout = computeLayout(elements, connectors);
  layoutCache.set(viewRef, layout);
  return layout;
}

export function invalidateLayout(viewRef?: string): void {
  if (viewRef) {
    layoutCache.delete(viewRef);
  } else {
    layoutCache.clear();
  }
}
