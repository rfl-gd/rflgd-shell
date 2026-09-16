import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveNewUserRole, type NewUserContext } from './nextauth-strategy'

/**
 * Who becomes an administrator on a fresh instance is decided here. A silent
 * mistake in these five lines is expensive, so they carry their own test.
 */

const context = (over: Partial<NewUserContext> = {}): NewUserContext => ({
  orgRole: null,
  platformRole: null,
  email: 'someone@example.de',
  isFirstUser: false,
  ...over,
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveNewUserRole', () => {
  it('makes the first account an administrator', () => {
    expect(resolveNewUserRole(context({ isFirstUser: true }))).toBe('admin')
  })

  it('falls back to RFLGD_DEFAULT_USER_ROLE for everyone after that', () => {
    vi.stubEnv('RFLGD_DEFAULT_USER_ROLE', 'employee')

    expect(resolveNewUserRole(context())).toBe('employee')
  })

  it("uses the package's own default when the variable is unset", () => {
    vi.stubEnv('RFLGD_DEFAULT_USER_ROLE', undefined)

    expect(resolveNewUserRole(context())).toBe('user')
  })

  it('lets the app decide when it supplies a callback', () => {
    vi.stubEnv('RFLGD_DEFAULT_USER_ROLE', 'employee')

    const role = resolveNewUserRole(context({ orgRole: 'admin' }), ({ orgRole }) =>
      orgRole === 'admin' ? 'hr-admin' : 'employee',
    )

    expect(role).toBe('hr-admin')
  })

  it('hands the callback the first-user flag, so it can keep that rule', () => {
    // Without this the app cannot reproduce today's behaviour, and a fresh
    // instance can end up with no administrator at all.
    const role = resolveNewUserRole(context({ isFirstUser: true }), ({ isFirstUser }) =>
      isFirstUser ? 'admin' : 'employee',
    )

    expect(role).toBe('admin')
  })

  it('passes null claims through untouched — the standalone case', () => {
    // No rflgd:memberships scope, or a session older than the field. The app
    // must be able to tell "not an org admin" from "no platform at all".
    const seen: NewUserContext[] = []
    resolveNewUserRole(context(), (ctx) => {
      seen.push(ctx)
      return 'employee'
    })

    expect(seen[0]?.orgRole).toBeNull()
    expect(seen[0]?.platformRole).toBeNull()
  })
})
