/**
 * Web-standard response and cookie helpers. They work on plain `Response`
 * objects so route handlers do not depend on a framework's response type.
 */

export type CookieAttributes = {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
  path?: string
  maxAge?: number
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function redirectResponse(url: string | URL, status = 307): Response {
  // Response.redirect() returns immutable headers; build it by hand so cookies can be added.
  return new Response(null, { status, headers: { location: url.toString() } })
}

export function setCookie(res: Response, name: string, value: string, attrs: CookieAttributes): void {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (attrs.path !== undefined) parts.push(`Path=${attrs.path}`)
  if (attrs.maxAge !== undefined) parts.push(`Max-Age=${attrs.maxAge}`)
  if (attrs.httpOnly) parts.push('HttpOnly')
  if (attrs.secure) parts.push('Secure')
  if (attrs.sameSite) parts.push(`SameSite=${attrs.sameSite}`)
  res.headers.append('set-cookie', parts.join('; '))
}

export function deleteCookie(res: Response, name: string, attrs: Omit<CookieAttributes, 'maxAge'>): void {
  setCookie(res, name, '', { ...attrs, maxAge: 0 })
}

/** Returns the raw (still encoded) value of `name` from a `Cookie` request header. */
export function cookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null
  const prefix = `${name}=`
  for (const segment of cookieHeader.split(';')) {
    const trimmed = segment.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length)
  }
  return null
}
