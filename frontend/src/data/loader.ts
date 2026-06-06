import { DiagramData, Element, Connector, ViewTree, ViewNode, RawElement, RawConnector } from './types';
import * as yaml from 'js-yaml';

export async function loadDiagramData(): Promise<DiagramData> {
  const [elementsYaml, connectorsYaml] = await Promise.all([
    fetch('/elements.yaml').then((r) => r.text()),
    fetch('/connectors.yaml').then((r) => r.text()),
  ]);
  return parseDiagramData(elementsYaml, connectorsYaml);
}

export function parseDiagramData(elementsYaml: string, connectorsYaml: string): DiagramData {
  const rawElements = yaml.load(elementsYaml) as Record<string, RawElement>;
  const rawConnectors = yaml.load(connectorsYaml) as RawConnector[];

  const elements = new Map<string, Element>();
  if (rawElements) {
    Object.entries(rawElements).forEach(([ref, elem]) => {
      elements.set(ref, {
        ref,
        name: elem.name,
        kind: elem.kind,
        description: elem.description,
        technology: elem.technology,
        has_view: elem.has_view ?? false,
        placements: elem.placements || [],
        file_path: elem.file_path,
        language: elem.language,
      });
    });
  }

  const viewTree = buildViewTree(elements);

  const connectors = (rawConnectors || []).filter((conn) => {
    const sourceExists = elements.has(conn.source);
    const targetExists = elements.has(conn.target);
    const isSelfLoop = conn.source === conn.target;
    return sourceExists && targetExists && !isSelfLoop;
  });

  return { elements, connectors, viewTree };
}

function buildViewTree(elements: Map<string, Element>): ViewTree {
  const nodes = new Map<string, ViewNode>();

  const root: ViewNode = {
    ref: 'root',
    name: 'Root',
    kind: 'root',
    description: 'Architecture root',
    has_view: true,
    children: [],
    parent: 'root',
  };
  nodes.set('root', root);

  elements.forEach((elem, ref) => {
    const node: ViewNode = {
      ref,
      name: elem.name,
      kind: elem.kind,
      description: elem.description,
      has_view: elem.has_view,
      children: [],
      parent: '',
    };
    nodes.set(ref, node);
  });

  elements.forEach((elem, ref) => {
    if (elem.placements.length > 0) {
      const parentRef = elem.placements[0].parent;
      const node = nodes.get(ref)!;
      node.parent = parentRef;

      const parent = nodes.get(parentRef);
      if (parent) {
        parent.children.push(ref);
      } else {
        node.parent = 'root';
        root.children.push(ref);
      }
    } else {
      const node = nodes.get(ref)!;
      node.parent = 'root';
      root.children.push(ref);
    }
  });

  return { nodes, root };
}

export function getViewElements(data: DiagramData, viewRef: string): Element[] {
  const viewNode = data.viewTree.nodes.get(viewRef);
  if (!viewNode) return [];
  return viewNode.children
    .map((childRef) => data.elements.get(childRef))
    .filter((elem): elem is Element => elem !== undefined);
}

export function getViewConnectors(data: DiagramData, viewRef: string): Connector[] {
  return data.connectors.filter((conn) => conn.view === viewRef);
}

export function getNodeConnectors(data: DiagramData, elementRef: string): Connector[] {
  return data.connectors.filter((conn) => conn.source === elementRef || conn.target === elementRef);
}

export function getViewChildRefs(data: DiagramData, viewRef: string): Set<string> {
  const viewNode = data.viewTree.nodes.get(viewRef);
  if (!viewNode) return new Set();
  return new Set(viewNode.children);
}

export function isExternalToView(connector: Connector, currentView: string, data: DiagramData): boolean {
  const sourceElem = data.elements.get(connector.source);
  const targetElem = data.elements.get(connector.target);

  if (!sourceElem || !targetElem) return false;

  const sourceParent = sourceElem.placements[0]?.parent || 'root';
  const targetParent = targetElem.placements[0]?.parent || 'root';

  const sourceIsChild = sourceParent === currentView;
  const targetIsChild = targetParent === currentView;

  return sourceIsChild !== targetIsChild;
}

export function getExternalConnectors(data: DiagramData, viewRef: string, elementRef: string): Connector[] {
  return getNodeConnectors(data, elementRef).filter((conn) => isExternalToView(conn, viewRef, data));
}

/**
 * Recursively collect all descendant refs of a node (not including the node itself).
 * Uses the viewTree children structure built from placements.
 */
export function getDescendantRefs(data: DiagramData, nodeRef: string): Set<string> {
  const descendants = new Set<string>();
  const viewNode = data.viewTree.nodes.get(nodeRef);
  if (!viewNode) return descendants;

  const queue = [...viewNode.children];
  while (queue.length > 0) {
    const ref = queue.pop()!;
    if (descendants.has(ref)) continue;
    descendants.add(ref);
    const child = data.viewTree.nodes.get(ref);
    if (child) {
      queue.push(...child.children);
    }
  }
  return descendants;
}
