import { describe, expect, it } from 'vitest'
import { toEmbedLabFlow } from './graph'

describe('toEmbedLabFlow', () => {
  it('preserves symbol metadata and toggles labels', () => {
    const result = toEmbedLabFlow(
      [
        {
          id: 'symbol:1',
          type: 'symbol',
          label: 'NewAnalyzeCmd',
          subtitle: 'cmd/analyze/analyze.go',
          data: { similarity: 1, score: 2.5 },
        },
      ],
      [
        {
          id: 'sim:1:2',
          source: 'symbol:1',
          target: 'symbol:2',
          type: 'similarity',
          label: '0.941',
          weight: 0.941,
        },
      ],
      true,
    )

    expect(result.nodes[0].data).toMatchObject({
      type: 'symbol',
      label: 'NewAnalyzeCmd',
      subtitle: 'cmd/analyze/analyze.go',
      similarity: 1,
      score: 2.5,
    })
    expect(result.edges[0]).toMatchObject({
      label: '0.941',
      animated: true,
      data: { type: 'similarity', weight: 0.941 },
    })
  })

  it('hides labels when disabled', () => {
    const result = toEmbedLabFlow(
      [],
      [{ id: 'ref:1', source: 'symbol:1', target: 'symbol:2', type: 'reference', label: 'calls' }],
      false,
    )

    expect(result.edges[0].label).toBeUndefined()
    expect(result.edges[0].animated).toBe(false)
  })
})
