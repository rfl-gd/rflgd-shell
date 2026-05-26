import { NextResponse } from 'next/server'
import * as oauth from 'oauth4webapi'

import { OIDC_COOKIE, OIDC_SESSION_TTL, OIDC_STATE_COOKIE, loadOidcEnv } from '../auth/oidc-config'
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

  const session = await signSessionCookie(env.authSecret, {
    sub: String(claims.sub),
    email,
    name: typeof claims.name === 'string' ? claims.name : null,
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
  })

  const origin = env.baseUrl || url.origin
  const res = NextResponse.redirect(new URL(pkce.callback || '/admin', origin))
  res.cookies.set(OIDC_COOKIE, session, {
    httpOnly: true,
    secure: req.url.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: OIDC_SESSION_TTL,
  })
  res.cookies.delete(OIDC_STATE_COOKIE)
  return res
}
