import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
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
  it('every entry except testing loads under native Node ESM', () => {
    // Consumers' vitest loads node_modules .js natively, without a bundler's
    // resolution, so an extensionless deep import such as 'next/server' fails there.
    const exportsMap = JSON.parse(readFileSync('package.json', 'utf8')).exports as Record<string, unknown>
    const files = Object.entries(exportsMap)
      .filter(([key, value]) => key !== './testing' && typeof value === 'object')
      .map(([, value]) => pathToFileURL((value as { import: string }).import).href)
    const script = `for (const f of ${JSON.stringify(files)}) await import(f)`

    expect(() =>
      execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe' }),
    ).not.toThrow()
  })
})
