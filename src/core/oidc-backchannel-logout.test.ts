import { exportJWK, generateKeyPair, SignJWT, type JWTPayload, type KeyLike } from 'jose'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type { OidcEnv } from './auth/oidc-config'
import { clearRevocations, isSessionRevoked } from './auth/revocations'
import { BACKCHANNEL_LOGOUT_EVENT, backchannelLogout } from './oidc-backchannel-logout'

const ISSUER = 'https://id.example.test/oidc'

const env: OidcEnv = {
  issuer: ISSUER,
  clientId: 'module-client',
  clientSecret: 's',
  redirectUri: 'https://module.example.test/api/oidc/callback',
  authSecret: 'x'.repeat(32),
  baseUrl: 'https://module.example.test',
}

let signingKey: KeyLike
let strangerKey: KeyLike
const servedKeys: object[] = []

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  signingKey = pair.privateKey
  strangerKey = (await generateKeyPair('RS256')).privateKey
  servedKeys.push({ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const href = String(input instanceof Request ? input.url : input)
      if (href === `${ISSUER}/.well-known/openid-configuration`) {
        return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks` })
      }
      if (href === `${ISSUER}/jwks`) return Response.json({ keys: servedKeys })
      return new Response('not found', { status: 404 })
    }),
  )
})

afterAll(() => vi.unstubAllGlobals())
afterEach(() => clearRevocations())

const now = () => Math.floor(Date.now() / 1000)

async function logoutToken(
  claims: JWTPayload = {},
  key: KeyLike = signingKey,
  kid = 'k1',
): Promise<string> {
  return new SignJWT({
    iss: ISSUER,
    aud: 'module-client',
    sub: 'u-1',
    sid: 'sid-1',
    events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'logout+jwt' })
    .setIssuedAt(typeof claims.iat === 'number' ? claims.iat : now())
    .setJti(`jti-${Math.random()}`)
    .setExpirationTime(now() + 120)
    .sign(key)
}

const post = (body: string) =>
  backchannelLogout(
    new Request('https://module.example.test/api/oidc/backchannel-logout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }),
    { env },
  )

const postToken = async (token: string) => post(new URLSearchParams({ logout_token: token }).toString())

describe('POST /api/oidc/backchannel-logout', () => {
  it('a valid token ends that provider session and answers 200 no-store', async () => {
    const res = await postToken(await logoutToken())
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(isSessionRevoked({ sub: 'u-1', sid: 'sid-1', signedInAt: Date.now() - 1000 })).toBe(true)
    expect(isSessionRevoked({ sub: 'u-1', sid: 'sid-2', signedInAt: Date.now() - 1000 })).toBe(false)
  })

  it('a token without sid ends every session of the person', async () => {
    const res = await postToken(await logoutToken({ sid: undefined }))
    expect(res.status).toBe(200)
    expect(isSessionRevoked({ sub: 'u-1', sid: 'any', signedInAt: Date.now() - 1000 })).toBe(true)
  })

  it.each([
    ['no token at all', async () => post('')],
    ['a token signed by another key', async () => postToken(await logoutToken({}, strangerKey))],
    ['a foreign issuer', async () => postToken(await logoutToken({ iss: 'https://evil.example.test/oidc' }))],
    ['another audience', async () => postToken(await logoutToken({ aud: 'other-client' }))],
    ['an iat ten minutes old', async () => postToken(await logoutToken({ iat: now() - 600 }))],
    ['no logout event', async () => postToken(await logoutToken({ events: { other: {} } }))],
    ['a nonce', async () => postToken(await logoutToken({ nonce: 'n' }))],
    ['neither sid nor sub', async () => postToken(await logoutToken({ sid: undefined, sub: undefined }))],
    ['garbage', async () => postToken('not-a-jwt')],
  ])('refuses %s with 400 and ends nothing', async (_, send) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await send()
    expect(res.status).toBe(400)
    expect(isSessionRevoked({ sub: 'u-1', sid: 'sid-1', signedInAt: 0 })).toBe(false)
    warn.mockRestore()
  })

  it('accepts a token signed with a rotated key once the cached key set is older than a minute', async () => {
    await postToken(await logoutToken()) // key set cached
    const rotated = await generateKeyPair('RS256')
    servedKeys.push({ ...(await exportJWK(rotated.publicKey)), kid: 'k2', alg: 'RS256', use: 'sig' })
    vi.useFakeTimers({ now: Date.now() + 61_000, toFake: ['Date'] })
    try {
      const res = await postToken(await logoutToken({ sid: 'sid-rotated' }, rotated.privateKey, 'k2'))
      expect(res.status).toBe(200)
      expect(isSessionRevoked({ sub: 'u-1', sid: 'sid-rotated', signedInAt: 0 })).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('answers 405 to anything but POST', async () => {
    const res = await backchannelLogout(new Request('https://module.example.test/api/oidc/backchannel-logout'), {
      env,
    })
    expect(res.status).toBe(405)
  })

  it('answers 503 while the issuer cannot be discovered, and retries later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const offline = { ...env, issuer: 'https://offline.example.test/oidc' }
    const req = () =>
      new Request('https://module.example.test/api/oidc/backchannel-logout', {
        method: 'POST',
        body: new URLSearchParams({ logout_token: 'x.y.z' }).toString(),
      })
    expect((await backchannelLogout(req(), { env: offline })).status).toBe(503)
    expect((await backchannelLogout(req(), { env: offline })).status).toBe(503)
    warn.mockRestore()
  })
})
