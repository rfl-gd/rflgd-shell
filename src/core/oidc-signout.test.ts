import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OidcEnv } from '../lib/auth/oidc-config'
import { loadOidcEnv } from '../lib/auth/oidc-config'
import { cookieSessionStore } from './cookie-session-store'
import type { OidcContext } from './oidc-signin'
import { oidcSignout } from './oidc-signout'

let ctx: OidcContext

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
  const env = loadOidcEnv() as OidcEnv
  ctx = { env, sessions: cookieSessionStore(env) }
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('oidcSignout', () => {
  it('redirects to the platform single-logout and ends the session', async () => {
    const res = await oidcSignout(new Request('https://app.example.test/api/oidc/signout'), ctx)
    expect(res.headers.get('location')).toBe('https://id.example.test/api/sso/signout?post_logout_redirect_uri=https%3A%2F%2Fapp.example.test%2Flogin%3Fsigned-out%3D1')
    expect(res.headers.get('set-cookie')).toMatch(/^rflgd-session=; Path=\/; Max-Age=0; HttpOnly; SameSite=lax$/)
  })
})
