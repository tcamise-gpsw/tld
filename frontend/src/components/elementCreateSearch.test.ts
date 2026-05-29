import { describe, expect, it } from 'vitest'
import type { LibraryElement } from '../types'
import { buildElementCreateSearchResults } from './elementCreateSearch'

const element = (id: number, name: string): LibraryElement => ({
  id,
  name,
  kind: 'service',
  description: null,
  technology: null,
  url: null,
  logo_url: null,
  technology_connectors: [],
  tags: [],
  created_at: '',
  updated_at: '',
  has_view: false,
  view_label: null,
})

describe('buildElementCreateSearchResults', () => {
  it('keeps create-new as the first result before matches', () => {
    const results = buildElementCreateSearchResults({
      query: 'api',
      allElements: [element(1, 'API Gateway')],
      remoteElements: [element(2, 'Billing API')],
    })

    expect(results.map((result) => result.kind)).toEqual(['new', 'existing', 'existing'])
    expect(results[0]).toEqual({ kind: 'new', label: 'api' })
  })

  it('uses Unnamed for blank create labels', () => {
    expect(buildElementCreateSearchResults({
      query: '   ',
      allElements: [],
      remoteElements: [],
    })).toEqual([{ kind: 'new', label: 'Unnamed' }])
  })
})
