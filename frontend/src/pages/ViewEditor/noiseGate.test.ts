import { describe, expect, it } from 'vitest'
import { deriveViewNoiseGateEnabled, hasViewNoiseGateConfiguration } from './noiseGate'

describe('ViewEditor noise gate state', () => {
  it('does not treat a default normal density as enabled without overrides', () => {
    expect(hasViewNoiseGateConfiguration([])).toBe(false)
    expect(deriveViewNoiseGateEnabled(0, [], null)).toBe(false)
  })

  it('treats persisted visibility overrides as noise gate configuration', () => {
    const overrides = [{ resource_type: 'element' as const }]

    expect(hasViewNoiseGateConfiguration(overrides)).toBe(true)
    expect(deriveViewNoiseGateEnabled(0, overrides, null)).toBe(true)
  })

  it('keeps configured gates disabled at full density unless a pending toggle is active', () => {
    const overrides = [{ resource_type: 'element' as const }]

    expect(deriveViewNoiseGateEnabled(2, overrides, null)).toBe(false)
    expect(deriveViewNoiseGateEnabled(2, overrides, true)).toBe(true)
  })
})
