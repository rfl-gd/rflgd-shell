# Role Translation at SSO Account Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an app decide the role a new SSO account receives, using the workspace role the platform already puts in the session, instead of a fixed `RFLGD_DEFAULT_USER_ROLE`.

**Architecture:** A pure function `resolveNewUserRole()` makes the decision; `createOidcStrategy()` wires it into Payload's auth strategy and takes the app's `roleForNewUser` callback. The existing `nextauthStrategy` export becomes `createOidcStrategy()` with no options, so the nine other consuming repositories see no change. Kollega passes a mapping and keeps its `restrictBootstrapAdmin` hook untouched.

**Tech Stack:** TypeScript, Payload 3 `AuthStrategy`, Vitest (new to this package), pnpm 9.15.0, GitHub Actions publish on `v*` tag.

**Spec:** `docs/superpowers/specs/2026-09-16-role-translation-design.md` (same repository)

## Global Constraints

- **No breaking change.** `nextauthStrategy` stays exported from `@reflagged/shell/auth/nextauth-strategy` and keeps today's behaviour exactly. Release is a **minor** (1.2.0 → 1.3.0).
- **Default behaviour, verbatim:** without `roleForNewUser` the role is `isFirst ? 'admin' : loadAppConfig().defaultRole`, where `defaultRole` is `process.env.RFLGD_DEFAULT_USER_ROLE ?? 'user'`.
- **Modules stay independent.** No module of this package may import another module of this package; `./auth/nextauth-strategy` must not pull in `./middleware` or `./components/*`. This is what keeps every module optional.
- **Standalone must keep working.** With SSO off the strategy is never registered; with SSO on but no membership claims, `orgRole` and `platformRole` are `null` and reach the callback unchanged.
- **Language:** identifiers, comments, docblocks and test names in English. User-facing strings stay German.
- **Kollega's mapping must keep the first-user rule.** `isFirstUser → 'admin'`, or a fresh instance ends up with no administrator at all (`restrictBootstrapAdmin` only lets the bootstrap address be `admin`).
- **pnpm in this repository:** a parent `package.json` forces yarn, so use `COREPACK_ENABLE_STRICT=0 npx --yes pnpm@9.15.0 <cmd>`.

---

### Task 1: Role decision, factory, tests, and release

**Files:**
- Modify: `src/lib/auth/nextauth-strategy.ts` (whole file, currently 48 lines)
- Create: `src/lib/auth/nextauth-strategy.test.ts`
- Modify: `package.json` (devDependency `vitest`, `test` script, `files` exclusion, version)
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: `loadAppConfig()` from `../../config` — returns `{ appKey: string; appLabel: string; defaultRole: string }`.
- Produces:
  - `type NewUserContext = { orgRole: string | null; platformRole: string | null; email: string; isFirstUser: boolean }`
  - `type RoleForNewUser = (ctx: NewUserContext) => string`
  - `resolveNewUserRole(ctx: NewUserContext, roleForNewUser?: RoleForNewUser): string`
  - `createOidcStrategy(options?: { roleForNewUser?: RoleForNewUser }): AuthStrategy`
  - `nextauthStrategy: AuthStrategy` (unchanged name, now `createOidcStrategy()`)

- [ ] **Step 1: Add Vitest to the package**

The package has no test runner today — `scripts` knows only `typecheck`.

```bash
cd ~/Development/rflgd-shell
COREPACK_ENABLE_STRICT=0 npx --yes pnpm@9.15.0 add -D vitest@^3.2.0
```

Then add the script to `package.json` (keep `typecheck` as it is):

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "vitest run"
}
```

- [ ] **Step 2: Keep tests out of the published tarball**

`package.json` has `"files": ["src", "tsconfig.json", "README.md"]`, so `src/**/*.test.ts` would ship to every consumer. npm honours negated patterns in `files`, so exclude them there:

```json
"files": [
  "src",
  "!src/**/*.test.ts",
  "tsconfig.json",
  "README.md"
]
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Write the failing test**

