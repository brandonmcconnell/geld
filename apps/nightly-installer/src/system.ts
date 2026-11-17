import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { windowsExeCandidates } from './browsers';
import type { BrowserInfo, Environment } from './browsers';

/** The two things the installer does outside its folders: the clipboard, and opening a browser profile. */

const CLIPBOARD: Readonly<Record<string, ReadonlyArray<readonly [string, ...string[]]>>> = {
  darwin: [['pbcopy']],
  win32: [['powershell', '-NoProfile', '-Command', 'Set-Clipboard -Value (([System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.Encoding]::UTF8)).ReadToEnd().TrimEnd())']],
  linux: [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '--clipboard', '--input']],
};

export function copyToClipboard(text: string, platform: string): boolean {
  for (const [command, ...args] of CLIPBOARD[platform] ?? []) {
    const result = spawnSync(command, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000 });
    if (result.error === undefined && result.status === 0) return true;
  }
  return false;
}

function onPath(binary: string, env: Readonly<Record<string, string | undefined>>): string | null {
  for (const dir of (env['PATH'] ?? '').split(path.delimiter)) {
    const candidate = path.join(dir, binary);
    if (dir !== '' && existsSync(candidate)) return candidate;
  }
  return null;
}

export interface Launch {
  readonly command: string;
  readonly args: readonly string[];
  /** macOS's `open` hands the launch to the system and exits, so its exit code says whether the browser started. */
  readonly exits?: true;
}

/**
 * How to open the browser in `profile`, or null when it cannot be found. Chrome ignores a `chrome://` URL given
 * on its command line (Chrome 156 opened a new tab instead, Nov 2026), so the extensions page is left for the
 * reader to type, and the installer prints its address.
 */
export function launchFor(browser: BrowserInfo, directory: string, environment: Environment): Launch | null {
  const args = browser.rootProfile === true ? [] : [`--profile-directory=${directory}`];
  if (environment.platform === 'darwin') return { command: 'open', args: ['-na', browser.macApp, '--args', ...args], exits: true };
  if (environment.platform === 'win32') {
    const exe = windowsExeCandidates(browser, environment).find((candidate) => existsSync(candidate));
    return exe === undefined ? null : { command: exe, args };
  }
  for (const binary of browser.linuxBinaries) {
    const found = onPath(binary, environment.env);
    if (found !== null) return { command: found, args };
  }
  return null;
}

/** Starts the browser detached, so it outlives the installer, and says whether it started. */
export function open(launch: Launch): Promise<boolean> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(launch.command, [...launch.args], { detached: true, stdio: 'ignore' });
    } catch {
      resolve(false);
      return;
    }
    child.once('error', () => resolve(false));
    if (launch.exits === true) child.once('exit', (code) => resolve(code === 0));
    else child.once('spawn', () => resolve(true));
    child.unref();
  });
}
