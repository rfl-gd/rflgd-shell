# reFlagged Shell Contract

Every app that hosts the shell components (`BrandSwitcher`, `NotificationBell`,
`TenantTheme`, `ImpersonationCapsule`) fulfils this contract. The components
then work with fixed URLs and no configuration. The shell's design always wins:
apps place the components, they do not restyle or re-implement them.

The Next route files from `@reflagged/shell/next` (or the `./api/*` entries)
fulfil the HTTP part as they are. Other servers wire the handlers from
`@reflagged/shell/core` to the same paths.

## Routes

All paths are on the app's own origin.

### `GET /api/shell-info`

What the components render: user, workspace, bookings, catalog, branding.

| Case | Status | Body |
|------|--------|------|
| Session valid | 200 | The platform's shell info JSON (`/api/shell/me`), passed through unchanged |
| No session, or an unreadable one | 401 | `{"error":"no-session"}` |
| Session without access token | 401 | `{"error":"no-access-token"}` |
| Platform refused the session even after a token refresh | 401 | `{"error":"session-ended"}`; the session is ended |
| Platform answered another error | the platform's status | `{"error":"upstream-failed","status":<n>}` |
| Shell not configured (Next route only) | 503 | `{"error":"oidc-not-configured"}` |

The handler refreshes the access token when it is about to expire or the
platform rejects it, and saves the refreshed session on the response.

`BrandSwitcher` reloads the page when it gets 401 or 403 with
`{"error":"session-ended"}`, so the app signs in afresh. Any other 401 or 403
shows a sign-in link (`/api/oidc/signin`) instead of the apps.

Shell info fields the components read: `user` (`email`, `name`, `role`),
`org` (`id`, `slug`, `name`, `logoUrl`, `logoDarkUrl`, `logoMarkUrl`,
`themeCssUrl`), `orgs`, `bookings`, `catalog`, `catalogUrl`, `baseUrl`,
`impersonation`, `unreadNotifications`. Older platforms omit some; the
components fall back.

### `GET /api/oidc/signin?callbackUrl=<path>`

Starts the SSO flow directly: a 307 to the identity provider's authorization
endpoint (PKCE, state and nonce in a short-lived `rflgd-oidc-state` cookie). No
intermediate page of the app's own.

- `callbackUrl` is restricted to a path on the app's own origin. Absolute URLs,
  `//host`, `/\host` and anything else fall back to `/admin`. The callback
  route checks the stored value again before redirecting there.
- A session the platform revoked is ended and redirected to the platform's
  `/apps?error=no-access` instead.
- Not configured (Next route only): 500 `{"error":"oidc-not-configured"}`.

The callback lives at `/api/oidc/callback` and is the `redirect_uri` registered
with the provider.

### `GET /api/oidc/signout`

Ends the local session and the platform session: a 307 to the provider's
single-logout (`<issuer origin>/api/sso/signout`) with
`post_logout_redirect_uri` set to the app's signed-out page. The Next route
also answers `POST`, and without provider configuration clears the session
cookie and redirects straight to the signed-out page.

The signed-out page is `/login?signed-out=1` unless `RFLGD_SIGNED_OUT_PATH`
names another path. An app may refuse a cross-site `GET` (sign-out CSRF, e.g.
by `Sec-Fetch-Site`); a same-origin click from the switcher must work. The
page must exist, and the app clears its own client state
there (local storage, caches, in-memory stores), because the shell cannot know
it.

## Dark mode

A `.dark` class on an ancestor switches the shell components to their dark
colours (Tailwind `darkMode: 'class'`, the platform's convention). Put it on
`<html>`: the open palette is rendered into `<body>`. A `.dark` further down
still works for the palette as long as it encloses the trigger when it opens.

The components bring their own stylesheet (hoisted once into `<head>`); the
app adds nothing. Without `.dark` they render light. Apps do not set the
`--rflgd-shell-*` properties; they are the shell's internals.

## Theme tokens

The tenant palette comes from the platform: `org.themeCssUrl` in the shell
info, loaded by `BrandSwitcher` (or `<TenantTheme />` in apps without it) as
`<link id="rflgd-tenant-theme">`. It sets on `:root`:

- `--brass-50` … `--brass-900`: RGB channels (`125 85 26`) of the tenant-tinted
  brass scale.
- `--rflgd-brand-primary`: the raw tenant colour, decorative use only.

The shell components read both, always with the Reflagged brass fallback. Apps
point their own tokens at them the same way (see the README's "Tenant
branding").

## Checking an app

`describeShellContract` from `@reflagged/shell/testing` (needs `vitest`) checks
the routes above without a session through the app's own request handler:

```ts
import { describeShellContract } from '@reflagged/shell/testing'
import { app } from '../src/server'

describeShellContract({ handle: (req) => app.fetch(req), origin: 'https://app.example.test' })
```

It sends `GET` requests shaped like a same-origin browser navigation
(`Sec-Fetch-Site: same-origin`, a same-origin `Referer`) and expects: `/api/shell-info` answers 401 JSON with an
`error`; `/api/oidc/signin?callbackUrl=/x` redirects, and not back to itself;
an external `callbackUrl` is neither a server error nor the redirect target;
`/api/oidc/signout` redirects. Stub the provider's discovery document
(`fetch`) and the OIDC environment the routes read, as the shell's own test
does (`src/core/shell-contract-conformance.test.ts`).
