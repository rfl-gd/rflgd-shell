#!/usr/bin/env bash
# Verify that every local consumer installs, typechecks and builds against the packed shell.
#
# Consumer checkouts are never modified: each one is copied into $WORK_DIR and the
# packed tarball is installed into the copy. A step that fails with the tarball is
# re-run on a fresh copy with the consumer's current shell (its lockfile) to tell
# regressions from pre-existing failures.
#
# Usage: scripts/verify-consumers.sh [--clean] [consumer ...]
#        Consumers default to scripts/consumers.txt; a workspace app is <root>:<app-subdir>.
#        --clean removes the consumer copies when the run ends (logs and results stay).
# Env:   DEV_ROOT (default ~/Development), WORK_DIR (default $TMPDIR/shell-consumers),
#        TARBALL (skip build+pack and use this tarball),
#        GITHUB_TOKEN (for consumers whose lockfile pulls private packages from GitHub
#        Packages; USE_GH_TOKEN=1 takes it from `gh auth token` instead). It reaches pnpm
#        only through a temporary user config, and as GITHUB_TOKEN only for the install
#        commands of consumers whose .npmrc expands it. Without a token those consumers
#        are recorded as skipped.
# Output: a table of every consumer with a result in $WORK_DIR/results (re-running a subset
#        keeps the other rows); logs per consumer and step in $WORK_DIR/logs.
# Exit:  1 when a step of this run fails with the tarball but passes with the current shell.
set -euo pipefail
umask 077

SHELL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_ROOT="${DEV_ROOT:-$HOME/Development}"
WORK_DIR="${WORK_DIR:-${TMPDIR:-/tmp}/shell-consumers}"
DEFAULT_PNPM="pnpm@9.15.0"
LOG_DIR="$WORK_DIR/logs"
RESULT_DIR="$WORK_DIR/results"
PRIVATE_REGISTRY="npm.pkg.github.com"

CLEAN=0
if [[ "${1:-}" == --clean ]]; then
  CLEAN=1
  shift
fi

USERCONFIG=""
cleanup() {
  if [[ -n "$USERCONFIG" ]]; then rm -f "$USERCONFIG"; fi
  if ((CLEAN)); then rm -rf "$WORK_DIR/v2" "$WORK_DIR/baseline"; fi
}
trap cleanup EXIT

mkdir -p "$LOG_DIR" "$RESULT_DIR"
chmod 700 "$WORK_DIR"

token="${GITHUB_TOKEN:-}"
if [[ -z "$token" && "${USE_GH_TOKEN:-0}" == 1 ]]; then
  token="$(gh auth token 2>/dev/null || true)"
fi
if [[ -n "$token" ]]; then
  USERCONFIG="$(mktemp)"
  { cat "$HOME/.npmrc" 2>/dev/null || true; echo; echo "//$PRIVATE_REGISTRY/:_authToken=$token"; } >"$USERCONFIG"
fi

# The consumer's own pnpm when its root package.json pins one, otherwise the default.
pnpm_for() { # <root>
  local spec
  spec="$(node -e 'const p=require(process.argv[1]);const m=p.packageManager||"";console.log(m.startsWith("pnpm@")?m.split("+")[0]:"")' "$1/package.json")" \
    || return 1
  echo "${spec:-$DEFAULT_PNPM}"
}

run_pnpm() { # <pnpm spec> <dir> <log> <args...>
  local spec="$1" dir="$2" log="$3"
  shift 3
  (cd "$dir" && CI=1 npx --yes "$spec" "$@") >>"$log" 2>&1
}

