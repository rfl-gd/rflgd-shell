import { describe, expect, it } from 'vitest'

import { faviconHref, keepTenantFaviconLast } from './TenantTheme'

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

/**
 * Minimal stand-in for `document.head`: an ordered child list with the two
 * operations the favicon placement uses. Removal is recorded, never performed,
 * so a test sees every attempt to detach a node.
 */
type FakeLink = { rel: string; media: string; removed: boolean; remove(): void }

function fakeLink(rel = 'icon', media = ''): FakeLink {
  return {
    rel,
    media,
    removed: false,
    remove() {
      this.removed = true
    },
  }
}

function fakeHead(children: FakeLink[]) {
  let appends = 0
  return {
    children,
    appends: () => appends,
    querySelectorAll: () => children.filter((c) => /\bicon\b/.test(c.rel)),
    appendChild(node: FakeLink) {
      appends++
      const at = children.indexOf(node)
      if (at !== -1) children.splice(at, 1)
      children.push(node)
      return node
    },
  }
}

/**
 * The app renders favicons of its own through React (Payload: one per colour
 * scheme), and Next re-inserts them on every client navigation. Those nodes
 * belong to React: detaching them makes React's next commit fail with
 * "Cannot read properties of null (reading 'removeChild')" and the navigation
 * never finishes.
 */
describe('keepTenantFaviconLast', () => {
  it('never detaches the app\'s own icon links', () => {
    const appIcon = fakeLink()
    const ours = fakeLink()
    const head = fakeHead([ours, appIcon])

    keepTenantFaviconLast(head as never, ours as never)

    expect(appIcon.removed).toBe(false)
    expect(head.children).toContain(appIcon)
  })

  it('switches the app\'s icons off so the tenant icon wins in every browser', () => {
    const light = fakeLink()
    const dark = fakeLink('icon', '(prefers-color-scheme: dark)')
    const ours = fakeLink()
    const head = fakeHead([light, dark, ours])

    keepTenantFaviconLast(head as never, ours as never)

    expect(light.media).toBe('not all')
    expect(dark.media).toBe('not all')
    expect(ours.media).toBe('')
  })

  it('moves the tenant icon behind an icon inserted after it', () => {
    const ours = fakeLink()
    const reinserted = fakeLink()
    const head = fakeHead([ours, reinserted])

    keepTenantFaviconLast(head as never, ours as never)

    expect(head.children.at(-1)).toBe(ours)
  })

  it('leaves the head alone when the tenant icon is already last', () => {
    // The caller re-runs this from a MutationObserver on the head; appending
    // again would trigger the observer again, forever.
    const appIcon = fakeLink('icon', 'not all')
    const ours = fakeLink()
    const head = fakeHead([appIcon, ours])

    keepTenantFaviconLast(head as never, ours as never)

    expect(head.appends()).toBe(0)
  })
})
