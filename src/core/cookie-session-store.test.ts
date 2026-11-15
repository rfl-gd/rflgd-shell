import { describe, expect, it, vi } from 'vitest'
import { signSessionCookie } from '../lib/auth/oidc-cookie'
import type { OidcEnv } from '../lib/auth/oidc-config'
import { cookieSessionStore } from './cookie-session-store'
import { jsonResponse } from './http'
import type { ShellSession } from './session-store'
import { sessionStoreConformance } from './session-store-conformance'

vi.mock('../lib/auth/oidc-refresh', () => ({
  refreshAccessToken: vi.fn(async () => ({ accessToken: 'new', refreshToken: 'r2', accessTokenExpiresAt: 9e9 })),
}))

const env: OidcEnv = {
  issuer: 'https://id.example.test/oidc',
  clientId: 'c',
  clientSecret: 's',
  redirectUri: 'https://app.example.test/api/oidc/callback',
  authSecret: 'x'.repeat(32),
  baseUrl: 'https://app.example.test',
}

const session: ShellSession = {
  sub: 'u1',
  email: 'ada@example.test',
  name: 'Ada',
  accessToken: 'old',
  refreshToken: null,
  accessTokenExpiresAt: 1000,
  emailVerified: true,
  tenantId: 't1',
  tenantSlug: 'acme-tenant',
  orgSlug: 'acme',
  orgRole: 'member',
  platformRole: 'member',
  accessibleServices: ['*'],
}

const req = new Request('https://app.example.test/api/shell-info', {
  headers: { cookie: `rflgd-session=${await signSessionCookie(env.authSecret, session)}` },
})
const store = cookieSessionStore(env)

sessionStoreConformance('cookie', () => ({ store, req, session }))

describe('cookieSessionStore', () => {
  it('load returns null without a session cookie', async () => {
    expect(await store.load(new Request('https://app.example.test/'))).toBeNull()
  })

  it('refresh keeps every membership claim', async () => {
    const s = await store.refresh(req, { ...session, refreshToken: 'r1' })
    expect(s).toMatchObject({ accessToken: 'new', orgSlug: 'acme', accessibleServices: ['*'] })
  })

  it('save sets the session cookie with the login attributes', async () => {
    const res = await store.save(req, session, jsonResponse({}))
    expect(res.headers.get('set-cookie')).toMatch(/^rflgd-session=.+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=lax$/)
  })

  it('save marks the cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const res = await store.save(req, session, jsonResponse({}))
      expect(res.headers.get('set-cookie')).toContain('; Secure')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('end deletes the session cookie with the login attributes', async () => {
    const res = await store.end(req, jsonResponse({}))
    expect(res.headers.get('set-cookie')).toMatch(/^rflgd-session=; Path=\/; Max-Age=0; HttpOnly; SameSite=lax$/)
  })
})
