# Framework-independent `@reflagged/shell` — design

Date: 2026-11-15 · Status: draft for approval · Repo: `rfl-gd/rflgd-shell`

## Intent

`@reflagged/shell` gives every reFlagged module the same platform integration: OIDC sign-in
against the platform, the app switcher, tenant theme, notifications, module settings and the
directory client. Today it declares Next.js and Payload as peer dependencies, ships TypeScript
source that only Next (`transpilePackages`) compiles, and reads its configuration from
`NEXT_PUBLIC_*` variables. A module that is not a Next/Payload app cannot install it.

The first such module exists: Botspawn (React + Vite web app, Hono API, Better Auth for OIDC).
It carries a hand-made, reduced copy of the switcher that already looks and behaves differently
from every other module. Each further non-Next module would copy again and drift again.

Goal: a module built on any React front end and any server that speaks Web-standard
`Request`/`Response` (Hono, Remix, Next route handlers, Bun, Deno) installs the one package and
gets the same shell as the Next modules, from the same code. The 20 existing Next/Payload
consumers keep working without a code change.

## Goals

1. Four layers inside the one package, each an entry point in `exports`:
   `core` (no framework), `react` (components), `next` (middleware + route handlers), `payload`
   (auth strategy). `core` and `react` import nothing from `next` or `payload`.
2. Core handlers are `(req: Request, ctx) => Promise<Response>`. They take their OIDC
   configuration and their session storage explicitly; a module that keeps platform tokens
   somewhere other than the shell cookie (Botspawn: Better Auth account rows) plugs in its own
   storage.
3. React components take their configuration from a `ShellProvider` (app key, label, where
   `shell-info` is served). Without a provider they fall back to today's `NEXT_PUBLIC_*` values, so
   existing consumers render unchanged.
4. The package ships compiled ESM plus type declarations; consumers no longer need
   `transpilePackages`. `'use client'` survives on the React entries.
5. Every import path that exists today keeps working and keeps its behaviour, so the fan-out bump
   PRs merge green across all consumers.
6. `next` and `payload` become optional peer dependencies.

## Non-goals

- Non-React front ends (Vue, Twig, plain HTML). No web component. Explicitly deferred.
- Splitting into several npm packages. The entry points are the future package boundaries; the
  split can follow when a non-React layer needs it.
- Changing the platform API (`/api/shell/me`, OIDC claims) or the visual design of the switcher.
- Replacing Botspawn's switcher. That is the first consumer project and gets its own spec in the
  Botspawn repo once this ships; this design only has to make it possible.

## Anti-goals (failure even if it works)

- A consumer that updated through the fan-out and now renders a different switcher, loses its
  session, or fails to build.
- Shipping the raw TypeScript source as the only distribution again.
- Two implementations of the same behaviour (one Next, one generic) living side by side.

## Constraints

- Release flow stays: version bump, tag, `publish.yml` publishes, `fan-out.yml` opens bump PRs in
  every `rfl-gd` repo and merges when CI passes. A green CI on the consumer is therefore the
  compatibility test; failing builds block the rollout.
- Node 22 on CI; consumers run Next 15 / React 19 / Payload 3.
- Existing tests (vitest, offline) stay green; new behaviour gets tests of the same kind.
- `jose` and `oauth4webapi` remain the only runtime dependencies of `core`.

## Approaches considered

**A. One package, layered entry points** (chosen). Same separation as B, no repo surgery;
boundaries enforced by a test that greps the layer directories for forbidden imports. Consumers
bump one dependency and change nothing.

**B. Monorepo with `shell-core`, `shell-react`, `shell-next`, `shell-payload`.** Boundaries
enforced by packages; costs changesets, multi-package fan-out, two dependencies per consumer.
Worth it once non-React layers arrive.

**C. Extract only `shell-info` and the components into a second package.** Fast, but two code
paths for the same behaviour. Rejected.

## Design

### Layout

```
src/
  core/        OIDC config + env readers, session cookie, refresh, client credentials,
               handlers (signin, callback, signout, shell-info), session store interface,
               cookie session store, notifier, blocks, settings client, directory client,
               palette logic, can-access
  react/       ShellProvider, BrandSwitcher, TenantTheme, ServiceIcon, NotificationBell,
               ImpersonationCapsule
  next/        middleware, route-handler wrappers (bind core handlers to env + cookie store)
  payload/     createOidcStrategy, nextauthStrategy, resolveNewUserRole
```

