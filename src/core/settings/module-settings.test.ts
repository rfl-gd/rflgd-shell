import { describe, expect, it, vi } from 'vitest'

import { createModuleSettings } from './module-settings'

const env = { issuer: 'https://base.test/oidc', clientId: 'crm', clientSecret: 's3cret' }

type Reply = { status: number; body?: unknown; etag?: string } | Error

/** A fake base: answers the token endpoint itself, settings requests from `replies` in order. */
function fakeBase(replies: Reply[]) {
  const settingsCalls: Array<{ headers: Record<string, string> }> = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oidc/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 600 }), { status: 200 })
    }
    settingsCalls.push({ headers: (init?.headers ?? {}) as Record<string, string> })
    const reply = replies.shift() ?? { status: 500 }
    if (reply instanceof Error) throw reply
    return new Response(reply.status === 304 ? null : JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: reply.etag ? { etag: reply.etag } : {},
    })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, settingsCalls }
}

const values = (v: Record<string, unknown>) => ({ success: true, data: { values: v } })

describe('createModuleSettings', () => {
  it('loads all values in one request and returns the stored one', async () => {
    const base = fakeBase([{ status: 200, body: values({ 'documents.enabled': false }) }])
    const settings = createModuleSettings({ ...env, fetch: base.fetch })
    expect(await settings.get('documents.enabled', true)).toBe(false)
    expect(base.settingsCalls).toHaveLength(1)
  })

  it('serves repeated reads within the cache window without asking the base', async () => {
    const base = fakeBase([{ status: 200, body: values({ a: 1 }) }])
    const settings = createModuleSettings({ ...env, fetch: base.fetch })
    await settings.get('a', 0)
    await settings.get('a', 0)
    expect(base.settingsCalls).toHaveLength(1)
  })

  it('revalidates with the ETag after the cache window and keeps values on 304', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([{ status: 200, body: values({ a: 1 }), etag: 'W/"1"' }, { status: 304 }])
      const settings = createModuleSettings({ ...env, fetch: base.fetch, ttlMs: 1000 })
      await settings.get('a', 0)
      vi.advanceTimersByTime(1500)
      expect(await settings.get('a', 0)).toBe(1)
      expect(base.settingsCalls[1]?.headers['if-none-match']).toBe('W/"1"')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the last good value when the base fails later', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([{ status: 200, body: values({ a: 1 }) }, { status: 500 }])
      const settings = createModuleSettings({ ...env, fetch: base.fetch, ttlMs: 1000 })
      await settings.get('a', 0)
      vi.advanceTimersByTime(1500)
      expect(await settings.get('a', 0)).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back when the base is unreachable from the start', async () => {
    const base = fakeBase([new Error('ECONNREFUSED')])
    const settings = createModuleSettings({ ...env, fetch: base.fetch })
    expect(await settings.get('documents.enabled', true)).toBe(true)
  })

  it('falls back when the stored value has another type than the fallback', async () => {
    const base = fakeBase([{ status: 200, body: values({ 'documents.enabled': 'x' }) }])
    const settings = createModuleSettings({ ...env, fetch: base.fetch })
    expect(await settings.get('documents.enabled', true)).toBe(true)
  })

  it('sends one request for concurrent reads', async () => {
    const base = fakeBase([{ status: 200, body: values({ a: 1 }) }])
    const settings = createModuleSettings({ ...env, fetch: base.fetch })
    await Promise.all([settings.get('a', 0), settings.get('a', 0), settings.refresh()])
    expect(base.settingsCalls).toHaveLength(1)
  })

  it('peek answers synchronously with the fallback and loads in the background', async () => {
    const base = fakeBase([{ status: 200, body: values({ a: 7 }) }])
    const settings = createModuleSettings({ ...env, fetch: base.fetch })
    expect(settings.peek('a', 0)).toBe(0)
    await vi.waitFor(() => expect(settings.peek('a', 0)).toBe(7))
    expect(base.settingsCalls).toHaveLength(1)
  })

  it('never calls out without OIDC client settings', async () => {
    const fetch = vi.fn()
    const settings = createModuleSettings({ issuer: '', clientId: '', clientSecret: '', fetch })
    expect(await settings.get('a', 'x')).toBe('x')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('gives up on a base that does not answer and returns the fallback', async () => {
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
    const settings = createModuleSettings({ ...env, fetch: fetch as never, requestTimeoutMs: 20 })
    expect(await settings.get('documents.enabled', true)).toBe(true)
  })

  it('waits before asking again after a failed load', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([{ status: 500 }, { status: 500 }, { status: 200, body: values({ a: 1 }) }])
      const settings = createModuleSettings({ ...env, fetch: base.fetch, ttlMs: 60_000, retryAfterMs: 10_000 })
      await settings.get('a', 0)
      await settings.get('a', 0)
      expect(base.settingsCalls).toHaveLength(1)
      vi.advanceTimersByTime(10_001)
      await settings.get('a', 0)
      expect(base.settingsCalls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
