import { describe, it, expect, beforeEach } from 'vitest';
import { computeLayout, getOrComputeLayout, invalidateLayout } from './layout';
import { Element, Connector } from '../data/types';

function createTestElements(): Element[] {
  return [
    {
      ref: 'elem-a',
      name: 'elem-a',
      kind: 'class',
      description: 'Element A',
      technology: 'kotlin',
      has_view: false,
      placements: [{ parent: 'root' }],
    },
    {
      ref: 'elem-b',
      name: 'elem-b',
      kind: 'class',
      description: 'Element B',
      technology: 'kotlin',
      has_view: false,
      placements: [{ parent: 'root' }],
    },
    {
      ref: 'elem-c',
      name: 'elem-c',
      kind: 'class',
      description: 'Element C',
      technology: 'kotlin',
      has_view: false,
      placements: [{ parent: 'root' }],
    },
  ];
}

function createTestConnectors(): Connector[] {
  return [
    {
      view: 'root',
      source: 'elem-a',
      target: 'elem-b',
      direction: 'forward',
      style: 'smoothstep',
      id: 'conn-1',
    },
    {
      view: 'root',
      source: 'elem-b',
      target: 'elem-c',
      direction: 'forward',
      style: 'smoothstep',
      id: 'conn-2',
    },
  ];
}

describe('Layout Module', () => {
  describe('computeLayout', () => {
    it('produces positioned nodes from elements', () => {
      const elements = createTestElements();
      const connectors = createTestConnectors();
      const layout = computeLayout(elements, connectors);

      expect(layout.nodes).toHaveLength(3);
      expect(layout.edges).toHaveLength(2);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('all nodes have valid positions', () => {
      const elements = createTestElements();
      const connectors = createTestConnectors();
      const layout = computeLayout(elements, connectors);

      for (const node of layout.nodes) {
        expect(typeof node.x).toBe('number');
        expect(typeof node.y).toBe('number');
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
      }
    });

    it('handles empty elements gracefully', () => {
      const layout = computeLayout([], []);
      expect(layout.nodes).toHaveLength(0);
      expect(layout.edges).toHaveLength(0);
      expect(layout.width).toBe(0);
      expect(layout.height).toBe(0);
    });

    it('marks groups correctly', () => {
      const elements: Element[] = [
        {
          ref: 'group-a',
          name: 'group-a',
          kind: 'group',
          description: 'Group A',
          technology: 'kotlin',
          has_view: true,
          placements: [{ parent: 'root' }],
        },
        {
          ref: 'elem-a',
          name: 'elem-a',
          kind: 'class',
          description: 'Element A',
          technology: 'kotlin',
          has_view: false,
          placements: [{ parent: 'root' }],
        },
      ];
      const layout = computeLayout(elements, []);

      const groupNode = layout.nodes.find((n) => n.ref === 'group-a');
      const elemNode = layout.nodes.find((n) => n.ref === 'elem-a');

      expect(groupNode?.isGroup).toBe(true);
      expect(elemNode?.isGroup).toBe(false);
    });
  });

  describe('getOrComputeLayout', () => {
    beforeEach(() => {
      invalidateLayout();
    });

    it('returns cached layout on second call', () => {
      const elements = createTestElements();
      const connectors = createTestConnectors();

      const layout1 = getOrComputeLayout('root', elements, connectors);
      const layout2 = getOrComputeLayout('root', elements, connectors);

      expect(layout1).toBe(layout2);
    });

    it('computes new layout for different view', () => {
      const elements = createTestElements();
      const connectors = createTestConnectors();

      const layout1 = getOrComputeLayout('root', elements, connectors);
      const layout2 = getOrComputeLayout('other', elements, connectors);

      expect(layout1).not.toBe(layout2);
    });
  });

  describe('invalidateLayout', () => {
    it('clears specific cache entry', () => {
      const elements = createTestElements();
      const connectors = createTestConnectors();

      const layout1 = getOrComputeLayout('root', elements, connectors);
      invalidateLayout('root');
      const layout2 = getOrComputeLayout('root', elements, connectors);

      expect(layout1).not.toBe(layout2);
    });

    it('clears all cache entries', () => {
      const elements = createTestElements();
      const connectors = createTestConnectors();

      getOrComputeLayout('root', elements, connectors);
      getOrComputeLayout('other', elements, connectors);
      invalidateLayout();

      const layout1 = getOrComputeLayout('root', elements, connectors);
      const layout2 = getOrComputeLayout('other', elements, connectors);

      expect(layout1).toBeDefined();
      expect(layout2).toBeDefined();
    });
  });
});
