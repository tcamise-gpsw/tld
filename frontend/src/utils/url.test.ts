import { describe, expect, it } from 'vitest'
import { trimTrailingSlash } from './url'

describe('trimTrailingSlash', () => {
  it('does not modify strings without trailing slashes', () => {
    expect(trimTrailingSlash('hello')).toBe('hello')
    expect(trimTrailingSlash('http://localhost:8060')).toBe('http://localhost:8060')
    expect(trimTrailingSlash('')).toBe('')
  })

  it('removes a single trailing slash', () => {
    expect(trimTrailingSlash('hello/')).toBe('hello')
    expect(trimTrailingSlash('http://localhost:8060/')).toBe('http://localhost:8060')
  })

  it('removes multiple trailing slashes', () => {
    expect(trimTrailingSlash('hello//')).toBe('hello')
    expect(trimTrailingSlash('http://localhost:8060///')).toBe('http://localhost:8060')
  })

  it('correctly handles strings of only slashes', () => {
    expect(trimTrailingSlash('/')).toBe('')
    expect(trimTrailingSlash('///')).toBe('')
  })

  it('executes extremely fast on strings with massive numbers of trailing slashes without backtracking issues', () => {
    const slashes = '/'.repeat(50000)
    const start = performance.now()
    const result = trimTrailingSlash('http://localhost:8060' + slashes)
    const duration = performance.now() - start

    expect(result).toBe('http://localhost:8060')
    // A linear loop should run in less than 5 milliseconds for 50k repetitions.
    // Regex replace(/\/+$/, '') on some engines can take hundreds of ms or cause issues.
    expect(duration).toBeLessThan(10)
  })
})
