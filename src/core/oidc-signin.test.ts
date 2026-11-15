import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OidcEnv } from './auth/oidc-config'
import { loadOidcEnv } from './auth/oidc-config'
import { memorySessionStore } from './memory-session-store'
import { oidcSignin } from './oidc-signin'

let env: OidcEnv

const discovery = {
  issuer: 'https://id.example.test/oidc',
  authorization_endpoint: 'https://id.example.test/oidc/auth',
  token_endpoint: 'https://id.example.test/oidc/token',
  jwks_uri: 'https://id.example.test/oidc/jwks',
}

beforeEach(() => {
  vi.stubEnv('OIDC_ISSUER', 'https://id.example.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'client')
  vi.stubEnv('OIDC_CLIENT_SECRET', 'secret')
  vi.stubEnv('AUTH_SECRET', 'x'.repeat(32))
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://app.example.test')
  vi.stubEnv('RFLGD_SERVER_URL', '')
  env = loadOidcEnv() as OidcEnv
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(discovery)))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const signin = (query: string) =>
  oidcSignin(new Request(`https://app.example.test/api/oidc/signin?${query}`), {
    env,
    sessions: memorySessionStore({ session: null }),
  })

const storedCallback = (res: Response): string => {
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('rflgd-oidc-state='))
  if (!cookie) throw new Error('no state cookie')
  const value = cookie.slice('rflgd-oidc-state='.length).split(';')[0]
  return JSON.parse(decodeURIComponent(value)).callback
}

describe('oidcSignin callbackUrl', () => {
  it('stores a same-origin path with its query and fragment', async () => {
    const res = await signin(`callbackUrl=${encodeURIComponent('/chat?tab=files#top')}`)
    expect(storedCallback(res)).toBe('/chat?tab=files#top')
  })

  it.each([
    ['an absolute URL', 'https://evil.example.test/'],
    ['a protocol-relative URL', '//evil.example.test'],
    ['a backslash host', '/\\evil.example.test'],
  ])('stores /admin instead of %s', async (_, raw) => {
    const res = await signin(`callbackUrl=${encodeURIComponent(raw)}`)
    expect(storedCallback(res)).toBe('/admin')
  })

  it('stores /admin without a callbackUrl', async () => {
    expect(storedCallback(await signin(''))).toBe('/admin')
  })
})
