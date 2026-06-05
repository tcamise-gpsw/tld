import { describe, it, expect } from 'vitest';
import { computeExternalStubs } from './stubs';
import { DiagramData, Element, Connector, ViewNode } from '../data/types';
import { ViewLayout } from './layout';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeElement(ref: string, parentRef: string, name?: string): Element {
  return {
    ref,
    name: name ?? ref,
    kind: 'service',
    description: '',
    technology: '',
    has_view: false,
    placements: [{ parent: parentRef }],
  };
}

function makeConnector(id: string, source: string, target: string, view = 'group-a'): Connector {
  return { id, source, target, view, direction: 'outbound', style: 'solid' };
}

function makeData(elements: Element[], connectors: Connector[]): DiagramData {
  const elemMap = new Map<string, Element>(elements.map((e) => [e.ref, e]));

  const viewNodes = new Map<string, ViewNode>();
  const root: ViewNode = {
    ref: 'root',
    name: 'Root',
    kind: 'root',
    description: '',
    has_view: true,
    children: [],
    parent: 'root',
  };
  viewNodes.set('root', root);

  for (const elem of elements) {
    viewNodes.set(elem.ref, {
      ref: elem.ref,
      name: elem.name,
      kind: elem.kind,
      description: elem.description ?? '',
      has_view: elem.has_view,
      children: [],
      parent: '',
    });
  }

  for (const elem of elements) {
    const parentRef = elem.placements[0]?.parent ?? 'root';
    const node = viewNodes.get(elem.ref)!;
    node.parent = parentRef;
    const parent = viewNodes.get(parentRef);
    if (parent) {
      parent.children.push(elem.ref);
    } else {
      node.parent = 'root';
      root.children.push(elem.ref);
    }
  }

  return { elements: elemMap, connectors, viewTree: { nodes: viewNodes, root } };
}

