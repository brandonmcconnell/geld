// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewPanel } from './review-panel';

const url = 'https://gitlab.com/group/project/-/merge_requests/1';
const summary: ProviderReviewComment = { id: '1', anchor: 'note_1', url: `${url}#note_1`, body: '## Greptile review\nConfidence score: 5/5\nNo issues found.', author: { id: 'native-bot', login: 'review-bot', automated: true }, createdAt: '2026-11-10T10:00:00Z' };
const input: ProviderReviewInput = { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '1', headSha: 'a'.repeat(40) }, threads: [], bots: [{ id: 'greptile', authorId: summary.author.id }], complete: true };
let panel: ProviderReviewPanel | undefined;
beforeEach(() => { window.location.href = url; });
afterEach(() => { panel?.destroy();panel = undefined;document.body.replaceChildren(); });
function host(): HTMLElement { const element = document.createElement('div');document.body.append(element);return element; }

it('previews a verified existing summary with sibling controls and no additional rendering or source actions', () => {
  const open = vi.fn((_url: string, _anchor: string, event: MouseEvent) => event.preventDefault());
  const render = vi.fn((_comment: ProviderReviewComment, body: HTMLElement) => { body.innerHTML = '<p id="native-body"><strong>Rendered summary</strong></p><button>Native action</button>';return true; });
  panel = renderProviderReviewPanel(host(), input, { comments: [summary], renderComment: render, onOpenSource: open });
  const calls = render.mock.calls.length;
  const section = panel.element.querySelector('[data-geld-review-key="bots"]');
  const button = section?.querySelector<HTMLButtonElement>('button[data-geld-summary-preview]');
  expect(button).not.toBeNull();expect(button?.closest('[data-geld-review-toggle]')).toBeNull();
  expect(section?.getAttribute('data-geld-review-open')).toBe('false');
  button?.click();
  const card = panel.element.querySelector('[role="dialog"]');
  expect(card?.querySelector('.geld-provider-summary-preview__body strong')?.textContent).toBe('Rendered summary');
  expect(card?.querySelector('[id="native-body"]')).toBeNull();expect(card?.textContent).not.toContain('Native action');
  expect(render).toHaveBeenCalledTimes(calls);expect(open).not.toHaveBeenCalled();
  expect(section?.getAttribute('data-geld-review-open')).toBe('false');
  card?.querySelector<HTMLAnchorElement>('a')?.click();expect(open).toHaveBeenCalledWith(summary.url, summary.anchor, expect.any(MouseEvent));
});

it('closes previews when a native summary changes before the next panel render', async () => {
  let signature = 'first';
  panel = renderProviderReviewPanel(host(), input, { comments: [summary], commentSignature: () => signature });
  panel.element.querySelector<HTMLButtonElement>('[data-geld-summary-preview]')?.click();
  expect(panel.element.querySelector('[role="dialog"]')).not.toBeNull();
  signature = 'changed';panel.element.append(document.createElement('span'));await Promise.resolve();
  expect(panel.element.querySelector('[role="dialog"]')).toBeNull();
  panel.update({ ...input, subject: { ...input.subject, headSha: 'b'.repeat(40) } }, { comments: [summary] });
  panel.element.querySelector<HTMLButtonElement>('[data-geld-summary-preview]')?.click();
  panel.suspend();expect(panel.element.querySelector('[role="dialog"]')).toBeNull();
});

it('keeps a visible compact preview button focused when the collapsed digest refreshes unchanged', () => {
  const options = { comments: [summary] };
  panel = renderProviderReviewPanel(host(), input, options);
  const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-summary-preview]')!;
  button.focus();panel.update(input, options);
  expect(document.activeElement).toBe(button);
  expect(panel.element.querySelector('[role="dialog"]')).not.toBeNull();
  expect(button.getAttribute('aria-label')).toContain('Preview Greptile review');
  expect(button.getAttribute('aria-label')).toContain('5/5');
});

it.each(['unbound', 'ambiguous', 'unverified', 'command', 'wrong-review'] as const)('does not invent a preview source for %s evidence', change => {
  const source = change === 'command' ? { ...summary, body: '@greptileai' } : change === 'wrong-review' ? { ...summary, url: summary.url.replace('/1#', '/2#') } : summary;
  const subject = change === 'unverified' ? { ...input.subject, provider: 'bitbucket' as const, origin: 'https://bitbucket.org' } : input.subject;
  const bots = change === 'unbound' ? [] : change === 'ambiguous' ? [...(input.bots ?? []), { id: 'coderabbit', authorId: summary.author.id }] : input.bots;
  panel = renderProviderReviewPanel(host(), { ...input, subject, ...(bots === undefined ? {} : { bots }) }, { comments: [source] });
  expect(panel.element.querySelector('[data-geld-summary-preview]')).toBeNull();
});
