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

#### Rich mails (`blocks`, since 1.9.0)

`title`, `body` and one button are enough for a short note. For anything with
structure — a status, facts, a table, a transcript — send `blocks`. A module
chooses the building blocks; how they look (colours, fonts, logo, spacing)
comes from the tenant's branding, rendered by the base with React Email. There
is no HTML and no style property, so every module's mail looks like it
belongs to the tenant and renders in Outlook, Gmail and Apple Mail alike.

```ts
import { createNotifier, type Block } from '@reflagged/shell/notifications/notifier'

const blocks: Block[] = [
  { type: 'callout', tone: 'warning', title: 'Rückruf nötig', text: 'Weitergabe zugesagt' },
  {
    type: 'facts',
    items: [
      { label: 'Anliegen', value: 'Angebot für einen Onlineshop' },
      { label: 'Rückruf an', value: [{ text: '0721 952 795 78', href: 'tel:+4972195279578' }] },
      { label: 'Dauer', value: '1:05 Min.' },
    ],
  },
  {
    type: 'section',
    title: 'Gesprächsverlauf',
    tone: 'outlined',
    blocks: [
      {
        type: 'conversation',
        messages: [
          { speaker: 'Agent', side: 'end', text: 'Hallo, hier ist die digitale Assistenz.' },
          { speaker: 'Anrufer', text: 'Ich möchte bitte zurückgerufen werden.' },
        ],
      },
    ],
  },
]

await createNotifier().notify({
  idempotencyKey: `call-${call.id}-callback`,
  topic: 'voice.call.callback',
  category: 'transactional',
  title: 'Rückrufwunsch – Angebot Onlineshop',  // subject and heading
  body: 'Angebot für einen Onlineshop',          // short text for the inbox list
  blocks,
  actionUrl: `https://voice.acme.rfl.gd/calls/${call.id}`,
  actionLabel: 'Anruf öffnen',                   // rendered as the last button
  recipients: [{ role: 'org:admins' }],
})
```

| Block | Fields | Use for |
|---|---|---|
| `heading` | `text`, `level?` 1–3 | sub-headings inside the mail |
| `text` | `text`, `size?` sm/md/lg, `muted?`, `align?` | paragraphs; line breaks are kept |
| `button` | `label`, `url`, `variant?` primary/secondary, `align?` | actions — https on the booking's or tenant's domain (like `actionUrl`), or `tel:`/`mailto:` |
| `image` | `src`, `alt`, `width?`, `href?`, `align?` | charts, screenshots — https on the booking's or tenant's domain |
| `callout` | `tone` neutral/info/success/warning/danger, `title?`, `text?` | status banners; tone colours are fixed, not branded |
| `facts` | `items[{ label, value }]` | label/value pairs |
| `list` | `items[]`, `ordered?` | bullet or numbered lists |
| `table` | `columns[{ label, align? }]`, `rows[][]` | tabular data, up to 8 columns / 200 rows |
| `quote` | `text`, `cite?` | quoted statements |
| `conversation` | `messages[{ speaker, text, side?, time? }]` | transcripts, chats; `side: 'end'` = the module's own side |
| `code` | `code`, `language?` | logs, snippets (monospace) |
| `divider`, `spacer` | `size?` | separation |
| `section` | `blocks`, `title?`, `tone?` plain/muted/outlined | grouping |
| `row` | `columns[{ blocks, width? }]` (2–4) | side-by-side content, e.g. key figures |

Every `text`/`value`/cell is a `RichText`: a plain string, or spans for
emphasis and links — `[{ text: 'fett', bold: true }, { text: ' und ' },
{ text: 'Link', href: 'https://…' }]`. Markdown is **not** interpreted.

Rules the base enforces (400 with the failing path otherwise): only the
blocks above, no extra properties, links https/`tel:`/`mailto:`; images and
button links only on the booking's or tenant's domains (inline span links may
point to any https page, e.g. a source), at most 200 top-level blocks, 100 kB, and
`section`/`row` nested three levels deep. The base also writes a plain-text
part from the blocks and shows the full mail in the platform inbox. Without
`blocks`, `body` is rendered as paragraphs as before. Types:
`@reflagged/shell/notifications/blocks`.

#### Email: modules do not send mail themselves

Every mail a module sends to a person goes through `notify()`. A module
configures **no SMTP server, no mail adapter and no mail credentials** — no
`@payloadcms/email-*`, no `nodemailer`, no `SMTP_*` variables in the manifest
or compose file. The base owns the sender per tenant (own SMTP server,
Microsoft 365 or the platform's `app@rfl.gd` with SPF/DKIM), the branding,
the user's preferences, unsubscribe links and the delivery log.

- `category: 'transactional'` for mails that must arrive (cannot be opted
  out of), `'activity'` for everything else.
- Only people with a platform account in the booking's organization can be
  reached. Mail to outsiders (a tenant's own customers, newsletters) is not
  supported — raise it with the platform team instead of adding a transport.
- **Passwords are not a module concern.** Users sign in through the
  platform's SSO; password reset, invitations and 2FA live in the base. The
  local Payload login is a bootstrap fallback for the first admin only —
  never hand out local module credentials to customers, because the module
  cannot send them a reset mail.

The bell shows the unread count (from `/api/shell-info`) and links to the
central inbox:

```tsx
import { NotificationBell } from '@reflagged/shell/components/NotificationBell'

<NotificationBell />
```

## Releasing

Bump `version` in `package.json`, commit, tag `vX.Y.Z` and push the tag.
`publish.yml` puts it on npm; `fan-out.yml` then opens a bump PR in every
`rfl-gd` repo whose root `package.json` depends on this package and merges it
unless the bump breaks a CI job that passes on the repo's default branch (a
main that is red already does not block it; no CI at all merges, too). Re-run
a rollout via *Actions → Roll out @reflagged/shell → Run workflow*; it resumes
open PRs.

Needs the secret `SHELL_FANOUT_TOKEN`: a fine-grained token on `rfl-gd`, all
repositories, with Contents and Pull requests read/write, Commit statuses and
Actions read. `PACKAGES_READ_TOKEN` (`read:packages`) lets repos with private
`@rfl-gd` packages resolve their lockfile. Running tenant instances stay pinned and update one by one in
Base (Plattform → Updates).

## App palette

`BrandSwitcher` opens on click or with ⌘K / Ctrl+K anywhere in the app. It
shows every running app with its catalog icon and tagline, filters them as you
type, and lists the user's workspaces. Platform admins get a "Plattform"
section that links to the Base palette (`<baseUrl>/?palette=<query>`); the
tenant switch itself runs in Base, where the platform session lives.

Apps that bind ⌘K / Ctrl+K themselves should drop their own binding.

The trigger is named by what it shows — app label, workspace — followed by
"Apps wechseln", so speech input finds it by its visible text (WCAG 2.5.3).
Style or query it with `button[data-brand-switcher]`, not by its name (the open
palette carries `data-brand-switcher` too).

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
