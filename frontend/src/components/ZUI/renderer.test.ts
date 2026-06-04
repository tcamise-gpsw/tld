import { describe, expect, it } from 'vitest'
import { createNodeScreenState, type SceneNode } from './sceneGraph'
import { nodeConnectorEndpointAlphaFromState } from './renderer'
import type { LayoutNode } from './types'

function layoutNode(id: string, elementId: number, children: LayoutNode[] = []): LayoutNode {
  return {
    id,
    elementId,
    diagramId: elementId,
    worldX: 0,
    worldY: 0,
    worldW: 100,
    worldH: 100,
    label: id,
    type: 'service',
    logoUrl: null,
    description: null,
    technology: null,
    tags: [],
    ancestorElementIds: [],
    pathElementIds: [elementId],
    children,
    childScale: 1,
    childOffsetX: 0,
    childOffsetY: 0,
    edgesOut: [],
  }
}

function sceneNode(layout: LayoutNode, partialState: Partial<SceneNode['state']> = {}): SceneNode {
  return {
    layout,
    children: [],
    state: {
      ...createNodeScreenState(),
      ...partialState,
    },
  }
}

describe('nodeConnectorEndpointAlphaFromState', () => {
  it('keeps expanded parent boundary anchors usable for native connectors', () => {
    const node = sceneNode(layoutNode('parent', 1, [layoutNode('child', 2)]), {
      inheritedAlpha: 1,
      parentAlpha: 0,
      t: 1,
    })

    expect(nodeConnectorEndpointAlphaFromState(node)).toBeGreaterThan(0)
  })
})
