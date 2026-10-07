import { describeBrowser } from '../ui/feedback-link';

/** Where a diagnostics report goes: the site's `/diagnostics`, which forwards to the issue form (see `apps/site/app/diagnostics/route.ts`). */
export const DIAGNOSTICS_REPORT_URL = 'https://www.geld.sh/diagnostics';

/**
 * How much of the report the link may carry, measured encoded. GitHub's
 * `issues/new` reads its form fields from the query, and the request line
 * has to stay well under the 8 KB servers commonly refuse with 414; the
 * version and browser fields and the redirect through the site take some
 * of that too.
 */
export const REPORT_URL_BUDGET = 6000;

const TRIMMED_NOTE = '(Trimmed to fit the link. The full report is on your clipboard: paste it over this.)';

/**
 * The report as the link can carry it: whole when it fits, else its newest
 * lines up to the budget under a note saying so. The header line (version
 * and event count) is kept either way, and lines are dropped from the oldest
 * end, since what just happened is what a report is usually about.
 */
export function trimReportForUrl(report: string, budget: number = REPORT_URL_BUDGET): { readonly text: string; readonly trimmed: boolean } {
  if (encodeURIComponent(report).length <= budget) return { text: report, trimmed: false };
  const lines = report.split('\n');
  const header = lines[0] ?? '';
  const rest = lines.slice(1);
  const kept: string[] = [];
  let used = encodeURIComponent(`${header}\n${TRIMMED_NOTE}\n`).length;
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const line = rest[index] ?? '';
    const cost = encodeURIComponent(`${line}\n`).length;
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(line);
  }
  return { text: [header, TRIMMED_NOTE, ...kept].join('\n'), trimmed: true };
}

/** The link that opens the issue form with the report (as trimmed) and the environment filled in. */
export function diagnosticsReportUrl(report: string, version: string, userAgent: string, platform: string): URL {
  const url = new URL(DIAGNOSTICS_REPORT_URL);
  url.searchParams.set('version', version);
  const described = describeBrowser(userAgent, platform);
  if (described !== '') url.searchParams.set('browser', described);
  url.searchParams.set('diagnostics', trimReportForUrl(report).text);
  return url;
}
