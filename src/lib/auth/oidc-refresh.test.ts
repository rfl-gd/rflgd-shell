import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const grant = vi.hoisted(() => ({
  calls: [] as string[],
  outcome: 'ok' as 'ok' | 'refused',
  waiting: [] as (() => void)[],
  release() {
    this.waiting.splice(0).forEach((resolve) => resolve())
  },
}))

vi.mock('oauth4webapi', () => ({
  discoveryRequest: vi.fn(async () => new Response('{}')),
  processDiscoveryResponse: vi.fn(async () => ({ issuer: 'https://id.example.test/oidc' })),
  ClientSecretBasic: vi.fn(() => () => {}),
  refreshTokenGrantRequest: vi.fn(async (_as: unknown, _client: unknown, _auth: unknown, refreshToken: string) => {
    grant.calls.push(refreshToken)
    await new Promise<void>((resolve) => grant.waiting.push(resolve))
    return new Response('{}')
  }),
  processRefreshTokenResponse: vi.fn(async () => {
    if (grant.outcome === 'refused') throw new Error('invalid_grant')
    return { access_token: `at-${grant.calls.length}`, refresh_token: `rt-${grant.calls.length}`, expires_in: 3600 }
  }),
}))

import type { OidcEnv } from './oidc-config'
import { refreshAccessToken } from './oidc-refresh'

/**
 * Once the platform rotates refresh tokens, presenting one a second time
 * revokes the whole grant. A page navigation fires several shell-info
 * requests at once, all carrying the same expired session, so they must
 * share a single refresh instead of each spending the token.
 */

const env = {
  issuer: 'https://id.example.test/oidc',
  clientId: 'client',
  clientSecret: 'secret',
} as OidcEnv

let tokenSeq = 0
const freshToken = () => `rt-original-${++tokenSeq}`

const settle = async () => {
  await vi.waitFor(() => expect(grant.calls.length).toBeGreaterThan(0))
  grant.release()
}

beforeEach(() => {
  grant.calls = []
  grant.waiting = []
  grant.outcome = 'ok'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('refreshAccessToken', () => {
  it('spends a refresh token once for concurrent callers', async () => {
    const token = freshToken()

    const pending = Promise.all([1, 2, 3].map(() => refreshAccessToken(env, token)))
    await settle()
    const results = await pending

    expect(grant.calls).toEqual([token])
    expect(results.every((r) => r?.accessToken === 'at-1' && r.refreshToken === 'rt-1')).toBe(true)
  })

  it('hands the same result to a request that arrives just after the refresh', async () => {
    const token = freshToken()

    const first = refreshAccessToken(env, token)
    await settle()
    await first
    const late = await refreshAccessToken(env, token)

    expect(grant.calls).toEqual([token])
    expect(late?.refreshToken).toBe('rt-1')
  })

  it('refreshes again once the grace period is over', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const token = freshToken()

    const first = refreshAccessToken(env, token)
    await settle()
    await first
    vi.advanceTimersByTime(60_000)
    const second = refreshAccessToken(env, token)
    await vi.waitFor(() => expect(grant.calls.length).toBe(2))
    grant.release()
    await second

    expect(grant.calls).toEqual([token, token])
  })

  it('does not hold on to a refused refresh', async () => {
    const token = freshToken()
    grant.outcome = 'refused'

    const first = refreshAccessToken(env, token)
    await settle()
    expect(await first).toBeNull()

    grant.outcome = 'ok'
    const retry = refreshAccessToken(env, token)
    await vi.waitFor(() => expect(grant.calls.length).toBe(2))
    grant.release()

    expect((await retry)?.accessToken).toBe('at-2')
  })

  it('keeps refreshes for different sessions apart', async () => {
    const pending = Promise.all([refreshAccessToken(env, freshToken()), refreshAccessToken(env, freshToken())])
    await vi.waitFor(() => expect(grant.calls.length).toBe(2))
    grant.release()
    await pending

    expect(new Set(grant.calls).size).toBe(2)
  })
})
