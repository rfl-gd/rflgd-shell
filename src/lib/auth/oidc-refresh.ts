import * as oauth from 'oauth4webapi'
import type { OidcEnv } from './oidc-config'

type Refreshed = { accessToken: string; refreshToken: string | null; accessTokenExpiresAt: number }

// Once the provider rotates refresh tokens, presenting one twice revokes the
// whole grant. Parallel requests from one page carry the same expired
// session, so they share a single refresh. The result stays shared for a
// while after it lands, because requests sent before the browser stored the
// renewed cookie still arrive with the old refresh token.
const SHARED_RESULT_TTL_MS = 60_000
const sharedRefreshes = new Map<string, Promise<Refreshed | null>>()

export function refreshAccessToken(env: OidcEnv, refreshToken: string): Promise<Refreshed | null> {
  const key = `${env.issuer}\n${env.clientId}\n${refreshToken}`
  const shared = sharedRefreshes.get(key)
  if (shared) return shared

  const refresh = requestRefresh(env, refreshToken)
  sharedRefreshes.set(key, refresh)
  void refresh.then((refreshed) => {
    if (!refreshed) {
      sharedRefreshes.delete(key)
      return
    }
    setTimeout(() => sharedRefreshes.delete(key), SHARED_RESULT_TTL_MS).unref?.()
  })
  return refresh
}

async function requestRefresh(env: OidcEnv, refreshToken: string): Promise<Refreshed | null> {
  const issuerUrl = new URL(env.issuer)
  let as: oauth.AuthorizationServer
  try {
    as = await oauth
      .discoveryRequest(issuerUrl, { algorithm: 'oidc' })
      .then((r) => oauth.processDiscoveryResponse(issuerUrl, r))
  } catch {
    return null
  }
  const client: oauth.Client = { client_id: env.clientId }
  const clientAuth = oauth.ClientSecretBasic(env.clientSecret)
  try {
    const res = await oauth.refreshTokenGrantRequest(as, client, clientAuth, refreshToken)
    const body = await oauth.processRefreshTokenResponse(as, client, res)
    if (typeof body.access_token !== 'string') return null
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : refreshToken,
      accessTokenExpiresAt:
        typeof body.expires_in === 'number'
          ? Math.floor(Date.now() / 1000) + body.expires_in
          : Math.floor(Date.now() / 1000) + 3600,
    }
  } catch {
    return null
  }
}
