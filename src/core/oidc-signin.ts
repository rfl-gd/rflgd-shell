import * as oauth from 'oauth4webapi'

import { OIDC_STATE_COOKIE, oidcScopes, providerOrigin, secureCookies } from './auth/oidc-config'
import type { OidcEnv } from './auth/oidc-config'
import { isSessionAccessRevoked } from './directory/user-access'
import { jsonResponse, redirectResponse, setCookie } from './http'
import { safeCallbackPath } from './safe-callback-path'
import type { ShellSessionStore } from './session-store'

export type OidcContext = { env: OidcEnv; sessions: ShellSessionStore }

/** Starts the authorization-code flow with PKCE and redirects to the provider. */
export async function oidcSignin(req: Request, ctx: OidcContext): Promise<Response> {
  const { env, sessions } = ctx

  // A session the base revoked lands here when the module stops accepting it.
  // Signing in again would only hit the base's own access gate, so end the
  // session and show the base's no-access page instead.
  const session = await sessions.load(req)
  if (session && isSessionAccessRevoked(session.sub)) {
    return sessions.end(req, redirectResponse(`${providerOrigin(env)}/apps?error=no-access`))
  }

  const url = new URL(req.url)
  const callback = safeCallbackPath(url.searchParams.get('callbackUrl'), env.baseUrl || url.origin)

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
    return jsonResponse({ error: 'no-authorization-endpoint' }, 500)
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

  const res = redirectResponse(authUrl)
  setCookie(res, OIDC_STATE_COOKIE, JSON.stringify({ codeVerifier, state, nonce, callback }), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
