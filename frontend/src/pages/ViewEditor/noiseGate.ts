import type { VisibilityOverride } from '../../types'

type NoiseGateOverride = Pick<VisibilityOverride, 'resource_type'>

export function hasViewNoiseGateConfiguration(overrides: NoiseGateOverride[]) {
  return overrides.length > 0
}

export function deriveViewNoiseGateEnabled(
  densityLevel: number,
  overrides: NoiseGateOverride[],
  pendingEnabled: boolean | null,
) {
  return pendingEnabled ?? (densityLevel !== 2 && hasViewNoiseGateConfiguration(overrides))
}
