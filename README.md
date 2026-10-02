# @reflagged/shell

Shared app shell for Reflagged services. Provides:

- OIDC authentication (signin, callback, signout)
- SSO session management (JWT cookie + Payload AuthStrategy)
- `/api/shell-info` proxy for platform service catalog
- `BrandSwitcher` component (app palette: icons, search, ⌘K / Ctrl+K)
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

### Notifications (`createNotifier`, `NotificationBell`)

Since 1.4.0 a module can post notifications to the platform inbox. The base
stores one inbox entry per recipient, renders and brands the mail, and
delivers it through the tenant's sender. Modules send data, never HTML.

```ts
// server only — uses OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET
import { createNotifier } from '@reflagged/shell/notifications/notifier'

const notifier = createNotifier()
await notifier.notify({
  idempotencyKey: `absence-${absence.id}-approved`, // same key → no duplicate
  topic: 'kollega.absence.approved',               // <module>.<object>.<event>
  category: 'activity',                            // or 'transactional' (not opt-out-able)
  title: 'Urlaub genehmigt',
  body: '12.–16. Oktober',
  actionUrl: `https://kollega.acme.rfl.gd/abwesenheiten/${absence.id}`, // https, own or tenant domain
  actionLabel: 'Antrag öffnen',
  recipients: [{ email: requester.email }],        // or { userId } / { role: 'org:admins' | 'org:members' }
})
```

Recipients must belong to the booking's organization (403 otherwise);
addresses without a platform account are skipped. The token comes from the
`client_credentials` grant with scope `notifications:write`, which every
module client of the platform may request. Errors throw `NotifyError` with
the HTTP `status` and the base's error `code`.

The bell shows the unread count (from `/api/shell-info`) and links to the
central inbox:

```tsx
import { NotificationBell } from '@reflagged/shell/components/NotificationBell'

<NotificationBell />
```

## App palette

`BrandSwitcher` opens on click or with ⌘K / Ctrl+K anywhere in the app. It
shows every running app with its catalog icon and tagline, filters them as you
type, and lists the user's workspaces. Platform admins get a "Plattform"
section that links to the Base palette (`<baseUrl>/?palette=<query>`); the
tenant switch itself runs in Base, where the platform session lives.

Apps that bind ⌘K / Ctrl+K themselves should drop their own binding.

## Tenant branding

`BrandSwitcher` shows the tenant's logo mark and loads the tenant palette from
the platform (`org.themeCssUrl` in `/api/shell-info`) as
`<link id="rflgd-tenant-theme">`. Modules without the switcher render
`<TenantTheme />` from `@reflagged/shell/components/TenantTheme` once in the root
layout.

The stylesheet defines, on `:root`:

- `--brass-50` … `--brass-900` — RGB channels (`125 85 26`), the Reflagged
  brass scale re-tinted to the tenant colour. Every step keeps brass's
  luminance, so contrast pairs that work with brass keep working.
- `--rflgd-brand-primary` — the raw tenant colour (decorative use only).

Point the module's own tokens at it, always with the brass fallback:

```css
:root { --primary: rgb(var(--brass-700, 125 85 26)); }
.dark { --primary: rgb(var(--brass-400, 214 166 76)); }
```

or in Tailwind 3: `primary: 'rgb(var(--brass-700, 125 85 26) / <alpha-value>)'`.
Text on a filled brand surface stays white on `700` (light) and dark on `400`
(dark mode). Status and destructive colours do not follow the palette.

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
