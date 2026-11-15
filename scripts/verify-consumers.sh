#!/usr/bin/env bash
# Verify that every local consumer typechecks and builds against the packed shell.
#
# Consumer checkouts are never modified: each one is copied into $WORK_DIR and the
# packed tarball is installed into the copy. A step that fails with the tarball is
# re-run on a fresh copy with the consumer's current shell (its lockfile) to tell
# regressions from pre-existing failures.
#
# Usage: scripts/verify-consumers.sh [consumer ...]
#        Consumers default to scripts/consumers.txt; a workspace app is <root>:<app-subdir>.
# Env:   DEV_ROOT (default ~/Development), WORK_DIR (default $TMPDIR/shell-consumers),
#        TARBALL (skip build+pack and use this tarball),
#        GITHUB_TOKEN (private @rfl-gd packages; falls back to `gh auth token`, and reaches
#        pnpm only through a temporary user config removed on exit)
# Output: a table of every consumer with a result in $WORK_DIR/results (re-running a subset
#        keeps the other rows); logs per consumer and step in $WORK_DIR/logs.
# Exit:  1 when a step fails with the tarball but passes with the current shell.
set -euo pipefail

SHELL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_ROOT="${DEV_ROOT:-$HOME/Development}"
WORK_DIR="${WORK_DIR:-${TMPDIR:-/tmp}/shell-consumers}"
DEFAULT_PNPM="pnpm@9.15.0"
LOG_DIR="$WORK_DIR/logs"
RESULT_DIR="$WORK_DIR/results"

mkdir -p "$LOG_DIR" "$RESULT_DIR"

if [[ -z "${GITHUB_TOKEN:-}" ]] && command -v gh >/dev/null; then
  GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
fi
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  export GITHUB_TOKEN
  NPM_CONFIG_USERCONFIG="$(mktemp)"
  export NPM_CONFIG_USERCONFIG
  trap 'rm -f "$NPM_CONFIG_USERCONFIG"' EXIT
  chmod 600 "$NPM_CONFIG_USERCONFIG"
  { cat "$HOME/.npmrc" 2>/dev/null || true; echo; echo "//npm.pkg.github.com/:_authToken=$GITHUB_TOKEN"; } \
    >"$NPM_CONFIG_USERCONFIG"
fi

# The consumer's own pnpm when its root package.json pins one, otherwise the default.
pnpm_for() {
  local spec
  spec="$(node -e 'const p=require(process.argv[1]);const m=p.packageManager||"";console.log(m.startsWith("pnpm@")?m.split("+")[0]:"")' "$1/package.json")"
  echo "${spec:-$DEFAULT_PNPM}"
}

run_pnpm() { # <pnpm spec> <dir> <log> <args...>
  local spec="$1" dir="$2" log="$3"
  shift 3
  (cd "$dir" && CI=1 npx --yes "$spec" "$@") >>"$log" 2>&1
}

# Copies <root> into <dest> without build output, installed dependencies or git
# worktrees nested inside the checkout (they are other branches, not this app).
fresh_copy() { # <src root> <dest>
  local nested=()
  while IFS= read -r git_entry; do
    nested+=(--exclude "/$(dirname "${git_entry#"$1"/}")")
  done < <(find "$1" -mindepth 2 -maxdepth 4 -name .git -not -path '*/node_modules/*')
  rm -rf "$2"
  mkdir -p "$2"
  rsync -a --exclude node_modules --exclude .next --exclude dist --exclude .turbo ${nested[@]+"${nested[@]}"} "$1/" "$2/"
}

# Runs one verification step; prints pass, fail or skipped.
run_step() { # <step> <pnpm spec> <app dir> <log>
  local step="$1" spec="$2" app="$3" log="$4"
  case "$step" in
    typecheck)
      [[ -f "$app/tsconfig.json" ]] || { echo skipped; return; }
      run_pnpm "$spec" "$app" "$log" exec tsc --noEmit && echo pass || echo fail
      ;;
    build)
      [[ -f "$app/.env" ]] || { echo skipped; return; }
      run_pnpm "$spec" "$app" "$log" run build && echo pass || echo fail
      ;;
  esac
}

if [[ -z "${TARBALL:-}" ]]; then
  echo "==> building and packing @reflagged/shell"
  (cd "$SHELL_ROOT" && npx --yes "$DEFAULT_PNPM" build && npx --yes "$DEFAULT_PNPM" pack --pack-destination "$WORK_DIR") \
    >"$LOG_DIR/shell-pack.log" 2>&1 || { echo "build/pack failed, see $LOG_DIR/shell-pack.log"; exit 2; }
  TARBALL="$(ls -t "$WORK_DIR"/reflagged-shell-*.tgz | head -1)"
