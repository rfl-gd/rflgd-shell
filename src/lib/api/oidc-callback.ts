import { NextResponse } from 'next/server'
import * as oauth from 'oauth4webapi'

import {
  OIDC_COOKIE,
  OIDC_SESSION_TTL,
  OIDC_STATE_COOKIE,
  loadOidcEnv,
  secureCookies,
} from '../auth/oidc-config'
import { signSessionCookie } from '../auth/oidc-cookie'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  if (!env) return NextResponse.json({ error: 'oidc-not-configured' }, { status: 500 })

  const url = new URL(req.url)
  const stateCookie = req.headers
    .get('cookie')
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${OIDC_STATE_COOKIE}=`))
  if (!stateCookie) return NextResponse.json({ error: 'missing-state' }, { status: 400 })

  let pkce: { codeVerifier: string; state: string; nonce: string; callback: string }
  try {
    pkce = JSON.parse(decodeURIComponent(stateCookie.split('=')[1] ?? ''))
  } catch {
    return NextResponse.json({ error: 'corrupt-state' }, { status: 400 })
  }

  const issuerUrl = new URL(env.issuer)
  const as = await oauth.discoveryRequest(issuerUrl, { algorithm: 'oidc' }).then((r) =>
    oauth.processDiscoveryResponse(issuerUrl, r),
  )
  const client: oauth.Client = { client_id: env.clientId }
  const clientAuth = oauth.ClientSecretBasic(env.clientSecret)

  const params = oauth.validateAuthResponse(as, client, url, pkce.state)

  const tokenResponse = await oauth.authorizationCodeGrantRequest(
    as, client, clientAuth, params, env.redirectUri, pkce.codeVerifier,
  )
  const result = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse, {
    expectedNonce: pkce.nonce,
    requireIdToken: true,
  })

  const claims = oauth.getValidatedIdTokenClaims(result)
  if (!claims) return NextResponse.json({ error: 'no-id-token' }, { status: 400 })
  const email = typeof claims.email === 'string' ? claims.email : null
  if (!email) return NextResponse.json({ error: 'no-email-claim' }, { status: 400 })

  const accessToken = typeof result.access_token === 'string' ? result.access_token : null
  const refreshToken = typeof result.refresh_token === 'string' ? result.refresh_token : null
  const accessTokenExpiresAt =
    typeof result.expires_in === 'number'
      ? Math.floor(Date.now() / 1000) + result.expires_in
      : null

  // Membership/workspace claims (present when the rflgd:memberships scope was
  // requested). Persisted into the session JWT so consumers can gate features
  // via accessibleServices without a /api/shell/me roundtrip.
  const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const accessibleServices = Array.isArray(claims.accessible_services)
    ? (claims.accessible_services as unknown[]).filter((s): s is string => typeof s === 'string')
    : null

  const session = await signSessionCookie(env.authSecret, {
    sub: String(claims.sub),
    email,
    name: typeof claims.name === 'string' ? claims.name : null,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    emailVerified: typeof claims.email_verified === 'boolean' ? claims.email_verified : null,
    tenantId: asString(claims.tenant_id),
    tenantSlug: asString(claims.tenant_slug),
    orgSlug: asString(claims.org_slug),
    orgRole: asString(claims.org_role),
    platformRole: asString(claims.platform_role),
    accessibleServices,
  })

  const origin = env.baseUrl || url.origin
  const res = NextResponse.redirect(new URL(pkce.callback || '/admin', origin))
  res.cookies.set(OIDC_COOKIE, session, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_SESSION_TTL,
  })
  res.cookies.delete(OIDC_STATE_COOKIE)
  return res
}
