import { afterEach, describe, expect, it, vi } from 'vitest'

import { OIDC_SESSION_TTL } from './oidc-config'
import { signSessionCookie, verifySessionCookie } from './oidc-cookie'
import { clearRevocations, isSessionRevoked, recordLogout } from './revocations'

const SECRET = 'x'.repeat(32)

afterEach(() => clearRevocations())

describe('revocations', () => {
  it('revokes a session of that sid signed in before the logout', () => {
    recordLogout({ sid: 's-1', sub: 'u-1' }, 2_000)
    expect(isSessionRevoked({ sub: 'u-1', sid: 's-1', signedInAt: 1_000 })).toBe(true)
  })

  it('keeps a later sign-in with the same sid', () => {
    recordLogout({ sid: 's-1', sub: 'u-1' }, 2_000)
    expect(isSessionRevoked({ sub: 'u-1', sid: 's-1', signedInAt: 3_000 })).toBe(false)
  })

  it("a sid logout spares the person's other sessions", () => {
    recordLogout({ sid: 's-1', sub: 'u-1' }, 2_000)
    expect(isSessionRevoked({ sub: 'u-1', sid: 's-2', signedInAt: 1_000 })).toBe(false)
  })

  it('a sub-only logout revokes every session of that sub signed in before', () => {
    recordLogout({ sub: 'u-1' }, 2_000)
    expect(isSessionRevoked({ sub: 'u-1', sid: 's-9', signedInAt: 1_000 })).toBe(true)
    expect(isSessionRevoked({ sub: 'u-1', sid: 's-9', signedInAt: 3_000 })).toBe(false)
    expect(isSessionRevoked({ sub: 'u-2', sid: 's-9', signedInAt: 1_000 })).toBe(false)
  })

  it('a session minted before 2.2 (no sid) ends with any logout of its person', () => {
    recordLogout({ sid: 's-1', sub: 'u-1' }, 2_000)
    expect(isSessionRevoked({ sub: 'u-1', sid: null, signedInAt: null })).toBe(true)
    expect(isSessionRevoked({ sub: 'u-2', sid: null, signedInAt: null })).toBe(false)
  })

  it('a session without signedInAt counts as signed in at 0', () => {
    recordLogout({ sub: 'u-1' }, 2_000)
    expect(isSessionRevoked({ sub: 'u-1' })).toBe(true)
  })

  it('forgets logouts older than the session lifetime', () => {
    const now = Date.now()
    recordLogout({ sid: 's-old' }, now - OIDC_SESSION_TTL * 1000 - 1)
    recordLogout({ sid: 's-new' }, now)
    expect(isSessionRevoked({ sub: 'u', sid: 's-old', signedInAt: 0 })).toBe(false)
    expect(isSessionRevoked({ sub: 'u', sid: 's-new', signedInAt: 0 })).toBe(true)
  })

  it('is shared by every copy of the module in one process', async () => {
    recordLogout({ sid: 's-shared' }, 2_000)
    vi.resetModules()
    const copy = await import('./revocations?copy' as string).catch(() => import('./revocations'))
    expect(copy.isSessionRevoked({ sub: 'u', sid: 's-shared', signedInAt: 1_000 })).toBe(true)
  })

  it('a cookie without signedInAt signed after the logout stays valid (an app signing its own cookie)', async () => {
    recordLogout({ sid: 's-1', sub: 'u-1' }, Date.now() - 60_000)
    const fresh = await signSessionCookie(SECRET, { sub: 'u-1', email: 'a@x' })
    expect(await verifySessionCookie(SECRET, fresh)).toMatchObject({ sub: 'u-1', signedInAt: null })
  })

  it('a cookie without signedInAt signed before the logout is refused', async () => {
    const old = await signSessionCookie(SECRET, { sub: 'u-1', email: 'a@x' })
    recordLogout({ sid: 's-1', sub: 'u-1' }, Date.now() + 60_000)
    expect(await verifySessionCookie(SECRET, old)).toBeNull()
  })

  it('verifySessionCookie refuses a revoked session and accepts a newer one', async () => {
    const older = await signSessionCookie(SECRET, { sub: 'u-1', email: 'a@x', sid: 's-1', signedInAt: 1_000 })
    const newer = await signSessionCookie(SECRET, { sub: 'u-1', email: 'a@x', sid: 's-1', signedInAt: 3_000 })
    recordLogout({ sid: 's-1', sub: 'u-1' }, 2_000)
    expect(await verifySessionCookie(SECRET, older)).toBeNull()
    expect(await verifySessionCookie(SECRET, newer)).toMatchObject({ sid: 's-1', signedInAt: 3_000 })
  })
})
