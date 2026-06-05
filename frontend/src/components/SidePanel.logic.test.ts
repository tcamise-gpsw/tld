import { describe, it, expect, vi } from 'vitest';
import { resolveConnectors, sortConnectors, ConnectorRow } from './SidePanel.logic';
import { DiagramData, Connector } from '../data/types';
import * as loader from '../data/loader';

vi.mock('../data/loader', () => ({
  getNodeConnectors: vi.fn(),
  isExternalToView: vi.fn(),
}));

describe('SidePanel Logic', () => {
  describe('resolveConnectors', () => {
    it('should correctly classify inbound and outbound connectors and resolve names', () => {
      const mockData = {
        elements: new Map([
          ['nodeA', { name: 'Node A', kind: 'component', placements: [] }],
          ['nodeB', { name: 'Node B', kind: 'component', placements: [] }],
          ['nodeC', { name: 'Node C', kind: 'component', placements: [] }],
        ]),
        connectors: [],
        viewTree: {},
      } as unknown as DiagramData;

      const mockConnectors: Connector[] = [
        { id: '1', source: 'nodeA', target: 'nodeB', view: 'view1', style: 'sync', direction: 'forward' },
        { id: '2', source: 'nodeC', target: 'nodeA', view: 'view1', style: 'async', direction: 'forward' },
      ];

      vi.mocked(loader.getNodeConnectors).mockReturnValue(mockConnectors);
      vi.mocked(loader.isExternalToView).mockReturnValue(false);

      const result = resolveConnectors(mockData, 'nodeA', 'view1');

      expect(result.inboundCount).toBe(1);
      expect(result.outboundCount).toBe(1);
      expect(result.connectors).toHaveLength(2);

      const outbound = result.connectors.find(c => c.direction === 'Outbound');
      expect(outbound?.target).toBe('Node B');
      expect(outbound?.type).toBe('sync');

      const inbound = result.connectors.find(c => c.direction === 'Inbound');
      expect(inbound?.target).toBe('Node C');
      expect(inbound?.type).toBe('async');
    });
  });

  describe('sortConnectors', () => {
    const mockRows: ConnectorRow[] = [
      { id: '1', direction: 'Outbound', target: 'Zebra', type: 'Async', view: 'B', isExternal: false },
      { id: '2', direction: 'Inbound', target: 'Apple', type: 'Sync', view: 'A', isExternal: false },
      { id: '3', direction: 'Outbound', target: 'Mango', type: 'Event', view: 'C', isExternal: false },
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
