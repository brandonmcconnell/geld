// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@geld/core';
import type { ProviderReviewInput } from '@geld/review';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewPanelEvent } from './review-panel';
import { referenceForSubject } from './references';
import type { ProviderReviewReference } from './references';
import { ProviderConversation } from './conversation';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from './types';
import { gitLabReferenceAnchor, readGitLabReferences } from '../gitlab/references';

vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: vi.fn(() => { throw new Error('Unexpected real transport.'); }) } } }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined }) } }));

const url = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
const sha = 'a'.repeat(40);
const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/whitebox', id: '272', headSha: sha } as const;
const input: ProviderReviewInput = { subject, threads: [], checks: [], reviewers: [] };
const event: ProviderReviewPanelEvent = { id: '3381331989', url: `${url}#note_3381331989`, body: 'mentioned in merge request insta360!34', author: { id: '20669535', login: 'avilabss' }, createdAt: '2026-05-25T08:19:30.235Z', kind: 'activity' };
const target = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'whitebox-aero/insta360', projectId: '56211886', nativeId: '488556842', number: '34', kind: 'merge-request', url: 'https://gitlab.com/whitebox-aero/insta360/-/merge_requests/34' } as const;
const outgoing: ProviderReviewReference = { id: 'description:34', direction: 'outgoing', label: 'insta360!34 (merged)', title: 'Speed up camera downloads with parallel HTTP range requests', target, source: { reviewUrl: url, anchor: null } };
const incoming: ProviderReviewReference = { ...outgoing, id: 'note:34', direction: 'incoming', source: { reviewUrl: url, anchor: 'note_3381331989', eventId: event.id, author: event.author, createdAt: event.createdAt } };
const cleanup: (() => void)[] = [];
beforeEach(() => { window.location.href = url;document.body.replaceChildren(); });
afterEach(() => { for (const stop of cleanup.splice(0)) stop();vi.restoreAllMocks(); });
function host(): HTMLElement { const value = document.createElement('main');document.body.append(value);return value; }

it('shows separate reference groups with canonical native labels, titles and source links without invented states/hooks', () => {
  const panel = renderProviderReviewPanel(host(), input, { references: [outgoing, incoming], events: [event], onRevealReference: () => true });
  expect(panel.element.querySelector('[data-geld-review-key="references:incoming"] summary')?.textContent).toBe('Incoming references · 1');
  expect(panel.element.querySelector('[data-geld-review-key="references:outgoing"] summary')?.textContent).toBe('Outgoing references · 1');
  expect(panel.element.querySelector('[data-geld-review-key="activity"]')).toBeNull();
  const links = [...panel.element.querySelectorAll<HTMLAnchorElement>('.geld-provider-review__reference-link')];
  expect(links.map((link) => link.href)).toEqual([target.url, target.url]);
  expect(links[0]?.textContent).toBe(`${outgoing.label}${outgoing.title}`);
  expect(panel.element.querySelector('[data-state="merged"],.gl-badge,svg,[data-reference-type],[data-popover-mounted]')).toBeNull();
  expect(panel.element.querySelector('time')?.dateTime).toBe(event.createdAt);
  expect(panel.element.textContent).toContain('avilabss');
});

it('keeps unparsed activity instead of treating absent references as a universal empty index', () => {
  const panel = renderProviderReviewPanel(host(), input, { events: [event] });
  expect(panel.element.querySelector('[data-geld-review-key^="references:"]')).toBeNull();
  expect(panel.element.querySelector('[data-geld-event="3381331989"]')).not.toBeNull();
});

it('retains independent disclosure state across refresh and removes wrong-review references', () => {
  const panel = renderProviderReviewPanel(host(), input, { references: [outgoing, incoming] });
  const open = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="references:outgoing"]');
  if (open === null) throw new Error('Missing reference section.');
  open.open = true;open.dispatchEvent(new Event('toggle'));
  panel.update(input, { references: [{ ...outgoing, title: 'Updated observed title' }, incoming] });
  expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="references:outgoing"]')?.open).toBe(true);
  expect(panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="references:incoming"]')?.open).toBe(false);
  panel.update({ ...input, subject: { ...subject, id: '273' } });
  expect(panel.element.querySelector('[data-geld-reference]')).toBeNull();
});

it('uses text content for reference labels and titles and rejects unsafe or mismatched targets', () => {
  const unsafe = { ...outgoing, id: 'unsafe', target: { ...target, url: 'javascript:alert(1)' } };
  const wrongOrigin = { ...outgoing, id: 'foreign', target: { ...target, url: 'https://other.example/whitebox-aero/insta360/-/merge_requests/34' } };
  const wrongSource = { ...outgoing, id: 'wrong-source', source: { ...outgoing.source, reviewUrl: url.replace('/272', '/273') } };
  const literal = { ...outgoing, label: '<img src=x onerror=alert(1)>', title: '<script>alert(1)</script>' };
  const panel = renderProviderReviewPanel(host(), input, { references: [unsafe, wrongOrigin, wrongSource, literal] });
  expect(panel.element.querySelectorAll('[data-geld-reference]')).toHaveLength(1);
  expect(panel.element.querySelector('img,script')).toBeNull();
  expect(panel.element.textContent).toContain(literal.label);
  expect(referenceForSubject({ ...incoming, source: { ...incoming.source, eventId: 'event-id', anchor: 'unsafe#anchor' } }, subject)).toBe(false);
});

