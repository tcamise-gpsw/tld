export type EmbedLabNode = {
  id: string
  type: string
  label: string
  subtitle?: string
  data?: {
    similarity?: number
    score?: number
    [key: string]: unknown
  }
}

export type EmbedLabEdge = {
  id: string
  source: string
  target: string
  type: string
  label?: string
  weight?: number
}

export type FlowNode = {
  id: string
  type: 'embed'
  position: { x: number; y: number }
  data: {
    type: string
    label: string
    subtitle: string
    similarity?: number
    score?: number
  }
}

export type FlowEdge = {
  id: string
  source: string
  target: string
  label?: string
  animated: boolean
  data: {
    type: string
    weight?: number
  }
}

export function toEmbedLabFlow(nodes: EmbedLabNode[], edges: EmbedLabEdge[], showLabels: boolean) {
  return {
    nodes: nodes.map((node, index): FlowNode => ({
      id: node.id,
      type: 'embed',
      position: {
        x: Math.cos(index * 0.75) * (220 + index * 8),
        y: Math.sin(index * 0.75) * (180 + index * 6),
      },
      data: {
        type: node.type,
        label: node.label,
        subtitle: node.subtitle ?? '',
        similarity: node.data?.similarity,
        score: node.data?.score,
      },
    })),
    edges: edges.map((edge): FlowEdge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: showLabels ? edge.label : undefined,
      animated: edge.type === 'similarity',
      data: {
        type: edge.type,
        weight: edge.weight,
      },
    })),
  }
}
