import { describe, expect, it } from 'vitest';
import { diagnosticsReportUrl, REPORT_URL_BUDGET, trimReportForUrl } from './diagnostics-report';

describe('diagnostics report link', () => {
  const header = 'Geld 0.1.2 diagnostics — 300 events (this browser session)';

  it('carries a short report whole', () => {
    const report = `${header}\n12:00:00.000 worker-start\n12:00:01.000 fetch o/r#1 ok 120ms`;
    expect(trimReportForUrl(report)).toEqual({ text: report, trimmed: false });
  });

  it('keeps the header and the newest lines when the report is too long for a link', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `12:00:${String(index % 60).padStart(2, '0')}.000 fetch owner/repo#${index} ok ${index}ms budget=${index % 30}`);
    const report = [header, ...lines].join('\n');
    const { text, trimmed } = trimReportForUrl(report);
    expect(trimmed).toBe(true);
    expect(encodeURIComponent(text).length).toBeLessThanOrEqual(REPORT_URL_BUDGET);
    const out = text.split('\n');
    expect(out[0]).toBe(header);
    expect(out[1]).toContain('Trimmed to fit the link');
    // The newest line survives, the oldest goes.
    expect(out[out.length - 1]).toBe(lines[lines.length - 1]);
    expect(text).not.toContain('owner/repo#0 ');
    // When the clipboard write failed, the note does not promise a paste; it points at Copy diagnostics instead.
    const without = trimReportForUrl(report, REPORT_URL_BUDGET, false).text.split('\n')[1] ?? '';
    expect(without).toContain('Copy diagnostics');
    expect(without).not.toContain('clipboard');
  });

  it('builds the link with the environment and the (trimmed) report', () => {
    const url = diagnosticsReportUrl(`${header}\nline`, '0.1.2', 'Mozilla/5.0 (Macintosh) Chrome/148.0.0.0 Safari/537.36', 'MacIntel');
    expect(url.origin + url.pathname).toBe('https://github.com/brandonmcconnell/geld/issues/new');
    expect(url.searchParams.get('template')).toBe('diagnostics.yml');
    expect(url.searchParams.get('version')).toBe('0.1.2');
    expect(url.searchParams.get('browser')).toBe('Chrome 148 on macOS');
    expect(url.searchParams.get('diagnostics')).toBe(`${header}\nline`);
  });
});
