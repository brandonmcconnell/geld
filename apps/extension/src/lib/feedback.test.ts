import { describe, expect, it } from 'vitest';
import type { ContextChoice, FeedbackContext } from './feedback';
import { feedbackIssue, ISSUE_BODY_LIMIT, parseCreatedIssue, parseDraft, refusalMessage } from './feedback';

const CONTEXT: FeedbackContext = {
  environment: '0.1.3.812 · Chrome 148 on macOS',
  where: 'pull request conversation',
  page: 'https://github.com/wxt-dev/wxt/pull/2544',
  diagnostics: 'Geld 0.1.3 · 2 events\nfetch github.com/wxt-dev/wxt#2544 ok 120ms\nfetch github.com/wxt-dev/wxt#2545 ok 98ms',
  provider: 'GitHub (github.com)',
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
    expect(bare).toContain('- **Git provider:** GitHub (github.com)');
    const full = feedbackIssue({ kind: 'idea', title: 't', text: 'Please add this.' }, CONTEXT, ALL).body;
    expect(full).toContain('- **Geld:** 0.1.3.812 · Chrome 148 on macOS');
    expect(full).toContain('- **Page type:** pull request conversation');
    expect(full).toContain('- **Page address:** <https://github.com/wxt-dev/wxt/pull/2544>');
    expect(full).toContain('<details><summary>Diagnostics</summary>');
    expect(full).toContain('fetch github.com/wxt-dev/wxt#2545 ok 98ms');
  });

  it('obfuscates the diagnostics when the page address stays out', () => {
    const body = feedbackIssue({ kind: 'bug', title: 't', text: 'x' }, CONTEXT, { ...ALL, page: false }).body;
    expect(body).toContain('<details><summary>Diagnostics</summary>');
    expect(body).toContain('fetch github.com/[org]/[repo]#[pr] ok 120ms');
    expect(body.split('<details>')[1]).not.toContain('wxt');
  });

  it('leaves out empty details, so the preview can stand in for them', () => {
    expect(feedbackIssue({ kind: 'bug', title: '', text: '  ' }, { ...CONTEXT, provider: null }, NONE).body).toBe('<sub>Sent from the feedback form in the Geld extension.</sub>');
  });

  it('skips context this device has none of', () => {
    const body = feedbackIssue({ kind: 'bug', title: 't', text: 'x' }, { ...CONTEXT, page: null, where: null }, ALL).body;
    expect(body).not.toContain('**Page address:**');
    expect(body).not.toContain('**Page type:**');
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

  it('never cuts the reader\'s words, and says how far they run over instead', () => {
    const text = 'z'.repeat(ISSUE_BODY_LIMIT + 10);
    const issue = feedbackIssue({ kind: 'bug', title: 't', text }, CONTEXT, ALL);
    expect(issue.body).toContain(text);
    expect(issue.body).not.toContain('<details>');
    expect(issue.overBy).toBe(issue.body.length - ISSUE_BODY_LIMIT);
    expect(feedbackIssue({ kind: 'bug', title: 't', text: 'short' }, CONTEXT, ALL).overBy).toBe(0);
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
