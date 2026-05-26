import * as oauth from 'oauth4webapi'
import type { OidcEnv } from './oidc-config'

export async function refreshAccessToken(
  env: OidcEnv,
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string | null; accessTokenExpiresAt: number } | null> {
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
