import { NextResponse } from 'next/server'
import * as oauth from 'oauth4webapi'

import { OIDC_STATE_COOKIE, loadOidcEnv } from '../auth/oidc-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const env = loadOidcEnv()
  if (!env) {
    return NextResponse.json({ error: 'oidc-not-configured' }, { status: 500 })
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
  authUrl.searchParams.set('scope', 'openid profile email offline_access')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  const res = NextResponse.redirect(authUrl)
  res.cookies.set(OIDC_STATE_COOKIE, JSON.stringify({ codeVerifier, state, nonce, callback }), {
    httpOnly: true,
    secure: req.url.startsWith('https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
