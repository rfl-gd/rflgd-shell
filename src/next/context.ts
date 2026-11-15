import { NextResponse } from 'next/server'

import { loadOidcEnv } from '../core/auth/oidc-config'
import { cookieSessionStore } from '../core/cookie-session-store'
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

/** Wraps a core web Response, Set-Cookie headers included, as a NextResponse. */
export function toNextResponse(res: Response): NextResponse {
  return new NextResponse(res.body, res)
}
