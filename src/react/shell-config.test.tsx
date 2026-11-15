import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrandSwitcher } from './BrandSwitcher'
import { ShellProvider, resolveShellConfig } from './shell-config'

describe('shell config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('falls back to the env reader without a provider', () => {
    vi.stubEnv('NEXT_PUBLIC_RFLGD_APP_KEY', 'from-env')
    vi.stubEnv('NEXT_PUBLIC_RFLGD_APP_LABEL', 'From Env')
    expect(resolveShellConfig(null)).toEqual({
      appKey: 'from-env',
      appLabel: 'From Env',
      shellInfoUrl: '/api/shell-info',
    })
  })

  it('defaults everything without a provider or env', () => {
    vi.stubEnv('NEXT_PUBLIC_RFLGD_APP_KEY', undefined)
    vi.stubEnv('NEXT_PUBLIC_RFLGD_APP_LABEL', undefined)
    expect(resolveShellConfig(null)).toEqual({
      appKey: 'unknown',
      appLabel: 'Reflagged App',
      shellInfoUrl: '/api/shell-info',
    })
  })

  it('keeps the provider values and defaults the url', () => {
    expect(resolveShellConfig({ appKey: 'botspawn', appLabel: 'Botspawn' })).toEqual({
      appKey: 'botspawn',
      appLabel: 'Botspawn',
      shellInfoUrl: '/api/shell-info',
    })
  })

  it('renders the switcher inside a provider', () => {
    const html = renderToString(
      <ShellProvider config={{ appKey: 'x', appLabel: 'Label X' }}>
        <BrandSwitcher />
      </ShellProvider>,
    )
    expect(html).toContain('Label X')
  })
})
