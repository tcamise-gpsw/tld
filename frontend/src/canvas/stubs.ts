import { DiagramData } from '../data/types';
import { ViewLayout } from './layout';

/**
 * Describes one external connector stub: a dashed line + label drawn from a node
 * edge toward the canvas boundary, representing connections that cross the current
 * view boundary.
 */
export interface ExternalStub {
  /** Ref of the node this stub originates from. */
  nodeRef: string;
  /** Human-readable name of the external group being connected to/from. */
  targetGroup: string;
  /** Whether this stub represents connections going out or coming in. */
  direction: 'outbound' | 'inbound';
  /** Number of connectors aggregated into this stub. */
  count: number;
  /** Angle in radians for the stub direction (0 = right, π = left). */
  angle: number;
  /** Node center X in world coordinates. */
  nodeX: number;
  /** Node center Y in world coordinates. */
  nodeY: number;
  /** Node width in world coordinates. */
  nodeWidth: number;
  /** Node height in world coordinates. */
  nodeHeight: number;
}

type StubAccum = Omit<ExternalStub, 'angle'>;

/**
 * Walk up the placement hierarchy from `elementRef` to find the direct child of
 * `viewRef` that contains (or is) `elementRef`.
 *
 * Returns the ref of that direct child, or `null` if `elementRef` is not a
 * descendant of `viewRef`.
 *
 * Uses `element.placements[0].parent` exclusively — consistent with the
 * placement-based externality semantics used throughout the app, and works for
 * both flat views (element IS a direct child) and hierarchical views (element is a
 * nested descendant inside a visible group node).
 */
function getVisibleNodeAncestor(
  elementRef: string,
  viewRef: string,
  data: DiagramData
): string | null {
  let current = elementRef;
  const visited = new Set<string>();

  while (!visited.has(current)) {
    visited.add(current);
    const elem = data.elements.get(current);
    if (!elem) return null;

    const parentRef = elem.placements[0]?.parent ?? 'root';
    // current is a direct child of viewRef → this is the visible node
    if (parentRef === viewRef) return current;
    // reached the tree root without crossing viewRef → not in this view
    if (parentRef === 'root' && viewRef !== 'root') return null;
    current = parentRef;
  }
  return null; // cycle guard
}

/**
 * Compute external stub descriptors for all nodes visible in the current view.
 *
 * Works for both flat views (visible nodes are leaf elements) **and** hierarchical
 * views (visible nodes are group nodes whose descendants carry the actual connectors).
 *
 * A connector is "external" when exactly one of its endpoints is a descendant of
 * `viewRef`. The stub is attributed to the visible node (a direct child of `viewRef`)
 * that contains the in-view endpoint, found by walking `placements` ancestry.
 *
 * Groups by (nodeRef, resolvedTargetGroupName, direction) so that multiple
 * connections to the same external group are collapsed into a single stub with
 * a count > 1.
 *
 * Angles are spread per node so stubs don't overlap:
 *   - Outbound stubs fan out from the right side (base angle 0).
 *   - Inbound stubs fan out from the left side (base angle π).
 *   - Spread range is ±30° (π/6) per side.
 */
export function computeExternalStubs(
  data: DiagramData,
  viewRef: string,
  layout: ViewLayout
): ExternalStub[] {
  // Build quick-access maps for the visible layout nodes
  const layoutNodeRefs = new Set(layout.nodes.map((n) => n.ref));
  const layoutNodeByRef = new Map(layout.nodes.map((n) => [n.ref, n]));

  const groups = new Map<string, StubAccum>();

  for (const conn of data.connectors) {
    const sourceAncestor = getVisibleNodeAncestor(conn.source, viewRef, data);
    const targetAncestor = getVisibleNodeAncestor(conn.target, viewRef, data);

    // Only emit a stub when exactly one endpoint belongs to a visible layout node.
    // - Both inside view  → internal connector, skip
    // - Neither inside    → unrelated, skip
    // - Exactly one inside → external: emit stub on the in-view visible node
    const sourceInView = sourceAncestor !== null && layoutNodeRefs.has(sourceAncestor);
    const targetInView = targetAncestor !== null && layoutNodeRefs.has(targetAncestor);

    if (sourceInView === targetInView) continue;

    let nodeRef: string;
    let direction: 'outbound' | 'inbound';
    let otherEndpointRef: string;

    if (sourceInView) {
      nodeRef = sourceAncestor!;
      direction = 'outbound';
      otherEndpointRef = conn.target;
    } else {
      nodeRef = targetAncestor!;
      direction = 'inbound';
      otherEndpointRef = conn.source;
    }

    // Resolve target group: immediate parent of the other (external) endpoint
    const otherElem = data.elements.get(otherEndpointRef);
    const otherParentRef = otherElem?.placements[0]?.parent ?? 'root';
    const parentElem = data.elements.get(otherParentRef);
    const targetGroup = parentElem?.name ?? otherParentRef;

    const key = `${nodeRef}|${targetGroup}|${direction}`;
    const existing = groups.get(key);
    const layoutNode = layoutNodeByRef.get(nodeRef)!;

    if (existing) {
      existing.count++;
    } else {
      groups.set(key, {
        nodeRef,
        targetGroup,
        direction,
        count: 1,
        nodeX: layoutNode.x,
        nodeY: layoutNode.y,
        nodeWidth: layoutNode.width,
        nodeHeight: layoutNode.height,
      });
    }
  }

  // Assign angles — spread stubs per node per direction
  const byNode = new Map<string, StubAccum[]>();
  for (const stub of groups.values()) {
    const list = byNode.get(stub.nodeRef) ?? [];
    list.push(stub);
    byNode.set(stub.nodeRef, list);
  }

  const SPREAD_RANGE = Math.PI / 3; // ±30° total spread per side
  const result: ExternalStub[] = [];

  for (const stubs of byNode.values()) {
    const outbound = stubs.filter((s) => s.direction === 'outbound');
    const inbound = stubs.filter((s) => s.direction === 'inbound');

    const assignAngles = (list: StubAccum[], baseAngle: number): void => {
      list.forEach((stub, i) => {
        const offset =
          list.length === 1
            ? 0
            : ((i / (list.length - 1)) - 0.5) * SPREAD_RANGE;
        result.push({ ...stub, angle: baseAngle + offset });
      });
    };

    assignAngles(outbound, 0);          // right side
    assignAngles(inbound, Math.PI);     // left side
  }

  return result;
}
