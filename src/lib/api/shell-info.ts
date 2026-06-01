import { NextResponse } from 'next/server'

import type { OidcSessionToken } from '../auth/oidc-config'
import { OIDC_COOKIE, OIDC_SESSION_TTL, loadOidcEnv } from '../auth/oidc-config'
import { signSessionCookie, verifySessionCookie } from '../auth/oidc-cookie'
import { refreshAccessToken } from '../auth/oidc-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Renew the access token this many seconds before its declared expiry, so a
// token about to lapse mid-request is refreshed up front rather than after a
// guaranteed 401 round-trip.
const REFRESH_SKEW_SECONDS = 30

type Refreshed = NonNullable<Awaited<ReturnType<typeof refreshAccessToken>>>

/**
 * Re-sign the session cookie after a token refresh, PRESERVING every
 * membership/workspace claim from the existing session. Only the token fields
 * change — dropping orgRole/accessibleServices/tenantSlug/... here would
 * silently degrade per-service entitlement gating and the workspace header
 * after each refresh.
 */
function reSignSession(
  authSecret: string,
  session: OidcSessionToken,
  refreshed: Refreshed,
): Promise<string> {
  return signSessionCookie(authSecret, {
    sub: session.sub,
    email: session.email,
    name: session.name,
    emailVerified: session.emailVerified,
    tenantId: session.tenantId,
    tenantSlug: session.tenantSlug,
    orgSlug: session.orgSlug,
    orgRole: session.orgRole,
    accessibleServices: session.accessibleServices,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
  })
}

export async function GET(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  if (!env) return NextResponse.json({ error: 'oidc-not-configured' }, { status: 503 })

  const cookieHeader = req.headers.get('cookie') ?? ''
  const segment = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OIDC_COOKIE}=`))
  if (!segment) return NextResponse.json({ error: 'no-session' }, { status: 401 })

  const token = segment.slice(`${OIDC_COOKIE}=`.length)
  let session = await verifySessionCookie(env.authSecret, token)
  if (!session) return NextResponse.json({ error: 'invalid-session' }, { status: 401 })
  if (!session.accessToken) {
    return NextResponse.json({ error: 'no-access-token' }, { status: 401 })
  }

  const baseUrl = env.issuer.replace(/\/oidc\/?$/, '')
  const callUpstream = (accessToken: string) =>
    fetch(`${baseUrl}/api/shell/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })

  let accessToken: string = session.accessToken
  let refreshedCookie: string | null = null

  // Proactive refresh: if the access token has expired (or is within the skew
  // window), renew it BEFORE calling upstream. The access token lives ~1h and
  // the refresh token ~14d, so the App-Switcher menu stays alive for the whole
  // session without burning a 401 round-trip or forcing a manual re-login.
  const nowSeconds = Math.floor(Date.now() / 1000)
  if (
    session.refreshToken &&
    typeof session.accessTokenExpiresAt === 'number' &&
    session.accessTokenExpiresAt - REFRESH_SKEW_SECONDS <= nowSeconds
  ) {
    const refreshed = await refreshAccessToken(env, session.refreshToken)
    if (refreshed) {
      refreshedCookie = await reSignSession(env.authSecret, session, refreshed)
      session = { ...session, ...refreshed }
      accessToken = refreshed.accessToken
    }
  }

  let upstream = await callUpstream(accessToken)

  // Reactive backstop: the token was rejected before its declared expiry
  // (revoked, clock skew, rotated elsewhere) — try one refresh and retry.
  if (upstream.status === 401 && session.refreshToken) {
    const refreshed = await refreshAccessToken(env, session.refreshToken)
    if (refreshed) {
      refreshedCookie = await reSignSession(env.authSecret, session, refreshed)
      session = { ...session, ...refreshed }
      accessToken = refreshed.accessToken
      upstream = await callUpstream(accessToken)
    }
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: 'upstream-failed', status: upstream.status },
      { status: upstream.status },
    )
  }

  const res = NextResponse.json(await upstream.json())
  if (refreshedCookie) {
    res.cookies.set(OIDC_COOKIE, refreshedCookie, {
      httpOnly: true,
      secure: req.url.startsWith('https'),
      sameSite: 'lax',
      path: '/',
      maxAge: OIDC_SESSION_TTL,
    })
  }
  return res
}
