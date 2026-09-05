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
  // Membership/workspace claims (released by the provider when the
  // `rflgd:memberships` scope is requested). All optional for backward
  // compatibility with sessions minted before this was added.
  emailVerified?: boolean | null
  tenantId?: string | null
  tenantSlug?: string | null
  orgSlug?: string | null
  orgRole?: string | null
  /**
   * The platform-wide role (`superadmin` · `reflagged_admin` · `tenant_admin`
   * · `member`), beside `org_role` rather than behind it.
   *
   * `org_role` is emitted as `membership ?? platform`, which drops the second
   * one: a `superadmin` carried as `member` in their own organisation looks
   * like an ordinary member to a service. A service deriving rights from the
   * token would lock them out of their own instance at the next sign-in.
   */
  platformRole?: string | null
  /** Product keys the user may access; ['*'] = all, [] = none. */
  accessibleServices?: string[] | null
  iat: number
  exp: number
}

/**
 * Scopes requested at authorize time. Defaults include `rflgd:memberships`
 * so the id_token carries org_slug/org_role/accessible_services. Override via
 * the OIDC_SCOPES env var (space-separated) for clients that need less.
 */
export function oidcScopes(): string {
  return (
    process.env.OIDC_SCOPES?.trim() ||
    'openid profile email offline_access rflgd:memberships'
  )
}

/**
 * Local landing after single-logout. Defaults to `/login?signed-out=1`
 * (every consumer has a /login). Override per app via RFLGD_SIGNED_OUT_PATH
 * (e.g. `/?signed-out=1`). Previously hardcoded to `/admin/login`, which
 * 404'd in consumers without an /admin route.
 */
export function signedOutPath(): string {
  return process.env.RFLGD_SIGNED_OUT_PATH?.trim() || '/login?signed-out=1'
}

/**
 * Origin of the provider (where /api/sso/signout lives). Robustly derived
 * from the issuer URL rather than string-stripping a trailing `/oidc`.
 */
export function providerOrigin(env: OidcEnv): string {
  try {
    return new URL(env.issuer).origin
  } catch {
    return env.issuer.replace(/\/oidc\/?$/, '')
  }
}

/** True in production — used for the Secure cookie flag (don't infer from req.url behind a TLS-terminating proxy). */
export function secureCookies(): boolean {
  return process.env.NODE_ENV === 'production'
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
