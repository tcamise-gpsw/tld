import { describe, expect, it } from 'vitest'
import type { Connector, LibraryElement, ViewTreeNode } from '../types'
import { buildInventoryRows, dependencyConnectorToConnector, filterInventoryRows } from './inventoryData'

const element = (id: number, name: string, tags: string[] = []): LibraryElement => ({
  id,
  name,
  kind: 'service',
  description: null,
  technology: 'Go',
  url: null,
  logo_url: null,
  technology_connectors: [],
  tags,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  has_view: id === 1,
  view_label: id === 1 ? 'Container' : null,
})

const view = (id: number, name: string, tags: string[] = []): ViewTreeNode => ({
  id,
  owner_element_id: null,
  name,
  description: null,
  level_label: 'Context',
  tags,
  level: 0,
  depth: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
  parent_view_id: null,
  children: [],
})

const connector = (id: number, tags: string[] = []): Connector => ({
  id,
  view_id: 10,
  source_element_id: 1,
  target_element_id: 2,
  label: 'writes',
  description: null,
  relationship: 'SQL',
  direction: 'forward',
  style: 'bezier',
  url: null,
  source_handle: null,
  target_handle: null,
  tags,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-04T00:00:00Z',
})

describe('inventoryData', () => {
  it('builds rows with relationship labels and quality flags', () => {
    const rows = buildInventoryRows(
      [element(1, 'API', ['payments']), element(2, 'Database')],
      [view(10, 'System Context')],
      [connector(20, ['critical'])],
      { 10: { placements: 2, connectors: 1 } },
    )

    expect(rows.map((row) => row.key)).toContain('element:1')
    expect(rows.find((row) => row.key === 'connector:20')).toMatchObject({
      name: 'writes',
      subtitle: 'API -> Database',
      viewName: 'System Context',
      tags: ['critical'],
    })
    expect(rows.find((row) => row.key === 'view:10')?.qualityFlags).toContain('untagged')
  })

  it('filters by object type, search, tag, kind, and quality', () => {
    const rows = buildInventoryRows(
      [element(1, 'Payments API', ['payments']), element(2, 'Ledger DB')],
      [view(10, 'Payments View', ['payments'])],
      [connector(20)],
      { 10: { placements: 0, connectors: 0 } },
    )

    expect(filterInventoryRows(rows, { type: 'elements', query: 'payments', tag: '', kind: '', quality: '' }).map((row) => row.key)).toEqual(['element:1'])
    expect(filterInventoryRows(rows, { type: 'all', query: '', tag: 'payments', kind: '', quality: '' }).map((row) => row.key).sort()).toEqual(['element:1', 'view:10'])
    expect(filterInventoryRows(rows, { type: 'views', query: '', tag: '', kind: 'Context', quality: 'empty view' }).map((row) => row.key)).toEqual(['view:10'])
  })

  it('converts dependency connectors into editable connectors with tags', () => {
    expect(dependencyConnectorToConnector({
      id: '5',
      view_id: '7',
      source_element_id: '1',
      target_element_id: '2',
      label: null,
      description: null,
      relationship_type: 'HTTP',
      direction: 'forward',
      connector_type: 'step',
      url: null,
      source_handle: null,
      target_handle: null,
      tags: ['edge'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    })).toMatchObject({ id: 5, view_id: 7, relationship: 'HTTP', style: 'step', tags: ['edge'] })
  })
})
