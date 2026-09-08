#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the site (Root Directory: apps/site).
#
# Exit 0 = skip the build, exit 1 = build. We build whenever something the
# site renders from changed since the LAST SUCCESSFUL DEPLOYMENT of this
# branch: its own sources, @geld/core (the patterns page and the demo matcher
# come from it), the extension's package.json (the version shown on the site),
# the brand assets and screenshots, or the workspace/lockfile. Commits that only change the
# extension itself are skipped.
#
# Vercel provides the previous deployment's commit as VERCEL_GIT_PREVIOUS_SHA.
# Comparing against HEAD^ instead would skip a build whenever the newest
# commit happened to be extension-only, even if the site had never deployed.
set -euo pipefail

cd "$(dirname "$0")/../../.."

SITE_PATHS=(
  apps/site
  packages/core
  apps/extension/package.json
  assets/brand
  assets/screenshots
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
)

PREVIOUS="${VERCEL_GIT_PREVIOUS_SHA:-}"

if [[ -z "$PREVIOUS" ]]; then
  echo "No previous successful deployment for this branch; building."
  exit 1
fi

if [[ "$PREVIOUS" == "$(git rev-parse HEAD)" ]]; then
  echo "HEAD is already the deployed commit (redeploy); building."
  exit 1
fi

# Vercel clones shallowly; make sure the previous commit is available before
# trusting a diff against it. If we cannot see it, err on the side of building.
if ! git cat-file -e "${PREVIOUS}^{commit}" 2>/dev/null; then
  if ! git fetch --quiet --deepen=50 origin 2>/dev/null || ! git cat-file -e "${PREVIOUS}^{commit}" 2>/dev/null; then
    echo "Previous deployment ${PREVIOUS} is not in the clone; building."
    exit 1
  fi
fi

if git diff --quiet "$PREVIOUS" HEAD -- "${SITE_PATHS[@]}"; then
  echo "No site-relevant changes since deployed commit ${PREVIOUS}; skipping build."
  exit 0
fi

echo "Site-relevant changes since ${PREVIOUS}; building."
exit 1