Public entry points (new): `@reflagged/shell/core`, `@reflagged/shell/react`,
`@reflagged/shell/next`, `@reflagged/shell/payload`. Every current path (`./middleware`,
`./config`, `./components/*`, `./auth/*`, `./api/*`, `./notifications/*`, `./settings`,
`./directory`) stays in `exports` and re-exports from the new layers.

### Core handlers and session storage

```ts
export type ShellSession = {
  accessToken: string
  refreshToken?: string | null
  accessTokenExpiresAt?: number | null   // unix seconds
  // identity claims as today (OidcSessionToken), kept for the cookie store
}

export interface ShellSessionStore {
  /** The platform session behind this request, or null. */
  load(req: Request): Promise<ShellSession | null>
  /**
   * Renew the tokens with the OIDC client that issued them. The store owns the client, so a
   * module with its own client (Botspawn: Better Auth) refreshes with that one and the shell
   * never touches a refresh token it did not issue. Null when the platform refused.
   */
  refresh(req: Request, session: ShellSession): Promise<ShellSession | null>
  /** Persist refreshed tokens. May return a new Response (e.g. with Set-Cookie). */
  save(req: Request, session: ShellSession, res: Response): Promise<Response>
  /** End the platform session for this request (platform refused the tokens). */
  end(req: Request, res: Response): Promise<Response>
}

/** What `shellInfo` needs: the platform origin and a store. No client credentials. */
export type ShellInfoContext = { platformUrl: string; sessions: ShellSessionStore }
/** The sign-in trio owns the OIDC client and therefore needs the full env. */
export type OidcContext = { env: OidcEnv; sessions: ShellSessionStore }

export function shellInfo(req: Request, ctx: ShellInfoContext): Promise<Response>
export function oidcSignin(req: Request, ctx: OidcContext): Promise<Response>
export function oidcCallback(req: Request, ctx: OidcContext): Promise<Response>
export function oidcSignout(req: Request, ctx: OidcContext): Promise<Response>

export function cookieSessionStore(env: OidcEnv): ShellSessionStore
```

- Responses are Web `Response` built with `Response.json` and `Response.redirect`; cookies go
  through `Set-Cookie` headers (one small serializer in core, no dependency). Redirect responses
  are constructed with a mutable header set, not `Response.redirect`, so cookies can still be set.
- `shellInfo` keeps today's logic exactly (proactive refresh when the access token is within the
  skew window, reactive refresh on 401, `session-ended` → `sessions.end`), but calls
  `sessions.refresh` instead of `refreshAccessToken` itself. `cookieSessionStore` implements
  `refresh` with today's `refreshAccessToken(env, …)`, so Next consumers behave as before.
  `platformUrl` is `env.issuer` without the `/oidc` suffix, as today.
- `oidcSignin`/`oidcCallback` keep the PKCE state cookie; the state cookie is part of the cookie
  store's concern, not a second interface. A module with its own OIDC client (Botspawn) uses
  `shellInfo` only; the sign-in trio stays available for modules that want the shell to own OIDC.
- `loadOidcEnv()` keeps reading `process.env` and lives in core as the Node convenience; handlers
  never read env themselves. `NEXT_PUBLIC_SERVER_URL` is read as today and additionally
  `RFLGD_SERVER_URL` is accepted (first non-empty wins) so a non-Next module has a name without
  the `NEXT_PUBLIC_` prefix.

### React layer

```tsx
export type ShellConfig = { appKey: string; appLabel: string; shellInfoUrl?: string }
export function ShellProvider(props: { config: ShellConfig; children: ReactNode }): JSX.Element
export function useShellConfig(): ShellConfig
```

