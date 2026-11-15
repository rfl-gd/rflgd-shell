import { describe, expect, it } from 'vitest'
import { loadAppConfig } from './config'

describe('loadAppConfig', () => {
  it('reads nothing when there is no process env', () => {
    expect(loadAppConfig({})).toEqual({ appKey: 'unknown', appLabel: 'Reflagged App', defaultRole: 'user' })
  })

  it('reads the given env', () => {
    expect(
      loadAppConfig({
        NEXT_PUBLIC_RFLGD_APP_KEY: 'botspawn',
        NEXT_PUBLIC_RFLGD_APP_LABEL: 'Botspawn',
        RFLGD_DEFAULT_USER_ROLE: 'admin',
      }),
    ).toEqual({ appKey: 'botspawn', appLabel: 'Botspawn', defaultRole: 'admin' })
  })
})
