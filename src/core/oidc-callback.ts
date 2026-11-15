import * as oauth from 'oauth4webapi'

import { OIDC_STATE_COOKIE, secureCookies } from './auth/oidc-config'
import { deniedPage } from './denied-page'
import { cookieValue, deleteCookie, jsonResponse, redirectResponse } from './http'
import type { OidcContext } from './oidc-signin'
import type { ShellSession } from './session-store'

function clearStateCookieOn(res: Response): Response {
  deleteCookie(res, OIDC_STATE_COOKIE, { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/' })
  return res
}

/** Completes the authorization-code flow and saves the session through the session store. */
export async function oidcCallback(req: Request, ctx: OidcContext): Promise<Response> {
  const { env, sessions } = ctx
  const url = new URL(req.url)

  // The provider may come back without a code: `error=access_denied` when the
  // account is not a member of this service instance, `error=server_error`
  // when it is unwell. validateAuthResponse() throws on these, and an
  // unhandled throw is a 500 that swallows the one sentence the person
  // needs. Answer it before anything else — no state cookie is required to
  // say "no".
  const providerError = url.searchParams.get('error')
  if (providerError) {
    return clearStateCookieOn(deniedPage(providerError, url.searchParams.get('error_description')))
  }

  const stateCookie = cookieValue(req.headers.get('cookie'), OIDC_STATE_COOKIE)
  if (stateCookie === null) return jsonResponse({ error: 'missing-state' }, 400)

  let pkce: { codeVerifier: string; state: string; nonce: string; callback: string }
  try {
    pkce = JSON.parse(decodeURIComponent(stateCookie))
  } catch {
    return jsonResponse({ error: 'corrupt-state' }, 400)
  }

  const issuerUrl = new URL(env.issuer)
  const as = await oauth.discoveryRequest(issuerUrl, { algorithm: 'oidc' }).then((r) =>
    oauth.processDiscoveryResponse(issuerUrl, r),
  )
  const client: oauth.Client = { client_id: env.clientId }
  const clientAuth = oauth.ClientSecretBasic(env.clientSecret)

  const params = oauth.validateAuthResponse(as, client, url, pkce.state)

  // The provider issued a code and may still refuse to exchange it. Seen live:
  // after an "Einloggen als" session ended, the browser's provider session
  // still belonged to the impersonated account, every code was minted for it,
  // and every exchange came back invalid_grant — an unhandled throw, so a bare
  // 500 on each reload.
  let result: Awaited<ReturnType<typeof oauth.processAuthorizationCodeResponse>>
  try {
    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      as, client, clientAuth, params, env.redirectUri, pkce.codeVerifier,
    )
    result = await oauth.processAuthorizationCodeResponse(as, client, tokenResponse, {
      expectedNonce: pkce.nonce,
      requireIdToken: true,
    })
  } catch (error) {
    if (!(error instanceof oauth.ResponseBodyError)) throw error
    return clearStateCookieOn(deniedPage(error.error, error.error_description ?? null))
  }

  const claims = oauth.getValidatedIdTokenClaims(result)
  if (!claims) return jsonResponse({ error: 'no-id-token' }, 400)
  const email = typeof claims.email === 'string' ? claims.email : null
  if (!email) return jsonResponse({ error: 'no-email-claim' }, 400)

  const accessToken = typeof result.access_token === 'string' ? result.access_token : null
  const refreshToken = typeof result.refresh_token === 'string' ? result.refresh_token : null
  const accessTokenExpiresAt =
    typeof result.expires_in === 'number'
      ? Math.floor(Date.now() / 1000) + result.expires_in
      : null

  // Membership/workspace claims (present when the rflgd:memberships scope was
  // requested). Persisted into the session so consumers can gate features
  // via accessibleServices without a /api/shell/me roundtrip.
  const asString = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const accessibleServices = Array.isArray(claims.accessible_services)
    ? (claims.accessible_services as unknown[]).filter((s): s is string => typeof s === 'string')
    : null

  const session: ShellSession = {
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
  }

  const origin = env.baseUrl || url.origin
  const res = clearStateCookieOn(redirectResponse(new URL(pkce.callback || '/admin', origin)))
  return sessions.save(req, session, res)
}
