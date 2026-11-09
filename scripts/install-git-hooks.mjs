// `core.hooksPath` is left alone: Cursor's cloud agents point it at their own dispatcher, which still runs the hook in
// `.git/hooks`, so a hook there serves them and everyone else. Someone else's pre-commit hook is never replaced.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MARK = '# geld: hands off to .githooks/pre-commit';
const SHIM = `#!/bin/sh
${MARK} (installed by scripts/install-git-hooks.mjs on pnpm install)
hook="$(git rev-parse --show-toplevel)/.githooks/pre-commit"
[ -f "$hook" ] || exit 0
exec sh "$hook" "$@"
`;

let commonDir;
try {
  commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  process.exit(0);
}

const hooks = resolve(commonDir, 'hooks');
const target = join(hooks, 'pre-commit');
if (existsSync(target) && !readFileSync(target, 'utf8').includes(MARK)) process.exit(0);

mkdirSync(hooks, { recursive: true });
writeFileSync(target, SHIM);
chmodSync(target, 0o755);
