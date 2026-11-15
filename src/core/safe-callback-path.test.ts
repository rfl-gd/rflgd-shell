import { describe, expect, it } from 'vitest'

import { safeCallbackPath } from './safe-callback-path'

const base = 'https://app.example.test'

describe('safeCallbackPath', () => {
  it.each([
    ['an absolute URL', 'https://evil.example.test/x'],
    ['a protocol-relative URL', '//evil.example.test'],
    ['a backslash host', '/\\evil.example.test'],
    ['a tab between the slashes', '/\t/evil.example.test'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an encoded protocol-relative URL', '%2F%2Fevil.example.test'],
    ['dot segments that collapse to a protocol-relative URL', '/.//evil.example.test'],
    ['an empty value', ''],
  ])('falls back to /admin for %s', (_, raw) => {
    expect(safeCallbackPath(raw, base)).toBe('/admin')
  })

  it('falls back to /admin when the value is missing', () => {
    expect(safeCallbackPath(null, base)).toBe('/admin')
    expect(safeCallbackPath(undefined, base)).toBe('/admin')
  })

  it('keeps a same-origin path with query and fragment', () => {
    expect(safeCallbackPath('/chat/42?tab=files#top', base)).toBe('/chat/42?tab=files#top')
  })

  it('normalises the path', () => {
    expect(safeCallbackPath('/a/../chat', base)).toBe('/chat')
  })

  it('accepts a base with a path', () => {
    expect(safeCallbackPath('/chat', 'https://app.example.test/some/where')).toBe('/chat')
  })
})