it('copies each reference source once and never copies replaced activity as an extra mention', async () => {
  const copy = vi.fn();
  const panel = renderProviderReviewPanel(host(), input, { references: [outgoing, incoming, incoming], events: [event], copyText: copy });
  panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
  await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
  const text: unknown = copy.mock.calls[0]?.[0];if (typeof text !== 'string') throw new Error('Missing copied text.');
  expect(text).toContain('## Incoming references');expect(text).toContain('## Outgoing references');
  expect(text).toContain(event.url);expect(text).not.toContain(`avilabss: ${event.body}`);
});

it('keeps canonical navigation and reports unavailable original sources without activating stale controls', () => {
  const reveal = vi.fn(() => false);
  const panel = renderProviderReviewPanel(host(), input, { references: [outgoing], onRevealReference: reveal });
  const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-reference] button');
  button?.click();expect(reveal).toHaveBeenCalledWith(outgoing);
  expect(panel.element.querySelector('[role="status"]')?.textContent).toContain('unavailable');
  panel.destroy();button?.click();expect(reveal).toHaveBeenCalledOnce();
});

async function conversationFixture() {
  const anchorHtml = '<a class="gfm gfm-merge_request" data-reference-type="merge_request" data-project="56211886" data-project-path="whitebox-aero/insta360" data-iid="34" data-merge-request="488556842" href="/whitebox-aero/insta360/-/merge_requests/34" title="Speed up camera downloads with parallel HTTP range requests">insta360!34 (merged)</a>';
  document.body.innerHTML = `<div class="issuable-discussion"><main></main><div data-testid="description-content"><div class="md"><p>Summary</p><p>${anchorHtml}</p></div></div></div>`;
  const mount = document.querySelector('main');if (mount === null) throw new Error('Missing host.');
  const reference = document.querySelector<HTMLAnchorElement>('a.gfm');if (reference === null) throw new Error('Missing original.');
  vi.spyOn(reference, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 10, 100, 20));
  const scroll = vi.spyOn(reference, 'scrollIntoView').mockImplementation(() => {});
  let active: ProviderReviewPage | null = { provider: 'gitlab', repository: { provider: 'gitlab', origin: subject.origin, path: subject.repository }, number: subject.id, kind: 'overview', url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, headSha: null, version: '|latest' };
  const snapshot: ProviderReviewSnapshot = { input, comments: [], events: [], complete: true, unavailable: [], approvalsRequired: null, approvalsLeft: null, actions: [] };
  const fetchReview = vi.fn(async () => snapshot);
  const adapter: ProviderAdapter = { id: 'gitlab', describe: () => active, readDiff: () => null, headerTargets: () => [], listRows: () => [], fetchDiff: async () => ({ files: [], revision: sha, complete: true }), reviewHost: () => mount, fetchReview, readReferences: readGitLabReferences, referenceAnchor: gitLabReferenceAnchor, descriptionHost: () => document.querySelector('[data-testid="description-content"] > .md') };
  const changed = vi.fn();
  const conversation = new ProviderConversation(adapter, changed);
  const settings = { ...DEFAULT_SETTINGS, prOverview: true, quickReview: false, aiEnabled: false, compactTimeline: 'minimal', collapseDescription: true } as const;
  cleanup.push(() => conversation.clear());
  conversation.apply(active, settings);await vi.waitFor(() => expect(changed).toHaveBeenCalled());conversation.apply(active, settings);
  const button = document.querySelector<HTMLButtonElement>('[data-geld-reference] button');if (button === null) throw new Error('Missing source control.');
  return { button, reference, scroll, snapshot, fetchReview, conversation, setPage: (value: ProviderReviewPage | null) => { active = value; }, getPage: () => active };
}

it('reveals an owned collapsed description and focuses the current original anchor without new reads or native mutations', async () => {
  const fixture = await conversationFixture();const before = fixture.reference.outerHTML;
  expect(fixture.reference.closest('[data-geld-provider-description-hidden]')).not.toBeNull();
  fixture.button.click();
  expect(fixture.reference.closest('[data-geld-provider-description-hidden]')).toBeNull();
  expect(document.activeElement).toBe(fixture.reference);expect(fixture.scroll).toHaveBeenCalledOnce();
  expect(fixture.reference.outerHTML).toBe(before);expect(fixture.fetchReview).toHaveBeenCalledOnce();
});

