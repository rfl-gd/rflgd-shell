import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The core and react layers must run without Next or Payload, so they may not
 * import either. Directories that do not exist yet are skipped.
 */
const FRAMEWORK_IMPORT = /from ['"](next(\/|'|")|payload|@payloadcms)/

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

const files = ['src/core', 'src/react'].flatMap(sourceFiles)

describe('layer boundaries', () => {
  it('finds core sources to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} imports no framework`, () => {
      expect(readFileSync(file, 'utf8')).not.toMatch(FRAMEWORK_IMPORT)
    })
  }
})
