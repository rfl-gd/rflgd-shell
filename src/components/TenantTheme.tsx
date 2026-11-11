'use client'

import { useEffect, useState } from 'react'

import { fetchShellInfo, isOk } from '../lib/shell-info/fetch-shell-info'

const THEME_LINK_ID = 'rflgd-tenant-theme'
const FAVICON_LINK_ID = 'rflgd-tenant-favicon'

/**
 * Loads the tenant palette stylesheet from the platform once per page:
 * `--brass-50` … `--brass-900` (RGB channels) and `--rflgd-brand-primary`.
 * Modules point their own tokens at it with a brass fallback, e.g.
 * `--primary: rgb(var(--brass-700, 125 85 26))`.
 */
export function useTenantTheme(href: string | null | undefined): void {
  useEffect(() => {
    if (!href) return
    const existing = document.getElementById(THEME_LINK_ID) as HTMLLinkElement | null
    if (existing) {
      if (existing.href !== href) existing.href = href
      return
    }
    const link = document.createElement('link')
    link.id = THEME_LINK_ID
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
  }, [href])
}

/**
 * Which stored image becomes the favicon.
 *
 * The mark is the square asset made for small sizes; the wide logo squeezed
 * into 16×16 looks poor but still tells you which tab you are on. A tenant may
 * have neither — then the tab stays blank rather than showing somebody else's
 * logo, which is worse than no icon at all.
 *
 * Pure on purpose: the choice is the part worth testing, the DOM work below
 * only repeats what `useTenantTheme` has been doing since 1.x.
 */
export function faviconHref(
  org: { logoMarkUrl?: string | null; logoUrl?: string | null } | null | undefined,
): string | null {
  return org?.logoMarkUrl?.trim() || org?.logoUrl?.trim() || null
}

/**
 * Makes the tenant icon the one the browser shows, without detaching a node.
 *
 * An app may ship icons of its own (the Payload admin does, one per colour
 * scheme), rendered by React, and Next re-inserts them on every client
 * navigation, after ours. Those nodes belong to React: removing them makes its
 * next commit fail on a missing parent and the navigation never finishes. So
 * they stay in place, switched off with `media="not all"`, and ours is moved to
 * the end, where browsers look last.
 *
 * Appends only when ours is not already the last icon: the caller runs this
 * from a MutationObserver on the head, which would otherwise fire on its own
 * change forever.
 */
export function keepTenantFaviconLast(
  head: Pick<HTMLHeadElement, 'querySelectorAll' | 'appendChild'>,
  link: HTMLLinkElement,
): void {
  const icons = [...head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')]
  for (const other of icons) {
    if (other !== link && other.media !== 'not all') other.media = 'not all'
  }
  if (icons.at(-1) !== link) head.appendChild(link)
}

/**
 * Points the browser tab at the tenant's logo.
 *
 * Set from the client, because the modules share this package rather than a
 * server layout: a per-app `icon.tsx` would mean the same file in every
 * service. The cost is a blank tab for the moment it takes `/api/shell-info`
 * to answer.
 */
export function useTenantFavicon(href: string | null | undefined): void {
  useEffect(() => {
    if (!href) return

    const apply = () => {
      let link = document.getElementById(FAVICON_LINK_ID) as HTMLLinkElement | null
      if (!link) {
        link = document.createElement('link')
        link.id = FAVICON_LINK_ID
        link.rel = 'icon'
      }
      if (link.href !== href) link.href = href
      keepTenantFaviconLast(document.head, link)
    }

    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.head, { childList: true })
    return () => observer.disconnect()
  }, [href])
}

/**
 * For modules that do not mount `BrandSwitcher` (which loads the palette
 * itself): render once in the root layout.
 */
export function TenantTheme(): null {
  const [href, setHref] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  useEffect(() => {
    let cancel = false
    fetchShellInfo()
      .then(({ status, body }) => {
        const d = isOk(status)
          ? (body as {
              org?: {
                themeCssUrl?: string | null
                logoMarkUrl?: string | null
                logoUrl?: string | null
              } | null
            } | null)
          : null
        if (cancel) return
        setHref(d?.org?.themeCssUrl ?? null)
        setIcon(faviconHref(d?.org))
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [])
  useTenantTheme(href)
  useTenantFavicon(icon)
  return null
}
