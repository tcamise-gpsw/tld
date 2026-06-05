import { ViewLayout, LayoutNode, LayoutEdge } from './layout';
import { CameraState } from './camera';
import { ExternalStub } from './stubs';
import { Element } from '../data/types';
import * as theme from '../theme';

export interface RenderState {
  hoveredNode: string | null;
  selectedNode: string | null;
  showExternalStubs: boolean;
  highlightedExternalEdges: Set<string>;
}

// Re-export ExternalStub so existing consumers can import from renderer if needed
export type { ExternalStub } from './stubs';

const TEXT_ZOOM_THRESHOLD = 0.3;
const ARROWHEAD_SIZE = 8;
const CONNECTOR_WIDTH = 1.5;
const CONNECTOR_HIGHLIGHTED_WIDTH = 2.5;
const NODE_SELECTED_STROKE_WIDTH = 3;
const NODE_DEFAULT_STROKE_WIDTH = 1.5;

const STUB_LENGTH = 50;
const STUB_GAP = 6;
const STUB_HIGHLIGHTED_WIDTH = 2.5;
const STUB_DEFAULT_WIDTH = 1.5;

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  layout: ViewLayout,
  camera: CameraState,
  state: RenderState,
  elements: Map<string, Element>,
  dpr: number = 1,
  externalStubs: ExternalStub[] = []
): void {
  // Reset transform and clear canvas
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = theme.BG_COLOR;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  // Empty group: show centered message instead of blank canvas
  if (layout.nodes.length === 0 && layout.edges.length === 0) {
    ctx.fillStyle = theme.NODE_TEXT_SECONDARY;
    ctx.font = theme.FONT_PRIMARY;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No elements in this view', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  // Apply camera transform
  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.x, dpr * camera.y);

  // Draw connectors first (behind nodes)
  const layoutNodeRefs = new Set(layout.nodes.map(n => n.ref));
  drawConnectors(ctx, layout.edges, state, layoutNodeRefs);

  // Draw nodes on top
  drawNodes(ctx, layout.nodes, state, camera, elements, dpr);

  // Draw external stubs on top of nodes (filtering handled upstream in App)
  if (externalStubs.length > 0) {
    drawExternalStubs(ctx, externalStubs, state);
  }
}

/**
 * Convert viewport bounds to world coordinates for frustum culling.
 * The camera transform maps world → physical pixel as:
 *   physX = worldX * dpr * zoom + dpr * camera.x
 * Inverting: worldX = (physX - dpr * camera.x) / (dpr * zoom) = (physX/dpr - camera.x) / zoom
 */
export function isNodeVisible(
  node: LayoutNode,
  camera: CameraState,
  canvasWidth: number,
  canvasHeight: number,
  dpr: number
): boolean {
  const leftWorld = -camera.x / camera.zoom;
  const topWorld = -camera.y / camera.zoom;
  const rightWorld = leftWorld + canvasWidth / dpr / camera.zoom;
  const bottomWorld = topWorld + canvasHeight / dpr / camera.zoom;

  // Dagre centers nodes at (x, y); check AABB overlap with viewport
  return (
    node.x + node.width / 2 >= leftWorld &&
    node.x - node.width / 2 <= rightWorld &&
    node.y + node.height / 2 >= topWorld &&
    node.y - node.height / 2 <= bottomWorld
  );
}