- `useShellConfig()` returns the provider value; without a provider it returns
  `loadAppConfig()` (today's `NEXT_PUBLIC_*` reader) with `shellInfoUrl` defaulting to
  `/api/shell-info`. `loadAppConfig` guards `typeof process` so it is safe in Vite.
- `shellInfoUrl` is same-origin by contract (relative path, or absolute on the page's origin).
  Botspawn serves web and API behind one Caddy origin, so no CORS and no `SameSite=None` work
  is needed; the core handler sets no CORS headers.
- The `ShellProvider` context must be shared between the `./react` entry and the legacy
  `./components/*` entries: the build externalises the package's own entry points
  (`@reflagged/shell/react` is an external import of `./components/BrandSwitcher`), so one
  module instance holds the context.
- All five components read `useShellConfig()` instead of calling `loadAppConfig()` directly and
  fetch `shellInfoUrl` instead of the literal `/api/shell-info`.
- No visual or behavioural change. Snapshot of the rendered switcher stays the same.

### Next layer

- `middleware.ts` unchanged, moved.
- `api/*.ts` become thin: `GET` builds the context from `loadOidcEnv()` and
  `cookieSessionStore(env)`, keeps today's `oidc-not-configured` short-circuit, calls the core
  handler and returns `new NextResponse(res.body, res)`. Return types stay `Promise<NextResponse>`,
  `clearSessionCookie(res: NextResponse)` and `deniedResponse(): NextResponse` keep their
  signatures (implemented over the core helpers), so every consumer typechecks as before. Survey
  of the 20 consumers on 2026-11-15: the handlers are only re-exported; `oidc-config`,
  `oidc-cookie` (`verifySessionCookie`, `signSessionCookie`), `can-access`, `directory`,
  `notifier`, `config` and the components are imported by name; none reads `.cookies` on a
  response the shell returned. Those named exports keep their signatures unchanged.
- `dynamic` and `runtime` exports kept.

### Payload layer

- Moved unchanged. `payload` and `next` move to `peerDependenciesMeta.optional`.

### Build and packaging

- tsup, ESM only, one entry per public path, `dts: true`, `splitting: false`,
  `'use client'` banner on the react entries (tsup strips directives otherwise).
- `files: ["dist", "README.md"]`; `exports` maps every path to `dist/...js` with `types`.
- `pnpm typecheck` stays; `pnpm build` runs in `publish.yml` before `npm publish`.
- README: Install section drops `transpilePackages` (keeping it is harmless), adds the Vite/Hono
  path (provider, `shellInfo` with an own store).

### Compatibility and release

- Major version `2.0.0`. Behaviour identical; the major marks the packaging change (dist instead
  of source, optional peers).
- Consumer CI is not a sufficient gate: `bump-consumer.sh` merges repos without CI, a red main
  hides new failures, and most consumer CI only typechecks. Therefore, before tagging:
  1. `pnpm build` of the package, then a script (`scripts/verify-consumers.sh`, builder's
     choice of shape) runs `next build` in every local consumer checkout against the packed
     tarball (`pnpm pack` + `pnpm add ./shell.tgz`, no lockfile change committed). All must build.
  2. Manual smoke on one deployed module after its bump (Agentforge): sign-in, switcher,
     tenant theme, sign-out.
  3. Fan-out as today afterwards. No staged rollout: once 1 and 2 pass, the remaining risk is
     per-repo and visible in that repo's bump PR.
- Tenant instances stay pinned and update one by one in Base, as today.

### Tests

- Existing handler tests switch from `NextResponse` to `Response` assertions (`Set-Cookie` header
  text already asserted today).
- Architecture test: a vitest case that reads `src/core/**` and `src/react/**` and fails on any
  import of `next`, `next/*`, `payload`, `@payloadcms/*`.
- `ShellSessionStore` conformance test, run against `cookieSessionStore` and an in-memory store,
  so Botspawn's future store can run the same suite.
- React: render `BrandSwitcher` with and without `ShellProvider` (fetch mocked); both call the
  configured `shellInfoUrl`.

## Left to the builder

- Exact tsup configuration and file moves; internal module names.
- Cookie serializer details (attributes mirror today's `NextResponse.cookies.set` calls).
- Whether `src/app/` (the example route files) stays or moves to README snippets.
- Order of commits; keep each layer move a separate, green commit.

## Follow-up project (separate spec, Botspawn repo)

Botspawn replaces `apps/web/src/components/platform-switcher*.tsx` and `platform-shell-info.ts`
with `@reflagged/shell/react` inside a `ShellProvider`, and mounts `shellInfo` on Hono with a
`ShellSessionStore` over Better Auth's account rows (`getAccessToken`/`refreshToken` by account
id). Gains the ⌘K palette, Katalog, Plattform section, impersonation capsule and tenant favicon
for free.
