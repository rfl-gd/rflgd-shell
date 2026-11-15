# Framework-independent `@reflagged/shell` 2.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@reflagged/shell` 2.0.0 ships compiled ESM with four layers (`core`, `react`, `next`, `payload`); `core` and `react` import nothing from Next or Payload, every existing import path keeps working, and the package is published and rolled out to all consumers.

**Architecture:** Core handlers are `(req: Request, ctx) => Promise<Response>` over a `ShellSessionStore` interface (cookie store for Next, any other store for modules with their own OIDC client). The Next layer binds core to `loadOidcEnv()` + cookie store and returns `NextResponse` so consumer types stay identical. React components read configuration from a `ShellProvider` and fall back to today's env-based `loadAppConfig()`.

**Tech Stack:** TypeScript 5.7, React 19, vitest 3, tsup (new dev dependency), jose, oauth4webapi. Node 22, pnpm 9.15.

**Spec:** `docs/superpowers/specs/2026-11-15-framework-independent-shell-design.md`

## Global Constraints

- `src/core/**` and `src/react/**` must not import `next`, `next/*`, `payload`, `@payloadcms/*` (architecture test, Task 5).
- Runtime dependencies of `core` stay exactly `jose` and `oauth4webapi`.
- Every import path in today's `exports` map keeps resolving with unchanged signatures: `./middleware`, `./config`, `./components/BrandSwitcher`, `./components/TenantTheme`, `./components/ServiceIcon`, `./components/NotificationBell`, `./components/ImpersonationCapsule`, `./auth/oidc-config`, `./auth/oidc-cookie`, `./auth/can-access`, `./auth/oidc-refresh`, `./auth/nextauth-strategy`, `./api/oidc-signin`, `./api/oidc-callback`, `./api/oidc-signout`, `./api/shell-info`, `./notifications/notifier`, `./notifications/blocks`, `./settings`, `./directory`, `./package.json`.
- Next wrappers keep `GET(): Promise<NextResponse>`, `clearSessionCookie(res: NextResponse): void`, `deniedResponse(): NextResponse`, and the `dynamic`/`runtime`/`POST` exports.
- No visual or behavioural change in the components; the `Abmelden` link stays `href="/api/oidc/signout"`.
- `platformUrl` for `shellInfo` = `env.issuer.replace(/\/oidc\/?$/, '')` (today's derivation).
- Cookie attributes stay as today: session cookie `HttpOnly; Secure (when secureCookies()); SameSite=Lax; Path=/; Max-Age=OIDC_SESSION_TTL`; state cookie same with `Max-Age=600`; deletion with `Max-Age=0`.
- Version `2.0.0`; `next` and `payload` optional peers; `files: ["dist", "README.md"]`.
- Tests stay offline and deterministic; existing tests keep passing (they may move with their modules).
- Commit messages Conventional Commits, English. Work on branch `feat/framework-independent-shell`.

## Review Focus

1. A redirect built with `Response.redirect` has immutable headers, so `Set-Cookie` on it throws → Task 1 tests `redirectResponse` accepts `setCookie`.
2. A state cookie value containing `;`, `"` and `,` (JSON) must round-trip through the callback's `decodeURIComponent` → Task 1 tests encoding.
3. Two cookies on one response (callback sets the session and deletes the state) must both arrive → Task 1 tests `getSetCookie()` length 2.
4. The legacy `./components/BrandSwitcher` entry must share the `ShellProvider` context instance with `./react` → Task 7 tests the built legacy entry imports a shared chunk instead of inlining the context.
5. `loadAppConfig()` must not throw where `process` is undefined (Vite browser bundle) → Task 6 tests the explicit-env form.

---

### Task 1: Web-standard HTTP helpers

**Files:**
- Create: `src/core/http.ts`
- Test: `src/core/http.test.ts`

**Interfaces:**
- Produces:
  - `jsonResponse(body: unknown, status?: number): Response` (status default 200, `content-type: application/json`)
  - `redirectResponse(url: string | URL, status?: number): Response` (status default 307, mutable headers: `new Response(null, { status, headers: { location } })`)
  - `type CookieAttributes = { httpOnly?: boolean; secure?: boolean; sameSite?: 'lax' | 'strict' | 'none'; path?: string; maxAge?: number }`
  - `setCookie(res: Response, name: string, value: string, attrs: CookieAttributes): void` (appends one `Set-Cookie`, value `encodeURIComponent`-encoded, attribute names `Path`, `Max-Age`, `HttpOnly`, `Secure`, `SameSite`)
  - `deleteCookie(res: Response, name: string, attrs: Omit<CookieAttributes, 'maxAge'>): void` (= `setCookie(res, name, '', { ...attrs, maxAge: 0 })`)
  - `cookieValue(cookieHeader: string | null, name: string): string | null` (raw segment value, not decoded)

- [ ] **Step 1: Write the failing tests** in `src/core/http.test.ts`

```ts
it('sets a cookie on a redirect response', () => {
  const res = redirectResponse('https://x.test/a')
  setCookie(res, 'c', 'v', { path: '/' })
  expect(res.status).toBe(307)
  expect(res.headers.get('location')).toBe('https://x.test/a')
  expect(res.headers.get('set-cookie')).toBe('c=v; Path=/')
})
it('encodes the value so JSON survives the round trip', () => {
  const res = jsonResponse({})
  const value = JSON.stringify({ a: 'b;c', d: '"e",f' })
  setCookie(res, 's', value, { path: '/' })
  const raw = cookieValue(`x=1; s=${res.headers.get('set-cookie')!.split(';')[0].slice(2)}`, 's')
  expect(decodeURIComponent(raw!)).toBe(value)
})
it('keeps two cookies on one response', () => {
  const res = jsonResponse({ ok: true })
  setCookie(res, 'a', '1', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
  deleteCookie(res, 'b', { path: '/' })
  expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=lax', 'b=; Path=/; Max-Age=0'])
})
it('jsonResponse carries status and content type', async () => {
  const res = jsonResponse({ error: 'x' }, 401)
  expect(res.status).toBe(401)
  expect(res.headers.get('content-type')).toContain('application/json')
  expect(await res.json()).toEqual({ error: 'x' })
})
```

- [ ] **Step 2: Run** `pnpm vitest run src/core/http.test.ts` → FAIL (module not found)
- [ ] **Step 3: Implement** `src/core/http.ts` with the signatures above
- [ ] **Step 4: Run** the test file → PASS
- [ ] **Step 5: Commit** `feat(core): web-standard response and cookie helpers`

### Task 2: Session store interface, cookie store, conformance suite

**Files:**
- Create: `src/core/session-store.ts`, `src/core/cookie-session-store.ts`, `src/core/memory-session-store.ts` (test helper, exported for consumers' tests too), `src/core/session-store-conformance.ts`
- Test: `src/core/cookie-session-store.test.ts`, `src/core/memory-session-store.test.ts`
- Existing (read only this task): `src/lib/auth/oidc-config.ts`, `src/lib/auth/oidc-cookie.ts`, `src/lib/auth/oidc-refresh.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `signSessionCookie`, `verifySessionCookie`, `sessionCookieValue`, `refreshAccessToken`, `OIDC_COOKIE`, `OIDC_SESSION_TTL`, `secureCookies`, `OidcEnv`, `OidcSessionToken`.
- Produces:
  - `type ShellSession = Omit<OidcSessionToken, 'iat' | 'exp'>` (so `accessToken` may be `null` and `shellInfo` keeps answering `no-access-token`)
  - `interface ShellSessionStore { load(req: Request): Promise<ShellSession | null>; refresh(req: Request, session: ShellSession): Promise<ShellSession | null>; save(req: Request, session: ShellSession, res: Response): Promise<Response>; end(req: Request, res: Response): Promise<Response> }`
  - `cookieSessionStore(env: OidcEnv): ShellSessionStore` — `load` verifies the `rflgd-session` cookie; `refresh` calls `refreshAccessToken(env, session.refreshToken)` and returns `{ ...session, ...refreshed }` or null (null when no refresh token); `save` re-signs with every claim preserved (today's `reSignSession`) and sets the cookie with the Global-Constraints attributes; `end` deletes it (`Max-Age=0`, same attributes).
  - `memorySessionStore(options: { session: ShellSession | null; refreshed?: ShellSession | null }): ShellSessionStore & { saved: ShellSession[]; ended: number }`
  - `sessionStoreConformance(name: string, make: () => { store: ShellSessionStore; req: Request; session: ShellSession }): void` — registers a `describe` with: `load` returns the session; `refresh` of a session without refresh token returns null; `save` returns a Response whose later `load` (cookie store) or `saved` (memory) carries the new access token; `end` makes the next `load` null (cookie store: a request carrying the `Set-Cookie` value) or increments `ended`.

- [ ] **Step 1: Write the failing tests**: `cookie-session-store.test.ts` runs `sessionStoreConformance('cookie', …)` with `env` = `{ issuer: 'https://id.example.test/oidc', clientId: 'c', clientSecret: 's', redirectUri: 'https://app.example.test/api/oidc/callback', authSecret: 'x'.repeat(32), baseUrl: 'https://app.example.test' }`, `vi.mock('../lib/auth/oidc-refresh')` returning `{ accessToken: 'new', refreshToken: 'r2', accessTokenExpiresAt: 9e9 }`, and adds:

```ts
it('refresh keeps every membership claim', async () => {
  const s = await store.refresh(req, { ...session, refreshToken: 'r1' })
  expect(s).toMatchObject({ accessToken: 'new', orgSlug: 'acme', accessibleServices: ['*'] })
})
it('save sets the session cookie with the login attributes', async () => {
  const res = await store.save(req, session, jsonResponse({}))
  expect(res.headers.get('set-cookie')).toMatch(/^rflgd-session=.+; Path=\/; Max-Age=2592000; HttpOnly; SameSite=lax$/)
})
```
  `memory-session-store.test.ts` runs the conformance suite only.

- [ ] **Step 2: Run** both files → FAIL
- [ ] **Step 3: Implement** the four files
- [ ] **Step 4: Run** both files → PASS; `pnpm typecheck` clean
- [ ] **Step 5: Commit** `feat(core): session store interface with cookie and memory stores`

### Task 3: Core `shellInfo`

**Files:**
- Create: `src/core/shell-info.ts`
- Test: `src/core/shell-info.test.ts`
- Read: `src/lib/api/shell-info.ts` (the logic to move; do not delete it yet)

**Interfaces:**
- Consumes: Task 1, Task 2.
- Produces: `type ShellInfoContext = { platformUrl: string; sessions: ShellSessionStore }`; `shellInfo(req: Request, ctx: ShellInfoContext): Promise<Response>`; `REFRESH_SKEW_SECONDS = 30` exported.

Behaviour (today's, storage calls swapped): `load` null → `401 {error:'no-session'}`; `accessToken` null → `401 {error:'no-access-token'}`; proactive `sessions.refresh` when `accessTokenExpiresAt - 30 <= now` and a refresh token exists; `fetch(`${platformUrl}/api/shell/me`, { headers: { Authorization: Bearer }, cache: 'no-store' })`; on 401 one reactive refresh and retry; still 401 → `sessions.end(req, jsonResponse({error:'session-ended'}, 401))`; other non-ok → `{error:'upstream-failed', status}` with that status; ok → `jsonResponse(body)` passed through `sessions.save` when a refresh happened.

- [ ] **Step 1: Write the failing tests** with `memorySessionStore` and `vi.stubGlobal('fetch', …)`:
  - `answers no-session without a session`
  - `answers no-access-token when the session has none`
  - `refreshes up front when the access token is about to expire` (expiresAt = now + 10 → upstream called with the refreshed token, `saved.length === 1`)
  - `retries once after an upstream 401` (first 401, then 200)
  - `ends the module session after the refresh fails too` (`ended === 1`, body `session-ended`)
  - `keeps the session on other upstream failures` (503 → status 503, `ended === 0`)
  - `passes the platform body through` (`{ user: { email: 'a@b' } }`)
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** `src/core/shell-info.ts`
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(core): shell-info handler over the session store`

### Task 4: Core OIDC sign-in, callback, sign-out

**Files:**
- Create: `src/core/oidc-signin.ts`, `src/core/oidc-callback.ts`, `src/core/oidc-signout.ts`, `src/core/denied-page.ts`
- Test: `src/core/oidc-callback.test.ts` (port of `src/lib/api/oidc-callback.test.ts` to the core signature), `src/core/oidc-signout.test.ts`
- Read: the three handlers under `src/lib/api/` (logic to move, keep files for now)

**Interfaces:**
- Consumes: Tasks 1–2; `oauth4webapi`; `oidcScopes`, `providerOrigin`, `secureCookies`, `signedOutPath`, `OIDC_STATE_COOKIE`; `isSessionAccessRevoked`.
- Produces:
  - `type OidcContext = { env: OidcEnv; sessions: ShellSessionStore }`
  - `oidcSignin(req, ctx): Promise<Response>` — revoked-session check uses `ctx.sessions.load` then `ctx.sessions.end` on the redirect to `${providerOrigin(env)}/apps?error=no-access`; state cookie via `setCookie` (`Max-Age=600`, `HttpOnly`, `Secure` per `secureCookies()`, `SameSite=lax`, `Path=/`).
  - `oidcCallback(req, ctx): Promise<Response>` — on success builds the `ShellSession` from the claims (today's mapping) and returns `ctx.sessions.save(req, session, redirectResponse(new URL(pkce.callback || '/admin', origin)))` with the state cookie deleted; provider errors → `deniedPage` with the state cookie deleted.
  - `oidcSignout(req, ctx): Promise<Response>` — today's redirect logic, session ended via `ctx.sessions.end`.
  - `deniedPage(error: string, description: string | null): Response` — today's HTML, `Response` instead of `NextResponse`.
  - `clearSessionCookieOn(res: Response): void` in `oidc-signout.ts` (today's attributes) — used by the Next wrapper's `clearSessionCookie`.

- [ ] **Step 1: Port the callback tests** to call `oidcCallback(req, { env, sessions: cookieSessionStore(env) })` with the same cases (403 page, 400 page, escaping, state cookie cleared, invalid_grant page); add in `oidc-signout.test.ts`:

```ts
it('redirects to the platform single-logout and ends the session', async () => {
  const res = await oidcSignout(new Request('https://app.example.test/api/oidc/signout'), ctx)
  expect(res.headers.get('location')).toBe('https://id.example.test/api/sso/signout?post_logout_redirect_uri=https%3A%2F%2Fapp.example.test%2Flogin%3Fsigned-out%3D1')
  expect(res.headers.get('set-cookie')).toMatch(/^rflgd-session=; Path=\/; Max-Age=0; HttpOnly; SameSite=lax$/)
})
```
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** the four files
- [ ] **Step 4: Run** `pnpm test` → all green (old tests untouched and still passing)
- [ ] **Step 5: Commit** `feat(core): oidc sign-in, callback and sign-out over web responses`

### Task 5: Layer moves, Next wrappers, Payload layer, architecture test

**Files:**
- Move (git mv, imports fixed): `src/lib/auth/{oidc-config,oidc-cookie,oidc-refresh,client-credentials,can-access}.ts` → `src/core/auth/`; `src/lib/directory/*` → `src/core/directory/`; `src/lib/notifications/*` → `src/core/notifications/`; `src/lib/settings/*` → `src/core/settings/`; `src/lib/palette/*` → `src/core/palette/`; `src/config.ts` → `src/core/config.ts`; tests move with their modules.
- Move: `src/lib/auth/nextauth-strategy.ts` (+ test) → `src/payload/strategy.ts`; `src/middleware.ts` → `src/next/middleware.ts`.
- Replace: `src/lib/api/{oidc-signin,oidc-callback,oidc-signout,shell-info}.ts` → `src/next/api/*.ts` wrappers (delete the old files and their tests; Task 3/4 tests cover the logic, the wrapper tests below cover the binding).
- Create: `src/core/index.ts`, `src/next/index.ts`, `src/payload/index.ts` (barrels), `src/next/context.ts`, legacy entry files `src/entries/<old path>.ts` re-exporting (one file per legacy path listed in Global Constraints; components come in Task 6).
- Test: `src/architecture.test.ts`, `src/next/api/shell-info.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  - `src/next/context.ts`: `oidcContext(): OidcContext | null` (= `loadOidcEnv()` → null or `{ env, sessions: cookieSessionStore(env) }`), `shellInfoContext(): ShellInfoContext | null`, `toNextResponse(res: Response): NextResponse` (= `new NextResponse(res.body, res)`).
  - `src/next/api/shell-info.ts`: `GET(req: Request): Promise<NextResponse>` (`503 oidc-not-configured` when context null), `runtime`, `dynamic`.
  - `src/next/api/oidc-signin.ts`, `oidc-callback.ts` (`deniedResponse` = `toNextResponse(deniedPage(...))`), `oidc-signout.ts` (`clearSessionCookie(res: NextResponse)` = `clearSessionCookieOn(res)`, `POST = GET`); all `500 oidc-not-configured` when context null, as today.
  - Legacy paths resolve to the barrels/wrappers with identical exported names.

- [ ] **Step 1: Write the failing architecture test**

```ts
const files = await fg(['src/core/**/*.ts', 'src/core/**/*.tsx', 'src/react/**/*.tsx', 'src/react/**/*.ts'])
for (const f of files) it(`${f} imports no framework`, () => {
  expect(readFileSync(f, 'utf8')).not.toMatch(/from ['"](next(\/|'|")|payload|@payloadcms)/)
})
```
  (use `node:fs` + `readdirSync` recursion, no new dependency) and a wrapper test `src/next/api/shell-info.test.ts` with the env stubs of today's test: `answers 503 without configuration`, `returns a NextResponse carrying the core Set-Cookie` (mock fetch 200 + expiring token → `res.cookies.get('rflgd-session')` defined).
- [ ] **Step 2: Run** `pnpm test` → the wrapper test fails (module missing)
- [ ] **Step 3: Move files, create wrappers, barrels and legacy entries**; `tsconfig` `include` unchanged. In `src/core/auth/oidc-config.ts`, `loadOidcEnv()` takes the base URL from the first non-empty of `RFLGD_SERVER_URL`, `NEXT_PUBLIC_SERVER_URL` (test: `vi.stubEnv('RFLGD_SERVER_URL', 'https://b.test')` with `NEXT_PUBLIC_SERVER_URL` unset → `baseUrl === 'https://b.test'`; both set → `RFLGD_SERVER_URL` wins).
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test` → green; `grep -rn "next/server" src/core src/react` → empty
- [ ] **Step 5: Commit** `refactor: split into core, next and payload layers with legacy entry points`

### Task 6: React layer with `ShellProvider`

**Files:**
- Move: `src/components/*.tsx` (+ `TenantTheme.test.ts`) → `src/react/`
- Create: `src/react/shell-config.tsx` (`ShellProvider`, `useShellConfig`, `resolveShellConfig`), `src/react/index.ts`
- Modify: `src/core/config.ts` (`loadAppConfig(env?: Record<string, string | undefined>)`), the five components (config via hook, fetch via `shellInfoUrl`)
- Test: `src/react/shell-config.test.ts`, `src/core/config.test.ts`

**Interfaces:**
- Consumes: Task 5 layout.
- Produces:
  - `type ShellConfig = { appKey: string; appLabel: string; shellInfoUrl: string }`
  - `ShellProvider(props: { config: Partial<ShellConfig> & Pick<ShellConfig, 'appKey' | 'appLabel'>; children: ReactNode })`
  - `useShellConfig(): ShellConfig`; `resolveShellConfig(provided: Partial<ShellConfig> | null): ShellConfig` (provided ?? `loadAppConfig()` mapped; `shellInfoUrl` default `'/api/shell-info'`)
  - `loadAppConfig(env = typeof process !== 'undefined' ? process.env : {}): AppConfig`
  - Components: `BrandSwitcher`, `TenantTheme`, `NotificationBell` fetch `useShellConfig().shellInfoUrl`; `BrandSwitcher` reads `appKey`/`appLabel` from the hook.

- [ ] **Step 1: Write the failing tests**

```ts
it('falls back to the env reader without a provider', () => {
  expect(resolveShellConfig(null)).toEqual({ appKey: 'unknown', appLabel: 'Reflagged App', shellInfoUrl: '/api/shell-info' })
})
it('keeps the provider values and defaults the url', () => {
  expect(resolveShellConfig({ appKey: 'botspawn', appLabel: 'Botspawn' })).toEqual({ appKey: 'botspawn', appLabel: 'Botspawn', shellInfoUrl: '/api/shell-info' })
})
it('renders the switcher inside a provider', () => {
  const html = renderToString(<ShellProvider config={{ appKey: 'x', appLabel: 'Label X' }}><BrandSwitcher /></ShellProvider>)
  expect(html).toContain('Label X')
})
// config.test.ts
it('reads nothing when there is no process env', () => {
  expect(loadAppConfig({})).toEqual({ appKey: 'unknown', appLabel: 'Reflagged App', defaultRole: 'user' })
})
```
  (`renderToString` from `react-dom/server`; the test file is `.tsx`, extend `vitest.config.ts` `include` to `src/**/*.test.{ts,tsx}`.)
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**; legacy `src/entries/components/*.ts` re-export from `src/react/`
- [ ] **Step 4: Run** `pnpm typecheck && pnpm test` → green; `git diff --stat src/react` shows only the config/fetch lines changed in the components
- [ ] **Step 5: Commit** `feat(react): ShellProvider configuration with env fallback`

### Task 7: Build, packaging, README

**Files:**
- Create: `tsup.config.ts`, `src/dist.test.ts` (runs against `dist/`, skipped when absent)
- Modify: `package.json` (version `2.0.0`, `scripts.build`, `files`, `exports`, `peerDependenciesMeta`, devDependency `tsup`), `.github/workflows/publish.yml` (`pnpm build` before the version guard, comment updated), `README.md` (Install without `transpilePackages`, "Entry points" with the four layers, new section "Outside Next.js (Vite, Hono, Remix)" showing `ShellProvider` + `shellInfo` with an own `ShellSessionStore`), `.gitignore` (`dist`)

**Interfaces:**
- Produces: `pnpm build` → `dist/` with one ESM file + `.d.ts` per entry; `exports` keys: new `./core`, `./react`, `./next`, `./payload` plus every legacy path, each `{ types: './dist/<x>.d.ts', import: './dist/<x>.js' }`; react entries carry the `'use client'` banner; legacy component entries import `@reflagged/shell/react` as an external.

tsup: `entry` map of all paths, `format: ['esm']`, `dts: true`, `splitting: true` (shared chunks, so the `ShellProvider` context lives in one chunk imported by `react.js` and every legacy component entry), `clean: true`, `external: ['react', 'react-dom', 'lucide-react', 'next', 'payload']`, `banner: { js: "'use client'" }` only for the react entries (two `defineConfig` entries in one array; the second build must not `clean`). Legacy entry files import relatively (`export * from '../react'`), never via the package name.

- [ ] **Step 1: Write the failing dist test**

```ts
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
```
- [ ] **Step 2: Run** `pnpm build && pnpm test` → dist test fails until config is right
- [ ] **Step 3: Implement** config, package.json, workflow, README, .gitignore
- [ ] **Step 4: Verify** `pnpm build && pnpm typecheck && pnpm test` green; `pnpm pack --pack-destination /tmp` lists only `dist/**`, `README.md`, `package.json`; `node -e "import('@reflagged/shell/core')"` from a scratch dir with the tarball installed resolves
- [ ] **Step 5: Commit** `build: compiled ESM distribution, layered exports, optional next and payload peers`

### Task 8: Consumer verification script

**Files:**
- Create: `scripts/verify-consumers.sh`, `scripts/consumers.txt` (one local checkout path per line: the 20 `~/Development` consumers from the spec survey)

Behaviour: `pnpm build && pnpm pack` → for each consumer dir: `pnpm add -D <tarball>` (no `--save`-free option exists, so afterwards `git checkout -- package.json pnpm-lock.yaml` and `git status --short` must be empty for those two files); run `pnpm exec tsc --noEmit` when a `tsconfig.json` exists and `pnpm exec next build` when `.env` exists (Payload apps need it); print a table `consumer | typecheck | build` with `pass/fail/skipped`; exit 1 if any fail. Consumers whose `package.json` lacks `@reflagged/shell` are skipped with `n/a`.

- [ ] **Step 1: Write** the script (bash, `set -euo pipefail`, per-consumer failures collected, not fatal mid-run)
- [ ] **Step 2: Run** it against the 20 consumers; fix package problems it reveals in the shell (not in consumers) and re-run until every typecheck passes and every attempted build passes
- [ ] **Step 3: Record** the table in `docs/superpowers/plans/2026-11-15-verify-consumers.md`
- [ ] **Step 4: Commit** `chore: consumer verification script and results`

### Task 9: Release and rollout

- [ ] **Step 1: Push** the branch, open the PR `feat: framework-independent shell 2.0` (body per repo convention: What/Why/Changes/Risk/Tested), wait for CI
- [ ] **Step 2: Merge** to `main`
- [ ] **Step 3: Tag** `v2.0.0` on the merge commit, push the tag; watch `publish.yml` → npm shows `2.0.0`
- [ ] **Step 4: Watch** `fan-out.yml`; list the bump PRs it opened and their merge state; for a consumer whose CI fails because of the bump, fix in the shell (patch release) or in the consumer PR, never leave it red
- [ ] **Step 5: Smoke** on Agentforge after its bump deployed: sign-in, switcher (⌘K, apps, Abmelden), tenant theme, sign-out → record in the PR
- [ ] **Step 6: Commit** nothing further; report the rollout table
