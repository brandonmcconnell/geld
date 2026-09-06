#!/usr/bin/env bash
# Fails when a change to the extension is about to land on main without a new
# version in apps/extension/package.json. That version is what WXT writes into
# the manifest and what the Release workflow tags and ships to the stores, so a
# forgotten bump would silently produce no release (and the stores reject a
# re-upload of an existing version anyway).
#
# Usage: check-extension-version.sh <base-sha> <head-sha> [pr-number]
#
# Exits 0 when:
#   - nothing under the extension's inputs changed between base and head, or
#   - the pull request carries the `no-release` label (needs GH_TOKEN), or
#   - the version changed to a higher one that has not been tagged yet.
set -euo pipefail

BASE_SHA="${1:?base sha}"
HEAD_SHA="${2:?head sha}"
PR_NUMBER="${3:-}"
PACKAGE_JSON='apps/extension/package.json'
SKIP_LABEL='no-release'

# Everything that ends up in the built extension. The site is not part of it.
RELEASE_PATHS=(apps/extension packages/core assets/brand pnpm-lock.yaml)

fail() {
  echo "::error title=Extension version not bumped::$1"
  exit 1
}

# Three dots: only what the branch adds on top of its merge base, so a branch
# that is merely behind main is not blamed for main's changes.
if git diff --quiet "$BASE_SHA...$HEAD_SHA" -- "${RELEASE_PATHS[@]}"; then
  echo "No extension files changed; version check not needed."
  exit 0
fi

if [[ -n "$PR_NUMBER" && -n "${GH_TOKEN:-}" ]]; then
  if gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' | grep -qx "$SKIP_LABEL"; then
    echo "Pull request #$PR_NUMBER is labelled '$SKIP_LABEL'; skipping the version check."
    exit 0
  fi
fi

base_version="$(git show "$BASE_SHA:$PACKAGE_JSON" | jq -r .version)"
head_version="$(git show "$HEAD_SHA:$PACKAGE_JSON" | jq -r .version)"

if [[ "$base_version" == "$head_version" ]]; then
  fail "Extension files changed but $PACKAGE_JSON is still $head_version. Run 'pnpm bump patch' (or minor/major), or add the '$SKIP_LABEL' label if this change should not ship."
fi

# `sort -V` orders version strings numerically per component.
highest="$(printf '%s\n%s\n' "$base_version" "$head_version" | sort -V | tail -n1)"
if [[ "$highest" != "$head_version" ]]; then
  fail "$PACKAGE_JSON went from $base_version to $head_version, which is lower."
fi

if git ls-remote --exit-code --tags origin "refs/tags/v$head_version" >/dev/null 2>&1; then
  fail "v$head_version has already been released; bump to a version that has no tag yet."
fi

echo "Extension version bumps $base_version -> $head_version (unreleased)."
