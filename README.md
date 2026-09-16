# @reflagged/shell

Shared app shell for Reflagged services. Provides:

- OIDC authentication (signin, callback, signout)
- SSO session management (JWT cookie + Payload AuthStrategy)
- `/api/shell-info` proxy for platform service catalog
- `BrandSwitcher` component (app switcher dropdown)
- Admin route SSO enforcement middleware

Published as a **public npm package of raw TS/TSX source**. Consumers transpile
it in-app via Next's `transpilePackages` — there is no build/bundle step.

## Install

```bash
pnpm add @reflagged/shell
```

In each consuming Next.js app, add the package to `transpilePackages`
(**required** — the package ships `.ts/.tsx` source, incl. a `'use client'`
component, that Next must compile):

```ts
// next.config.ts
const nextConfig = {
  transpilePackages: ['@reflagged/shell'],
}
```

Do **not** add it to `serverExternalPackages` — it must be transpiled.

Configure via env vars (`NEXT_PUBLIC_*` are inlined at **build** time):

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_RFLGD_APP_KEY` | App key matching the platform catalog `service` value (highlights the current app as "aktuell") |
| `NEXT_PUBLIC_RFLGD_APP_LABEL` | Display name in BrandSwitcher |
| `RFLGD_DEFAULT_USER_ROLE` | Role for auto-created users (default: `user`) |

## Entry points

```ts
import { BrandSwitcher } from '@reflagged/shell/components/BrandSwitcher'
import { loadAppConfig } from '@reflagged/shell/config'
import { OIDC_COOKIE, loadOidcEnv } from '@reflagged/shell/auth/oidc-config'
import { verifySessionCookie } from '@reflagged/shell/auth/oidc-cookie'
import { refreshAccessToken } from '@reflagged/shell/auth/oidc-refresh'
import { nextauthStrategy, createOidcStrategy } from '@reflagged/shell/auth/nextauth-strategy'
```

### Mapping the platform's role onto your own (`roleForNewUser`)

`nextauthStrategy` is `createOidcStrategy()` with no options — the role a
newly created account gets is `RFLGD_DEFAULT_USER_ROLE` (or `admin` for the
very first account). Call `createOidcStrategy` directly to decide that role
yourself from the platform's view of the person, using the workspace role
the platform put in the session:

```ts
import { createOidcStrategy, type NewUserContext } from '@reflagged/shell/auth/nextauth-strategy'

function roleForNewUser({ orgRole, isFirstUser }: NewUserContext): string {
  if (isFirstUser) return 'admin'
  // org_role is three-valued, not two: 'owner' | 'admin' | 'member' when a
  // membership row exists (both 'owner' and 'admin' administer the
  // workspace), or a *platform* role — 'superadmin' | 'reflagged_admin' |
  // 'tenant_admin' | 'member' — when it does not. Check for 'owner' as well
  // as 'admin': the person who books an instance is always created as
  // 'owner', never 'admin'.
  return orgRole === 'owner' || orgRole === 'admin' ? 'workspace-admin' : 'member'
}

export const oidcStrategy = createOidcStrategy({ roleForNewUser })
```

This callback runs only when an account is created, never on later
sign-ins — see `NewUserContext`'s doc comments in
`src/lib/auth/nextauth-strategy.ts` for the full contract, including the
`isFirstUser` branch and the `null` case for standalone operation.

### Per-app route files + middleware

Each app keeps thin wrappers that re-export the handlers:

```ts
// src/app/api/oidc/signin/route.ts
export { GET, dynamic, runtime } from '@reflagged/shell/api/oidc-signin'

// src/middleware.ts
export { default, config } from '@reflagged/shell/middleware'
```

Other API re-exports: `@reflagged/shell/api/oidc-callback`,
`@reflagged/shell/api/oidc-signout`, `@reflagged/shell/api/shell-info`.

## Local development (live-edit against a consumer)

A published package is frozen in `node_modules`. To iterate on the shell and a
consuming app at the same time, add a **local, uncommitted** pnpm override in
the consumer (all Reflagged repos sit side-by-side under `~/Development/`):

```jsonc
// <app>/package.json — DEV ONLY, do not commit
"pnpm": {
  "overrides": {
    "@reflagged/shell": "link:../rflgd-shell"
  }
}
```

Then `pnpm install`. Edits in `rflgd-shell/src` are picked up live (still
transpiled via `transpilePackages`). **Remove the override before committing** —
`link:../rflgd-shell` does not exist in the Coolify build context and would
break the build.

## Releasing

Raw source, no build. To publish a new version:

1. Bump `version` in `package.json`.
2. Commit, then `git tag vX.Y.Z && git push --tags`.
3. The `.github/workflows/publish.yml` workflow typechecks, verifies the tag
   matches `version`, and runs `npm publish --access public` (needs the
   `NPM_TOKEN` repo secret).
