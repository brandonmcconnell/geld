#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the site (Root Directory: apps/site).
#
# Exit 0 = skip the build, exit 1 = build. We build whenever a commit touches
# something the site renders from: its own sources, @geld/core (the patterns
# page and the demo matcher come from it), the extension's package.json (the
# version shown on the site), the brand assets, or the workspace/lockfile.
# Commits that only change the extension itself are skipped.
set -euo pipefail

cd "$(dirname "$0")/../../.."

# First deployment or shallow clone without a parent: always build.
if ! git rev-parse --verify --quiet HEAD^ >/dev/null; then
  echo "No previous commit available; building."
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- \
  apps/site \
  packages/core \
  apps/extension/package.json \
  assets/brand \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml; then
  echo "No site-relevant changes since the previous commit; skipping build."
  exit 0
fi

echo "Site-relevant changes detected; building."
exit 1
