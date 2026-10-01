import { describe, expect, it, vi } from 'vitest'

import { createNotifier, NotifyError } from './notifier'

const input = {
  idempotencyKey: 'k1',
  topic: 'kollega.absence.approved',
  category: 'activity' as const,
  title: 'Urlaub genehmigt',
  recipients: [{ email: 'a@b.de' }],
}

function fakeFetch(responses: Array<[number, unknown]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected call ${String(url)}`)
    return new Response(JSON.stringify(next[1]), { status: next[0] })
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

const token = (value: string) => [200, { access_token: value, expires_in: 600 }] as [number, unknown]
const created = [201, { success: true, data: { ids: [1], recipients: 1, skipped: 0 } }] as [number, unknown]

describe('createNotifier', () => {
  it('fetches a client_credentials token once and reuses it', async () => {
    const { fn, calls } = fakeFetch([token('t1'), created, created])
    const notifier = createNotifier({ issuer: 'https://app.rfl.gd/oidc', clientId: 'c', clientSecret: 's', fetch: fn })
    await expect(notifier.notify(input)).resolves.toEqual({ ids: [1], recipients: 1, skipped: 0 })
    await notifier.notify(input)
    expect(calls.map((c) => c.url)).toEqual([
      'https://app.rfl.gd/oidc/token',
      'https://app.rfl.gd/api/notifications',
      'https://app.rfl.gd/api/notifications',
    ])
    expect(String(calls[0]?.init?.body)).toContain('grant_type=client_credentials')
    expect((calls[1]?.init?.headers as Record<string, string>).authorization).toBe('Bearer t1')
  })

  it('refreshes the token once on 401', async () => {
    const { fn, calls } = fakeFetch([token('old'), [401, {}], token('new'), created])
    const notifier = createNotifier({ issuer: 'https://app.rfl.gd/oidc', clientId: 'c', clientSecret: 's', fetch: fn })
    await notifier.notify(input)
    expect((calls[3]?.init?.headers as Record<string, string>).authorization).toBe('Bearer new')
  })

  it('throws a NotifyError with the base error code', async () => {
    const { fn } = fakeFetch([
      token('t'),
      [403, { success: false, error: { code: 'forbidden', message: 'Empfänger gehört nicht zur Organisation' } }],
    ])
    const notifier = createNotifier({ issuer: 'https://app.rfl.gd/oidc', clientId: 'c', clientSecret: 's', fetch: fn })
    const err = await notifier.notify(input).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotifyError)
    expect(err).toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('requires the OIDC client settings', () => {
    expect(() => createNotifier({ issuer: '', clientId: '', clientSecret: '' })).toThrow(/required/)
  })
})
