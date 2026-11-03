// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { gitLabReferenceAnchor, readGitLabReferences } from './references';
import { referenceForSubject } from '../providers/references';
import type { ProviderReviewPage } from '../providers/types';
import type { ProviderReviewPanelEvent } from '../providers/review-panel';

const url = 'https://gitlab.com/whitebox-aero/whitebox/-/merge_requests/272';
const page: ProviderReviewPage = { provider: 'gitlab', repository: { provider: 'gitlab', origin: 'https://gitlab.com', path: 'whitebox-aero/whitebox' }, number: '272', kind: 'overview', url, diffPageUrl: `${url}/diffs`, diffUrl: `${url}.diff`, headSha: null, version: '|latest' };
const mr = '<a href="https://gitlab.com/whitebox-aero/insta360/-/merge_requests/34" title="Speed up camera downloads with parallel HTTP range requests" class="gfm gfm-merge_request" data-merge-request="488556842" data-project="56211886" data-project-path="whitebox-aero/insta360" data-iid="34" data-reference-type="merge_request" data-popover-listener-added="true">insta360!34 (merged)</a>';
const plugin = '<a href="https://gitlab.com/whitebox-aero/whitebox-plugin-device-insta360/-/merge_requests/44" title="Speed up camera downloads with parallel HTTP range requests" class="gfm gfm-merge_request" data-merge-request="488807245" data-project="62516629" data-project-path="whitebox-aero/whitebox-plugin-device-insta360" data-iid="44" data-reference-type="merge_request">whitebox-plugin-device-insta360!44 (merged)</a>';
const issue = '<a href="/whitebox-aero/whitebox/-/work_items/531" title="Improve download speed of video downloads off of Insta360" class="gfm gfm-issue" data-issue="185462933" data-project="56243493" data-iid="531" data-project-path="whitebox-aero/whitebox" data-issue-type="issue" data-reference-type="issue">#531 (closed)</a>';
const workItem = issue.replaceAll('gfm-issue', 'gfm-work_item').replaceAll('data-issue=', 'data-work-item=').replaceAll('data-issue-type=', 'data-work-item-type=').replace('data-reference-type="issue"', 'data-reference-type="work_item"');
const events: readonly ProviderReviewPanelEvent[] = [
  { id: '3381331989', url: `${url}#note_3381331989`, author: { id: '20669535', login: 'avilabss' }, body: 'mentioned in merge request insta360!34', createdAt: '2026-05-25T08:19:30.235Z', kind: 'activity' },
  { id: '3381332675', url: `${url}#note_3381332675`, author: { id: '20669535', login: 'avilabss' }, body: 'mentioned in issue #531', createdAt: '2026-05-25T08:19:49.752Z', kind: 'activity' },
];

function fixture(): void {
  // Reduced native description/system-note identities from the public MR272 capture.
  document.body.innerHTML = `<div class="issuable-discussion"><div data-testid="description-content"><div class="md">${mr}${plugin}${workItem}${mr}</div></div><ul>${events.map((event, index) => `<li class="js-timeline-entry system-note" id="note_${event.id}"><span data-testid="system-note-content" class="system-note-message">${event.body.startsWith('mentioned in issue') ? 'mentioned in issue ' : 'mentioned in merge request '}${index === 0 ? mr : issue}</span><div class="collapsed-native-body">${index === 0 ? mr : issue}</div></li>`).join('')}</ul></div>`;
}

beforeEach(() => { window.location.href = url;fixture(); });

