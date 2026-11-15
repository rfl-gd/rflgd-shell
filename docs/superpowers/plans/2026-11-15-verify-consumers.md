# Consumer verification: @reflagged/shell 2.0.0 (2026-11-15)

`scripts/verify-consumers.sh` packs the shell and, for every consumer in `scripts/consumers.txt`,
installs the tarball into a scratch copy of the checkout (the checkouts themselves are never
touched), then runs `tsc --noEmit` and, when the checkout has a `.env`, `pnpm run build`. A step
that fails with 2.0 is re-run on a fresh copy installed from the consumer's own lockfile (its
current 1.x shell); only a step that passes there counts as a regression.

## Result

No regressions. 12 of 16 consumers typecheck with 2.0, all 5 attempted builds pass, and the 4
typecheck failures are pre-existing: the same errors, error for error, with the current 1.x shell.

| consumer | typecheck 2.0 | build 2.0 | baseline (only for failures) |
|---|---|---|---|
| agentforge/apps/agentforge | pass | skipped | - |
| chat | fail | skipped | typecheck fail |
| company-brain | pass | skipped | - |
| corporate-memory | pass | pass | - |
| corporate-voice | pass | skipped | - |
| flagbit-cockpit/apps/web | pass | skipped | - |
| iso-zertifierungsagent | fail | skipped | typecheck fail |
| kollega | pass | pass | - |
| matchingportal | pass | pass | - |
| peoplepulse | pass | skipped | - |
| rflgd-contentcreator | pass | pass | - |
| rflgd-demo | pass | skipped | - |
| rflgd-project-template-basic | fail | skipped | typecheck fail |
| rflgd-project-template | fail | skipped | typecheck fail |
| rflgd-simple-crm | pass | skipped | - |
| voice-gcms | pass | pass | - |

Builds are skipped where the checkout has no `.env` (Payload apps cannot build without one).
Not covered: `corporate-memory-langfuse` and `simple-crm` (stale duplicate checkouts) and
`corenode` (not an rfl-gd repository).

## Pre-existing failures (identical with 1.x)

- **chat**: one cast error in its own auth code (`TS2352`, `User` to `undefined`).
- **iso-zertifierungsagent**: seven strictness errors in its tests.
- **rflgd-project-template-basic**: imports `signSession`, `verifySession`, `readSessionCookie`
  and `Session` from `@reflagged/shell/auth/oidc-cookie`, which no 1.x release exported either.
  The template is out of date with the shell, not broken by 2.0.
- **rflgd-project-template**: missing `@payloadcms/db-mongodb` and `sharp`, a Mastra config
  mismatch and a read-only `NODE_ENV` assignment in a test helper.

## Notes on the script

- Each consumer runs with the pnpm its `packageManager` pins (pnpm 9.15.0 otherwise); two
  consumers are on pnpm 10.
- `pnpm add` links only the project it runs in, so any copy with a `pnpm-workspace.yaml`
  (the two monorepos, and peoplepulse and contentcreator, whose roots are workspaces) is
  re-installed from its root afterwards; without that, sibling packages had no dependencies and
  typecheck failed for reasons unrelated to the shell.
- Git worktrees nested inside a checkout (other branches checked out in subfolders) are left out
  of the copy; they are not part of the app and drowned its typecheck in their own errors.
- Private `@rfl-gd` packages come from GitHub Packages. The token is read from `GITHUB_TOKEN` or
  `gh auth token` and passed to pnpm only through a temporary user config that is removed on exit.