Create `src/lib/auth/nextauth-strategy.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveNewUserRole, type NewUserContext } from './nextauth-strategy'

/**
 * Who becomes an administrator on a fresh instance is decided here. A silent
 * mistake in these five lines is expensive, so they carry their own test.
 */

const context = (over: Partial<NewUserContext> = {}): NewUserContext => ({
  orgRole: null,
  platformRole: null,
  email: 'someone@example.de',
  isFirstUser: false,
  ...over,
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveNewUserRole', () => {
  it('makes the first account an administrator', () => {
    expect(resolveNewUserRole(context({ isFirstUser: true }))).toBe('admin')
  })

  it('falls back to RFLGD_DEFAULT_USER_ROLE for everyone after that', () => {
    vi.stubEnv('RFLGD_DEFAULT_USER_ROLE', 'employee')

    expect(resolveNewUserRole(context())).toBe('employee')
  })

  it("uses the package's own default when the variable is unset", () => {
    vi.stubEnv('RFLGD_DEFAULT_USER_ROLE', undefined)

    expect(resolveNewUserRole(context())).toBe('user')
  })

  it('lets the app decide when it supplies a callback', () => {
    vi.stubEnv('RFLGD_DEFAULT_USER_ROLE', 'employee')

    const role = resolveNewUserRole(context({ orgRole: 'admin' }), ({ orgRole }) =>
      orgRole === 'admin' ? 'hr-admin' : 'employee',
    )

    expect(role).toBe('hr-admin')
  })

  it('hands the callback the first-user flag, so it can keep that rule', () => {
    // Without this the app cannot reproduce today's behaviour, and a fresh
    // instance can end up with no administrator at all.
    const role = resolveNewUserRole(context({ isFirstUser: true }), ({ isFirstUser }) =>
      isFirstUser ? 'admin' : 'employee',
    )

    expect(role).toBe('admin')
  })

  it('passes null claims through untouched — the standalone case', () => {
    // No rflgd:memberships scope, or a session older than the field. The app
    // must be able to tell "not an org admin" from "no platform at all".
    const seen: NewUserContext[] = []
    resolveNewUserRole(context(), (ctx) => {
      seen.push(ctx)
      return 'employee'
    })

    expect(seen[0]?.orgRole).toBeNull()
    expect(seen[0]?.platformRole).toBeNull()
  })
})
```

- [ ] **Step 4: Run the test and watch it fail**

```bash
cd ~/Development/rflgd-shell
COREPACK_ENABLE_STRICT=0 npx --yes pnpm@9.15.0 test
```

Expected: FAIL — `resolveNewUserRole` is not exported from `./nextauth-strategy`.

- [ ] **Step 5: Implement**

Replace `src/lib/auth/nextauth-strategy.ts` with:

```ts
import { randomBytes } from 'node:crypto'
import type { AuthStrategy } from 'payload'

import { loadAppConfig } from '../../config'
import { OIDC_COOKIE } from './oidc-config'
import { verifySessionCookie } from './oidc-cookie'

/** What the platform knows about a person signing in for the first time. */
export type NewUserContext = {
  /** Role in the current workspace ('admin' | 'member'), null without claims. */
  orgRole: string | null
  /** Role on the platform itself, null without claims. */
  platformRole: string | null
  email: string
  /** True when this account is the first in the instance. */
  isFirstUser: boolean
}

/** Maps the platform's view of a person onto one of this app's own roles. */
export type RoleForNewUser = (ctx: NewUserContext) => string

/**
 * The role a newly created account receives.
 *
 * Without a callback this is exactly what it always was: the first account
 * administers, everyone after it gets RFLGD_DEFAULT_USER_ROLE. With a
 * callback the decision belongs entirely to the app, `isFirstUser` included —
 * which is why it is in the context. An app that forgets that branch can end
 * up with an instance that has no administrator.
 *
 * The return value is not checked. Which roles exist is the app's knowledge;
 * an unknown value is rejected by Payload against the field configuration and
 * the account is not created. That is the same path on which this package's
 * own default 'user' once locked instances out.
 */
export function resolveNewUserRole(
  ctx: NewUserContext,
  roleForNewUser?: RoleForNewUser,
): string {
  if (roleForNewUser) return roleForNewUser(ctx)
  return ctx.isFirstUser ? 'admin' : loadAppConfig().defaultRole
}

/**
 * Payload auth strategy for the platform's single sign-on.
 *
 * Creates an account on first sign-in when none exists for the address. The
 * role it gets is `resolveNewUserRole`'s decision — see there.
 */
export function createOidcStrategy(options?: {
  roleForNewUser?: RoleForNewUser
}): AuthStrategy {
  return {
    name: 'rflgd-oidc',
    authenticate: async ({ payload, headers }) => {
      const secret = process.env.AUTH_SECRET
      if (!secret) return { user: null }

      const cookieHeader = headers.get('cookie') ?? ''
      const cookieStart = `${OIDC_COOKIE}=`
      const segment = cookieHeader
        .split(';')
        .map((c) => c.trim())
        .find((c) => c.startsWith(cookieStart))
      if (!segment) return { user: null }

      const token = segment.slice(cookieStart.length)
      const session = await verifySessionCookie(secret, token)
      if (!session?.email) return { user: null }

      const existing = await payload.find({
        collection: 'users',
        where: { email: { equals: session.email } },
        limit: 1,
        overrideAccess: true,
      })

      let user = existing.docs[0]
      if (!user) {
        const isFirstUser =
          (await payload.count({ collection: 'users', overrideAccess: true })).totalDocs === 0
        const role = resolveNewUserRole(
          {
            orgRole: session.orgRole ?? null,
            platformRole: session.platformRole ?? null,
            email: session.email,
            isFirstUser,
          },
          options?.roleForNewUser,
        )
        user = await payload.create({
          collection: 'users',
          data: {
            email: session.email,
            password: randomBytes(32).toString('hex'),
            // `role` comes from the environment or the app and is therefore a
            // `string`. The host application narrows `users.role` to the
            // options of its own collection — this package cannot know that
            // type. The value is checked by Payload against the field
            // configuration on write; an unknown one is rejected there.
            role: role as never,
          },
          overrideAccess: true,
        })
      }

      return { user: { ...user, collection: 'users' } }
    },
  }
}

/**
 * The strategy without options — the export every consumer used before this
 * package learned about role translation. Kept so nothing has to change.
 */
export const nextauthStrategy: AuthStrategy = createOidcStrategy()
```

