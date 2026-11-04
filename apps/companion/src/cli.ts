#!/usr/bin/env node
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, isAbsolute, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { pollConnector } from '@geld/relay';
import { pairingSchema } from './config';
import { savePairing } from './storage';
import { sdkEngine, companionHandler, claudeEnvironment } from './engine';
const folder = join(homedir(), '.config', 'geld');
const configFile = join(folder, 'companion.json');
async function installedClaude(): Promise<string> {
  const selected = process.env.GELD_CLAUDE_EXECUTABLE;
  if (selected) {
    if (!isAbsolute(selected)) throw new Error('GELD_CLAUDE_EXECUTABLE must be an absolute path');
    await access(selected, constants.X_OK);
    return selected;
  }
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    if (!folder || !isAbsolute(folder)) continue;
    const candidate = join(folder, process.platform === 'win32' ? 'claude.exe' : 'claude');
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* Try the next installed executable. */
    }
  }
  throw new Error('Install Claude Code first or set GELD_CLAUDE_EXECUTABLE to its absolute path');
}
async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'pair') {
    const file = process.argv[3];
    if (!file) throw new Error('Usage: geld-companion pair /path/to/geld-companion.json');
    const raw = await readFile(file, 'utf8');
    if (raw.length > 10000) throw new Error('Invalid pairing file');
    const config = pairingSchema.parse(JSON.parse(raw));
    await savePairing(folder, config);
    process.stdout.write('Companion paired. Remove the downloaded pairing file, then run geld-companion serve.\n');
    return;
  }
  if (command === 'login') {
    const executable = await installedClaude();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ['auth', 'login'], {
        stdio: 'inherit',
        env: claudeEnvironment(process.env),
        shell: false,
      });
      child.once('error', reject);
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Claude sign-in did not complete'))));
    });
    return;
  }
  if (command === 'serve') {
    const config = pairingSchema.parse(JSON.parse(await readFile(configFile, 'utf8')));
    const executable = await installedClaude();
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort());
    process.once('SIGTERM', () => abort.abort());
    process.stdout.write('Companion connected through the outbound relay. Press Ctrl+C to stop.\n');
    await pollConnector(
      { url: config.brokerUrl, channel: config.channel, secret: config.secret },
      'claude.local.geld.invalid',
      companionHandler(sdkEngine(executable)),
      abort.signal,
      'claude',
    );
    return;
  }
  process.stdout.write('Usage: geld-companion pair FILE | login | serve\n');
}
void main().catch((error) => {
  process.stderr.write(
    error instanceof Error && error.message.startsWith('Install Claude')
      ? `${error.message}\n`
      : 'The companion could not start. Check the pairing file, installed Claude executable and sign-in.\n',
  );
  process.exitCode = 1;
});
