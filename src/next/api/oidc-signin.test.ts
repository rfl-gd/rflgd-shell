import { afterEach, describe, expect, it, vi } from 'vitest'

import { GET as callback, deniedResponse } from './oidc-callback'
import { GET as signin } from './oidc-signin'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sign-in wrappers without configuration', () => {
  it.each([
    ['sign-in', signin],
    ['callback', callback],
  ])('%s answers 500 oidc-not-configured', async (_name, handler) => {
    vi.stubEnv('OIDC_ISSUER', '')

    const res = await handler(new Request('https://app.example.test/api/oidc/x'))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'oidc-not-configured' })
  })
})

describe('deniedResponse', () => {
  it('answers access_denied with a 403 page', () => {
    const res = deniedResponse('access_denied', null)

    expect(res.status).toBe(403)
    expect(res.headers.get('content-type')).toContain('text/html')
  })
})