# Like run_pnpm, but with registry credentials when there is a token.
install_pnpm() { # <copy root> <pnpm spec> <dir> <log> <args...>
  local root="$1"
  shift
  local auth=()
  if [[ -n "$USERCONFIG" ]]; then
    auth+=("NPM_CONFIG_USERCONFIG=$USERCONFIG")
    # shellcheck disable=SC2016 # matches the literal reference in .npmrc
    if grep -qs '${GITHUB_TOKEN}' "$root/.npmrc"; then auth+=("GITHUB_TOKEN=$token"); fi
  fi
  if ((${#auth[@]})); then
    (export "${auth[@]}" && run_pnpm "$@")
  else
    run_pnpm "$@"
  fi
}

# Copies <root> into <dest> without git data, build output, installed dependencies or git
# worktrees nested inside the checkout (they are other branches, not this app).
fresh_copy() { # <src root> <dest> <app subdir or empty>
  local src="$1" dest="$2" sub="$3" excludes=() git_entry dir
  for dir in "" ${sub:+"/$sub"}; do
    excludes+=(--exclude "$dir/dist" --exclude "$dir/.next" --exclude "$dir/.turbo")
  done
  while IFS= read -r git_entry; do
    excludes+=(--exclude "/$(dirname "${git_entry#"$src"/}")")
  done < <(find "$src" -mindepth 2 -maxdepth 4 -name .git -not -path '*/node_modules/*')
  rm -rf "$dest" && mkdir -p "$dest" || return 1
  rsync -a --safe-links --exclude .git --exclude node_modules "${excludes[@]}" "$src/" "$dest/"
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

# Verifies one consumer and writes its result row. Runs in an `if` (so errexit is off):
# every command that can fail checks its own status.
run_consumer() { # <entry> <result file>
  local entry="$1" result_file="$2" root sub="" label key src spec copy app base base_app
  local install typecheck build baseline="" step result
  root="${entry%%:*}"
  if [[ "$entry" == *:* ]]; then sub="${entry#*:}"; fi
  label="${root}${sub:+/$sub}"
  key="${label//\//_}"
  src="$DEV_ROOT/$root"

  if [[ ! -f "$src/${sub:+$sub/}package.json" ]]; then
    printf '%s\tmissing\tmissing\tmissing\t\n' "$label" >"$result_file"
    return 0
  fi
  if ! grep -q '"@reflagged/shell"' "$src/${sub:+$sub/}package.json"; then
    printf '%s\tn/a\tn/a\tn/a\t\n' "$label" >"$result_file"
    return 0
  fi
  if [[ -z "$token" ]] && grep -qs "$PRIVATE_REGISTRY" "$src/pnpm-lock.yaml"; then
    printf '%s\tskipped (no token)\tskipped (no token)\tskipped (no token)\t\n' "$label" >"$result_file"
    return 0
  fi

  spec="$(pnpm_for "$src")" || return 1
  copy="$WORK_DIR/v2/$key"
  app="$copy${sub:+/$sub}"
  fresh_copy "$src" "$copy" "$sub" || return 1
  for step in install typecheck build; do : >"$LOG_DIR/$key-$step.log"; done

  # `add` links only the project it runs in, so workspaces are re-installed from the
  # root to link their other packages.
  if install_pnpm "$copy" "$spec" "$app" "$LOG_DIR/$key-install.log" \
    add --ignore-workspace-root-check "@reflagged/shell@file:$TARBALL" \
    && { [[ ! -f "$copy/pnpm-workspace.yaml" ]] \
      || install_pnpm "$copy" "$spec" "$copy" "$LOG_DIR/$key-install.log" install --no-frozen-lockfile; }; then
    install=pass
    typecheck="$(run_step typecheck "$spec" "$app" "$LOG_DIR/$key-typecheck.log")"
    build="$(run_step build "$spec" "$app" "$LOG_DIR/$key-build.log")"
  else
    install=fail
    typecheck="not run"
    build="not run"
  fi

  if [[ "$install" == fail || "$typecheck" == fail || "$build" == fail ]]; then
    base="$WORK_DIR/baseline/$key"
    base_app="$base${sub:+/$sub}"
    fresh_copy "$src" "$base" "$sub" || return 1
    : >"$LOG_DIR/$key-baseline-install.log"
    if install_pnpm "$base" "$spec" "$base_app" "$LOG_DIR/$key-baseline-install.log" install --frozen-lockfile \
      || install_pnpm "$base" "$spec" "$base_app" "$LOG_DIR/$key-baseline-install.log" install --no-frozen-lockfile; then
      if [[ "$install" == fail ]]; then
        baseline="install pass (REGRESSION)"
      fi
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

  printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$install" "$typecheck" "$build" "$baseline" >"$result_file"
  echo "    install=$install typecheck=$typecheck build=$build${baseline:+ baseline: $baseline}"
}

if [[ -z "${TARBALL:-}" ]]; then
  echo "==> building and packing @reflagged/shell"
  (cd "$SHELL_ROOT" && npx --yes "$DEFAULT_PNPM" build && npx --yes "$DEFAULT_PNPM" pack --pack-destination "$WORK_DIR") \
    >"$LOG_DIR/shell-pack.log" 2>&1 || { echo "build/pack failed, see $LOG_DIR/shell-pack.log"; exit 2; }
  TARBALL="$WORK_DIR/reflagged-shell-$(node -p 'require(process.argv[1]).version' "$SHELL_ROOT/package.json").tgz"
  [[ -f "$TARBALL" ]] || { echo "no tarball at $TARBALL"; exit 2; }
fi
echo "==> tarball: $TARBALL"

consumers=()
if [[ $# -gt 0 ]]; then
  consumers=("$@")
else
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "$line" | xargs)"
    if [[ -n "$line" ]]; then consumers+=("$line"); fi
  done <"$SHELL_ROOT/scripts/consumers.txt"
fi

run_files=()
for entry in "${consumers[@]}"; do
  label="${entry/://}"
  result_file="$RESULT_DIR/${label//\//_}.tsv"
  run_files+=("$result_file")
  echo "==> $label"
  setup_log="$LOG_DIR/${label//\//_}-setup.log"
  if ! run_consumer "$entry" "$result_file" 2>"$setup_log"; then
    printf '%s\terror\terror\terror\tsetup failed, see %s\n' "$label" "${setup_log##*/}" >"$result_file"
    echo "    error, see $setup_log"
  fi
done

echo
echo "| consumer | install 2.0 | typecheck 2.0 | build 2.0 | baseline (only for failures) |"
echo "|---|---|---|---|---|"
while IFS=$'\t' read -r label install typecheck build baseline; do
  echo "| $label | $install | $typecheck | $build | ${baseline:--} |"
done < <(cat "$RESULT_DIR"/*.tsv)
echo
echo "logs: $LOG_DIR"

regressions="$(cat "${run_files[@]}" | { grep -o REGRESSION || true; } | wc -l | tr -d ' ')"
if ((regressions > 0)); then
  echo "$regressions regression(s) against the current shell"
  exit 1
fi
