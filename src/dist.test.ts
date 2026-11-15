import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe.skipIf(!existsSync('dist'))('dist', () => {
  it('react entries keep the use client directive', () => {
    expect(readFileSync('dist/react.js', 'utf8').startsWith("'use client'")).toBe(true)
  })

  it('legacy component entries share the react chunk instead of inlining it', () => {
    const src = readFileSync('dist/components/BrandSwitcher.js', 'utf8')
    expect(src).toMatch(/from ['"]\.\.?\/.*chunk-[A-Za-z0-9]+\.js['"]/)
    expect(src).not.toContain('createContext(')
  })

  it('core entry has no framework import', () => {
    expect(readFileSync('dist/core.js', 'utf8')).not.toMatch(/from ['"](next|payload)/)
  })

  it('ships the conformance suite as its own entry, outside core', () => {
    expect(existsSync('dist/testing.js')).toBe(true)
    expect(readFileSync('dist/core.js', 'utf8')).not.toContain('vitest')
  })
})
