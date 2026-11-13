import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GET as signin } from '../api/oidc-signin'
import { OIDC_COOKIE } from '../auth/oidc-config'
import { signSessionCookie } from '../auth/oidc-cookie'
import { createOidcStrategy } from '../auth/nextauth-strategy'
import { getUserAccess } from './user-access'

/**
 * The shell ends a module session when the base says the user lost access:
 * the Payload strategy stops accepting the session, and the sign-in route the
 * admin falls back to clears the cookie and sends the user to the base.
 */

const SECRET = 'test-secret'
const CLIENT_KEY = Symbol.for('@reflagged/shell/directory')

/** Base answering every directory read for a user with `access`. */
function stubBase(access: boolean | 'not-found' | 'forbidden') {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/oidc/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    }
    if (access === 'not-found') {
      return new Response(JSON.stringify({ success: false, error: { code: 'not-found' } }), { status: 404 })
    }
    if (access === 'forbidden') {
      return new Response(JSON.stringify({ success: false, error: { code: 'forbidden' } }), { status: 403 })
    }
    return new Response(JSON.stringify({ success: true, data: { access, groups: [], roles: [] } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

async function cookieHeader(sub = 'u1') {
  return `other=1; ${OIDC_COOKIE}=${await signSessionCookie(SECRET, { sub, email: 'a@example.de' })}`
}

const fakePayload = {
  find: vi.fn(async () => ({ docs: [{ id: 1, email: 'a@example.de' }] })),
  count: vi.fn(),
  create: vi.fn(),
}

async function authenticate(cookie: string) {
  const strategy = createOidcStrategy()
  return strategy.authenticate({
    payload: fakePayload as never,
    headers: new Headers({ cookie }),
  } as never)
}

beforeEach(() => {
  vi.stubEnv('AUTH_SECRET', SECRET)
  vi.stubEnv('OIDC_ISSUER', 'https://base.test/oidc')
  vi.stubEnv('OIDC_CLIENT_ID', 'crm')
  vi.stubEnv('OIDC_CLIENT_SECRET', 's3cret')
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://crm.test')
  delete (globalThis as Record<symbol, unknown>)[CLIENT_KEY]
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Payload strategy', () => {
  it('lets the first request through and refuses the session once the base said no', async () => {
    stubBase(false)
    const cookie = await cookieHeader()
    expect((await authenticate(cookie)).user).not.toBeNull()
    await vi.waitFor(async () => expect((await authenticate(cookie)).user).toBeNull())
  })

  it('refuses the session of a user the base does not know', async () => {
    stubBase('not-found')
    await getUserAccess('u1')
    expect((await authenticate(await cookieHeader())).user).toBeNull()
  })

  it('keeps the session when the user has access', async () => {
    stubBase(true)
    await getUserAccess('u1')
    expect((await authenticate(await cookieHeader())).user).not.toBeNull()
  })

  it('keeps the session when the module does not take part in groups and roles', async () => {
    stubBase('forbidden')
    await getUserAccess('u1')
    expect((await authenticate(await cookieHeader())).user).not.toBeNull()
  })

  it('keeps the session when the base is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))))
    await getUserAccess('u1')
    expect((await authenticate(await cookieHeader())).user).not.toBeNull()
  })

  it('does not enforce with RFLGD_DIRECTORY_ENFORCE=false', async () => {
    vi.stubEnv('RFLGD_DIRECTORY_ENFORCE', 'false')
    stubBase(false)
    await getUserAccess('u1')
    expect((await authenticate(await cookieHeader())).user).not.toBeNull()
  })
})

describe('sign-in route', () => {
  it('clears the session and sends a user without access to the base', async () => {
    stubBase(false)
    await getUserAccess('u1')
    const res = await signin(
      new Request('https://crm.test/api/oidc/signin?callbackUrl=/admin', {
        headers: { cookie: await cookieHeader() },
      }),
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://base.test/?error=no-access')
    const cleared = res.cookies.get(OIDC_COOKIE)
    expect(cleared?.value).toBe('')
    expect(cleared?.maxAge).toBe(0)
  })
})
