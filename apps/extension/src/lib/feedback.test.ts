import { describe, expect, it } from 'vitest';
import type { ContextChoice, FeedbackContext } from './feedback';
import { feedbackIssue, ISSUE_BODY_LIMIT, parseCreatedIssue, parseDraft, refusalMessage } from './feedback';

const CONTEXT: FeedbackContext = {
  environment: '0.1.3.812 · Chrome 148 on macOS',
  where: 'pull request conversation',
  page: 'https://github.com/wxt-dev/wxt/pull/2544',
  diagnostics: 'Geld 0.1.3 · 2 events\nfetch wxt-dev/wxt#2544 ok 120ms\nfetch wxt-dev/wxt#2545 ok 98ms',
};
const ALL: ContextChoice = { environment: true, where: true, page: true, diagnostics: true };
const NONE: ContextChoice = { environment: false, where: false, page: false, diagnostics: false };

describe('feedbackIssue', () => {
  it('leads the title with the kind and keeps the words on one line', () => {
    expect(feedbackIssue({ kind: 'bug', title: 'Counts\nstuck', text: 'x' }, CONTEXT, NONE).title).toBe('[Bug] Counts stuck');
    expect(feedbackIssue({ kind: 'other', title: 'Hi', text: 'x' }, CONTEXT, NONE).title).toBe('[Feedback] Hi');
  });

  it('attaches only what was ticked', () => {
    const bare = feedbackIssue({ kind: 'idea', title: 't', text: 'Please add this.' }, CONTEXT, NONE).body;
    expect(bare).toContain('Please add this.');
    expect(bare).not.toContain('Chrome');
    expect(bare).not.toContain('wxt-dev');
    expect(bare).not.toContain('Diagnostics');
    const full = feedbackIssue({ kind: 'idea', title: 't', text: 'Please add this.' }, CONTEXT, ALL).body;
    expect(full).toContain('- **Geld:** 0.1.3.812 · Chrome 148 on macOS');
    expect(full).toContain('- **Where:** pull request conversation');
    expect(full).toContain('- **Page:** <https://github.com/wxt-dev/wxt/pull/2544>');
    expect(full).toContain('<details><summary>Diagnostics</summary>');
    expect(full).toContain('fetch wxt-dev/wxt#2545 ok 98ms');
  });

  it('skips context this device has none of', () => {
    const body = feedbackIssue({ kind: 'bug', title: 't', text: 'x' }, { ...CONTEXT, page: null, where: null }, ALL).body;
    expect(body).not.toContain('**Page:**');
    expect(body).not.toContain('**Where:**');
  });

  it('fences a report holding backticks with a longer fence', () => {
    const body = feedbackIssue({ kind: 'bug', title: 't', text: 'x' }, { ...CONTEXT, diagnostics: 'header\n````\nmore' }, ALL).body;
    expect(body).toContain('`````text\nheader');
  });

  it('drops the oldest diagnostics lines to fit, never the reader\'s words', () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `line ${index} ${'x'.repeat(20)}`);
    const text = 'y'.repeat(2_000);
    const body = feedbackIssue({ kind: 'bug', title: 't', text }, { ...CONTEXT, diagnostics: ['header', ...lines].join('\n') }, ALL).body;
    expect(body.length).toBeLessThanOrEqual(ISSUE_BODY_LIMIT);
    expect(body.startsWith(text)).toBe(true);
    expect(body).toContain('header\n(Trimmed to fit the issue.');
    expect(body).toContain('line 19999');
    expect(body).not.toContain('line 0 ');
    expect(body.endsWith('</sub>')).toBe(true);
  });
});

describe('parseDraft', () => {
  it('reads a stored draft and refuses anything else', () => {
    expect(parseDraft({ kind: 'idea', title: 'a', text: 'b' })).toEqual({ kind: 'idea', title: 'a', text: 'b' });
    expect(parseDraft({ kind: 'nope', title: 'a', text: 'b' })).toBeNull();
    expect(parseDraft(null)).toBeNull();
  });
});

describe('GitHub answers', () => {
  it('reads the created issue', () => {
    expect(parseCreatedIssue({ number: 12, html_url: 'https://github.com/brandonmcconnell/geld/issues/12' })).toEqual({ number: 12, url: 'https://github.com/brandonmcconnell/geld/issues/12' });
    expect(parseCreatedIssue({ number: 12, html_url: 'https://evil.example/12' })).toBeNull();
  });

  it('says why GitHub refused', () => {
    expect(refusalMessage(403, { message: 'Resource not accessible by integration' }, false)).toMatch(/cannot open issues/);
    expect(refusalMessage(403, { message: 'API rate limit exceeded' }, true)).toMatch(/limiting requests/);
    expect(refusalMessage(410, null, false)).toMatch(/turned off/);
    expect(refusalMessage(422, { message: 'Validation Failed' }, false)).toBe('GitHub did not accept the issue: Validation Failed');
    expect(refusalMessage(500, null, false)).toMatch(/answered 500/);
  });
});
