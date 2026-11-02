// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as review from '@geld/review';
import type { BotVerdictRecord, ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { renderProviderReviewPanel } from './review-panel';

const reviewUrl = 'https://gitlab.com/group/sub/project/-/merge_requests/42';
const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/sub/project', id: '42', headSha: 'a'.repeat(40) } as const;
const rabbit = { id: '38968537', login: 'group_117740890_bot_4b22dd1a4e94814ac4828214cbd93cfe' };
const greptile = { id: '37628862', login: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b' };
const rabbitBody = '**Actionable comments posted: 3**\n\n<details><summary>🧹 Nitpick comments (1)</summary><blockquote>Consider explicit handling for missing or invalid state type.</blockquote></details>';
const greptileBody = '<h3>Greptile Summary</h3>\nThis PR ships the parallel HTTP range-request download feature.\n<h3>Confidence Score: 5/5</h3>\nSafe to merge.';

function note(id: string, body = rabbitBody, overrides: Partial<ProviderReviewComment> = {}): ProviderReviewComment {
  return { id, anchor: `note_${id}`, url: `${reviewUrl}#note_${id}`, author: rabbit, body, createdAt: '2026-11-02T00:00:00Z', ...overrides };
}
function input(overrides: Partial<ProviderReviewInput> = {}): ProviderReviewInput {
  return { subject, threads: [], checks: [], reviewers: [], complete: true, bots: [{ id: 'coderabbit', authorId: rabbit.id }, { id: 'greptile', authorId: greptile.id }], ...overrides };
}
function host(): HTMLElement { const element = document.createElement('div');document.body.append(element);return element; }
function target(element: HTMLElement, id: string): HTMLAnchorElement | null {
  return element.querySelector<HTMLAnchorElement>(`[data-geld-review-bot="${id}"] a`);
}
function verdict(id: string, state: BotVerdictRecord['verdict'], sourceId: string): BotVerdictRecord {
  return { id, login: id, verdict: state, reviewedSha: subject.headSha, sourceId };
}

beforeEach(() => { document.body.replaceChildren();window.location.href = reviewUrl; });
afterEach(() => { vi.restoreAllMocks();vi.unstubAllGlobals(); });

describe('provider bot View review targets', () => {
  it('links an actual running request to the newest native report without changing request provenance', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-02T00:12:00Z'));
    const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
    const older = note('1', rabbitBody, { updatedAt: '2026-11-02T00:05:00Z' });
    const report = note('2', rabbitBody, { createdAt: '2026-11-02T00:01:00Z' });
    const request = note('3', '@coderabbitai review', { author: { id: 'person', login: 'alice' }, createdAt: '2026-11-02T00:11:00Z' });
    const comments = [older, report, request];
    const source = input();
    const original = review.buildProviderBotVerdicts(source, comments);
    expect(original.find((bot) => bot.id === 'coderabbit')).toMatchObject({ verdict: 'running', sourceId: request.anchor });
    const open = vi.fn(() => true);
    const panel = renderProviderReviewPanel(host(), source, { comments, onOpenSource: open });
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.getAttribute('data-state')).toBe('running');
    expect(target(panel.element, 'coderabbit')?.href).toBe(report.url);
    target(panel.element, 'coderabbit')?.click();
    expect(open).toHaveBeenCalledWith(report.url, report.anchor, expect.any(Event));
    expect(review.buildProviderBotVerdicts(source, comments)).toEqual(original);
    expect(fetch).not.toHaveBeenCalled();
    panel.destroy();
  });

  it('resolves a shared trigger independently for running and loading bots and stays inert without a report', () => {
    // A shared source is a verdict-model boundary fixture; native reports retain distinct bot accounts.
    const shared = note('3', 'Review requested', { author: { id: 'person', login: 'alice' } });
    const rabbitReport = note('1');
    const greptileReport = note('2', greptileBody, { author: greptile });
    vi.spyOn(review, 'buildProviderBotVerdicts').mockReturnValue([
      verdict('coderabbit', 'running', shared.anchor), verdict('greptile', 'loading', shared.anchor),
    ]);
    const panel = renderProviderReviewPanel(host(), input(), { comments: [rabbitReport, greptileReport, shared] });
    expect(target(panel.element, 'coderabbit')?.href).toBe(rabbitReport.url);
    expect(target(panel.element, 'greptile')?.href).toBe(greptileReport.url);
    panel.update(input(), { comments: [greptileReport, shared] });
    expect(target(panel.element, 'coderabbit')).toBeNull();
    expect(panel.element.querySelector('[data-geld-review-bot="coderabbit"]')?.textContent).toContain('Review running');
    expect(target(panel.element, 'greptile')?.href).toBe(greptileReport.url);
    panel.update(input({ bots: [{ id: 'coderabbit', authorId: 'different-native-account' }] }), { comments: [rabbitReport, shared] });
    expect(target(panel.element, 'coderabbit')).toBeNull();
    panel.destroy();
  });

  it('preserves settled finding and refusal sources instead of redirecting them to a newer summary', () => {
    const finding = note('1', 'Check the null response before reading it.');
    const refusal = note('2', 'Permission denied. Check the token and retry.', { author: greptile });
    const newer = [note('3', rabbitBody, { createdAt: '2026-11-02T00:10:00Z' }), note('4', greptileBody, { author: greptile, createdAt: '2026-11-02T00:10:00Z' })];
    vi.spyOn(review, 'buildProviderBotVerdicts').mockReturnValue([
      verdict('coderabbit', 'findings', finding.anchor), verdict('greptile', 'failed', refusal.anchor),
    ]);
    const source = input({ threads: [{ id: 'discussion', anchor: finding.anchor, url: finding.url, resolved: false, outdated: false, comments: [finding] }] });
    const panel = renderProviderReviewPanel(host(), source, { comments: [refusal, ...newer] });
    expect(target(panel.element, 'coderabbit')?.href).toBe(finding.url);
    expect(target(panel.element, 'greptile')?.href).toBe(refusal.url);
    panel.destroy();
  });
});
