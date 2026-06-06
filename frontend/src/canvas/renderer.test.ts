/**
 * Task 6: Canvas Renderer — unit tests
 *
 * Covers:
 *  1. Text culling below zoom threshold (Task 6 QA scenario)
 *  2. Resolved element name + description drawn (not node.ref)
 *  3. Connector arrowhead drawn per edge
 *  4. Hover / selected border-color styling
 *  5. Frustum culling (viewport-based node skipping)
 *  6. External stubs drawing
 *  7. isNodeVisible pure-function unit tests
 *
 * Canvas 2D context is mocked with vi.fn() spies and a Proxy that records
 * every property assignment (strokeStyle, fillStyle, lineWidth …) in arrays
 * so tests can assert what was set, not just the final property value.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderFrame, drawExternalStubs, isNodeVisible, RenderState, ExternalStub } from './renderer';
import { ViewLayout, LayoutNode } from './layout';
import { CameraState } from './camera';
import { Element } from '../data/types';
import * as theme from '../theme';

// ---------------------------------------------------------------------------
// Mock canvas context factory
// ---------------------------------------------------------------------------

function createMockCtx(canvasWidth = 800, canvasHeight = 600) {
  const propertySets: Record<string, unknown[]> = {};

  const base: Record<string, unknown> = {
    canvas: { width: canvasWidth, height: canvasHeight },
    fillRect: vi.fn(),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 50 })),
  };

  const proxy = new Proxy(base, {
    set(target, prop, value) {
      if (typeof prop === 'string') {
        propertySets[prop] = propertySets[prop] ?? [];
        propertySets[prop].push(value);
      }
      (target as Record<string | symbol, unknown>)[prop] = value;
      return true;
    },
  });

  return Object.assign(proxy, { _sets: propertySets });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeElement(ref: string, overrides: Partial<Element> = {}): Element {
  return {
    ref,
    name: `Name-${ref}`,
    description: `Desc-${ref}`,
    kind: 'component',
    has_view: false,
    technology: '',
    placements: [],
    ...overrides,
  };
}

function emptyState(): RenderState {
  return {
    hoveredNode: null,
    hoveredGroupIcon: null,
    selectedNode: null,
    showExternalStubs: false,
    highlightedExternalEdges: new Set(),
  };
}

/** A layout with one node centred at (x, y). Canvas default is 800×600, so
 *  (100, 100) is firmly inside the viewport at zoom ≥ 1. */
function singleNodeLayout(
  ref: string,
  x = 100,
  y = 100,
  isGroup = false,
): ViewLayout {
  return {
    nodes: [{ ref, x, y, width: 220, height: 80, isGroup }],
    edges: [],
    width: 400,
    height: 400,
  };
}

const defaultCamera: CameraState = { x: 0, y: 0, zoom: 1 };