function makeLayout(
  nodes: Array<{ ref: string; x?: number; y?: number }>
): ViewLayout {
  return {
    nodes: nodes.map((n) => ({
      ref: n.ref,
      x: n.x ?? 100,
      y: n.y ?? 80,
      width: 220,
      height: 80,
      isGroup: false,
    })),
    edges: [],
    width: 600,
    height: 400,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeExternalStubs', () => {
  describe('empty / no-op cases', () => {
    it('returns empty array when layout has no nodes', () => {
      const data = makeData([], []);
      const layout = makeLayout([]);
      expect(computeExternalStubs(data, 'group-a', layout)).toEqual([]);
    });

    it('returns empty array when nodes have no external connectors', () => {
      // Both elements are children of group-a → connector is internal
      const elements = [
        makeElement('elem-a1', 'group-a', 'Service A1'),
        makeElement('elem-a2', 'group-a', 'Service A2'),
      ];
      const connectors = [makeConnector('c1', 'elem-a1', 'elem-a2', 'group-a')];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1' }, { ref: 'elem-a2' }]);

      expect(computeExternalStubs(data, 'group-a', layout)).toEqual([]);
    });

    it('returns empty array when toggle would be off (no connectors at all)', () => {
      const elements = [makeElement('elem-a1', 'group-a', 'Service A1')];
      const data = makeData(elements, []);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      expect(computeExternalStubs(data, 'group-a', layout)).toEqual([]);
    });
  });

  describe('single external connector', () => {
    it('produces one outbound stub for an outgoing external connector', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'Service A1'),
        makeElement('group-b', 'root', 'Group B'),   // parent of elem-b1
        makeElement('elem-b1', 'group-b', 'Service B1'),
      ];
      const connectors = [makeConnector('c1', 'elem-a1', 'elem-b1', 'group-a')];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1', x: 110, y: 80 }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs).toHaveLength(1);
      const stub = stubs[0];
      expect(stub.nodeRef).toBe('elem-a1');
      expect(stub.direction).toBe('outbound');
      expect(stub.count).toBe(1);
      expect(stub.targetGroup).toBe('Group B');
    });

    it('produces one inbound stub for an incoming external connector', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'Service A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'Service B1'),
      ];
      // connector goes FROM b1 TO a1 — inbound for a1
      const connectors = [makeConnector('c1', 'elem-b1', 'elem-a1', 'group-a')];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1', x: 110, y: 80 }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs).toHaveLength(1);
      expect(stubs[0].direction).toBe('inbound');
      expect(stubs[0].targetGroup).toBe('Group B');
    });
  });

  describe('grouping and count', () => {
    it('collapses multiple outbound connectors to the same external group into count>1', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
        makeElement('elem-b2', 'group-b', 'B2'),
      ];
      const connectors = [
        makeConnector('c1', 'elem-a1', 'elem-b1', 'group-a'),
        makeConnector('c2', 'elem-a1', 'elem-b2', 'group-a'),
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs).toHaveLength(1);
      expect(stubs[0].count).toBe(2);
      expect(stubs[0].targetGroup).toBe('Group B');
    });

    it('creates separate stubs for connectors to different external groups', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
        makeElement('group-c', 'root', 'Group C'),
        makeElement('elem-c1', 'group-c', 'C1'),
      ];
      const connectors = [
        makeConnector('c1', 'elem-a1', 'elem-b1', 'group-a'),
        makeConnector('c2', 'elem-a1', 'elem-c1', 'group-a'),
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs).toHaveLength(2);
      const groups = stubs.map((s) => s.targetGroup).sort();
      expect(groups).toEqual(['Group B', 'Group C']);
    });

    it('keeps outbound and inbound to the same group as separate stubs', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const connectors = [
        makeConnector('c1', 'elem-a1', 'elem-b1', 'group-a'),   // outbound
        makeConnector('c2', 'elem-b1', 'elem-a1', 'group-a'),   // inbound
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs).toHaveLength(2);
      expect(stubs.some((s) => s.direction === 'outbound')).toBe(true);
      expect(stubs.some((s) => s.direction === 'inbound')).toBe(true);
    });
  });

  describe('angle assignment', () => {
    it('assigns angle ≈ 0 (right) for a single outbound stub', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const data = makeData(elements, [makeConnector('c1', 'elem-a1', 'elem-b1')]);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs[0].angle).toBeCloseTo(0, 5);
    });

    it('assigns angle ≈ π (left) for a single inbound stub', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const data = makeData(elements, [makeConnector('c1', 'elem-b1', 'elem-a1')]);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs[0].angle).toBeCloseTo(Math.PI, 5);
    });

    it('spreads two outbound stubs symmetrically around angle 0', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
        makeElement('group-c', 'root', 'Group C'),
        makeElement('elem-c1', 'group-c', 'C1'),
      ];
      const connectors = [
        makeConnector('c1', 'elem-a1', 'elem-b1'),
        makeConnector('c2', 'elem-a1', 'elem-c1'),
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);
      const outboundAngles = stubs
        .filter((s) => s.direction === 'outbound')
        .map((s) => s.angle)
        .sort((a, b) => a - b);

      // Two stubs → symmetric spread: -spread/2 and +spread/2
      expect(outboundAngles).toHaveLength(2);
      expect(outboundAngles[0]).toBeLessThan(0);
      expect(outboundAngles[1]).toBeGreaterThan(0);
      // And they should be symmetric around 0
      expect(outboundAngles[0] + outboundAngles[1]).toBeCloseTo(0, 5);
    });
  });

  describe('node position propagation', () => {
    it('copies node x/y/width/height into the stub', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const data = makeData(elements, [makeConnector('c1', 'elem-a1', 'elem-b1')]);
      const layout: ViewLayout = {
        nodes: [{ ref: 'elem-a1', x: 300, y: 150, width: 200, height: 60, isGroup: false }],
        edges: [],
        width: 600,
        height: 400,
      };

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs[0].nodeX).toBe(300);
      expect(stubs[0].nodeY).toBe(150);
      expect(stubs[0].nodeWidth).toBe(200);
      expect(stubs[0].nodeHeight).toBe(60);
    });
  });

  describe('target group name resolution', () => {
    it('uses the parent element name as targetGroup', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('group-b', 'root', 'External Module'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const data = makeData(elements, [makeConnector('c1', 'elem-a1', 'elem-b1')]);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs[0].targetGroup).toBe('External Module');
    });

    it('falls back to parent ref when parent element is not in elements map', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        // elem-b1 has parent 'unknown-group' which is NOT in the elements map
        makeElement('elem-b1', 'unknown-group', 'B1'),
      ];
      const data = makeData(elements, [makeConnector('c1', 'elem-a1', 'elem-b1')]);
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      // targetGroup falls back to the raw parent ref string
      expect(stubs[0].targetGroup).toBe('unknown-group');
    });
  });

  describe('multi-node views', () => {
    it('returns stubs for all nodes that have external connectors', () => {
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('elem-a2', 'group-a', 'A2'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const connectors = [
        makeConnector('c1', 'elem-a1', 'elem-b1', 'group-a'),
        makeConnector('c2', 'elem-a2', 'elem-b1', 'group-a'),
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'elem-a1' }, { ref: 'elem-a2' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      const nodeRefs = stubs.map((s) => s.nodeRef).sort();
      expect(nodeRefs).toEqual(['elem-a1', 'elem-a2']);
    });

    it('only includes stubs for nodes present in the layout', () => {
      // elem-a2 is in the data but NOT in the layout nodes
      const elements = [
        makeElement('elem-a1', 'group-a', 'A1'),
        makeElement('elem-a2', 'group-a', 'A2'),
        makeElement('group-b', 'root', 'Group B'),
        makeElement('elem-b1', 'group-b', 'B1'),
      ];
      const connectors = [
        makeConnector('c1', 'elem-a1', 'elem-b1', 'group-a'),
        makeConnector('c2', 'elem-a2', 'elem-b1', 'group-a'),
      ];
      const data = makeData(elements, connectors);
      // Layout only contains elem-a1
      const layout = makeLayout([{ ref: 'elem-a1' }]);

      const stubs = computeExternalStubs(data, 'group-a', layout);

      expect(stubs.every((s) => s.nodeRef === 'elem-a1')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Hierarchical visible-group cases (the runtime bug: root/core scenario)
  // ---------------------------------------------------------------------------
  // In views like root/core the visible nodes (layout.nodes) are GROUP nodes
  // such as core-data, core-media, core-connection.  The actual connectors in
  // the YAML link *leaf descendants* of those groups, not the group nodes
  // themselves.  The old per-node getNodeConnectors approach therefore found zero
  // connectors and produced zero stubs.  The new placement-based ancestry walk
  // fixes this by scanning all connectors and finding the visible-node ancestor
  // of each endpoint.
  // ---------------------------------------------------------------------------
  describe('hierarchical visible-group cases (root/core runtime scenario)', () => {
    it('produces stubs for connectors between descendants of visible group nodes and external elements', () => {
      // Simulates root/core view:
      //   currentView = 'core'
      //   visible layout nodes: core-data (group), core-media (group)
      //   connectors are between leaf descendants, NOT the group nodes themselves
      const elements = [
        // visible group nodes (direct children of 'core')
        makeElement('core-data',  'core', 'Core Data'),
        makeElement('core-media', 'core', 'Core Media'),
        // leaf descendants (children of the visible groups)
        makeElement('core-data-svc',  'core-data',  'Core Data Service'),
        makeElement('core-media-svc', 'core-media', 'Core Media Service'),
        // external group + leaf (outside 'core')
        makeElement('external-group', 'root', 'External Module'),
        makeElement('external-svc',   'external-group', 'External Service'),
      ];
      const connectors = [
        // leaf inside core-data → external leaf  (outbound from core-data)
        makeConnector('c1', 'core-data-svc', 'external-svc', 'core'),
        // external leaf → leaf inside core-media  (inbound to core-media)
        makeConnector('c2', 'external-svc', 'core-media-svc', 'core'),
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([
        { ref: 'core-data',  x: 100, y: 100 },
        { ref: 'core-media', x: 300, y: 100 },
      ]);

      const stubs = computeExternalStubs(data, 'core', layout);

      expect(stubs).toHaveLength(2);

      const coreDataStub = stubs.find((s) => s.nodeRef === 'core-data');
      expect(coreDataStub).toBeDefined();
      expect(coreDataStub!.direction).toBe('outbound');
      expect(coreDataStub!.targetGroup).toBe('External Module');
      expect(coreDataStub!.count).toBe(1);

      const coreMediaStub = stubs.find((s) => s.nodeRef === 'core-media');
      expect(coreMediaStub).toBeDefined();
      expect(coreMediaStub!.direction).toBe('inbound');
      expect(coreMediaStub!.targetGroup).toBe('External Module');
      expect(coreMediaStub!.count).toBe(1);
    });

    it('collapses multiple descendant connectors to the same external group into a single stub', () => {
      const elements = [
        makeElement('core-data', 'core', 'Core Data'),
        makeElement('svc1', 'core-data', 'Service 1'),
        makeElement('svc2', 'core-data', 'Service 2'),
        makeElement('ext-group', 'root', 'External Module'),
        makeElement('ext-svc', 'ext-group', 'External Service'),
      ];
      const connectors = [
        makeConnector('c1', 'svc1', 'ext-svc', 'core'),
        makeConnector('c2', 'svc2', 'ext-svc', 'core'),
      ];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'core-data', x: 100, y: 100 }]);

      const stubs = computeExternalStubs(data, 'core', layout);

      expect(stubs).toHaveLength(1);
      expect(stubs[0].nodeRef).toBe('core-data');
      expect(stubs[0].count).toBe(2);
      expect(stubs[0].targetGroup).toBe('External Module');
      expect(stubs[0].direction).toBe('outbound');
    });

    it('does not produce stubs for internal connectors between descendants of different visible groups', () => {
      // svc1 (under core-data) → svc2 (under core-media): both inside 'core' → internal
      const elements = [
        makeElement('core-data',  'core', 'Core Data'),
        makeElement('core-media', 'core', 'Core Media'),
        makeElement('svc1', 'core-data',  'Service 1'),
        makeElement('svc2', 'core-media', 'Service 2'),
      ];
      const connectors = [makeConnector('c1', 'svc1', 'svc2', 'core')];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'core-data' }, { ref: 'core-media' }]);

      const stubs = computeExternalStubs(data, 'core', layout);

      expect(stubs).toHaveLength(0);
    });

    it('propagates visible group node position to stub geometry', () => {
      const elements = [
        makeElement('core-data', 'core', 'Core Data'),
        makeElement('svc1', 'core-data', 'Service 1'),
        makeElement('ext-group', 'root', 'External'),
        makeElement('ext-svc', 'ext-group', 'Ext Service'),
      ];
      const connectors = [makeConnector('c1', 'svc1', 'ext-svc', 'core')];
      const data = makeData(elements, connectors);
      const layout: ViewLayout = {
        nodes: [{ ref: 'core-data', x: 250, y: 180, width: 220, height: 80, isGroup: true }],
        edges: [],
        width: 600,
        height: 400,
      };

      const stubs = computeExternalStubs(data, 'core', layout);

      expect(stubs).toHaveLength(1);
      expect(stubs[0].nodeRef).toBe('core-data');
      expect(stubs[0].nodeX).toBe(250);
      expect(stubs[0].nodeY).toBe(180);
      expect(stubs[0].nodeWidth).toBe(220);
      expect(stubs[0].nodeHeight).toBe(80);
    });

    it('handles three-level nesting: leaf under sub-group under visible group', () => {
      // core-data → core-data-sub → deep-svc  (three levels deep)
      const elements = [
        makeElement('core-data',     'core',           'Core Data'),
        makeElement('core-data-sub', 'core-data',      'Core Data Sub'),
        makeElement('deep-svc',      'core-data-sub',  'Deep Service'),
        makeElement('ext-group',     'root',           'External'),
        makeElement('ext-svc',       'ext-group',      'Ext Service'),
      ];
      const connectors = [makeConnector('c1', 'deep-svc', 'ext-svc', 'core')];
      const data = makeData(elements, connectors);
      const layout = makeLayout([{ ref: 'core-data', x: 100, y: 100 }]);

      const stubs = computeExternalStubs(data, 'core', layout);

      expect(stubs).toHaveLength(1);
      expect(stubs[0].nodeRef).toBe('core-data');
      expect(stubs[0].direction).toBe('outbound');
    });
  });
});
