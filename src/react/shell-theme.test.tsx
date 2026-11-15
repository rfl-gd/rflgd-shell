import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BrandSwitcher } from './BrandSwitcher'
import { ShellProvider } from './shell-config'
import { SHELL_THEME_CSS, shellColor } from './shell-theme'

const darkBlock = SHELL_THEME_CSS.match(/:where\(\.dark\)\{([^}]*)\}/)?.[1] ?? ''
const darkValue = (token: string) => darkBlock.match(new RegExp(`--rflgd-shell-${token}:([^;]*);`))?.[1]

describe('shell theme', () => {
  it('keeps the light values as var() fallbacks', () => {
    expect(shellColor('ink')).toBe('var(--rflgd-shell-ink, #2C1E14)')
    expect(shellColor('muted')).toBe('var(--rflgd-shell-muted, #7A6A58)')
    expect(shellColor('surface')).toBe('var(--rflgd-shell-surface, #FFFFFF)')
    expect(shellColor('brand-text')).toBe('var(--rflgd-shell-brand-text, rgb(var(--brass-700, 125 85 26)))')
    expect(shellColor('frame')).toBe(
      'var(--rflgd-shell-frame, color-mix(in srgb, var(--rflgd-brand-primary, #B09A6A) 16%, transparent))',
    )
    expect(shellColor('plate')).toBe(
      'var(--rflgd-shell-plate, linear-gradient(180deg, #fffdf6 0%, #f7edd6 52%, #f0e2c2 100%))',
    )
  })

  it('sets dark values for the trigger text and the popover surface under .dark', () => {
    expect(darkValue('ink')).toBe('#fafafa')
    expect(darkValue('muted')).toBe('#a3a3a3')
    expect(darkValue('surface')).toBe('#171717')
    expect(darkValue('frame')).toBe('#262626')
    expect(darkValue('brand-text')).toBe('rgb(var(--brass-300, 223 186 110))')
    expect(darkValue('plate')).toBe('linear-gradient(180deg, #34291a 0%, #241d13 55%, #1a150e 100%)')
    expect(SHELL_THEME_CSS).toContain(':where(.dark) [data-rflgd-plate]>svg{filter:drop-shadow(0 1px 0 rgba(0,0,0,0.6))}')
  })

  it('renders the trigger with token colours and the theme stylesheet', () => {
    const html = renderToString(
      <ShellProvider config={{ appKey: 'x', appLabel: 'Label X' }}>
        <BrandSwitcher />
      </ShellProvider>,
    )
    expect(html).toContain('data-href="rflgd-shell-theme"')
    expect(html).toContain('color:var(--rflgd-shell-ink, #2C1E14)')
    expect(html).toContain('fill:var(--rflgd-brand-primary, #B09A6A)')
  })
})
