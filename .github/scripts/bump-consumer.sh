#!/usr/bin/env bash
# Bump @reflagged/shell in one consumer repo, open a PR, and merge it once its
# CI is green. A red or missing CI leaves the PR open for a human.
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

# Merge once the PR's CI is green; a red or missing CI leaves it open.
wait_and_merge() {
  local url=$1 n=0
  # Checks register a little after the push; wait for them (up to 10 min).
  for _ in $(seq 1 20); do
    n=$(gh pr view "$url" --json statusCheckRollup -q '.statusCheckRollup | length')
    [ "$n" -gt 0 ] && break
    sleep 30
  done
  if [ "$n" -eq 0 ]; then
    echo "::warning title=$repo::no CI checks on the PR; left open: $url"
    return 0
  fi
  if ! gh pr checks "$url" --watch --interval 30; then
    echo "::warning title=$repo::CI not green; PR left open: $url"
    return 0
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
