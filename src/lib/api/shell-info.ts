import { NextResponse } from 'next/server'

import { OIDC_COOKIE, OIDC_SESSION_TTL, loadOidcEnv } from '../auth/oidc-config'
import { signSessionCookie, verifySessionCookie } from '../auth/oidc-cookie'
import { refreshAccessToken } from '../auth/oidc-refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  let upstream = await callUpstream(session.accessToken)
  let refreshedCookie: string | null = null

  if (upstream.status === 401 && session.refreshToken) {
    const refreshed = await refreshAccessToken(env, session.refreshToken)
    if (refreshed) {
      session = { ...session, ...refreshed }
      refreshedCookie = await signSessionCookie(env.authSecret, {
        sub: session.sub,
        email: session.email,
        name: session.name,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      })
      upstream = await callUpstream(refreshed.accessToken)
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
