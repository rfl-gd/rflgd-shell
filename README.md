# rflgd-shell

Shared app shell for Reflagged services. Provides:

- OIDC authentication (signin, callback, signout)
- SSO session management (JWT cookie + Payload AuthStrategy)
- `/api/shell-info` proxy for platform service catalog
- `BrandSwitcher` component (app switcher dropdown)
- Admin route SSO enforcement middleware

## Usage

Add as git submodule:

```bash
git submodule add git@github.com:rfl-gd/rflgd-shell.git src/rflgd-shell
```

Configure via env vars:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_RFLGD_APP_KEY` | App key matching platform catalog |
| `NEXT_PUBLIC_RFLGD_APP_LABEL` | Display name in BrandSwitcher |
| `RFLGD_DEFAULT_USER_ROLE` | Role for auto-created users (default: `user`) |

## Per-app route files

Each app creates thin route wrappers that re-export from rflgd-shell:

```ts
// src/app/api/oidc/signin/route.ts
export { GET, dynamic, runtime } from '@/rflgd-shell/src/lib/api/oidc-signin'
```
