import { describe, expect, it } from 'vitest'
import { normalizeConnectorRouteStyle, normalizeLogoUrl, normalizeTechnologyConnectors } from './client'

describe('normalizeConnectorRouteStyle', () => {
  it('keeps valid route styles', () => {
    expect(normalizeConnectorRouteStyle('bezier')).toBe('bezier')
    expect(normalizeConnectorRouteStyle('straight')).toBe('straight')
    expect(normalizeConnectorRouteStyle('step')).toBe('step')
    expect(normalizeConnectorRouteStyle('smoothstep')).toBe('smoothstep')
  })

  it('maps legacy line styles to bezier', () => {
    expect(normalizeConnectorRouteStyle('solid')).toBe('bezier')
    expect(normalizeConnectorRouteStyle('dashed')).toBe('bezier')
    expect(normalizeConnectorRouteStyle(undefined)).toBe('bezier')
  })
})

describe('technology icon normalization', () => {
  it('derives a logo url from primary catalog technology links when logo_url is absent', () => {
    const links = normalizeTechnologyConnectors([
      { type: 'catalog', slug: 'golang', label: 'Go', isPrimaryIcon: true },
    ])

    expect(normalizeLogoUrl(undefined, links)).toBe('/icons/golang.png')
  })

  it('preserves explicit no-icon logo clears', () => {
    const links = normalizeTechnologyConnectors([
      { type: 'catalog', slug: 'golang', label: 'Go', isPrimaryIcon: true },
    ])

    expect(normalizeLogoUrl('', links)).toBe('')
  })
})