/** Collect all first-argument strings passed to fillText on a mock ctx. */
function fillTexts(ctx: ReturnType<typeof createMockCtx>): string[] {
  return (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls.map(
    (c: unknown[]) => c[0] as string,
  );
}

// ---------------------------------------------------------------------------
// 1. Text culling at zoom threshold  (Task 6 QA scenario: "Text labels skip
//    at low zoom (performance)")
// ---------------------------------------------------------------------------

describe('renderer — text culling at zoom threshold', () => {
  it('does NOT draw name/desc text when zoom < 0.3', () => {
    const ctx = createMockCtx();
    const elements = new Map([['a', makeElement('a', { name: 'Alpha' })]]);
    renderFrame(ctx as never, singleNodeLayout('a'), { x: 0, y: 0, zoom: 0.2 }, emptyState(), elements, 1);
    expect(ctx.fillText).not.toHaveBeenCalledWith('Alpha', expect.anything(), expect.anything());
  });

  it('does NOT draw text at 0.299 (just below threshold)', () => {
    const ctx = createMockCtx();
    const elements = new Map([['a', makeElement('a', { name: 'Alpha' })]]);
    renderFrame(ctx as never, singleNodeLayout('a'), { x: 0, y: 0, zoom: 0.299 }, emptyState(), elements, 1);
    expect(ctx.fillText).not.toHaveBeenCalledWith('Alpha', expect.anything(), expect.anything());
  });

  it('DOES draw text at exactly the threshold (zoom = 0.3)', () => {
    const ctx = createMockCtx();
    const elements = new Map([['a', makeElement('a', { name: 'Alpha' })]]);
    renderFrame(ctx as never, singleNodeLayout('a'), { x: 0, y: 0, zoom: 0.3 }, emptyState(), elements, 1);
    expect(ctx.fillText).toHaveBeenCalledWith('Alpha', expect.anything(), expect.anything());
  });

  it('DOES draw text at normal zoom (1.0)', () => {
    const ctx = createMockCtx();
    const elements = new Map([['a', makeElement('a', { name: 'Alpha' })]]);
    renderFrame(ctx as never, singleNodeLayout('a'), defaultCamera, emptyState(), elements, 1);
    expect(ctx.fillText).toHaveBeenCalledWith('Alpha', expect.anything(), expect.anything());
  });
});

// ---------------------------------------------------------------------------
// 2. Resolved element labels — name AND description come from the elements
//    map, not from node.ref  (prevents regression of the node.ref duplication
//    bug that was fixed post Wave 2)
// ---------------------------------------------------------------------------

describe('renderer — resolved element labels', () => {
  it('draws elem.name (not node.ref) as the node label', () => {
    const ctx = createMockCtx();
    const elements = new Map([['my-elem-ref', makeElement('my-elem-ref', { name: 'Auth Service' })]]);
    renderFrame(ctx as never, singleNodeLayout('my-elem-ref'), defaultCamera, emptyState(), elements, 1);
    const texts = fillTexts(ctx);
    expect(texts).toContain('Auth Service');
    expect(texts).not.toContain('my-elem-ref');       // node.ref must NOT appear as label text
  });

  it('draws elem.description as the secondary label', () => {
    const ctx = createMockCtx();
    const elements = new Map([['e', makeElement('e', { description: 'Handles OAuth flows' })]]);
    renderFrame(ctx as never, singleNodeLayout('e'), defaultCamera, emptyState(), elements, 1);
    expect(ctx.fillText).toHaveBeenCalledWith('Handles OAuth flows', expect.anything(), expect.anything());
  });

  it('renders both name AND description as separate fillText calls', () => {
    const ctx = createMockCtx();
    const elements = new Map([['e', makeElement('e', { name: 'ServiceA', description: 'Manages auth' })]]);
    renderFrame(ctx as never, singleNodeLayout('e'), defaultCamera, emptyState(), elements, 1);
    const texts = fillTexts(ctx);
    expect(texts).toContain('ServiceA');
    expect(texts).toContain('Manages auth');
  });

  it('skips text when the node ref is absent from the elements map', () => {
    const ctx = createMockCtx();
    // Node 'ghost' has no element entry
    renderFrame(ctx as never, singleNodeLayout('ghost'), defaultCamera, emptyState(), new Map(), 1);
    // Rounded rect IS drawn (fill/stroke called), but no text
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Connector arrowheads — fill() called once per edge with ≥ 2 points
// ---------------------------------------------------------------------------

describe('renderer — connector arrowheads', () => {
  it('calls fill() once per edge (arrowhead triangle)', () => {
    const ctx = createMockCtx();
    const layout: ViewLayout = {
      nodes: [],
      edges: [
        { source: 'a', target: 'b', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
        { source: 'b', target: 'c', points: [{ x: 100, y: 100 }, { x: 200, y: 50 }] },
      ],
      width: 400,
      height: 400,
    };
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), new Map(), 1);
    // No nodes → fill() comes only from arrowheads
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it('draws arrowhead for multi-point (bezier) edges', () => {
    const ctx = createMockCtx();
    const layout: ViewLayout = {
      nodes: [],
      edges: [{ source: 'a', target: 'b', points: [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 100 }] }],
      width: 400,
      height: 400,
    };
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), new Map(), 1);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it('does NOT draw arrowhead for a single-point edge', () => {
    const ctx = createMockCtx();
    const layout: ViewLayout = {
      nodes: [],
      edges: [{ source: 'a', target: 'b', points: [{ x: 0, y: 0 }] }],
      width: 400,
      height: 400,
    };
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), new Map(), 1);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('does NOT draw arrowhead for a zero-point edge', () => {
    const ctx = createMockCtx();
    const layout: ViewLayout = {
      nodes: [],
      edges: [{ source: 'a', target: 'b', points: [] }],
      width: 400,
      height: 400,
    };
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), new Map(), 1);
    expect(ctx.fill).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Hover and selected styling
// ---------------------------------------------------------------------------

describe('renderer — hover and selected styling', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let elements: Map<string, Element>;

  beforeEach(() => {
    ctx = createMockCtx();
    elements = new Map([['a', makeElement('a')]]);
  });

  it('uses NODE_BORDER_HOVER for the hovered node', () => {
    const state: RenderState = { ...emptyState(), hoveredNode: 'a' };
    renderFrame(ctx as never, singleNodeLayout('a'), defaultCamera, state, elements, 1);
    expect(ctx._sets['strokeStyle']).toContain(theme.NODE_BORDER_HOVER);
  });

  it('uses NODE_BORDER_SELECTED for the selected node', () => {
    const state: RenderState = { ...emptyState(), selectedNode: 'a' };
    renderFrame(ctx as never, singleNodeLayout('a'), defaultCamera, state, elements, 1);
    expect(ctx._sets['strokeStyle']).toContain(theme.NODE_BORDER_SELECTED);
  });

  it('selected takes priority over hovered — uses SELECTED color (same as hover when colors match)', () => {
    const state: RenderState = { ...emptyState(), hoveredNode: 'a', selectedNode: 'a' };
    renderFrame(ctx as never, singleNodeLayout('a'), defaultCamera, state, elements, 1);
    expect(ctx._sets['strokeStyle']).toContain(theme.NODE_BORDER_SELECTED);
  });

  it('uses default NODE_BORDER for an unhovered, unselected node', () => {
    renderFrame(ctx as never, singleNodeLayout('a'), defaultCamera, emptyState(), elements, 1);
    expect(ctx._sets['strokeStyle']).toContain(theme.NODE_BORDER);
    expect(ctx._sets['strokeStyle']).not.toContain(theme.NODE_BORDER_HOVER);
    expect(ctx._sets['strokeStyle']).not.toContain(theme.NODE_BORDER_SELECTED);
  });

  it('applies 3px stroke width for selected node', () => {
    const state: RenderState = { ...emptyState(), selectedNode: 'a' };
    renderFrame(ctx as never, singleNodeLayout('a'), defaultCamera, state, elements, 1);
    expect(ctx._sets['lineWidth']).toContain(3);
  });

  it('does not bleed hover color onto an adjacent unhoverd node', () => {
    const layout: ViewLayout = {
      nodes: [
        { ref: 'a', x: 100, y: 100, width: 220, height: 80, isGroup: false },
        { ref: 'b', x: 400, y: 100, width: 220, height: 80, isGroup: false },
      ],
      edges: [],
      width: 700,
      height: 400,
    };
    const elems = new Map([['a', makeElement('a')], ['b', makeElement('b')]]);
    const state: RenderState = { ...emptyState(), hoveredNode: 'a' };
    renderFrame(ctx as never, layout, defaultCamera, state, elems, 1);
    const hoverCount = (ctx._sets['strokeStyle'] as string[]).filter(s => s === theme.NODE_BORDER_HOVER).length;
    const defaultCount = (ctx._sets['strokeStyle'] as string[]).filter(s => s === theme.NODE_BORDER).length;
    expect(hoverCount).toBe(1);   // only node 'a'
    expect(defaultCount).toBe(1); // only node 'b'
  });
});

// ---------------------------------------------------------------------------
// 5. Frustum culling (viewport-based node skipping)
// ---------------------------------------------------------------------------

describe('renderer — frustum culling', () => {
  it('skips a node at (2000, 2000) when viewport is 800×600 at origin', () => {
    const ctx = createMockCtx(800, 600);
    const layout: ViewLayout = {
      nodes: [
        { ref: 'vis',  x: 100,  y: 100,  width: 220, height: 80, isGroup: false },
        { ref: 'far',  x: 2000, y: 2000, width: 220, height: 80, isGroup: false },
      ],
      edges: [],
      width: 2500,
      height: 2500,
    };
    const elements = new Map([
      ['vis', makeElement('vis',  { name: 'Visible' })],
      ['far', makeElement('far',  { name: 'Offscreen' })],
    ]);
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), elements, 1);
    const texts = fillTexts(ctx);
    expect(texts).toContain('Visible');
    expect(texts).not.toContain('Offscreen');
  });

  it('also skips fill/stroke for culled nodes (no rounded-rect drawn)', () => {
    const ctx = createMockCtx(800, 600);
    const layout: ViewLayout = {
      nodes: [{ ref: 'far', x: 2000, y: 2000, width: 220, height: 80, isGroup: false }],
      edges: [],
      width: 2500,
      height: 2500,
    };
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), new Map(), 1);
    expect(ctx.fill).not.toHaveBeenCalled(); // no edges → arrowhead fill absent; no visible node → rect fill absent
  });

  it('draws a node that partially overlaps the right viewport edge', () => {
    // Node at x=750; right edge = 750+110 = 860 > 800; left edge = 640 < 800 → overlaps
    const ctx = createMockCtx(800, 600);
    const layout: ViewLayout = {
      nodes: [{ ref: 'edge', x: 750, y: 300, width: 220, height: 80, isGroup: false }],
      edges: [],
      width: 1000,
      height: 600,
    };
    const elements = new Map([['edge', makeElement('edge', { name: 'EdgeNode' })]]);
    renderFrame(ctx as never, layout, defaultCamera, emptyState(), elements, 1);
    expect(ctx.fillText).toHaveBeenCalledWith('EdgeNode', expect.anything(), expect.anything());
  });

  it('shows a previously off-screen node after panning the camera', () => {
    // Node at world (900, 300); camera.x=-200 → leftWorld=200, rightWorld=1000 → node visible
    const ctx = createMockCtx(800, 600);
    const layout: ViewLayout = {
      nodes: [{ ref: 'far', x: 900, y: 300, width: 220, height: 80, isGroup: false }],
      edges: [],
      width: 1500,
      height: 600,
    };
    const elements = new Map([['far', makeElement('far', { name: 'FarNode' })]]);
    const pannedCamera: CameraState = { x: -200, y: 0, zoom: 1 };
    renderFrame(ctx as never, layout, pannedCamera, emptyState(), elements, 1);
    expect(ctx.fillText).toHaveBeenCalledWith('FarNode', expect.anything(), expect.anything());
  });
});

// ---------------------------------------------------------------------------
// 6. isNodeVisible — pure-function unit tests
// ---------------------------------------------------------------------------

describe('isNodeVisible', () => {
  const cam: CameraState = { x: 0, y: 0, zoom: 1 };
  const n = (x: number, y: number): LayoutNode => ({ ref: 'n', x, y, width: 220, height: 80, isGroup: false });

  it('returns true for a node centred inside the viewport', () => {
    expect(isNodeVisible(n(100, 100), cam, 800, 600, 1)).toBe(true);
  });

  it('returns false when node is entirely to the right of viewport', () => {
    expect(isNodeVisible(n(2000, 100), cam, 800, 600, 1)).toBe(false);
  });

  it('returns false when node is entirely below viewport', () => {
    expect(isNodeVisible(n(100, 2000), cam, 800, 600, 1)).toBe(false);
  });

  it('returns true when node partially overlaps right viewport edge', () => {
    // nodeLeft = 750-110 = 640 < 800 (rightWorld); nodeRight = 860 > 0 (leftWorld) → visible
    expect(isNodeVisible(n(750, 100), cam, 800, 600, 1)).toBe(true);
  });

  it('accounts for DPR: canvas 1600×1200 + dpr=2 === same world viewport as 800×600 + dpr=1', () => {
    expect(isNodeVisible(n(100, 100), cam, 1600, 1200, 2)).toBe(true);
    expect(isNodeVisible(n(2000, 100), cam, 1600, 1200, 2)).toBe(false);
  });

  it('correctly culls under zoom-in (rightWorld shrinks)', () => {
    const zoomedIn: CameraState = { x: 0, y: 0, zoom: 2 };
    // rightWorld = 800/1/2 = 400; node at x=500, left=390 ≤ 400 → visible
    expect(isNodeVisible(n(500, 100), zoomedIn, 800, 600, 1)).toBe(true);
    // node at x=600, left=490 > 400 → culled
    expect(isNodeVisible(n(600, 100), zoomedIn, 800, 600, 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. External stubs drawing
// ---------------------------------------------------------------------------

describe('renderer — drawExternalStubs', () => {
  it('draws a stroke and label for each stub', () => {
    const ctx = createMockCtx();
    const stubs: ExternalStub[] = [
      { nodeRef: 'a', targetGroup: 'NetworkLayer', count: 3, direction: 'outbound', angle: 0,
        nodeX: 0, nodeY: 100, nodeWidth: 220, nodeHeight: 80 },
    ];
    drawExternalStubs(ctx as never, stubs, emptyState());
    expect(ctx.stroke).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('NetworkLayer (3)', expect.anything(), expect.anything());
  });

  it('draws label for inbound stubs', () => {
    const ctx = createMockCtx();
    const stubs: ExternalStub[] = [
      { nodeRef: 'a', targetGroup: 'AuthService', count: 2, direction: 'inbound', angle: Math.PI,
        nodeX: 0, nodeY: 100, nodeWidth: 220, nodeHeight: 80 },
    ];
    drawExternalStubs(ctx as never, stubs, emptyState());
    expect(ctx.fillText).toHaveBeenCalledWith('AuthService (2)', expect.anything(), expect.anything());
  });

  it('uses red/green color when the stub node is selected', () => {
    const ctx = createMockCtx();
    const stubs: ExternalStub[] = [
      { nodeRef: 'a', targetGroup: 'G', count: 1, direction: 'outbound', angle: 0,
        nodeX: 0, nodeY: 100, nodeWidth: 220, nodeHeight: 80 },
    ];
    drawExternalStubs(ctx as never, stubs, { ...emptyState(), selectedNode: 'a' });
    expect(ctx._sets['strokeStyle']).toContain('#f85149');
    expect(ctx._sets['strokeStyle']).not.toContain(theme.CONNECTOR_STUB);
  });

  it('uses CONNECTOR_STUB color for non-selected stubs', () => {
    const ctx = createMockCtx();
    const stubs: ExternalStub[] = [
      { nodeRef: 'a', targetGroup: 'G', count: 1, direction: 'outbound', angle: 0,
        nodeX: 0, nodeY: 100, nodeWidth: 220, nodeHeight: 80 },
    ];
    drawExternalStubs(ctx as never, stubs, emptyState());
    expect(ctx._sets['strokeStyle']).toContain(theme.CONNECTOR_STUB);
    expect(ctx._sets['strokeStyle']).not.toContain(theme.CONNECTOR_EXTERNAL);
  });

  it('resets setLineDash([]) after each stub (no dash bleed)', () => {
    const ctx = createMockCtx();
    const stubs: ExternalStub[] = [
      { nodeRef: 'a', targetGroup: 'G1', count: 1, direction: 'outbound', angle: 0,
        nodeX: 0, nodeY: 100, nodeWidth: 220, nodeHeight: 80 },
      { nodeRef: 'b', targetGroup: 'G2', count: 2, direction: 'inbound', angle: Math.PI,
        nodeX: 0, nodeY: 200, nodeWidth: 220, nodeHeight: 80 },
    ];
    drawExternalStubs(ctx as never, stubs, emptyState());
    const setLineDashCalls = (ctx.setLineDash as ReturnType<typeof vi.fn>).mock.calls;
    const resetCalls = setLineDashCalls.filter((c: unknown[]) => {
      const arg = c[0] as unknown[];
      return Array.isArray(arg) && arg.length === 0;
    });
    expect(resetCalls.length).toBe(2); // once per stub
  });

  it('renders stub starting from node edge (not node center, not world origin)', () => {
    const ctx = createMockCtx();
    // Node centred at (500, 300), width=220 → halfW=110, STUB_GAP=6
    // angle=0 → cosA=1, sinA=0 → edgeDist=halfW=110
    // startX = 500 + 1*(110+6) = 616, startY = 300
    const stubs: ExternalStub[] = [
      { nodeRef: 'n', targetGroup: 'G', count: 1, direction: 'outbound', angle: 0,
        nodeX: 500, nodeY: 300, nodeWidth: 220, nodeHeight: 80 },
    ];
    drawExternalStubs(ctx as never, stubs, emptyState());
    const moveToCall = (ctx.moveTo as ReturnType<typeof vi.fn>).mock.calls[0];
    // Must NOT start at node centre (500, 300)
    expect(moveToCall[0]).not.toBe(500);
    // Must start at right edge + gap: 500 + 110 + 6 = 616
    expect(moveToCall[0]).toBeCloseTo(616, 5);
    expect(moveToCall[1]).toBeCloseTo(300, 5);
  });
});

describe('renderer — highlighted external edges', () => {
  it('draws highlighted edges with CONNECTOR_EXTERNAL color and thicker width', () => {
    const ctx = createMockCtx();
    const layout: ViewLayout = {
      nodes: [
        { ref: 'a', x: 50, y: 50, width: 220, height: 80, isGroup: false },
        { ref: 'b', x: 150, y: 150, width: 220, height: 80, isGroup: false },
        { ref: 'c', x: 250, y: 50, width: 220, height: 80, isGroup: false },
        { ref: 'd', x: 350, y: 150, width: 220, height: 80, isGroup: false },
      ],
      edges: [
        { source: 'a', target: 'b', points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
        { source: 'c', target: 'd', points: [{ x: 100, y: 100 }, { x: 200, y: 50 }] },
      ],
      width: 400,
      height: 400,
    };
    const state: RenderState = {
      ...emptyState(),
      highlightedExternalEdges: new Set(['a-b'])
    };
    const elements = new Map([
      ['a', makeElement('a')], ['b', makeElement('b')],
      ['c', makeElement('c')], ['d', makeElement('d')],
    ]);
    renderFrame(ctx as never, layout, defaultCamera, state, elements, 1);
    
    expect(ctx._sets['strokeStyle']).toContain(theme.CONNECTOR_EXTERNAL);
    expect(ctx._sets['strokeStyle']).toContain(theme.CONNECTOR_COLOR);
    expect(ctx._sets['lineWidth']).toContain(2.5); // CONNECTOR_HIGHLIGHTED_WIDTH
    expect(ctx._sets['lineWidth']).toContain(1.5); // CONNECTOR_WIDTH
  });
});
