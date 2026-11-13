import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDirectoryClient, hasRole, inGroup, type UserAccess } from './user-access'

const env = { issuer: 'https://base.test/oidc', clientId: 'crm', clientSecret: 's3cret' }

type Reply = { status: number; body?: unknown; etag?: string } | Error

const UNKNOWN: UserAccess = { access: true, groups: [], roles: [] }
const MINUTE = 60_000

/** A fake base: answers the token endpoint itself, directory requests from `replies` in order. */
function fakeBase(replies: Reply[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oidc/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const reply = replies.shift() ?? { status: 500 }
    if (reply instanceof Error) throw reply
    return new Response(reply.status === 304 ? null : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: reply.etag ? { etag: reply.etag } : {},
    })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls }
}

const user = (data: Partial<UserAccess> = {}) => ({
  success: true,
  data: { access: true, groups: [{ id: 12, name: 'Vertrieb', externalId: 'ext-12' }], roles: ['editor'], ...data },
})
const failure = (code: string) => ({ success: false, error: { code, message: 'x' } })

describe('getUserAccess', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns access, groups and roles from the base for the given sub', async () => {
    const base = fakeBase([{ status: 200, body: user() }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(await directory.getUserAccess('u/1')).toEqual(user().data)
    expect(base.calls[0]?.url).toBe('https://base.test/api/modules/directory/users/u%2F1')
    expect(base.calls[0]?.headers.authorization).toBe('Bearer tok')
  })

  it('serves a fresh value from the cache for five minutes without asking the base', async () => {
    const base = fakeBase([{ status: 200, body: user() }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await directory.getUserAccess('u1')
    vi.advanceTimersByTime(5 * MINUTE - 1)
    expect(await directory.getUserAccess('u1')).toEqual(user().data)
    expect(base.calls).toHaveLength(1)
  })

  it('revalidates with the ETag after five minutes and keeps the value on 304', async () => {
    const base = fakeBase([{ status: 200, body: user(), etag: 'W/"1"' }, { status: 304 }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await directory.getUserAccess('u1')
    vi.advanceTimersByTime(5 * MINUTE)
    expect(await directory.getUserAccess('u1')).toEqual(user().data)
    expect(base.calls[1]?.headers['if-none-match']).toBe('W/"1"')
  })

  it('serves the last good value while the base is down, for at most 60 minutes', async () => {
    const base = fakeBase([{ status: 200, body: user() }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await directory.getUserAccess('u1')
    vi.advanceTimersByTime(59 * MINUTE)
    expect(await directory.getUserAccess('u1')).toEqual(user().data)
    vi.advanceTimersByTime(MINUTE)
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)
  })

  it('treats a 304 as a fresh confirmation for the 60-minute window', async () => {
    const base = fakeBase([{ status: 200, body: user(), etag: 'W/"1"' }, { status: 304 }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await directory.getUserAccess('u1')
    vi.advanceTimersByTime(50 * MINUTE)
    await directory.getUserAccess('u1')
    vi.advanceTimersByTime(50 * MINUTE)
    expect(await directory.getUserAccess('u1')).toEqual(user().data)
  })

  it('returns the unknown fallback when the base never answered', async () => {
    const base = fakeBase([new Error('ECONNREFUSED')])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)
  })

  it('maps a 404 not-found to no access', async () => {
    const base = fakeBase([{ status: 404, body: failure('not-found') }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(await directory.getUserAccess('u1')).toEqual({ access: false, groups: [], roles: [] })
  })

  it('never throws on malformed JSON or a malformed body', async () => {
    const base = fakeBase([{ status: 200, body: 'not json' }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)

    const second = fakeBase([{ status: 200, body: { success: true, data: { access: 'yes', groups: [] } } }])
    const other = createDirectoryClient({ ...env, fetch: second.fetch })
    expect(await other.getUserAccess('u1')).toEqual(UNKNOWN)
  })

  it('never throws when the token request fails', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 500 }))
    const directory = createDirectoryClient({ ...env, fetch: fetch as never })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)
  })

  it('treats 401 and 5xx as unknown', async () => {
    const base = fakeBase([
      { status: 401, body: failure('unauthorized') },
      { status: 401, body: failure('unauthorized') },
    ])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)

    const down = fakeBase([{ status: 503, body: failure('failed') }])
    const other = createDirectoryClient({ ...env, fetch: down.fetch })
    expect(await other.getUserAccess('u1')).toEqual(UNKNOWN)
  })

  it('remembers a 403 forbidden for 60 minutes and asks for no user meanwhile', async () => {
    const base = fakeBase([{ status: 403, body: failure('forbidden') }, { status: 200, body: user() }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)
    expect(await directory.getUserAccess('u2')).toEqual(UNKNOWN)
    vi.advanceTimersByTime(59 * MINUTE)
    expect(await directory.getUserAccess('u3')).toEqual(UNKNOWN)
    expect(base.calls).toHaveLength(1)
    vi.advanceTimersByTime(MINUTE)
    expect(await directory.getUserAccess('u3')).toEqual(user().data)
  })

  it('waits before asking again after a failed load', async () => {
    const base = fakeBase([{ status: 500 }, { status: 200, body: user() }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch, retryAfterMs: 10_000 })
    await directory.getUserAccess('u1')
    await directory.getUserAccess('u2')
    expect(base.calls).toHaveLength(1)
    vi.advanceTimersByTime(10_000)
    expect(await directory.getUserAccess('u2')).toEqual(user().data)
  })

  it('sends one request for concurrent reads of the same user', async () => {
    const base = fakeBase([{ status: 200, body: user() }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await Promise.all([directory.getUserAccess('u1'), directory.getUserAccess('u1')])
    expect(base.calls).toHaveLength(1)
  })

  it('caps the cache and drops the oldest entry', async () => {
    const base = fakeBase([
      { status: 200, body: user() },
      { status: 200, body: user() },
      { status: 200, body: user() },
      { status: 200, body: user() },
    ])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch, maxEntries: 2 })
    await directory.getUserAccess('u1')
    await directory.getUserAccess('u2')
    await directory.getUserAccess('u3')
    await directory.getUserAccess('u2')
    expect(base.calls).toHaveLength(3)
    await directory.getUserAccess('u1')
    expect(base.calls).toHaveLength(4)
  })

  it('never calls out without OIDC client settings', async () => {
    const fetch = vi.fn()
    const directory = createDirectoryClient({ issuer: '', clientId: '', clientSecret: '', fetch })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)
    expect(await directory.listGroups()).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gives up on a base that does not answer', async () => {
    vi.useRealTimers()
    const fetch = vi.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (url.endsWith('/oidc/token')) {
            resolve(new Response(JSON.stringify({ access_token: 'tok', expires_in: 600 }), { status: 200 }))
            return
          }
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const directory = createDirectoryClient({ ...env, fetch: fetch as never, requestTimeoutMs: 20 })
    expect(await directory.getUserAccess('u1')).toEqual(UNKNOWN)
  })
})

describe('isAccessRevoked', () => {
  it('lets an unseen user through and loads the answer in the background', async () => {
    const base = fakeBase([{ status: 200, body: user({ access: false, groups: [], roles: [] }) }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    expect(directory.isAccessRevoked('u1')).toBe(false)
    await vi.waitFor(() => expect(directory.isAccessRevoked('u1')).toBe(true))
    expect(base.calls).toHaveLength(1)
  })

  it('reports a 404 not-found as revoked', async () => {
    const base = fakeBase([{ status: 404, body: failure('not-found') }])
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await directory.getUserAccess('u1')
    expect(directory.isAccessRevoked('u1')).toBe(true)
  })

  it.each([
    ['a network error', [new Error('ECONNREFUSED')] as Reply[]],
    ['a 401', [{ status: 401 }, { status: 401 }] as Reply[]],
    ['a 403 forbidden', [{ status: 403, body: failure('forbidden') }] as Reply[]],
    ['a 500', [{ status: 500 }] as Reply[]],
    ['a malformed body', [{ status: 200, body: { success: true } }] as Reply[]],
  ])('never reports revoked after %s', async (_, replies) => {
    const base = fakeBase(replies)
    const directory = createDirectoryClient({ ...env, fetch: base.fetch })
    await directory.getUserAccess('u1')
    expect(directory.isAccessRevoked('u1')).toBe(false)
  })

  it('serves the cached verdict while a stale entry is refreshed in the background', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([{ status: 200, body: user() }, { status: 200, body: user({ access: false }) }])
      const directory = createDirectoryClient({ ...env, fetch: base.fetch })
      await directory.getUserAccess('u1')
      vi.advanceTimersByTime(5 * MINUTE)
      expect(directory.isAccessRevoked('u1')).toBe(false)
      await vi.waitFor(() => expect(directory.isAccessRevoked('u1')).toBe(true))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('listGroups', () => {
  const groups = [
    { id: 12, name: 'Vertrieb', source: 'entra', state: 'active', externalId: 'ext', memberCount: 14 },
    { id: 15, name: 'Projekt Alt', source: 'manual', state: 'removed', externalId: null, memberCount: 0 },
  ]

  it('returns all groups of the tenant and revalidates with the ETag', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([
        { status: 200, body: { success: true, data: { groups } }, etag: 'W/"g"' },
        { status: 304 },
      ])
      const directory = createDirectoryClient({ ...env, fetch: base.fetch })
      expect(await directory.listGroups()).toEqual(groups)
      expect(base.calls[0]?.url).toBe('https://base.test/api/modules/directory/groups')
      vi.advanceTimersByTime(5 * MINUTE)
      expect(await directory.listGroups()).toEqual(groups)
      expect(base.calls[1]?.headers['if-none-match']).toBe('W/"g"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns an empty list when the module does not take part or the base is down', async () => {
    const forbidden = fakeBase([{ status: 403, body: failure('forbidden') }])
    expect(await createDirectoryClient({ ...env, fetch: forbidden.fetch }).listGroups()).toEqual([])
    const down = fakeBase([new Error('ECONNREFUSED')])
    expect(await createDirectoryClient({ ...env, fetch: down.fetch }).listGroups()).toEqual([])
  })
})

describe('hasRole / inGroup', () => {
  const access: UserAccess = user().data

  it('checks for a role', () => {
    expect(hasRole(access, 'editor')).toBe(true)
    expect(hasRole(access, 'admin')).toBe(false)
  })

  it('checks for a group id', () => {
    expect(inGroup(access, 12)).toBe(true)
    expect(inGroup(access, 13)).toBe(false)
  })

  it('grants nothing without access', () => {
    expect(hasRole({ access: false, groups: [], roles: ['editor'] }, 'editor')).toBe(false)
    expect(inGroup({ access: false, groups: [{ id: 12, name: 'x', externalId: null }], roles: [] }, 12)).toBe(false)
  })
})
