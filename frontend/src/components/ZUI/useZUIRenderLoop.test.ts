import { describe, expect, it } from 'vitest'
import { isPanFrame } from './useZUIRenderLoop'
import type { ZUIViewState } from './types'

function viewState(overrides: Partial<ZUIViewState> = {}): ZUIViewState {
  return {
    x: 0,
    y: 0,
    zoom: 1,
    ...overrides,
  }
}

describe('isPanFrame', () => {
  it('does not treat the initial frame as panning', () => {
    expect(isPanFrame(null, viewState())).toBe(false)
  })

  it('detects pan deltas from a previous frame', () => {
    expect(isPanFrame(viewState(), viewState({ x: 12 }))).toBe(true)
    expect(isPanFrame(viewState(), viewState({ y: -8 }))).toBe(true)
  })

  it('ignores pure zoom changes', () => {
    expect(isPanFrame(viewState(), viewState({ zoom: 2 }))).toBe(false)
  })
})