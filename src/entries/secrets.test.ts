import { describe, expect, it } from 'vitest'

describe('secrets entry', () => {
  it('is not part of the settings or core entries', async () => {
    expect('createModuleSecrets' in (await import('./settings'))).toBe(false)
    expect('createModuleSecrets' in (await import('../core/index'))).toBe(false)
    expect('createModuleSecrets' in (await import('./secrets'))).toBe(true)
  })

  it('fails on import in a browser bundle', async () => {
    await expect(import('./secrets.browser')).rejects.toThrow(/server-only/)
  })
})
