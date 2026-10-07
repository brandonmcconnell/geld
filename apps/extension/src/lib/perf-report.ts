import { browser } from 'wxt/browser';
import type { PerfReportMessage } from './messages';
import { formatPerf, isPerfSnapshot } from './perf';

/** `owner/repo#N`, `owner/repo@sha7`, or the path: enough to tell the tabs apart, never a query string. */
function tabLabel(url: string): string {
  try {
    const { pathname } = new URL(url);
    const pull = /^\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(pathname);
    if (pull !== null) return `${pull[1]}#${pull[2]}${pathname.slice(pull[0].length)}`;
    const commit = /^\/([^/]+\/[^/]+)\/commit\/([0-9a-f]+)/i.exec(pathname);
    if (commit !== null) return `${commit[1]}@${(commit[2] ?? '').slice(0, 7)}`;
    return pathname;
  } catch {
    return url;
  }
}

/**
 * Every open GitHub tab's performance snapshot (`lib/perf.ts`), formatted
 * for Copy diagnostics. A tab without the content script (open since before
 * an install) or an Enterprise host not granted simply does not answer.
 */
export async function collectTabPerf(hosts: readonly string[]): Promise<readonly string[]> {
  if (hosts.length === 0) return [];
  const targets: Array<{ readonly id: number; readonly url: string }> = [];
  try {
    const tabs = await browser.tabs.query({ url: hosts.map((host) => `https://${host}/*`), discarded: false });
    for (const tab of tabs) {
      if (tab.id !== undefined && tab.url !== undefined && tab.status !== 'unloaded') targets.push({ id: tab.id, url: tab.url });
    }
  } catch {
    return [];
  }
  const message: PerfReportMessage = { type: 'geld:perf-report' };
  const reports: string[] = [];
  for (const target of targets) {
    try {
      const response: unknown = await browser.tabs.sendMessage(target.id, message);
      if (isPerfSnapshot(response)) reports.push(formatPerf(tabLabel(target.url), response));
    } catch {
      // No content script in that tab: nothing to report for it.
    }
  }
  return reports.length === 0 ? [] : [`Per-tab timings (this browser, in memory only)\n${reports.join('\n')}`];
}
