import { SignJWT, jwtVerify } from 'jose'
import type { OidcSessionToken } from './oidc-config'
import { OIDC_SESSION_TTL } from './oidc-config'

const ALG = 'HS256'

function secretKey(authSecret: string): Uint8Array {
  return new TextEncoder().encode(authSecret)
}

export async function signSessionCookie(
  authSecret: string,
  payload: {
    sub: string
    email: string
    name?: string | null
    accessToken?: string | null
    refreshToken?: string | null
    accessTokenExpiresAt?: number | null
    emailVerified?: boolean | null
    tenantId?: string | null
    tenantSlug?: string | null
    orgSlug?: string | null
    orgRole?: string | null
    accessibleServices?: string[] | null
  },
): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name ?? null,
    accessToken: payload.accessToken ?? null,
    refreshToken: payload.refreshToken ?? null,
    accessTokenExpiresAt: payload.accessTokenExpiresAt ?? null,
    emailVerified: payload.emailVerified ?? null,
    tenantId: payload.tenantId ?? null,
    tenantSlug: payload.tenantSlug ?? null,
    orgSlug: payload.orgSlug ?? null,
    orgRole: payload.orgRole ?? null,
    accessibleServices: payload.accessibleServices ?? null,
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setSubject(payload.sub)
    .setExpirationTime(`${OIDC_SESSION_TTL}s`)
    .sign(secretKey(authSecret))
}

export async function verifySessionCookie(
  authSecret: string,
  token: string,
): Promise<OidcSessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(authSecret), { algorithms: [ALG] })
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
    return {
      sub: payload.sub,
      email: payload.email,
      name: typeof payload.name === 'string' ? payload.name : null,
      accessToken: typeof payload.accessToken === 'string' ? payload.accessToken : null,
      refreshToken: typeof payload.refreshToken === 'string' ? payload.refreshToken : null,
      accessTokenExpiresAt:
        typeof payload.accessTokenExpiresAt === 'number' ? payload.accessTokenExpiresAt : null,
      emailVerified: typeof payload.emailVerified === 'boolean' ? payload.emailVerified : null,
      tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : null,
      tenantSlug: typeof payload.tenantSlug === 'string' ? payload.tenantSlug : null,
      orgSlug: typeof payload.orgSlug === 'string' ? payload.orgSlug : null,
      orgRole: typeof payload.orgRole === 'string' ? payload.orgRole : null,
      accessibleServices: Array.isArray(payload.accessibleServices)
        ? (payload.accessibleServices as unknown[]).filter((s): s is string => typeof s === 'string')
        : null,
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    }
  } catch {
    return null
  }
}
