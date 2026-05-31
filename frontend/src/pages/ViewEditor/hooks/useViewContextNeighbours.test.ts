import { describe, expect, it } from 'vitest'
import type { Node as RFNode } from 'reactflow'
import type { CrossBranchContextSettings, ProxyConnectorLeaf } from '../../../crossBranch/types'
import type { VisibleContextSummaryForest, VisibleContextSummaryNode } from './contextSummaryTree'
import { buildSummaryLayoutById, budgetExternalContextGroups, reconcileMeasuredContextNodes } from './useViewContextNeighbours'

function settings(connectorBudget: number): CrossBranchContextSettings {
  return {
    enabled: true,
    depth: 5,
    connectorBudget,
    connectorPriority: 'external',
  }
}

function visibleNode(
  id: string,
  depth: number,
  overrides: Partial<VisibleContextSummaryNode> = {},
): VisibleContextSummaryNode {
  return {
    id,
    elementId: depth + 1,
    pathElementIds: [depth + 1],
    parentId: null,
    childIds: [],
    directLeafIds: [],
    descendantLeafIds: [],
    depth,
    isExpanded: false,
    isAutoExpanded: false,
    visibleChildIds: [],
    totalLeafCount: 1,
    hiddenLeafCount: 0,
    ...overrides,
  }
}

function forest(
  nodesById: Record<string, VisibleContextSummaryNode>,
  rootIds: string[],
): VisibleContextSummaryForest {
  return {
    nodesById,
    rootIds,
    leafToVisibleNodeId: {},
  }
}

function connectors(count: number): ProxyConnectorLeaf[] {
  return Array.from({ length: count }, () => ({}) as ProxyConnectorLeaf)
}

describe('budgetExternalContextGroups', () => {
  it('caps noisy context stacks without hiding quieter neighbours', () => {
    const summaryForest = forest({
      'ctx:a': visibleNode('ctx:a', 0, { descendantLeafIds: ['a1', 'a2', 'a3'] }),
      'ctx:b': visibleNode('ctx:b', 0, { descendantLeafIds: ['b1'] }),
      'ctx:c': visibleNode('ctx:c', 0, { descendantLeafIds: ['c1'] }),
    }, ['ctx:a', 'ctx:b', 'ctx:c'])

    const selected = budgetExternalContextGroups([
      {
        pairKey: 'ctx:a::1',
        source: 'ctx:a',
        target: '1',
        contextNodeId: 'ctx:a',
        currentNodeId: '1',
        connectors: connectors(9),
      },
      {
        pairKey: 'ctx:a::2',
        source: 'ctx:a',
        target: '2',
        contextNodeId: 'ctx:a',
        currentNodeId: '2',
        connectors: connectors(6),
      },
      {
        pairKey: 'ctx:b::3',
        source: 'ctx:b',
        target: '3',
        contextNodeId: 'ctx:b',
        currentNodeId: '3',
        connectors: connectors(4),
      },
      {
        pairKey: 'ctx:c::4',
        source: 'ctx:c',
        target: '4',
        contextNodeId: 'ctx:c',
        currentNodeId: '4',
        connectors: connectors(3),
      },
    ], summaryForest, settings(10))

    expect(selected.map(({ pairKey }) => pairKey).sort()).toEqual(['ctx:a::1', 'ctx:b::3', 'ctx:c::4'])
  })
})

