export const OIDC_COOKIE = 'rflgd-session'
export const OIDC_STATE_COOKIE = 'rflgd-oidc-state'
export const OIDC_SESSION_TTL = 60 * 60 * 24 * 30

export type OidcSessionToken = {
  sub: string
  email: string
  name?: string | null
  accessToken?: string | null
  refreshToken?: string | null
  accessTokenExpiresAt?: number | null
  iat: number
  exp: number
}

export type OidcEnv = {
  issuer: string
  clientId: string
  clientSecret: string
  redirectUri: string
  authSecret: string
  baseUrl: string
}

export function loadOidcEnv(): OidcEnv | null {
  const issuer = process.env.OIDC_ISSUER
  const clientId = process.env.OIDC_CLIENT_ID
  const clientSecret = process.env.OIDC_CLIENT_SECRET
  const authSecret = process.env.AUTH_SECRET
  const base = process.env.NEXT_PUBLIC_SERVER_URL
  if (!issuer || !clientId || !clientSecret || !authSecret || !base) return null
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${base.replace(/\/$/, '')}/api/oidc/callback`,
    authSecret,
    baseUrl: base.replace(/\/$/, ''),
  }
}
