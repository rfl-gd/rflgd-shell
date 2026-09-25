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

  // The provider may come back without a code: `error=access_denied` when the
  // account is not a member of this service instance, `error=server_error`
  // when it is unwell. validateAuthResponse() throws on these, and an
  // unhandled throw is a 500 that swallows the one sentence the person
  // needs. Answer it before anything else — no state cookie is required to
  // say "no".
  const providerError = url.searchParams.get('error')
  if (providerError) {
    const res = deniedResponse(providerError, url.searchParams.get('error_description'))
    res.cookies.delete(OIDC_STATE_COOKIE)
    return res
  }

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

const escapeHtml = (v: string): string =>
  v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * A readable page for a sign-in the provider refused. 403 for access_denied
 * (the account exists, the instance is not theirs), 400 for anything else.
 * The description is the provider's own sentence and arrives via the URL,
 * so it is escaped — anyone can craft a callback link.
 */
export function deniedResponse(error: string, description: string | null): NextResponse {
  const status = error === 'access_denied' ? 403 : 400
  const headline =
    error === 'access_denied' ? 'Kein Zugriff auf diese Anwendung' : 'Anmeldung fehlgeschlagen'
  const detail =
    description?.trim() ||
    (error === 'access_denied'
      ? 'Ihr Account ist dieser Anwendung nicht zugeordnet.'
      : `Der Anmeldedienst hat die Anmeldung abgelehnt (${error}).`)
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(headline)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: system-ui, -apple-system, sans-serif; background: #f6f5f2; color: #1a1a1a; }
  main { max-width: 32rem; padding: 2rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
  p { margin: 0 0 1rem; line-height: 1.5; }
  small { color: #666; }
  a { color: #8a7648; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(headline)}</h1>
  <p>${escapeHtml(detail)}</p>
  <p>Bitten Sie eine Administratorin oder einen Administrator Ihrer Organisation, Ihren Account für diese Anwendung freizuschalten.</p>
  <p><a href="/">Zur Startseite</a></p>
  <p><small>Fehlercode: ${escapeHtml(error)}</small></p>
</main>
</body>
</html>
`
  return new NextResponse(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}
