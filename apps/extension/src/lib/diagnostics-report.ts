import { describeBrowser } from '../ui/feedback-link';

/**
 * Where a diagnostics report goes: GitHub's new-issue page for the
 * repository, with the `diagnostics.yml` form. Straight to GitHub, not
 * through the site as the Feedback link goes: the report names pull
 * requests (`owner/repo#N`, private ones included), and the link carries it
 * in the query, so the only host that sees it is the one the issue is
 * submitted to, and only when the reader opens the form.
 */
export const DIAGNOSTICS_REPORT_URL = 'https://github.com/brandonmcconnell/geld/issues/new?template=diagnostics.yml';

/**
 * How much of the report the link may carry, measured encoded. GitHub's
 * `issues/new` reads its form fields from the query, and the request line
 * has to stay well under the 8 KB servers commonly refuse with 414; the
 * template, version and browser fields take some of that too.
 */
export const REPORT_URL_BUDGET = 6000;

/** Said at the top of a trimmed report, by whether the whole one made it to the clipboard. */
const TRIMMED_NOTES = {
  clipboard: '(Trimmed to fit the link. The full report is on your clipboard: paste it over this.)',
  noClipboard: '(Trimmed to fit the link. For the full report, press "Copy diagnostics" on the options page and paste it over this.)',
} as const;

/**
 * The report as the link can carry it: whole when it fits, else its newest
 * lines up to the budget under a note saying so. The header line (version
 * and event count) is kept either way, and lines are dropped from the oldest
 * end, since what just happened is what a report is usually about. The note
 * says where the rest is: on the clipboard when the copy succeeded, else
 * behind Copy diagnostics, so it never promises a paste that is not there.
 */
export function trimReportForUrl(report: string, budget: number = REPORT_URL_BUDGET, onClipboard = true): { readonly text: string; readonly trimmed: boolean } {
  if (encodeURIComponent(report).length <= budget) return { text: report, trimmed: false };
  const note = onClipboard ? TRIMMED_NOTES.clipboard : TRIMMED_NOTES.noClipboard;
  const lines = report.split('\n');
  const header = lines[0] ?? '';
  const rest = lines.slice(1);
  const kept: string[] = [];
  let used = encodeURIComponent(`${header}\n${note}\n`).length;
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const line = rest[index] ?? '';
    const cost = encodeURIComponent(`${line}\n`).length;
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(line);
  }
  return { text: [header, note, ...kept].join('\n'), trimmed: true };
}

/** The link that opens the issue form with the report (as trimmed) and the environment filled in. */
export function diagnosticsReportUrl(report: string, version: string, userAgent: string, platform: string, onClipboard = true): URL {
  const url = new URL(DIAGNOSTICS_REPORT_URL);
  url.searchParams.set('version', version);
  const described = describeBrowser(userAgent, platform);
  if (described !== '') url.searchParams.set('browser', described);
  url.searchParams.set('diagnostics', trimReportForUrl(report, REPORT_URL_BUDGET, onClipboard).text);
  return url;
}
