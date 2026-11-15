import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OIDC_COOKIE } from '../../core/auth/oidc-config'
import { GET } from './oidc-signout'

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
  vi.stubEnv('RFLGD_SERVER_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const deletion = new RegExp(`^${OIDC_COOKIE}=;.*Max-Age=0`)

describe('GET /api/oidc/signout (Next wrapper)', () => {
  it('keeps the session deletion when the caller sets another cookie', async () => {
    const res = await GET(new Request('https://app.example.test/api/oidc/signout'))
    res.cookies.set('other', 'v')

    expect(res.status).toBe(307)
    expect(res.headers.getSetCookie()).toContainEqual(expect.stringMatching(deletion))
  })

  it('keeps the session deletion without configuration too', async () => {
    vi.stubEnv('OIDC_ISSUER', '')

    const res = await GET(new Request('https://app.example.test/api/oidc/signout'))
    res.cookies.set('other', 'v')

    expect(res.headers.get('location')).toBe('https://app.example.test/login?signed-out=1')
    expect(res.headers.getSetCookie()).toContainEqual(expect.stringMatching(deletion))
  })
})
