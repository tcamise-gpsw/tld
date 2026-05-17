import { describe, expect, it } from 'vitest'
import { truncate } from './string'

describe('truncate', () => {
  it('does not truncate strings shorter than or equal to the limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('1234567890', 10)).toBe('1234567890')
  })

  it('truncates strings longer than the limit and adds ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
    expect(truncate('12345678901', 10)).toBe('1234567890...')
  })

  it('uses default limit of 15', () => {
    expect(truncate('123456789012345')).toBe('123456789012345')
    expect(truncate('1234567890123456')).toBe('123456789012345...')
  })
})