it('indexes exact native incoming and description-only outgoing identities without new reads or states', () => {
  const fetch = vi.fn();vi.stubGlobal('fetch', fetch);
  try {
    const before = document.body.innerHTML;
    const references = readGitLabReferences(page, document, events);
    expect(references.filter((reference) => reference.direction === 'outgoing')).toHaveLength(3);
    expect(references.filter((reference) => reference.direction === 'incoming')).toHaveLength(2);
    expect(references.map((reference) => [reference.direction, reference.target.repository, reference.target.projectId, reference.target.nativeId, reference.target.number])).toEqual([
      ['outgoing', 'whitebox-aero/insta360', '56211886', '488556842', '34'],
      ['outgoing', 'whitebox-aero/whitebox-plugin-device-insta360', '62516629', '488807245', '44'],
      ['outgoing', 'whitebox-aero/whitebox', '56243493', '185462933', '531'],
      ['incoming', 'whitebox-aero/insta360', '56211886', '488556842', '34'],
      ['incoming', 'whitebox-aero/whitebox', '56243493', '185462933', '531'],
    ]);
    expect(references[0]?.label).toBe('insta360!34 (merged)');
    expect(references[0]?.title).toBe('Speed up camera downloads with parallel HTTP range requests');
    expect(references[3]?.source).toEqual({ reviewUrl: url, anchor: 'note_3381331989', eventId: events[0]?.id, author: events[0]?.author, createdAt: events[0]?.createdAt });
    expect(references.every((reference) => !('state' in reference))).toBe(true);
    expect(document.body.innerHTML).toBe(before);expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it('deduplicates headline/body copies within a note but preserves independent mention events', () => {
  const row = document.getElementById('note_3381331989');
  if (row === null) throw new Error('Missing native note.');
  const second = row.cloneNode(true);
  if (!(second instanceof HTMLElement)) throw new Error('Expected cloned note.');
  second.id = 'note_3381331990';row.after(second);
  const event = events[0];if (event === undefined) throw new Error('Missing event.');
  const references = readGitLabReferences(page, document, [...events, { ...event, id: '3381331990', url: `${url}#note_3381331990` }]);
  expect(references.filter((reference) => reference.direction === 'incoming' && reference.target.number === '34')).toHaveLength(2);
});

const invalidIdentities: readonly (readonly [string, string])[] = [['href', 'https://other.example/whitebox-aero/insta360/-/merge_requests/34'], ['href', 'javascript:alert(1)'], ['href', 'https://name:password@gitlab.com/whitebox-aero/insta360/-/merge_requests/34'], ['href', '/whitebox-aero/insta360/-/merge_requests/35'], ['href', '/whitebox-aero/insta360/-/merge_requests/34#note_1'], ['data-project-path', 'other/insta360'], ['data-iid', 'not-an-id'], ['data-project', ''], ['data-merge-request', '']];
for (const [attribute, value] of invalidIdentities) {
  it(`refuses mismatched native identity ${attribute}=${value}`, () => {
    for (const anchor of document.querySelectorAll('a[data-merge-request="488556842"]')) anchor.setAttribute(attribute, value);
    expect(readGitLabReferences(page, document, events).some((reference) => reference.target.number === '34')).toBe(false);
  });
}

it('never reads owned copies, ordinary linked comments or unrelated system activity as incoming', () => {
  document.querySelector('ul')?.insertAdjacentHTML('beforeend', `<li id="note_1" class="js-timeline-entry"><span data-testid="system-note-content" class="system-note-message">mentioned in merge request ${mr}</span></li>`);
  document.querySelector('[data-testid="description-content"] > .md')?.insertAdjacentHTML('beforeend', `<div data-geld-ui>${plugin.replaceAll('44', '45')}</div>`);
  expect(readGitLabReferences(page, document, events)).toHaveLength(5);
  expect(readGitLabReferences(page, document, events.map((event) => ({ ...event, body: 'changed target branch' })))).toHaveLength(3);
});

it('leaves unknown localized and ambiguous native source shapes absent', () => {
  expect(readGitLabReferences(page, document, events.map((event) => ({ ...event, body: 'referenciado en una solicitud' })))).toHaveLength(3);
  const message = document.querySelector('[data-testid="system-note-content"]');message?.insertAdjacentHTML('beforeend', issue);
  expect(readGitLabReferences(page, document, events).filter((reference) => reference.direction === 'incoming')).toHaveLength(1);
});

it('does not choose an ambiguous duplicate description or duplicate native note identity', () => {
  const description = document.querySelector('[data-testid="description-content"]');if (description === null) throw new Error('Missing description.');description.after(description.cloneNode(true));
  const row = document.getElementById('note_3381331989');if (row === null) throw new Error('Missing row.');row.after(row.cloneNode(true));
  expect(readGitLabReferences(page, document, events).map((reference) => reference.source.anchor)).toEqual(['note_3381332675']);
});

it('does not normalize unknown work-item types or contradictory durable resource IDs', () => {
  document.querySelector('[data-work-item]')?.setAttribute('data-work-item-type', 'task');
  document.querySelector('[data-testid="description-content"] > .md')?.insertAdjacentHTML('beforeend', mr.replace('488556842', '999999999'));
  expect(readGitLabReferences(page, document, events).map((reference) => reference.target.number)).toEqual(['44', '531']);
});

it('reacquires the same source after native remount and rejects changed labels or navigation', () => {
  const reference = readGitLabReferences(page, document, events)[0];if (reference === undefined) throw new Error('Missing reference.');
  const original = gitLabReferenceAnchor(reference, page, document, events);expect(original).not.toBeNull();
  const replacement = original?.cloneNode(true);if (!(replacement instanceof HTMLAnchorElement)) throw new Error('Missing replacement.');original?.replaceWith(replacement);
  expect(gitLabReferenceAnchor(reference, page, document, events)).toBe(replacement);
  replacement.title = 'Different native title';expect(gitLabReferenceAnchor(reference, page, document, events)).toBeNull();
  window.location.href = url.replace('/272', '/273');expect(readGitLabReferences(page, document, events)).toEqual([]);
});


it('deduplicates the actual issue/work-item alias by durable identity without changing the canonical native URL', () => {
  document.querySelector('[data-testid="description-content"] > .md')?.insertAdjacentHTML('beforeend', issue.replace('/work_items/531', '/issues/531'));
  const references = readGitLabReferences(page, document, events).filter((reference) => reference.direction === 'outgoing');
  expect(references).toHaveLength(3);
  expect(references.find((reference) => reference.target.nativeId === '185462933')?.target.url).toBe('https://gitlab.com/whitebox-aero/whitebox/-/work_items/531');
});

it('keeps full nested target namespaces and rejects a changed review selection', () => {
  const nested = 'whitebox-aero/camera/tools/insta360';
  for (const anchor of document.querySelectorAll('a[data-merge-request="488556842"]')) {
    anchor.setAttribute('data-project-path', nested);anchor.setAttribute('href', `/${nested}/-/merge_requests/34`);
  }
  expect(readGitLabReferences(page, document, events).find((reference) => reference.target.number === '34')?.target.repository).toBe(nested);
  window.location.href = `${url}?w=1`;expect(readGitLabReferences(page, document, events)).toEqual([]);
});

it('does not select an ambiguous duplicate system event snapshot', () => {
  const first = events[0];if (first === undefined) throw new Error('Missing event.');
  expect(readGitLabReferences(page, document, [...events, first]).filter((reference) => reference.direction === 'incoming').map((reference) => reference.source.eventId)).toEqual(['3381332675']);
});


it('rejects disagreement between the authoritative system event kind and native reference kind', () => {
  const first = events[0];if (first === undefined) throw new Error('Missing event.');
  const references = readGitLabReferences(page, document, [{ ...first, body: 'mentioned in issue #34' }, ...events.slice(1)]);
  expect(references.filter((reference) => reference.direction === 'incoming').map((reference) => reference.source.eventId)).toEqual(['3381332675']);
});


it('preserves a native cached title while the existing count hover temporarily holds its title attribute', () => {
  const initial = readGitLabReferences(page, document, events)[0];if (initial === undefined) throw new Error('Missing reference.');
  const anchor = gitLabReferenceAnchor(initial, page, document, events);if (anchor === null) throw new Error('Missing original.');
  const title = anchor.getAttribute('title');if (title === null) throw new Error('Missing title.');
  anchor.setAttribute('data-geld-hover-title', title);anchor.removeAttribute('title');
  expect(gitLabReferenceAnchor(initial, page, document, events)).toBe(anchor);
  expect(readGitLabReferences(page, document, events)[0]?.title).toBe(title);
});


it('retains valid trailing-slash native target URLs through extraction, shared validation and source reacquisition', () => {
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>('a.gfm[href]')) anchor.setAttribute('href', `${anchor.getAttribute('href')}/`);
  const references = readGitLabReferences(page, document, events);
  expect(references).toHaveLength(5);
  for (const reference of references) {
    expect(reference.target.url.endsWith('/')).toBe(true);
    expect(referenceForSubject(reference, { provider: 'gitlab', origin: page.repository.origin, repository: page.repository.path, id: page.number, headSha: 'a'.repeat(40) })).toBe(true);
    expect(gitLabReferenceAnchor(reference, page, document, events)?.href).toBe(reference.target.url);
  }
});
