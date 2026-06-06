import { describe, it, expect, vi } from 'vitest';
import { resolveConnectors, sortConnectors, ConnectorRow } from './SidePanel.logic';
import { DiagramData, Connector } from '../data/types';
import * as loader from '../data/loader';

vi.mock('../data/loader', () => ({
  getDescendantRefs: vi.fn(),
}));

describe('SidePanel Logic', () => {
  describe('resolveConnectors', () => {
    it('should correctly classify inbound and outbound connectors and resolve names', () => {
      const mockData = {
        elements: new Map([
          ['nodeA', { name: 'Node A', kind: 'component', has_view: false, placements: [] }],
          ['nodeB', { name: 'Node B', kind: 'component', has_view: true, placements: [] }],
          ['nodeC', { name: 'Node C', kind: 'component', has_view: false, placements: [] }],
        ]),
        connectors: [
          { id: '1', source: 'nodeA', target: 'nodeB', view: 'view1', style: 'smoothstep', direction: 'forward', relationship: 'sync' },
          { id: '2', source: 'nodeC', target: 'nodeA', view: 'view1', style: 'smoothstep', direction: 'forward', relationship: 'async' },
        ] as Connector[],
        viewTree: { nodes: new Map(), root: { ref: 'root', name: 'Root', kind: 'root', description: '', has_view: true, children: [], parent: 'root' } },
      } as unknown as DiagramData;

      // First call: descendants of selectedNode ('nodeA') — leaf, no descendants.
      // Second call: descendants of currentView ('view1') — contains all nodes.
      vi.mocked(loader.getDescendantRefs)
        .mockReturnValueOnce(new Set())
        .mockReturnValueOnce(new Set(['nodeA', 'nodeB', 'nodeC']));

      const result = resolveConnectors(mockData, 'nodeA', 'view1');

      expect(result.inboundCount).toBe(1);
      expect(result.outboundCount).toBe(1);
      expect(result.connectors).toHaveLength(2);

      const outbound = result.connectors.find(c => c.direction === 'Outbound');
      expect(outbound?.target).toBe('Node B');
      expect(outbound?.targetRef).toBe('nodeB');
      expect(outbound?.targetHasView).toBe(true);
      expect(outbound?.type).toBe('sync');

      const inbound = result.connectors.find(c => c.direction === 'Inbound');
      expect(inbound?.target).toBe('Node C');
      expect(inbound?.targetRef).toBe('nodeC');
      expect(inbound?.targetHasView).toBe(false);
      expect(inbound?.type).toBe('async');
    });

    it('should surface connectors of descendants when selecting a group node', () => {
      // group-cache contains child-a and child-b as descendants.
      // Connectors reference the children, not the group itself.
      const mockData = {
        elements: new Map([
          ['group-cache', { name: 'Cache', kind: 'group', has_view: true, placements: [{ parent: 'root' }] }],
          ['child-a', { name: 'Child A', kind: 'component', has_view: false, placements: [{ parent: 'group-cache' }] }],
          ['child-b', { name: 'Child B', kind: 'component', has_view: false, placements: [{ parent: 'group-cache' }] }],
          ['external-x', { name: 'External X', kind: 'component', has_view: false, placements: [{ parent: 'root' }] }],
          ['external-y', { name: 'External Y', kind: 'component', has_view: true, placements: [{ parent: 'root' }] }],
        ]),
        connectors: [
          // child-a → external-x (outbound from group perspective)
          { id: 'c1', source: 'child-a', target: 'external-x', view: 'root', style: 'smoothstep', direction: 'forward', relationship: 'dependency' },
          // external-y → child-b (inbound to group perspective)
          { id: 'c2', source: 'external-y', target: 'child-b', view: 'root', style: 'smoothstep', direction: 'forward', relationship: 'uses' },
          // child-a → child-b (internal, should be excluded)
          { id: 'c3', source: 'child-a', target: 'child-b', view: 'root', style: 'smoothstep', direction: 'forward', relationship: 'internal' },
        ] as Connector[],
        viewTree: { nodes: new Map(), root: { ref: 'root', name: 'Root', kind: 'root', description: '', has_view: true, children: [], parent: 'root' } },
      } as unknown as DiagramData;

      // First call: descendants of selectedNode ('group-cache') — contains child-a and child-b.
      // Second call: descendants of currentView ('root') — contains everything.
      vi.mocked(loader.getDescendantRefs)
        .mockReturnValueOnce(new Set(['child-a', 'child-b']))
        .mockReturnValueOnce(new Set(['group-cache', 'child-a', 'child-b', 'external-x', 'external-y']));

      const result = resolveConnectors(mockData, 'group-cache', 'root');

      // Internal connector (child-a → child-b) excluded; only boundary-crossing ones shown
      expect(result.connectors).toHaveLength(2);
      expect(result.outboundCount).toBe(1);
      expect(result.inboundCount).toBe(1);

      const outbound = result.connectors.find(c => c.direction === 'Outbound');
      expect(outbound?.target).toBe('External X');
      expect(outbound?.targetRef).toBe('external-x');
      expect(outbound?.type).toBe('dependency');

      const inbound = result.connectors.find(c => c.direction === 'Inbound');
      expect(inbound?.target).toBe('External Y');
      expect(inbound?.targetRef).toBe('external-y');
      expect(inbound?.type).toBe('uses');
    });
  });

  describe('sortConnectors', () => {
    const mockRows: ConnectorRow[] = [
      { id: '1', direction: 'Outbound', target: 'Zebra', targetRef: 'zebra-ref', targetHasView: false, type: 'Async', view: 'B', isExternal: false },
      { id: '2', direction: 'Inbound', target: 'Apple', targetRef: 'apple-ref', targetHasView: true, type: 'Sync', view: 'A', isExternal: false },
      { id: '3', direction: 'Outbound', target: 'Mango', targetRef: 'mango-ref', targetHasView: false, type: 'Event', view: 'C', isExternal: false },
    ];

    it('should sort by Target ascending', () => {
      const sorted = sortConnectors(mockRows, 'Target', false);
      expect(sorted.map(r => r.target)).toEqual(['Apple', 'Mango', 'Zebra']);
    });

    it('should sort by Target descending', () => {
      const sorted = sortConnectors(mockRows, 'Target', true);
      expect(sorted.map(r => r.target)).toEqual(['Zebra', 'Mango', 'Apple']);
    });

    it('should sort by Direction ascending', () => {
      const sorted = sortConnectors(mockRows, 'Direction', false);
      expect(sorted.map(r => r.direction)).toEqual(['Inbound', 'Outbound', 'Outbound']);
    });

    it('should sort by View descending', () => {
      const sorted = sortConnectors(mockRows, 'View', true);
      expect(sorted.map(r => r.view)).toEqual(['C', 'B', 'A']);
    });
  });
});
