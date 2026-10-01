'use client'

import { useEffect, useState } from 'react'

const THEME_LINK_ID = 'rflgd-tenant-theme'

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
 * For modules that do not mount `BrandSwitcher` (which loads the palette
 * itself): render once in the root layout.
 */
export function TenantTheme(): null {
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    let cancel = false
    fetch('/api/shell-info', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { org?: { themeCssUrl?: string | null } | null } | null) => {
        if (!cancel) setHref(d?.org?.themeCssUrl ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancel = true
    }
  }, [])
  useTenantTheme(href)
  return null
}
