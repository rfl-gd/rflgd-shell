import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../auth/oidc-refresh', () => ({
  refreshAccessToken: vi.fn(async () => null),
}))

import { OIDC_COOKIE } from '../auth/oidc-config'
import { signSessionCookie } from '../auth/oidc-cookie'
import { GET } from './shell-info'

/**
 * A session whose token the platform refuses for good — e.g. minted during an
 * impersonation the admin has ended — must not linger: the module would keep
 * acting as the customer. The route drops the cookie so the next page loads
 * into a fresh sign-in.
 */

const SECRET = 'x'.repeat(32)

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', SECRET)
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function request(): Promise<Request> {
  const cookie = await signSessionCookie(SECRET, {
    sub: '7',
    email: 'customer@example.test',
    accessToken: 'at',
    refreshToken: 'rt',
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  })
  return new Request('https://kollega.acme.example.test/api/shell-info', {
    headers: { cookie: `${OIDC_COOKIE}=${cookie}` },
  })
}

describe('GET /api/shell-info when the platform refuses the session', () => {
  it('ends the module session after the refresh fails too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    )

    const res = await GET(await request())

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'session-ended' })
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`${OIDC_COOKIE}=;.*Max-Age=0`, 'i'))
  })

  it('keeps the session on other upstream failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 502 })),
    )

    const res = await GET(await request())

    expect(res.status).toBe(502)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
