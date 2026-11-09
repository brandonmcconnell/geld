#!/bin/sh
# Installs Geld Nightly for the browser profiles you pick: curl -fsSL https://www.geld.sh/nightly.sh | sh
# It downloads the installer from Geld's latest GitHub release, checks it against the SHA-256 published
# beside it, and runs it with Node.js. Options go after `sh -s --`, for example `| sh -s -- --all`.
set -eu

base="https://github.com/brandonmcconnell/geld/releases/latest/download"

if ! command -v node >/dev/null 2>&1; then
  echo "Geld's installer needs Node.js 20 or newer: https://nodejs.org" >&2
  exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 20 ]; then
  echo "Geld's installer needs Node.js 20 or newer. This is $(node -v)." >&2
  exit 1
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
curl -fsSL "$base/geld-nightly.mjs" -o "$dir/geld-nightly.mjs"
curl -fsSL "$base/geld-nightly.mjs.sha256" -o "$dir/geld-nightly.mjs.sha256"

expected=$(cut -d' ' -f1 < "$dir/geld-nightly.mjs.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$dir/geld-nightly.mjs" | cut -d' ' -f1)
else
  actual=$(shasum -a 256 "$dir/geld-nightly.mjs" | cut -d' ' -f1)
fi
if [ "$expected" != "$actual" ]; then
  echo "The installer does not match its published checksum, so it was not run." >&2
  exit 1
fi

# Piped into sh, standard input is this script: the installer's questions read the terminal instead.
# A session with no controlling terminal (CI, ssh without -t) can still list a readable /dev/tty that fails to
# open, so the terminal is tried, not just tested, and without one the installer runs on its own defaults.
if [ -t 0 ] || ! (exec </dev/tty) 2>/dev/null; then
  node "$dir/geld-nightly.mjs" "$@"
else
  node "$dir/geld-nightly.mjs" "$@" < /dev/tty
fi
