import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../core/auth/oidc-refresh', () => ({
  refreshAccessToken: vi.fn(async () => ({
    accessToken: 'at-2',
    refreshToken: 'rt-2',
    accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
  })),
}))

import { OIDC_COOKIE } from '../../core/auth/oidc-config'
import { signSessionCookie } from '../../core/auth/oidc-cookie'
import { GET } from './shell-info'

const SECRET = 'x'.repeat(32)

function stubConfiguredEnv(): void {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', SECRET)
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('GET /api/shell-info (Next wrapper)', () => {
  beforeEach(() => {
    vi.stubEnv('RFLGD_SERVER_URL', '')
  })

  it('answers 503 without configuration', async () => {
    vi.stubEnv('OIDC_ISSUER', '')

    const res = await GET(new Request('https://app.example.test/api/shell-info'))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'oidc-not-configured' })
  })

  it('returns a NextResponse carrying the core Set-Cookie', async () => {
    stubConfiguredEnv()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ user: { id: '7' } }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const cookie = await signSessionCookie(SECRET, {
      sub: '7',
      email: 'customer@example.test',
      accessToken: 'at',
      refreshToken: 'rt',
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 10,
    })

    const res = await GET(
      new Request('https://app.example.test/api/shell-info', {
        headers: { cookie: `${OIDC_COOKIE}=${cookie}` },
      }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: { id: '7' } })
    expect(fetch).toHaveBeenCalledWith('https://id.example.test/api/shell/me', expect.anything())
    expect(res.cookies.get(OIDC_COOKIE)).toBeDefined()
  })
})