Note the `role as never` cast: it is the same one that lived in each consumer's
patch file. Moving it here means the patch can be dropped downstream.

- [ ] **Step 6: Run the tests and the typecheck**

```bash
cd ~/Development/rflgd-shell
COREPACK_ENABLE_STRICT=0 npx --yes pnpm@9.15.0 test
COREPACK_ENABLE_STRICT=0 npx --yes pnpm@9.15.0 typecheck
```

Expected: 6 tests pass, typecheck clean.

- [ ] **Step 7: Commit**

```bash
cd ~/Development/rflgd-shell
git add src/lib/auth/nextauth-strategy.ts src/lib/auth/nextauth-strategy.test.ts \
        package.json pnpm-lock.yaml vitest.config.ts
git commit -m "feat(auth): let the app decide the role a new SSO account gets

The strategy created accounts with a fixed RFLGD_DEFAULT_USER_ROLE while
session.orgRole sat unused right beside it — whoever administers the
workspace still arrived as an ordinary member and had to be promoted by
hand, in every instance again.

createOidcStrategy takes a roleForNewUser callback that sees the platform's
view of the person and returns one of the app's own roles. It runs only when
an account is created; an existing account is never touched, so what someone
was promoted to inside the app stays.

nextauthStrategy remains exported and behaves exactly as before, so the nine
other consumers need no change.

The package gets its first tests along with it. Five lines decide who
becomes an administrator; that deserves more than a typecheck."
```

- [ ] **Step 8: Release 1.3.0**

```bash
cd ~/Development/rflgd-shell
node -e "const f='package.json',j=require('./'+f);j.version='1.3.0';require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
git add package.json && git commit -m "chore(release): 1.3.0"
git push origin main
git tag v1.3.0 && git push origin v1.3.0
```

The workflow `.github/workflows/publish.yml` triggers on `v*` and runs
`npm publish --access public`.

- [ ] **Step 9: Verify it actually reached the registry**

```bash
gh run list --repo rfl-gd/rflgd-shell --limit 1 --json conclusion --jq '.[0].conclusion'
curl -s "https://registry.npmjs.org/@reflagged%2Fshell/1.3.0" | head -c 120
```

Expected: `success`, and JSON with a `dist.tarball` field.

**Do not trust `npm view`** — its CDN lags by minutes and reported 1.1.0 as
latest while 1.2.0 was already published. The registry URL above is the
truth. If the workflow says success but the registry 404s, wait a minute and
re-check before assuming a failure.

---

### Task 2: Kollega passes its mapping

**Files:**
- Modify: `src/collections/Users.ts:3` (import) and `:23-31` (`gatedOidcStrategy`)
- Create: `tests/unit/auth/role-mapping.test.ts`
- Modify: `package.json` (dependency range), `patches/` (patch filename)

