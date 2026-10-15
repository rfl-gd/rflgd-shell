import { describe, expect, it } from 'vitest'

import { faviconHref } from './TenantTheme'

/**
 * Which image becomes the favicon. The mark is the square asset made for small
 * sizes; the logo is wide and gets squeezed into 16×16, which is ugly but still
 * tells you which tab you are on. Not every tenant has either — three of seven
 * carried a mark when this was written, one only a logo, two nothing at all.
 */
describe('faviconHref', () => {
  it('prefers the mark over the wide logo', () => {
    expect(faviconHref({ logoMarkUrl: '/mark.png', logoUrl: '/logo.png' })).toBe('/mark.png')
  })

  it('falls back to the logo when no mark is stored', () => {
    expect(faviconHref({ logoMarkUrl: null, logoUrl: '/logo.png' })).toBe('/logo.png')
    expect(faviconHref({ logoUrl: '/logo.png' })).toBe('/logo.png')
  })

  it('returns null when the tenant has neither', () => {
    // No placeholder: a foreign logo in the tab is worse than none.
    expect(faviconHref({ logoMarkUrl: null, logoUrl: null })).toBeNull()
    expect(faviconHref({})).toBeNull()
    expect(faviconHref(null)).toBeNull()
    expect(faviconHref(undefined)).toBeNull()
  })

  it('treats a blank string as absent', () => {
    expect(faviconHref({ logoMarkUrl: '   ', logoUrl: '/logo.png' })).toBe('/logo.png')
    expect(faviconHref({ logoMarkUrl: '', logoUrl: '' })).toBeNull()
  })
})
