# Consumer verification: @reflagged/shell 2.0.0 (2026-11-15)

`scripts/verify-consumers.sh` packs the shell and, for every consumer in `scripts/consumers.txt`,
installs the tarball into a scratch copy of the checkout (the checkouts themselves are never
touched), then runs `tsc --noEmit`, `pnpm run build` and, when the app has vitest in its
devDependencies, `vitest run`. The build uses the checkout's `.env`; without one it copies
`.env.example` to `.env` in the copy only ("example env"), and is skipped when neither exists. A
step that fails with 2.0 is re-run on a fresh copy installed from the consumer's own lockfile (its
current 1.x shell); only a step that passes there counts as a regression.

## Result (fix wave, tarball with the native-ESM, callbackUrl and denied-page fixes)

No regressions. All 16 consumers install; 12 typecheck; 12 of 14 attempted builds pass; 5 of 15
test suites pass. Every failure is pre-existing: the baseline with the current 1.x shell fails the
same step, and for the test step with the same failing files and the same counts. kollega's
middleware unit test (which loads `@reflagged/shell/middleware` natively) passes.

| consumer | install 2.0 | typecheck 2.0 | build 2.0 | test 2.0 | baseline (only for failures) |
|---|---|---|---|---|---|
| agentforge/apps/agentforge | pass | pass | skipped | fail | test fail |
| chat | pass | fail | pass (example env) | fail | typecheck fail, test fail |
| company-brain | pass | pass | pass (example env) | pass | - |
| corporate-memory | pass | pass | pass | fail | test fail |
| corporate-voice | pass | pass | pass (example env) | pass | - |
| flagbit-cockpit/apps/web | pass | pass | skipped | pass | - |
| iso-zertifierungsagent | pass | fail | pass (example env) | fail | typecheck fail, test fail |
| kollega | pass | pass | pass | fail | test fail |
| matchingportal | pass | pass | pass | fail | test fail |
| peoplepulse | pass | pass | pass (example env) | pass | - |
| rflgd-contentcreator | pass | pass | pass | fail | test fail |
| rflgd-demo | pass | pass | pass (example env) | skipped | - |
| rflgd-project-template-basic | pass | fail | fail (example env) | fail | typecheck fail, build fail (example env), test fail |
| rflgd-project-template | pass | fail | fail (example env) | pass | typecheck fail, build fail (example env) |
| rflgd-simple-crm | pass | pass | pass (example env) | fail | test fail |
| voice-gcms | pass | pass | pass | fail | test fail |

Skipped: builds of `flagbit-cockpit/apps/web` and `agentforge/apps/agentforge` (no `.env` or
`.env.example` in the app), tests of `rflgd-demo` (no vitest).
Not covered: `corporate-memory-langfuse` and `simple-crm` (stale duplicate checkouts) and
`corenode` (not an rfl-gd repository).

## Pre-existing failures (identical with 1.x)

- **chat**: typecheck: one cast error in its own auth code (`TS2352`). Tests: 4 failures in 2
  files (fixtures without `folders`, an unmet expectation).
- **iso-zertifierungsagent**: typecheck: seven strictness errors in its tests. Tests: an
  end-to-end pipeline test that times out without its services.
- **rflgd-project-template-basic**: imports `signSession`, `verifySession`, `readSessionCookie`
  and `Session` from `@reflagged/shell/auth/oidc-cookie`, which no 1.x release exported either;
  typecheck, build and its oidc tests all fail on that. Out of date with the shell, not broken by 2.0.
- **rflgd-project-template**: missing `@payloadcms/db-mongodb` and `sharp`, a Mastra config
  mismatch and a read-only `NODE_ENV` assignment in a test helper; the build stops on the
  missing module.
- **voice-gcms**: its tests import `signSession` the same way (3 failures).
- **kollega**, **rflgd-simple-crm**, **rflgd-contentcreator**: integration suites need Postgres or
  MongoDB, which this run does not start.
- **corporate-memory**: 12 failures from LLM-dependent tests answering non-JSON.
- **matchingportal**: one turnstile test that needs the network.
- **agentforge**: a repository-content test that runs `git ls-files`, which a copy without
  `.git` cannot answer.

## Notes on the script

- Each consumer runs with the pnpm its `packageManager` pins (pnpm 9.15.0 otherwise); two
  consumers are on pnpm 10.
- `pnpm add` links only the project it runs in, so any copy with a `pnpm-workspace.yaml`
  (the two monorepos, and peoplepulse and contentcreator, whose roots are workspaces) is
  re-installed from its root afterwards; without that, sibling packages had no dependencies and
  typecheck failed for reasons unrelated to the shell.
- Git worktrees nested inside a checkout (other branches checked out in subfolders) are left out
  of the copy; they are not part of the app and drowned its typecheck in their own errors.
- Private `@rfl-gd` packages come from GitHub Packages. The token is read from `GITHUB_TOKEN`
  (or `gh auth token` with `USE_GH_TOKEN=1`) and passed to pnpm only for install commands, through
  a temporary user config removed on exit. Without a token, consumers whose lockfile needs the
  private registry are recorded as skipped. This run had a token.
