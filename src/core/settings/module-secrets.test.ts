import { describe, expect, it, vi } from 'vitest'

import { createModuleSecrets, ModuleSecretError } from './module-secrets'

const env = { issuer: 'https://base.test/oidc', clientId: 'crm', clientSecret: 's3cret' }

type Reply = { status: number; body?: unknown } | Error

/** A fake base: answers the token endpoint itself, secret requests from `replies` in order. */
function fakeBase(replies: Reply[]) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const scopes: string[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oidc/token')) {
      scopes.push(new URLSearchParams(String(init?.body)).get('scope') ?? '')
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 600 }), { status: 200 })
    }
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const reply = replies.shift() ?? { status: 500 }
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status })
  })
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, scopes }
}

const values = (v: Record<string, unknown>) => ({ success: true, data: { values: v } })

describe('createModuleSecrets', () => {
  it('reads the secrets endpoint with the module token and returns the value', async () => {
    const base = fakeBase([{ status: 200, body: values({ 'lexware.api-token': 'lx' }) }])
    const secrets = createModuleSecrets<'lexware.api-token'>({ ...env, fetch: base.fetch })
    expect(await secrets.require('lexware.api-token')).toBe('lx')
    expect(base.calls[0]?.url).toBe('https://base.test/api/modules/settings/secrets')
    expect(base.calls[0]?.headers.authorization).toBe('Bearer tok')
    // Its own scope: reading plain settings never implies credentials.
    expect(base.scopes).toEqual(['settings:secrets'])
  })

  it('keeps the cached values when the base cannot decrypt (500 secret-key-missing)', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([
        { status: 200, body: values({ a: 'x' }) },
        { status: 500, body: { success: false, error: { code: 'secret-key-missing' } } },
      ])
      const secrets = createModuleSecrets({ ...env, fetch: base.fetch, ttlMs: 1000 })
      expect(await secrets.require('a')).toBe('x')
      vi.advanceTimersByTime(2000)
      expect(await secrets.require('a')).toBe('x')
      expect(base.calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['secret-key-missing', 'secret-undecryptable'])(
    'reports unreadable, not missing, for %s without a cache',
    async (code) => {
      const base = fakeBase([{ status: 500, body: { success: false, error: { code } } }])
      const secrets = createModuleSecrets({ ...env, fetch: base.fetch })
      await expect(secrets.get('a')).rejects.toMatchObject({ code: 'unreadable', key: 'a' })
    },
  )

  it('caches within the window', async () => {
    const base = fakeBase([{ status: 200, body: values({ a: 'x' }) }])
    const secrets = createModuleSecrets({ ...env, fetch: base.fetch })
    await secrets.get('a')
    await secrets.get('a')
    expect(base.calls).toHaveLength(1)
  })

  it('returns null from get and throws missing from require when not set', async () => {
    const base = fakeBase([{ status: 200, body: values({}) }])
    const secrets = createModuleSecrets({ ...env, fetch: base.fetch })
    expect(await secrets.get('a')).toBeNull()
    await expect(secrets.require('a')).rejects.toMatchObject({
      name: 'ModuleSecretError',
      code: 'missing',
      key: 'a',
    })
  })

  it('throws unavailable when the base never answered, not "missing"', async () => {
    const base = fakeBase([new Error('ECONNREFUSED')])
    const secrets = createModuleSecrets({ ...env, fetch: base.fetch })
    await expect(secrets.get('a')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('keeps the last good values through an outage', async () => {
    vi.useFakeTimers()
    try {
      const base = fakeBase([
        { status: 200, body: values({ a: 'x' }) },
        new Error('ECONNREFUSED'),
      ])
      const secrets = createModuleSecrets({ ...env, fetch: base.fetch, ttlMs: 1000 })
      expect(await secrets.get('a')).toBe('x')
      vi.advanceTimersByTime(2000)
      expect(await secrets.get('a')).toBe('x')
      expect(base.calls).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throws unconfigured without the OIDC client env', async () => {
    const secrets = createModuleSecrets({ issuer: '', clientId: '', clientSecret: '' })
    await expect(secrets.require('a')).rejects.toMatchObject({ code: 'unconfigured' })
  })

  it('never puts a value into an error message', async () => {
    const base = fakeBase([{ status: 200, body: values({ a: 'lx_live_secret' }) }])
    const secrets = createModuleSecrets({ ...env, fetch: base.fetch })
    await secrets.get('a')
    const err = await secrets.require('b').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ModuleSecretError)
    expect(String((err as Error).message)).not.toContain('lx_live_secret')
  })

  it('refuses to run in a browser', () => {
    vi.stubGlobal('window', {})
    try {
      expect(() => createModuleSecrets(env)).toThrow(ModuleSecretError)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
