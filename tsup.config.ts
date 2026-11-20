import { rmSync } from 'node:fs'
import { defineConfig } from 'tsup'

// The two builds run in parallel, so tsup's own `clean` in either one would delete
// the other's freshly written files (its declaration cleanup runs mid-build).
rmSync('dist', { recursive: true, force: true })

const external = ['react', 'react-dom', 'lucide-react', 'next', /^next\//, 'payload', 'vitest']

const legacyComponents = ['BrandSwitcher', 'TenantTheme', 'ServiceIcon', 'NotificationBell', 'ImpersonationCapsule']

const legacyPaths = [
  'middleware',
  'config',
  'auth/oidc-config',
  'auth/oidc-cookie',
  'auth/can-access',
  'auth/oidc-refresh',
  'auth/nextauth-strategy',
  'api/oidc-signin',
  'api/oidc-callback',
  'api/oidc-signout',
  'api/shell-info',
  'api/oidc-backchannel-logout',
  'notifications/notifier',
  'notifications/blocks',
  'settings',
  'directory',
]

export default defineConfig([
  {
    entry: {
      core: 'src/core/index.ts',
      next: 'src/next/index.ts',
      payload: 'src/payload/index.ts',
      testing: 'src/testing/index.ts',
      ...Object.fromEntries(legacyPaths.map((path) => [path, `src/entries/${path}.ts`])),
    },
    format: ['esm'],
    dts: true,
    splitting: true,
    external,
  },
  {
    // A second run so only the React entries carry the directive tsup strips otherwise.
    entry: {
      react: 'src/react/index.ts',
      ...Object.fromEntries(
        legacyComponents.map((name) => [`components/${name}`, `src/entries/components/${name}.ts`]),
      ),
    },
    format: ['esm'],
    dts: true,
    splitting: true,
    external,
    banner: { js: "'use client'" },
  },
])
