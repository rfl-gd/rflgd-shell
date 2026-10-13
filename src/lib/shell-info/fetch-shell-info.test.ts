import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchShellInfo } from './fetch-shell-info'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(responder: () => Promise<Response>) {
  const fn = vi.fn(responder)
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('fetchShellInfo', () => {
  it('shares one request between callers that ask while it is in flight', async () => {
    let release: (res: Response) => void = () => undefined
    const fn = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)))

    const first = fetchShellInfo()
    const second = fetchShellInfo()
    release(new Response(JSON.stringify({ aiDisclosure: 'KI-System' }), { status: 200 }))

    await expect(first).resolves.toEqual({ status: 200, body: { aiDisclosure: 'KI-System' } })
    await expect(second).resolves.toEqual({ status: 200, body: { aiDisclosure: 'KI-System' } })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('/api/shell-info', { credentials: 'include' })
  })

  it('asks again once the previous request has settled', async () => {
    const fn = stubFetch(async () => new Response('{}', { status: 200 }))

    await fetchShellInfo()
    await fetchShellInfo()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('passes refusals through with their status and body', async () => {
    stubFetch(async () => new Response(JSON.stringify({ error: 'session-ended' }), { status: 401 }))

    await expect(fetchShellInfo()).resolves.toEqual({ status: 401, body: { error: 'session-ended' } })
  })

  it('answers a body that is not JSON with null', async () => {
    stubFetch(async () => new Response('<html>', { status: 502 }))

    await expect(fetchShellInfo()).resolves.toEqual({ status: 502, body: null })
  })

  it('lets every waiting caller see a network failure, then recovers', async () => {
    const fn = stubFetch(async () => {
      throw new TypeError('offline')
    })

    await expect(Promise.all([fetchShellInfo(), fetchShellInfo()])).rejects.toThrow('offline')
    expect(fn).toHaveBeenCalledTimes(1)

    fn.mockImplementation(async () => new Response('{}', { status: 200 }))
    await expect(fetchShellInfo()).resolves.toEqual({ status: 200, body: {} })
  })
})
