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
  },
): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name ?? null,
    accessToken: payload.accessToken ?? null,
    refreshToken: payload.refreshToken ?? null,
    accessTokenExpiresAt: payload.accessTokenExpiresAt ?? null,
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
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    }
  } catch {
    return null
  }
}
