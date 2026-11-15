const FALLBACK_PATH = '/admin'

/**
 * Restricts a post-sign-in `callbackUrl` to a path on `base`'s own origin, so a
 * crafted sign-in link cannot send the person elsewhere after authenticating.
 * Anything that is not a single-slash path (absolute URLs, `//host`, `/\host`,
 * `javascript:`) falls back to `/admin`. Returns the normalised path, query
 * and fragment.
 */
export function safeCallbackPath(raw: string | null | undefined, base: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return FALLBACK_PATH
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return FALLBACK_PATH
  }
  if (url.origin !== new URL(base).origin) return FALLBACK_PATH
  // Dot segments can normalise to a leading `//` (`/.//evil`), which a browser
  // would read as another host.
  if (url.pathname.startsWith('//')) return FALLBACK_PATH
  return url.pathname + url.search + url.hash
}
