import { NextResponse } from 'next/server'

import { loadOidcEnv } from '../core/auth/oidc-config'
import { cookieSessionStore } from '../core/cookie-session-store'
import { parseSetCookie } from '../core/http'
import type { OidcContext } from '../core/oidc-signin'
import type { ShellInfoContext } from '../core/shell-info'

/** The core OIDC context from the environment with the cookie session store, or null when unconfigured. */
export function oidcContext(): OidcContext | null {
  const env = loadOidcEnv()
  return env ? { env, sessions: cookieSessionStore(env) } : null
}

/** The core shell-info context from the environment, or null when unconfigured. */
export function shellInfoContext(): ShellInfoContext | null {
  const env = loadOidcEnv()
  if (!env) return null
  return { platformUrl: env.issuer.replace(/\/oidc\/?$/, ''), sessions: cookieSessionStore(env) }
}

/**
 * Wraps a core web Response as a NextResponse. Cookies go through `next.cookies`
 * rather than raw headers: Next parses raw Set-Cookie headers lossily (an empty
 * value and Max-Age=0 vanish) and rewrites them from that view on the next
 * `cookies.set()`, which would turn a deletion into a session cookie.
 */
export function toNextResponse(res: Response): NextResponse {
  const headers = new Headers(res.headers)
  headers.delete('set-cookie')
  const next = new NextResponse(res.body, { status: res.status, statusText: res.statusText, headers })
  for (const header of res.headers.getSetCookie()) {
    const { name, value, attrs } = parseSetCookie(header)
    next.cookies.set(name, value, attrs)
  }
  return next
}