fi
echo "==> tarball: $TARBALL"

if [[ $# -gt 0 ]]; then
  consumers=("$@")
else
  consumers=()
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    [[ -n "$line" ]] && consumers+=("$line")
  done <"$SHELL_ROOT/scripts/consumers.txt"
fi


for entry in "${consumers[@]}"; do
  root="${entry%%:*}"
  sub=""
  [[ "$entry" == *:* ]] && sub="${entry#*:}"
  label="${root}${sub:+/$sub}"
  key="${label//\//_}"
  src="$DEV_ROOT/$root"
  echo "==> $label"

  result_file="$RESULT_DIR/$key.tsv"
  if [[ ! -f "$src/${sub:+$sub/}package.json" ]]; then
    printf '%s\tmissing\tmissing\t\n' "$label" >"$result_file"
    continue
  fi
  if ! grep -q '"@reflagged/shell"' "$src/${sub:+$sub/}package.json"; then
    printf '%s\tn/a\tn/a\t\n' "$label" >"$result_file"
    continue
  fi

  copy="$WORK_DIR/v2/$key"
  app="$copy${sub:+/$sub}"
  spec="$(pnpm_for "$src")"
  fresh_copy "$src" "$copy"
  : >"$LOG_DIR/$key-install.log"
  : >"$LOG_DIR/$key-typecheck.log"
  : >"$LOG_DIR/$key-build.log"

  # `add` links only the project it runs in, so workspaces are re-installed from the
  # root to link their other packages.
  if run_pnpm "$spec" "$app" "$LOG_DIR/$key-install.log" add --ignore-workspace-root-check "@reflagged/shell@file:$TARBALL" \
    && { [[ ! -f "$copy/pnpm-workspace.yaml" ]] || run_pnpm "$spec" "$copy" "$LOG_DIR/$key-install.log" install --no-frozen-lockfile; }; then
    typecheck="$(run_step typecheck "$spec" "$app" "$LOG_DIR/$key-typecheck.log")"
    build="$(run_step build "$spec" "$app" "$LOG_DIR/$key-build.log")"
  else
    typecheck="fail"
    build="fail"
    echo "install failed, see $LOG_DIR/$key-install.log" | tee -a "$LOG_DIR/$key-typecheck.log" >>"$LOG_DIR/$key-build.log"
  fi

  baseline=""
  if [[ "$typecheck" == fail || "$build" == fail ]]; then
    base="$WORK_DIR/baseline/$key"
    base_app="$base${sub:+/$sub}"
    fresh_copy "$src" "$base"
    : >"$LOG_DIR/$key-baseline-install.log"
    if run_pnpm "$spec" "$base_app" "$LOG_DIR/$key-baseline-install.log" install --frozen-lockfile \
      || run_pnpm "$spec" "$base_app" "$LOG_DIR/$key-baseline-install.log" install --no-frozen-lockfile; then
      for step in typecheck build; do
        [[ "${!step}" == fail ]] || continue
        : >"$LOG_DIR/$key-baseline-$step.log"
        result="$(run_step "$step" "$spec" "$base_app" "$LOG_DIR/$key-baseline-$step.log")"
        baseline+="${baseline:+, }$step $result"
        if [[ "$result" == pass ]]; then baseline+=" (REGRESSION)"; fi
      done
    else
      baseline="install fail"
    fi
  fi

  printf '%s\t%s\t%s\t%s\n' "$label" "$typecheck" "$build" "$baseline" >"$result_file"
  echo "    typecheck=$typecheck build=$build${baseline:+ baseline: $baseline}"
done

echo
echo "| consumer | typecheck 2.0 | build 2.0 | baseline (only for failures) |"
echo "|---|---|---|---|"
while IFS=$'\t' read -r label typecheck build baseline; do
  echo "| $label | $typecheck | $build | ${baseline:--} |"
done < <(cat "$RESULT_DIR"/*.tsv)
echo
echo "logs: $LOG_DIR"

regressions="$(cat "$RESULT_DIR"/*.tsv | { grep -o REGRESSION || true; } | wc -l | tr -d ' ')"
if ((regressions > 0)); then
  echo "$regressions regression(s) against the current shell"
  exit 1
fi
