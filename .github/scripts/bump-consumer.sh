#!/usr/bin/env bash
# Bump @reflagged/shell in one consumer repo, open a PR, and merge it unless
# the bump breaks a CI job that passes on the default branch.
#
# Usage: bump-consumer.sh <owner/repo> <version>
# Env:   GH_TOKEN (contents + pull requests write on the repo)
#        DRY_RUN=1 stops before pushing (prints the diff instead).
set -euo pipefail

repo=$1
version=$2
pkg='@reflagged/shell'
branch="chore/reflagged-shell-$version"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Failed jobs ("workflow / job") across the given workflow runs. A run that
# failed before starting any job (a broken workflow file) counts as one entry.
failed_jobs() {
  local id
  for id in "$@"; do
    gh api "repos/$repo/actions/runs/$id" -q 'select(.conclusion | IN("success", "skipped", "neutral") | not) | .name' |
      while read -r name; do
        jobs=$(gh api "repos/$repo/actions/runs/$id/jobs?per_page=100" \
          -q '.jobs[] | select(.conclusion | IN("success", "skipped", "neutral") | not) | .name')
        if [ -n "$jobs" ]; then
          printf '%s\n' "$jobs" | sed "s|^|$name / |"
        else
          echo "$name"
        fi
      done
  done | sort -u
}

# Merge once the PR is no worse than the default branch: every job that
# fails on the PR fails on the latest push to the default branch, too. Many
# consumers have a red main; holding the bump back there helps nobody, while
# a job the bump breaks still keeps the PR open. No CI at all: merge, the
# diff is package.json and the lockfile.
#
# CI is read from the Actions runs for the PR's head commit: a fine-grained
# token cannot read check runs (there is no Checks permission for it), but
# "Actions: read" covers the workflow runs every consumer's CI is made of.
wait_and_merge() {
  local url=$1 sha runs pending pr_failed main_failed regressions default
  sha=$(gh pr view "$url" --json headRefOid -q .headRefOid)
  runs="repos/$repo/actions/runs?head_sha=$sha&per_page=100"
  # Runs register a little after the push; wait for them (up to 10 min).
  for _ in $(seq 1 20); do
    [ "$(gh api "$runs" -q '.workflow_runs | length')" -gt 0 ] && break
    sleep 30
  done
  if [ "$(gh api "$runs" -q '.workflow_runs | length')" -gt 0 ]; then
    # Then until every run has finished (up to 75 min).
    for _ in $(seq 1 150); do
      pending=$(gh api "$runs" -q '[.workflow_runs[] | select(.status != "completed")] | length')
      [ "$pending" -eq 0 ] && break
      sleep 30
    done
    if [ "$pending" -ne 0 ]; then
      echo "::warning title=$repo::CI still running after 75 min; PR left open: $url"
      return 0
    fi
    pr_failed=$(failed_jobs $(gh api "$runs" -q '.workflow_runs[].id'))
    if [ -n "$pr_failed" ]; then
      default=$(gh api "repos/$repo" -q .default_branch)
      main_failed=$(failed_jobs $(gh api "repos/$repo/actions/runs?branch=$default&event=push&status=completed&per_page=50" \
        -q '.workflow_runs | group_by(.name) | map(max_by(.created_at)) | .[].id'))
      regressions=$(comm -23 <(printf '%s\n' "$pr_failed") <(printf '%s\n' "$main_failed"))
      if [ -n "$regressions" ]; then
        echo "::warning title=$repo::the bump breaks: $(echo "$regressions" | paste -sd ',' -); PR left open: $url"
        return 0
      fi
      echo "$repo: fails only what $default fails already: $(echo "$pr_failed" | paste -sd ',' -)"
    fi
  else
    echo "$repo: no CI runs for the PR; merging the dependency bump."
  fi
  if gh pr merge "$url" --squash --delete-branch; then
    echo "Merged $url"
  else
    echo "::warning title=$repo::merge refused (branch protection?); PR left open: $url"
  fi
}

