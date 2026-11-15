import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BrandSwitcher } from './BrandSwitcher'
import { ShellProvider, resolveShellConfig } from './shell-config'

describe('shell config', () => {
  it('falls back to the env reader without a provider', () => {
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