**Interfaces:**
- Consumes: `createOidcStrategy({ roleForNewUser })` from `@reflagged/shell/auth/nextauth-strategy` (Task 1).
- Produces: `roleForNewUser` exported from `src/collections/Users.ts` so the test can reach it without building a Payload instance.

- [ ] **Step 1: Bump the package**

```bash
cd ~/Development/kollega
node -e "const f='package.json',s=require('fs').readFileSync(f,'utf8').replace(/\"@reflagged\/shell\": \"\^1\.2\.0\"/,'\"@reflagged/shell\": \"^1.3.0\"').replace(/@reflagged__shell@1\.2\.0\.patch/g,'@reflagged__shell@1.3.0.patch').replace(/\"@reflagged\/shell@1\.2\.0\"/,'\"@reflagged/shell@1.3.0\"');require('fs').writeFileSync(f,s)"
git mv patches/@reflagged__shell@1.2.0.patch patches/@reflagged__shell@1.3.0.patch
pnpm install
```

The patch contains only the `role as never` cast, which Task 1 moved into the
package. Check whether it still applies:

```bash
grep -n "as never" node_modules/@reflagged/shell/src/lib/auth/nextauth-strategy.ts
```

If `pnpm install` reports the patch could not be applied, **delete it**: the
upstream fix made it redundant.

```bash
git rm patches/@reflagged__shell@1.3.0.patch
node -e "const f='package.json',j=require('./'+f);delete j.pnpm.patchedDependencies;require('fs').writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
pnpm install
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/auth/role-mapping.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { roleForNewUser } from '@/collections/Users'

/**
 * What a person becomes on their first sign-in through the suite.
 *
 * Workspace role and job role are two different axes: administering the
 * workspace should not make someone the technical administrator of an HR
 * instance, but it should give full professional access.
 */

const ctx = (over: Partial<Parameters<typeof roleForNewUser>[0]> = {}) => ({
  orgRole: null,
  platformRole: null,
  email: 'someone@example.de',
  isFirstUser: false,
  ...over,
})

describe('roleForNewUser', () => {
  it('makes the first account an administrator', () => {
    // Without this branch the booking person becomes hr-admin, and because
    // restrictBootstrapAdmin only lets the bootstrap address be admin, a
    // fresh instance would end up with no administrator at all.
    expect(roleForNewUser(ctx({ isFirstUser: true }))).toBe('admin')
  })

  it('gives a workspace administrator full professional access', () => {
    expect(roleForNewUser(ctx({ orgRole: 'admin' }))).toBe('hr-admin')
  })

  it('gives everyone else the employee role', () => {
    expect(roleForNewUser(ctx({ orgRole: 'member' }))).toBe('employee')
  })

  it('treats a missing claim as an ordinary employee', () => {
    // Standalone operation, or a session minted before the claim existed.
    expect(roleForNewUser(ctx())).toBe('employee')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd ~/Development/kollega
npx vitest run tests/unit/auth/role-mapping.test.ts
```

Expected: FAIL — `roleForNewUser` is not exported from `@/collections/Users`.

- [ ] **Step 4: Implement**

In `src/collections/Users.ts`, change the import on line 3:

```ts
import {
  createOidcStrategy,
  type NewUserContext,
} from '@reflagged/shell/auth/nextauth-strategy'
```

Add the mapping above `gatedOidcStrategy` (around line 22):

```ts
/**
 * What a person becomes on their first sign-in through the suite.
 *
 * The platform knows who administers the workspace; this application knows
 * what its own roles mean. Mapped onto `hr-admin` rather than `admin`, for
 * two reasons and the second is the weightier: `restrictBootstrapAdmin`
 * below downgrades any `admin` that is not the bootstrap address, so the
 * translation would run into it; and administering a workspace should not
 * hand someone the technical administration of an HR instance, but it should
 * give full professional access.
 *
 * `isFirstUser` keeps today's rule alive. Drop that branch and the booking
 * person arrives as `hr-admin`, the hook keeps `admin` for the bootstrap
 * address only, and the instance has no administrator at all.
 *
 * Exported so it can be tested without building a Payload instance.
 */
export function roleForNewUser({ orgRole, isFirstUser }: NewUserContext): string {
  if (isFirstUser) return 'admin'
  return orgRole === 'admin' ? 'hr-admin' : 'employee'
}

const rflgdOidcStrategy = createOidcStrategy({ roleForNewUser })
```

Leave `gatedOidcStrategy` (lines 23-31) exactly as it is — it wraps
`rflgdOidcStrategy`, which is now the configured strategy.

