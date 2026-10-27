import { browser } from 'wxt/browser';
import { tabSubject } from './diagnostics';
import type { PerfReportMessage } from './messages';
import { formatPerf, isPerfSnapshot } from './perf';

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
      if (isPerfSnapshot(response)) reports.push(formatPerf(tabSubject(target.url), response));
      else reports.push(`${tabSubject(target.url)}: no Geld in this tab (nothing answered)`);
    } catch {
      // No content script in that tab at all: that is itself what a blank page needs said.
      reports.push(`${tabSubject(target.url)}: no Geld in this tab (nothing answered)`);
    }
  }
  return reports.length === 0 ? [] : [`Per-tab timings (this browser, in memory only)\n${reports.join('\n')}`];
}