if [ -z "${DRY_RUN:-}" ]; then
  state=$(gh pr list -R "$repo" --head "$branch" --state all --json state,url -q '.[0] | "\(.state) \(.url)"')
  case "$state" in
    MERGED*) echo "$repo: $branch is merged already."; exit 0 ;;
    OPEN*) echo "$repo: resuming ${state#OPEN }"; wait_and_merge "${state#OPEN }"; exit 0 ;;
    CLOSED*) echo "$repo: $branch was closed by hand, leaving it."; exit 0 ;;
  esac
fi

git clone --quiet --depth 1 "https://x-access-token:${GH_TOKEN}@github.com/$repo.git" "$work/repo"
cd "$work/repo"

spec=$(node -p "const p=require('./package.json'); (p.dependencies||{})['$pkg'] || (p.devDependencies||{})['$pkg'] || ''")
if [ -z "$spec" ]; then
  echo "$repo does not depend on $pkg in its root package.json, skipping."
  exit 0
fi

locked_at_version() {
  if [ -f pnpm-lock.yaml ]; then
    grep -qE "^  '?$pkg@$version[(':]" pnpm-lock.yaml
  elif [ -f package-lock.json ]; then
    node -e "process.exit(require('./package-lock.json').packages?.['node_modules/$pkg']?.version === '$version' ? 0 : 1)"
  else
    return 1
  fi
}
if locked_at_version; then
  echo "$repo is already on $pkg $version."
  exit 0
fi

if [ -f pnpm-lock.yaml ]; then
  # Some repos run Prettier over the lockfile; pnpm would rewrite all of it.
  prettier_lock=$(grep -qE '^    resolution:$' pnpm-lock.yaml && echo 1 || true)
  # The repo's own pnpm, so the lockfile keeps its format.
  pm=$(node -p "const v=require('./package.json').packageManager||''; v.startsWith('pnpm@') ? v.split('+')[0] : 'pnpm@9'")
  npx --yes "$pm" update "$pkg@^$version" --lockfile-only --ignore-scripts
  if [ -n "$prettier_lock" ]; then
    # The repo's Prettier options without its plugins (not installed here).
    node -e "
      const fs = require('fs')
      let cfg = {}
      for (const f of ['.prettierrc', '.prettierrc.json']) if (fs.existsSync(f)) cfg = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (!Object.keys(cfg).length) cfg = require('./package.json').prettier || {}
      delete cfg.plugins
      fs.writeFileSync('$work/prettier.json', JSON.stringify(cfg))
    "
    npx --yes prettier@3 --config "$work/prettier.json" --write pnpm-lock.yaml >/dev/null
  fi
elif [ -f package-lock.json ]; then
  npm install "$pkg@^$version" --package-lock-only --ignore-scripts --no-audit --no-fund
else
  echo "$repo has no lockfile; installs already resolve the newest $spec. Skipping."
  exit 0
fi

if git diff --quiet; then
  echo "$repo is already on $pkg $version."
  exit 0
fi

git diff --stat
if [ -n "${DRY_RUN:-}" ]; then
  git diff -- package.json
  echo "DRY_RUN: not pushing."
  exit 0
fi

git config user.name 'reflagged-shell-bot'
git config user.email 'shell-bot@rfl.gd'
git switch --quiet -c "$branch"
git commit --quiet -am "chore(deps): $pkg $version"
git push --quiet origin "$branch"

url=$(gh pr create -R "$repo" --head "$branch" \
  --title "chore(deps): $pkg $version" \
  --body "Automatic bump from the [$pkg $version](https://github.com/rfl-gd/rflgd-shell/releases/tag/v$version) release. Merged automatically once CI is green; running instances update via Base → Plattform → Updates.")
echo "Opened $url"

wait_and_merge "$url"