function drawConnectors(ctx: CanvasRenderingContext2D, edges: LayoutEdge[], state: RenderState, layoutNodeRefs: Set<string>): void {
  for (const edge of edges) {
    const isHighlighted = state.highlightedExternalEdges.has(`${edge.source}-${edge.target}`);
    const isInternal = layoutNodeRefs.has(edge.source) && layoutNodeRefs.has(edge.target);

    let strokeWidth: number;
    let strokeColor: string;

    // Color edges by direction when a node is selected
    const selectedNode = state.selectedNode;
    const touchesSelected = selectedNode && (edge.source === selectedNode || edge.target === selectedNode);

    if (touchesSelected) {
      strokeWidth = CONNECTOR_HIGHLIGHTED_WIDTH;
      // source = dependent, target = dependency
      // Red: selected node depends on target (outgoing dependency)
      // Green: something depends on selected node (incoming requirement)
      strokeColor = edge.source === selectedNode ? '#f85149' : '#3fb950';
    } else if (isHighlighted) {
      strokeWidth = CONNECTOR_HIGHLIGHTED_WIDTH;
      strokeColor = theme.CONNECTOR_EXTERNAL;
    } else if (isInternal) {
      strokeWidth = CONNECTOR_WIDTH;
      strokeColor = theme.CONNECTOR_COLOR;
    } else {
      // External edge (one endpoint is outside this view)
      strokeWidth = CONNECTOR_WIDTH;
      strokeColor = theme.CONNECTOR_STUB;
    }

    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (edge.points.length === 0) {
      continue;
    }

    // Draw bezier curve through waypoints
    ctx.beginPath();
    ctx.moveTo(edge.points[0].x, edge.points[0].y);

    if (edge.points.length === 2) {
      // Straight line
      ctx.lineTo(edge.points[1].x, edge.points[1].y);
    } else if (edge.points.length > 2) {
      // Bezier through waypoints
      for (let i = 1; i < edge.points.length - 1; i++) {
        const cp = edge.points[i];
        const p = edge.points[i + 1];
        ctx.quadraticCurveTo(cp.x, cp.y, p.x, p.y);
      }
    }

    ctx.stroke();

    // Draw arrowhead at target
    if (edge.points.length >= 2) {
      const lastPoint = edge.points[edge.points.length - 1];
      const prevPoint = edge.points[edge.points.length - 2];
      drawArrowhead(ctx, prevPoint.x, prevPoint.y, lastPoint.x, lastPoint.y, strokeColor);
    }

    // Draw relationship label at edge midpoint
    if (edge.label && edge.points.length >= 2) {
      const midIdx = Math.floor(edge.points.length / 2);
      const midPoint = edge.points[midIdx];
      ctx.fillStyle = theme.NODE_TEXT_SECONDARY;
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(edge.label, midPoint.x, midPoint.y - 6);
    }
  }
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string
): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - ARROWHEAD_SIZE * Math.cos(angle - Math.PI / 6), toY - ARROWHEAD_SIZE * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(toX - ARROWHEAD_SIZE * Math.cos(angle + Math.PI / 6), toY - ARROWHEAD_SIZE * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: LayoutNode[],
  state: RenderState,
  camera: CameraState,
  elements: Map<string, Element>,
  dpr: number
): void {
  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;

  for (const node of nodes) {
    // Frustum culling: skip nodes whose AABB doesn't overlap the current viewport
    if (!isNodeVisible(node, camera, canvasWidth, canvasHeight, dpr)) {
      continue;
    }

    const isHovered = node.ref === state.hoveredNode;
    const isSelected = node.ref === state.selectedNode;
    const elem = elements.get(node.ref);

    // Draw node background
    ctx.fillStyle = theme.NODE_BG;
    ctx.strokeStyle = isSelected ? theme.NODE_BORDER_SELECTED : isHovered ? theme.NODE_BORDER_HOVER : theme.NODE_BORDER;
    ctx.lineWidth = isSelected ? NODE_SELECTED_STROKE_WIDTH : NODE_DEFAULT_STROKE_WIDTH;

    drawRoundedRect(ctx, node.x - node.width / 2, node.y - node.height / 2, node.width, node.height, theme.NODE_RADIUS);
    ctx.fill();
    ctx.stroke();

    // Draw text if zoom is sufficient
    if (camera.zoom >= TEXT_ZOOM_THRESHOLD && elem) {
      const maxTextWidth = node.width - 2 * theme.NODE_PADDING;

      ctx.fillStyle = theme.NODE_TEXT;
      ctx.font = theme.FONT_PRIMARY;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const nameY = node.y - 10;
      ctx.fillText(truncateText(ctx, elem.name, maxTextWidth), node.x, nameY);

      ctx.fillStyle = theme.NODE_TEXT_SECONDARY;
      ctx.font = theme.FONT_SECONDARY;
      const descY = node.y + 10;
      ctx.fillText(truncateText(ctx, elem.description || '', maxTextWidth), node.x, descY);
    }

    // Draw expand icon for groups
    if (node.isGroup) {
      drawGroupIcon(ctx, node.x + node.width / 2 - 12, node.y - node.height / 2 + 12);
    }
  }
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Truncate text with ellipsis if it exceeds maxWidth.
 * Uses ctx.measureText() to determine actual rendered width.
 */
function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + '…';
}

function drawGroupIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = theme.GROUP_ICON_COLOR;
  ctx.font = theme.FONT_BADGE;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⊞', x, y);
}

/**
 * Draw short dashed stub lines from each node's edge toward the canvas boundary,
 * representing connectors that cross the current view boundary.
 *
 * Outbound stubs (`→ GroupName (N)`) emanate from the right side.
 * Inbound stubs (`← GroupName (N)`) emanate from the left side.
 * The selected node's stubs are rendered with the external-highlight color and
 * a thicker stroke; all others use the muted stub color.
 */
export function drawExternalStubs(
  ctx: CanvasRenderingContext2D,
  stubs: ExternalStub[],
  state: RenderState
): void {
  for (const stub of stubs) {
    const isHighlighted = state.selectedNode === stub.nodeRef;
    const color = isHighlighted ? theme.CONNECTOR_EXTERNAL : theme.CONNECTOR_STUB;
    const lineWidth = isHighlighted ? STUB_HIGHLIGHTED_WIDTH : STUB_DEFAULT_WIDTH;

    const cosA = Math.cos(stub.angle);
    const sinA = Math.sin(stub.angle);

    // Compute the distance from the node center to the edge along the stub direction
    // using a safe AABB intersection.
    const halfW = stub.nodeWidth / 2;
    const halfH = stub.nodeHeight / 2;
    let edgeDist: number;
    if (Math.abs(sinA) < 1e-10) {
      edgeDist = halfW;
    } else if (Math.abs(cosA) < 1e-10) {
      edgeDist = halfH;
    } else {
      edgeDist = Math.min(halfW / Math.abs(cosA), halfH / Math.abs(sinA));
    }

    // Start just outside the node boundary; end STUB_LENGTH further out
    const startX = stub.nodeX + cosA * (edgeDist + STUB_GAP);
    const startY = stub.nodeY + sinA * (edgeDist + STUB_GAP);
    const endX = stub.nodeX + cosA * (edgeDist + STUB_GAP + STUB_LENGTH);
    const endY = stub.nodeY + sinA * (edgeDist + STUB_GAP + STUB_LENGTH);

    // Dashed line
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.setLineDash([]);

    // Label: → GroupName (N)  or  ← GroupName (N)
    const arrow = stub.direction === 'outbound' ? '→' : '←';
    const label = `${arrow} ${stub.targetGroup} (${stub.count})`;

    // Align text away from node so it doesn't overlap the line
    const labelX = endX + cosA * 4;
    const labelY = endY + sinA * 4;

    ctx.fillStyle = color;
    ctx.font = theme.FONT_BADGE;
    ctx.textAlign = cosA >= 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, labelX, labelY);
  }
}
