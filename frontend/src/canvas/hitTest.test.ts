import { describe, it, expect } from 'vitest';
import { hitTestNodes, isDrag, PAN_THRESHOLD, hitTestGroupIcon } from './hitTest';
import { LayoutNode } from './layout';

describe('Hit Testing Module', () => {
  describe('hitTestNodes', () => {
    it('detects node under point', () => {
      const nodes: LayoutNode[] = [
        { ref: 'node-a', x: 100, y: 100, width: 220, height: 80, isGroup: false },
      ];
      const result = hitTestNodes(100, 100, nodes);
      expect(result).toBe('node-a');
    });

    it('returns null for point outside node', () => {
      const nodes: LayoutNode[] = [
        { ref: 'node-a', x: 100, y: 100, width: 220, height: 80, isGroup: false },
      ];
      const result = hitTestNodes(0, 0, nodes);
      expect(result).toBeNull();
    });

    it('detects point at node boundaries', () => {
      const nodes: LayoutNode[] = [
        { ref: 'node-a', x: 100, y: 100, width: 220, height: 80, isGroup: false },
      ];
      // Left edge
      const left = hitTestNodes(100 - 110, 100, nodes);
      expect(left).toBe('node-a');
      // Right edge
      const right = hitTestNodes(100 + 110, 100, nodes);
      expect(right).toBe('node-a');
      // Top edge
      const top = hitTestNodes(100, 100 - 40, nodes);
      expect(top).toBe('node-a');
      // Bottom edge
      const bottom = hitTestNodes(100, 100 + 40, nodes);
      expect(bottom).toBe('node-a');
    });

    it('returns topmost node when overlapping', () => {
      const nodes: LayoutNode[] = [
        { ref: 'node-a', x: 100, y: 100, width: 220, height: 80, isGroup: false },
        { ref: 'node-b', x: 100, y: 100, width: 220, height: 80, isGroup: false },
      ];
      const result = hitTestNodes(100, 100, nodes);
      expect(result).toBe('node-b'); // Last in array = visually on top
    });

    it('returns null for empty nodes array', () => {
      const result = hitTestNodes(100, 100, []);
      expect(result).toBeNull();
    });
  });

  describe('isDrag', () => {
    it('returns false for movement below threshold', () => {
      const result = isDrag(100, 100, 102, 101);
      expect(result).toBe(false);
    });

    it('returns true for movement above threshold', () => {
      const result = isDrag(100, 100, 106, 100);
      expect(result).toBe(true);
    });

    it('uses PAN_THRESHOLD correctly', () => {
      const result = isDrag(100, 100, 100 + PAN_THRESHOLD + 1, 100);
      expect(result).toBe(true);
    });

    it('returns false for no movement', () => {
      const result = isDrag(100, 100, 100, 100);
      expect(result).toBe(false);
    });

    it('calculates distance correctly for diagonal movement', () => {
      // 3-4-5 triangle: 3px + 4px = 5px distance (not > threshold)
      const result = isDrag(100, 100, 103, 104);
      expect(result).toBe(false); // 5px is not > 5px
      // sqrt(16+16) = 5.66px > 5px
      const result2 = isDrag(100, 100, 104, 104);
      expect(result2).toBe(true);
    });
  });
});

describe('hitTestGroupIcon', () => {
  it('should return node ref when point is within icon radius of a group node', () => {
    const nodes = [
      { ref: 'group1', x: 100, y: 100, width: 100, height: 100, isGroup: true }
    ];
    // Icon center: x = 100 + 50 - 12 = 138, y = 100 - 50 + 12 = 62
    expect(hitTestGroupIcon(138, 62, nodes)).toBe('group1');
    expect(hitTestGroupIcon(140, 60, nodes)).toBe('group1'); // within 12px
    expect(hitTestGroupIcon(100, 100, nodes)).toBeNull(); // center of node, outside icon
  });

  it('should ignore non-group nodes', () => {
    const nodes = [
      { ref: 'leaf1', x: 100, y: 100, width: 100, height: 100, isGroup: false }
    ];
    expect(hitTestGroupIcon(138, 62, nodes)).toBeNull();
  });
});
