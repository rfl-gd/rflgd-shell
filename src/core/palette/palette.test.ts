import { describe, expect, it } from 'vitest'

import { baseSearchUrl, isPaletteShortcut, matchApps, type PaletteApp } from './palette'

const apps: PaletteApp[] = [
  { key: 'base', label: 'Base', tagline: 'Start, Team und Einstellungen', icon: null, href: '/', current: false },
  { key: 'kollega', label: 'Kollega', tagline: 'Vorgänge gemeinsam erledigen', icon: 'Users', href: 'https://k', current: true },
  { key: 'corporate-memory', label: 'Corporate Memory', tagline: null, icon: 'Brain', href: 'https://cm', current: false },
]

describe('matchApps', () => {
  it('returns every app without a query', () => {
    expect(matchApps(apps, '  ')).toEqual(apps)
  })

  it('matches label and tagline, case-insensitive', () => {
    expect(matchApps(apps, 'MEMORY').map((a) => a.key)).toEqual(['corporate-memory'])
    expect(matchApps(apps, 'vorgänge').map((a) => a.key)).toEqual(['kollega'])
  })
})

describe('baseSearchUrl', () => {
  it('opens the Base palette with the query prefilled', () => {
    expect(baseSearchUrl('https://app.rfl.gd', 'san ima')).toBe('https://app.rfl.gd/?palette=san%20ima')
  })

  it('tolerates a trailing slash and an empty query', () => {
    expect(baseSearchUrl('https://app.rfl.gd/', ' ')).toBe('https://app.rfl.gd/?palette=')
  })
})

describe('isPaletteShortcut', () => {
  const key = (init: Partial<KeyboardEvent>) =>
    ({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent

  it('accepts Cmd+K and Ctrl+K only', () => {
    expect(isPaletteShortcut(key({ metaKey: true }))).toBe(true)
    expect(isPaletteShortcut(key({ ctrlKey: true, key: 'K' }))).toBe(true)
    expect(isPaletteShortcut(key({}))).toBe(false)
    expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false)
  })
})
