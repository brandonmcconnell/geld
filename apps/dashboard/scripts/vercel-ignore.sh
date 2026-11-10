#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the dashboard (Root Directory: apps/dashboard).
#
# Exit 0 = skip the build, exit 1 = build. We build whenever something the
# dashboard builds from changed since the LAST SUCCESSFUL DEPLOYMENT of this
# branch: its own sources, the workspace packages it imports (@geld/core,
# domain, github, providers, relay, review, ui), or the workspace/lockfile.
# Commits that touch none of them (the extension, the site, docs) are skipped.
# Keep DASHBOARD_PATHS in step with the @geld/* dependencies in package.json.
#
# Vercel provides the previous deployment's commit as VERCEL_GIT_PREVIOUS_SHA.
# Comparing against HEAD^ instead would skip a build whenever the newest
# commit happened to touch only other apps, even if the dashboard had never deployed.
set -euo pipefail

cd "$(dirname "$0")/../../.."

DASHBOARD_PATHS=(
  apps/dashboard
  packages/core
  packages/domain
  packages/github
  packages/providers
  packages/relay
  packages/review
  packages/ui
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
)

PREVIOUS="${VERCEL_GIT_PREVIOUS_SHA:-}"

# No successful deployment to compare with (the dashboard had none for a long while): a branch other than main
# is compared with where it left main instead, so a pull request that leaves the dashboard alone still skips.
if [[ -z "$PREVIOUS" && "${VERCEL_GIT_COMMIT_REF:-}" != "main" && -n "${VERCEL_GIT_COMMIT_REF:-}" ]]; then
  if git fetch --quiet --deepen=200 origin 2>/dev/null && git fetch --quiet --depth=200 origin main 2>/dev/null; then
    PREVIOUS="$(git merge-base FETCH_HEAD HEAD 2>/dev/null || true)"
  fi
fi

if [[ -z "$PREVIOUS" ]]; then
  echo "No previous successful deployment for this branch, and no base on main to compare with; building."
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

if git diff --quiet "$PREVIOUS" HEAD -- "${DASHBOARD_PATHS[@]}"; then
  echo "No dashboard-relevant changes since ${PREVIOUS}; skipping build."
  exit 0
fi

echo "Dashboard-relevant changes since ${PREVIOUS}; building."
exit 1