- [ ] **Step 5: Run the tests, typecheck and lint**

```bash
cd ~/Development/kollega
npx vitest run tests/unit
npx tsc --noEmit 2>&1 | grep -v "access-matrix"
npx eslint .
npx prettier --check .
```

Expected: all unit tests pass (2459 + 4 new). The only typecheck errors are
the three pre-existing ones in `tests/integration/access-matrix.test.ts`.

If `prettier --check` flags `pnpm-lock.yaml`, format it — `pnpm install`
rewrites it unformatted and the quality gate fails on exactly this:

```bash
npx prettier --write pnpm-lock.yaml
```

- [ ] **Step 6: Commit and push**

```bash
cd ~/Development/kollega
git add -A
git commit -m "feat(auth): give a workspace administrator full access on first sign-in

Whoever administers the workspace arrived in Kollega as an ordinary
employee and had to be promoted by hand. The platform knew better all
along — session.orgRole sat unused beside the account creation.

Mapped onto hr-admin rather than admin: restrictBootstrapAdmin keeps admin
for the bootstrap address, and administering a workspace should not hand
someone the technical administration of an HR instance.

The first-user branch stays. Without it the booking person becomes
hr-admin, the hook keeps admin for the bootstrap address only, and a fresh
instance ends up with no administrator at all."
git push origin main
```

---

### Task 3: Deploy and verify on the running instance

**Files:** none — this is the acceptance.

**Interfaces:**
- Consumes: booking #53 of tenant `reflagged-demo`, reachable at
  `https://kollega.reflagged-demo.rfl.gd`.

- [ ] **Step 1: Wait for CI**

```bash
until [ "$(gh run list --repo rfl-gd/kollega --limit 1 --json status --jq '.[0].status')" = completed ]; do sleep 30; done
gh run view --repo rfl-gd/kollega $(gh run list --repo rfl-gd/kollega --limit 1 --json databaseId --jq '.[0].databaseId') --json jobs --jq '.jobs[]|"\(.name): \(.conclusion)"'
```

Expected: `quality / gate`, `Tests`, `Build`, `E2E Tests` all `success`.

- [ ] **Step 2: Roll the instance forward**

**Coolify does not deploy provisioned apps on push.** Use the platform:
`https://app.rfl.gd/platform/updates` → „Jetzt prüfen" → wait ~20s → reload →
„Upgrade" on the Kollega row (leave „Backup vorher" checked).

- [ ] **Step 3: Wait for the restart**

```bash
seen=0
for i in $(seq 1 45); do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 https://kollega.reflagged-demo.rfl.gd/api/health)
  [ "$code" != "200" ] && seen=1
  [ "$seen" = 1 ] && [ "$code" = "200" ] && { echo "restart complete after ~$((i*15))s"; break; }
  sleep 15
done
```

Expected: a 503 phase followed by 200, typically 3-4 minutes in total.

- [ ] **Step 4: Verify the translation on a new account**

The existing `admin@rfl.gd` account is untouched by design — the callback runs
only on creation. To see the translation, a **second** member of the
`reflagged-demo` workspace has to sign in for the first time.

Check the current state first:

```
https://app.rfl.gd/platform/tenants/reflagged-demo?tab=members
```

Pick a member who has never opened Kollega, sign in as them through the
launchpad, then confirm the role landed:

```
https://kollega.reflagged-demo.rfl.gd/hr/mitarbeiter
```

A workspace admin must arrive as `hr-admin` (full HR navigation visible), a
plain member as `employee` (only „Meine Abwesenheiten").

**If no second member is available**, say so rather than inventing a result:
the unit tests cover the mapping, and the wiring is one line. Do not create a
throwaway account in the production workspace to manufacture a test.

- [ ] **Step 5: Confirm standalone is unharmed**

```bash
cd ~/Development/kollega
npx vitest run tests/unit/auth
```

The E2E suite in CI runs with SSO off and already passed in Task 3 Step 1 —
that is the standalone path's guard.

---

## Out of scope

Recorded in the spec and deliberately not in this plan: access checking
(`can-access.ts` ships already and three of five apps simply do not use it),
model access, the env contract, error classes, the health endpoint, and the AI
registry.

Separate small task, decided but not planned here: Renovate or Dependabot per
consuming repository. Without it every package improvement sits unadopted —
Kollega hung on 1.0.0 while 1.1.0 carried the fix for the empty app switcher.