describe('buildSummaryLayoutById', () => {
  it('keeps sibling stack anchors fixed when a group expands outward', () => {
    const collapsedForest = forest({
      'ctx:root-a': visibleNode('ctx:root-a', 0, {
        childIds: ['ctx:child-a'],
        descendantLeafIds: ['leaf-a'],
      }),
      'ctx:root-b': visibleNode('ctx:root-b', 0, {
        descendantLeafIds: ['leaf-b'],
      }),
    }, ['ctx:root-a', 'ctx:root-b'])

    const expandedForest = forest({
      'ctx:root-a': visibleNode('ctx:root-a', 0, {
        childIds: ['ctx:child-a'],
        descendantLeafIds: ['leaf-a'],
        isExpanded: true,
        visibleChildIds: ['ctx:child-a'],
      }),
      'ctx:child-a': visibleNode('ctx:child-a', 1, {
        parentId: 'ctx:root-a',
        pathElementIds: [1, 2],
        descendantLeafIds: ['leaf-a'],
        directLeafIds: ['leaf-a'],
      }),
      'ctx:root-b': visibleNode('ctx:root-b', 0, {
        descendantLeafIds: ['leaf-b'],
      }),
    }, ['ctx:root-a', 'ctx:root-b'])

    const rootLayoutsBySide = {
      top: [],
      bottom: [],
      left: [],
      right: [
        { nodeId: 'ctx:root-a', centerX: 640, centerY: 120 },
        { nodeId: 'ctx:root-b', centerX: 640, centerY: 260 },
      ],
    }
    const bounds = {
      left: 0,
      right: 480,
      top: 0,
      bottom: 320,
    }

    const collapsedLayout = buildSummaryLayoutById(collapsedForest, rootLayoutsBySide, bounds)
    const expandedLayout = buildSummaryLayoutById(expandedForest, rootLayoutsBySide, bounds)

    expect(expandedLayout.get('ctx:root-a')?.position).toEqual(collapsedLayout.get('ctx:root-a')?.position)
    expect(expandedLayout.get('ctx:root-b')?.position).toEqual(collapsedLayout.get('ctx:root-b')?.position)
    expect((expandedLayout.get('ctx:child-a')?.position.x ?? 0)).toBeGreaterThan(expandedLayout.get('ctx:root-a')?.position.x ?? 0)
  })
})

describe('reconcileMeasuredContextNodes', () => {
  it('keeps measured context node references when recomputed nodes are equivalent', () => {
    const previousNode: RFNode = {
      id: 'ctx:service',
      type: 'contextNeighborNode',
      position: { x: 10, y: 20 },
      width: 212,
      height: 118,
      data: {
        name: 'Service',
        contextElementSignature: ['service', 1],
        relationshipDetailsSignature: ['connector', 1],
        onSelectElement: () => {},
        onOpenRelationshipDetails: () => {},
      },
    }
    const previous = [previousNode]
    const recomputed: RFNode[] = [{
      id: 'ctx:service',
      type: 'contextNeighborNode',
      position: { x: 10, y: 20 },
      width: 200,
      height: 100,
      data: {
        name: 'Service',
        contextElementSignature: ['service', 1],
        relationshipDetailsSignature: ['connector', 1],
        onSelectElement: () => {},
        onOpenRelationshipDetails: () => {},
      },
    }]

    const next = reconcileMeasuredContextNodes(previous, recomputed)

    expect(next).toBe(previous)
    expect(next[0]).toBe(previousNode)
  })

  it('replaces a measured context node when computed data changes', () => {
    const previousNode: RFNode = {
      id: 'ctx:service',
      type: 'contextNeighborNode',
      position: { x: 10, y: 20 },
      width: 212,
      height: 118,
      data: {
        name: 'Service',
        relationshipDetailsSignature: ['connector', 1],
        onOpenRelationshipDetails: () => {},
      },
    }
    const recomputed: RFNode[] = [{
      id: 'ctx:service',
      type: 'contextNeighborNode',
      position: { x: 10, y: 20 },
      width: 200,
      height: 100,
      data: {
        name: 'Service',
        relationshipDetailsSignature: ['connector', 2],
        onOpenRelationshipDetails: () => {},
      },
    }]

    const next = reconcileMeasuredContextNodes([previousNode], recomputed)

    expect(next[0]).not.toBe(previousNode)
    expect(next[0]?.width).toBe(212)
    expect(next[0]?.height).toBe(118)
  })
})
