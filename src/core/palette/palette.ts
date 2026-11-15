/**
 * Search for the app palette in BrandSwitcher (⌘K / Ctrl+K).
 *
 * Mirrors rflgd-base's `src/lib/shell/palette.ts`, minus tenants: a module
 * cannot start a platform tenant switch (that runs on Base's session), so
 * platform admins jump to the Base palette instead (`baseSearchUrl`).
 */

export type PaletteApp = {
  key: string
  label: string
  /** One line from the catalog that says what the app does. */
  tagline: string | null
  /** Lucide name from the platform; `null` for Base, which shows the stack. */
  icon: string | null
  href: string
  current: boolean
}

export function matchApps(apps: PaletteApp[], query: string): PaletteApp[] {
  const q = query.trim().toLowerCase()
  if (!q) return apps
  return apps.filter((a) => a.label.toLowerCase().includes(q) || a.tagline?.toLowerCase().includes(q))
}

/** Base opens its palette with `?palette=<query>` prefilled. */
export function baseSearchUrl(baseUrl: string, query: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/?palette=${encodeURIComponent(query.trim())}`
}

/** ⌘K on macOS, Ctrl+K elsewhere; Alt/Shift combinations stay free. */
export function isPaletteShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'
}
