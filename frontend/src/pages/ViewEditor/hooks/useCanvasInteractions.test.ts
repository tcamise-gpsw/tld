import { afterEach, describe, expect, it } from 'vitest'
import type { Node as RFNode, NodeChange } from 'reactflow'
import type { Connector } from '../../../types'
import {
  PENDING_ELEMENT_NODE_ID,
  applyPendingElementNodeChanges,
  getConnectorDeletionTarget,
  pendingElementPositionFromFlowPoint,
  resolveConnectorDropTarget,
  shouldDisplayConnectorDragPlaceholder,
  type PendingElementState,
} from './useCanvasInteractions'

const connector = (id: number): Connector => ({
  id,
  view_id: 1,
  source_element_id: 10,
  target_element_id: 20,
  label: null,
  description: null,
  relationship: null,
  direction: 'forward',
  style: 'bezier',
  url: null,
  source_handle: 'right',
  target_handle: 'left',
  tags: [],
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
})

const originalElement = globalThis.Element
const originalDocument = globalThis.document
const hadOriginalElement = 'Element' in globalThis
const hadOriginalDocument = 'document' in globalThis

class FakeElement {
  id = ''

  constructor(
    private readonly closestResults: Record<string, FakeElement | null>,
    private readonly attrs: Record<string, string> = {},
  ) { }

  closest(selector: string) {
    return this.closestResults[selector] ?? null
  }

  getAttribute(name: string) {
    return this.attrs[name] ?? null
  }
}

function node(id: string): RFNode {
  return { id, position: { x: 0, y: 0 }, data: {} } as RFNode
}

function installPointHitTest(elements: FakeElement[]) {
  Object.defineProperty(globalThis, 'Element', {
    configurable: true,
    value: FakeElement,
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      elementsFromPoint: () => elements,
      elementFromPoint: () => elements[0] ?? null,
    },
  })
}

afterEach(() => {
  if (hadOriginalElement) {
    Object.defineProperty(globalThis, 'Element', {
      configurable: true,
      value: originalElement,
    })
  } else {
    Reflect.deleteProperty(globalThis, 'Element')
  }

  if (hadOriginalDocument) {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    })
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

describe('getConnectorDeletionTarget', () => {
  it('returns the selected connector id', () => {
    expect(getConnectorDeletionTarget(connector(7))).toBe(7)
  })

  it('returns null when nothing is selected', () => {
    expect(getConnectorDeletionTarget(null)).toBeNull()
  })
})

describe('pending element node state', () => {
  const pending = (): PendingElementState => ({
    id: PENDING_ELEMENT_NODE_ID,
    position: { x: 100, y: 200 },
    mode: 'add',
    sourceElementIds: [],
    sourceHandle: null,
  })

  it('uses top-left placement from the requested flow point', () => {
    expect(pendingElementPositionFromFlowPoint(320, 180)).toEqual({ x: 220, y: 140 })
  })

  it('tracks pending node drag position without persisting it', () => {
    const changes: NodeChange[] = [{
      id: PENDING_ELEMENT_NODE_ID,
      type: 'position',
      position: { x: 150, y: 240 },
      dragging: true,
    }]

    expect(applyPendingElementNodeChanges(pending(), changes)).toEqual({
      ...pending(),
      position: { x: 150, y: 240 },
      dragging: true,
    })
  })

  it('cancels pending node state when the node is removed', () => {
    expect(applyPendingElementNodeChanges(pending(), [{ id: PENDING_ELEMENT_NODE_ID, type: 'remove' }])).toBeNull()
  })

  it('keeps preview metadata while tracking position updates', () => {
    const previewPending = { ...pending(), preview: true }
    const changes: NodeChange[] = [{
      id: PENDING_ELEMENT_NODE_ID,
      type: 'position',
      position: { x: 180, y: 260 },
      dragging: false,
    }]

    expect(applyPendingElementNodeChanges(previewPending, changes)).toEqual({
      ...previewPending,
      position: { x: 180, y: 260 },
      dragging: false,
    })
  })
})

describe('connector drag placeholder visibility', () => {
  it('shows the placeholder over empty canvas', () => {
    expect(shouldDisplayConnectorDragPlaceholder(null)).toBe(true)
  })

  it('shows the placeholder over the pending node itself to avoid self-flicker', () => {
    expect(shouldDisplayConnectorDragPlaceholder({ nodeId: PENDING_ELEMENT_NODE_ID, isHandle: false })).toBe(true)
  })

  it('hides the placeholder over a node body or handle', () => {
    expect(shouldDisplayConnectorDragPlaceholder({ nodeId: '12', isHandle: false })).toBe(false)
    expect(shouldDisplayConnectorDragPlaceholder({ nodeId: '12', isHandle: true })).toBe(false)
    expect(shouldDisplayConnectorDragPlaceholder({ isHandle: true })).toBe(false)
  })
})

describe('connector drop target resolution', () => {
  it('uses coordinate hit-testing before event target fallback', () => {
    const sourceNodeElement = new FakeElement({}, { 'data-id': '1' })
    const sourceEventTarget = new FakeElement({ '.react-flow__node': sourceNodeElement })
    const canvasElement = new FakeElement({})
    installPointHitTest([canvasElement])

    expect(resolveConnectorDropTarget(sourceEventTarget as unknown as EventTarget, 120, 160, [node('1')])).toEqual({
      droppedNode: null,
      droppedHandleId: null,
    })
  })

  it('resolves the handle under the release point', () => {
    const targetNodeElement = new FakeElement({}, { 'data-id': '2' })
    const targetHandleElement = new FakeElement({ '.react-flow__node': targetNodeElement }, { 'data-handleid': 'left-2' })
    const releaseTarget = new FakeElement({
      '.react-flow__node': targetNodeElement,
      '.react-flow__handle': targetHandleElement,
    })
    installPointHitTest([releaseTarget])

    expect(resolveConnectorDropTarget(null, 120, 160, [node('1'), node('2')])).toEqual({
      droppedNode: node('2'),
      droppedHandleId: 'left-2',
    })
  })
})
