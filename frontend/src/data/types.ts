export interface RawElement {
  name: string;
  kind: string;
  description: string;
  technology: string;
  has_view?: boolean;
  placements?: { parent: string }[];
  file_path?: string;
  language?: string;
}

export type RawConnector = Connector;

export interface Element {
  ref: string;
  name: string;
  kind: string;
  description: string;
  technology: string;
  has_view: boolean;
  placements: { parent: string }[];
  file_path?: string;
  language?: string;
}

export interface Connector {
  id?: string;
  source: string;
  target: string;
  label?: string;
  view: string;
  level?: string;
  relationship?: string;
  direction?: string;
  style?: string;
}

export interface ViewNode {
  ref: string;
  name: string;
  kind: string;
  description: string;
  has_view: boolean;
  children: string[];
  parent: string;
}

export interface ViewTree {
  nodes: Map<string, ViewNode>;
  root: ViewNode;
}

export interface DiagramData {
  elements: Map<string, Element>;
  connectors: Connector[];
  viewTree: ViewTree;
}