it('refuses to focus a changed or framework-hidden original', async () => {
  const fixture = await conversationFixture();fixture.reference.title = 'Changed source';fixture.button.click();
  expect(fixture.scroll).not.toHaveBeenCalled();
  fixture.reference.title = 'Speed up camera downloads with parallel HTTP range requests';fixture.reference.hidden = true;fixture.button.click();
  expect(fixture.scroll).not.toHaveBeenCalled();
});

it('refuses stale review and head contexts even when an old source control still exists', async () => {
  const fixture = await conversationFixture();const page = fixture.getPage();if (page === null) throw new Error('Missing page.');
  fixture.setPage({ ...page, number: '273', url: url.replace('/272', '/273') });fixture.button.click();expect(fixture.scroll).not.toHaveBeenCalled();
  fixture.setPage({ ...page, headSha: 'b'.repeat(40) });fixture.button.click();expect(fixture.scroll).not.toHaveBeenCalled();
  fixture.setPage({ ...page, kind: 'diff', version: 'selected-commit' });fixture.button.click();expect(fixture.scroll).not.toHaveBeenCalled();
});


it('preserves reference keyboard focus across refresh without stealing focus from a native source', () => {
  const panel = renderProviderReviewPanel(host(), input, { references: [outgoing], onRevealReference: () => true, version: 1 });
  const section = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="references:outgoing"]');if (section === null) throw new Error('Missing section.');
  section.open = true;section.dispatchEvent(new Event('toggle'));
  const target = panel.element.querySelector<HTMLAnchorElement>('.geld-provider-review__reference-link');target?.focus();
  panel.update(input, { references: [outgoing], onRevealReference: () => true, version: 2 });
  expect(document.activeElement?.getAttribute('data-geld-reference-role')).toBe('target');
  const button = panel.element.querySelector<HTMLButtonElement>('[data-geld-reference] button');button?.focus();
  panel.update(input, { references: [outgoing], onRevealReference: () => true, version: 3 });
  expect(document.activeElement?.getAttribute('data-geld-reference-role')).toBe('source');
  const original = document.createElement('a');original.href = target?.href ?? '/';document.body.append(original);original.focus();
  panel.update(input, { references: [outgoing], onRevealReference: () => true, version: 4 });expect(document.activeElement).toBe(original);
});

it('does not carry a reference focus target into another review or head even when its target identity repeats', () => {
  const panel = renderProviderReviewPanel(host(), input, { references: [outgoing], version: 1 });
  const section = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="references:outgoing"]');if (section === null) throw new Error('Missing section.');
  section.open = true;section.dispatchEvent(new Event('toggle'));
  panel.element.querySelector<HTMLAnchorElement>('.geld-provider-review__reference-link')?.focus();
  const nextSubject = { ...subject, id: '273' };
  const nextReference = { ...outgoing, source: { ...outgoing.source, reviewUrl: url.replace('/272', '/273') } };
  panel.update({ ...input, subject: nextSubject }, { references: [nextReference], version: 2 });
  expect(panel.element.querySelector('.geld-provider-review__reference-link')).not.toBeNull();
  expect(document.activeElement?.getAttribute('data-geld-reference-role')).not.toBe('target');
  const reopened = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-key="references:outgoing"]');if (reopened === null) throw new Error('Missing new section.');
  reopened.open = true;reopened.dispatchEvent(new Event('toggle'));
  panel.element.querySelector<HTMLAnchorElement>('.geld-provider-review__reference-link')?.focus();
  panel.update({ ...input, subject: { ...nextSubject, headSha: 'b'.repeat(40) } }, { references: [nextReference], version: 3 });
  expect(document.activeElement?.getAttribute('data-geld-reference-role')).not.toBe('target');
});


it('keeps shared URL safety independent of native route syntax, ID formats and fragment prefixes', () => {
  const otherSubject = { ...subject, provider: 'bitbucket', origin: 'https://bitbucket.org', repository: 'workspace/repository' } as const;
  const reference: ProviderReviewReference = { ...incoming,
    target: { ...target, provider: 'bitbucket', origin: otherSubject.origin, repository: 'other/repository', projectId: '{project-uuid}', nativeId: '{resource-uuid}', number: '34', kind: 'pull-request', url: 'https://bitbucket.org/other/repository/pull-requests/34/?tab=overview#native-reference' },
    source: { reviewUrl: 'https://bitbucket.org/workspace/repository/pull-requests/272', anchor: 'comment-source-id', eventId: 'event-source-id' } };
  expect(referenceForSubject(reference, otherSubject)).toBe(true);
  expect(referenceForSubject({ ...reference, target: { ...reference.target, url: 'https://user:password@bitbucket.org/other/repository/pull-requests/34/' } }, otherSubject)).toBe(false);
  expect(referenceForSubject({ ...reference, target: { ...reference.target, url: 'javascript:alert(1)' } }, otherSubject)).toBe(false);
  expect(referenceForSubject({ ...reference, target: { ...reference.target, url: 'https://other.example/other/repository/pull-requests/34/' } }, otherSubject)).toBe(false);
});
