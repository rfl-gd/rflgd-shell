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

### `POST /api/oidc/backchannel-logout`

The platform ends sessions of this app (OpenID Connect Back-Channel Logout 1.0):
when "Einloggen als" starts or ends, on logout at the platform, when a booking
ends or a person loses access. Form body `logout_token=<JWT>`.

| Case | Status | Body |
|------|--------|------|
| Valid logout token | 200 | empty, `Cache-Control: no-store` |
| Missing or invalid token | 400 | `{"error":"invalid_request"}` |
| Issuer cannot be discovered | 503 | `{"error":"temporarily_unavailable"}` |
| Any method but `POST` | 405 | `{"error":"method_not_allowed"}` |
| Shell not configured (Next route only) | 503 | `{"error":"oidc-not-configured"}` |

Validation (§2.6): signature against the issuer's JWKS (from discovery, fetched
again for an unknown key at most once a minute; 5 s timeout), header
`typ: logout+jwt`, `iss` = issuer, `aud` contains the app's client id, `iat`,
`exp` and `jti` present, `iat` within ±300 s, `events` holds
`http://schemas.openid.net/event/backchannel-logout`, `sid` or `sub` present,
no `nonce`. Bodies over 64 KiB are refused.

A token with `sid` ends the sessions of that provider session; one with only
`sub` ends every session of that person. The logout is dated by the token
(end of its `iat` second), not by its arrival: only sessions signed in at or
before then end, so a sign-in after the platform issued the logout survives a
late push or a replayed token, even with the same `sid`. The session therefore
keeps the ID token's `sid` and its `iat` as `signedInAt` (milliseconds) across
refreshes; both times are on the platform's clock. A session minted before 2.2 has no `sid`; it ends with any
logout of its person and signs in afresh. A cookie without `signedInAt` (an
app that signs its own session cookie) is dated by the cookie's own `iat`;
such apps should still store the ID token's `sid` and `iat` like the shell's
callback does.

Every session read honours these logouts: `verifySessionCookie` (and with it the
cookie store and the Payload strategy) returns null for an ended session; a
custom `ShellSessionStore` calls `isSessionRevoked(session)` in `load`. The
record lives in the process's memory and is not shared between instances: the
platform revokes the session's tokens as well, so after a restart (or on
another instance) the session ends at its next `shell-info` call, which the
components make on every page load. A session that never reaches the platform
— e.g. Payload API calls without a page — depends on the in-memory record.

The route must be reachable without a session: middleware and auth gates leave
`/api/oidc/*` alone. The app declares the path in its `rflgd.json` as
`"oidcBackchannelLogoutPath": "/api/oidc/backchannel-logout"`; the platform
registers it with the app's OIDC client when the app is provisioned or updated.

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
