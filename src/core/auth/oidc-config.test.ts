import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadOidcEnv } from './oidc-config'

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('RFLGD_SERVER_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('loadOidcEnv base URL', () => {
  it('reads RFLGD_SERVER_URL when NEXT_PUBLIC_SERVER_URL is unset', () => {
    vi.stubEnv('RFLGD_SERVER_URL', 'https://b.test')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', undefined)

    expect(loadOidcEnv()?.baseUrl).toBe('https://b.test')
  })

  it('prefers RFLGD_SERVER_URL over NEXT_PUBLIC_SERVER_URL', () => {
    vi.stubEnv('RFLGD_SERVER_URL', 'https://b.test')
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://next.test')

    expect(loadOidcEnv()?.baseUrl).toBe('https://b.test')
  })
})
