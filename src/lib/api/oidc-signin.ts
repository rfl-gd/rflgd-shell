import { NextResponse } from 'next/server'
import * as oauth from 'oauth4webapi'

import { isSessionAccessRevoked } from '../directory/user-access'
import { OIDC_STATE_COOKIE, loadOidcEnv, oidcScopes, providerOrigin, secureCookies } from '../auth/oidc-config'
import { sessionCookieValue, verifySessionCookie } from '../auth/oidc-cookie'
import { clearSessionCookie } from './oidc-signout'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  if (!env) {
    return NextResponse.json({ error: 'oidc-not-configured' }, { status: 500 })
  }

  // A session the base revoked lands here when the module stops accepting it.
  // Signing in again would only hit the base's own access gate, so end the
  // session and show the base's no-access page instead.
  const sessionToken = sessionCookieValue(req.headers.get('cookie'))
  const session = sessionToken ? await verifySessionCookie(env.authSecret, sessionToken) : null
  if (session && isSessionAccessRevoked(session.sub)) {
    const res = NextResponse.redirect(`${providerOrigin(env)}/?error=no-access`)
    clearSessionCookie(res)
    return res
  }

  const url = new URL(req.url)
  const callback = url.searchParams.get('callbackUrl') ?? '/admin'

  const issuerUrl = new URL(env.issuer)
  const as = await oauth.discoveryRequest(issuerUrl, { algorithm: 'oidc' }).then((r) =>
    oauth.processDiscoveryResponse(issuerUrl, r),
  )

  const codeVerifier = oauth.generateRandomCodeVerifier()
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier)
  const state = oauth.generateRandomState()
  const nonce = oauth.generateRandomNonce()

  const authEndpoint = as.authorization_endpoint
  if (!authEndpoint) {
    return NextResponse.json({ error: 'no-authorization-endpoint' }, { status: 500 })
  }
  const authUrl = new URL(authEndpoint)
  authUrl.searchParams.set('client_id', env.clientId)
  authUrl.searchParams.set('redirect_uri', env.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', oidcScopes())
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  const res = NextResponse.redirect(authUrl)
  res.cookies.set(OIDC_STATE_COOKIE, JSON.stringify({ codeVerifier, state, nonce, callback }), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
