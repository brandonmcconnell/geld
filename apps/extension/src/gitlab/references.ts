import { repositoryKey } from '@geld/core';
import type { GitLabReferenceTarget, ProviderReviewReference } from '../providers/references';
import type { ProviderReviewPanelEvent } from '../providers/review-panel';
import type { ProviderReviewPage } from '../providers/types';
import { isProviderReviewPage } from '../providers/types';
import { gitLabDescriptionHost } from './conversation';
import { describeGitLabPage } from './page';

type GitLabReviewReference = Omit<ProviderReviewReference, 'target'> & { readonly target: GitLabReferenceTarget };
interface ReferenceAnchor { readonly reference: GitLabReviewReference; readonly anchor: HTMLAnchorElement }
const ID = /^[1-9]\d*$/;
const MAX_REFERENCES = 200;

function currentPage(page: ProviderReviewPage, doc: Document): boolean {
  const active = describeGitLabPage(new URL(doc.URL), doc);
  return active !== null && isProviderReviewPage(active) && active.url === page.url && active.number === page.number && active.kind === page.kind && active.version === page.version
    && repositoryKey(active.repository) === repositoryKey(page.repository) && (page.headSha === null || active.headSha === page.headSha);
}

function targetOf(anchor: HTMLAnchorElement, page: ProviderReviewPage): GitLabReferenceTarget | null {
  if (anchor.closest('[data-geld-ui]') !== null || !anchor.classList.contains('gfm')) return null;
  const type = anchor.getAttribute('data-reference-type');
  if (type !== 'merge_request' && type !== 'issue' && type !== 'work_item') return null;
  if (type === 'issue' && anchor.getAttribute('data-issue-type') !== 'issue' || type === 'work_item' && anchor.getAttribute('data-work-item-type') !== 'issue') return null;
  const nativeId = anchor.getAttribute(type === 'merge_request' ? 'data-merge-request' : type === 'issue' ? 'data-issue' : 'data-work-item');
  const projectId = anchor.getAttribute('data-project');
  const repository = anchor.getAttribute('data-project-path');
  const number = anchor.getAttribute('data-iid');
  if (nativeId === null || projectId === null || repository === null || number === null || !ID.test(nativeId) || !ID.test(projectId) || !ID.test(number)) return null;
  try {
    const url = new URL(anchor.getAttribute('href') ?? '', `${page.repository.origin}/`);
    if (url.origin !== page.repository.origin || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || /%(?:2f|5c)/i.test(url.pathname)) return null;
    const match = /^\/(.+)\/-\/(merge_requests|issues|work_items)\/([1-9]\d*)\/?$/.exec(decodeURIComponent(url.pathname));
    if (match === null || match[1] !== repository || match[3] !== number || (type === 'merge_request') !== (match[2] === 'merge_requests')) return null;
    return { provider: 'gitlab', origin: url.origin, repository, projectId, nativeId, number, kind: type === 'merge_request' ? 'merge-request' : 'issue', url: url.href };
  } catch { return null; }
}

function targetKey(target: GitLabReferenceTarget): string { return JSON.stringify([target.origin, target.repository, target.projectId, target.kind, target.nativeId, target.number]); }

function scan(page: ProviderReviewPage, doc: Document, events: readonly ProviderReviewPanelEvent[]): readonly ReferenceAnchor[] {
  if (page.provider !== 'gitlab' || page.kind !== 'overview' || !currentPage(page, doc)) return [];
  const entries: ReferenceAnchor[] = [];
  const make = (anchor: HTMLAnchorElement, direction: ProviderReviewReference['direction'], source: ProviderReviewReference['source']): ReferenceAnchor | null => {
    const target = targetOf(anchor, page);
    const label = anchor.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (target === null || label === '') return null;
    const title = (anchor.getAttribute('title') ?? anchor.getAttribute('data-geld-hover-title'))?.trim() || null;
    return { anchor, reference: { id: JSON.stringify([direction, source.anchor, targetKey(target)]), direction, label, title, target, source } };
  };
  const descriptions = [...doc.querySelectorAll<HTMLElement>('.issuable-discussion [data-testid="description-content"] > .md')].filter((root) => root.closest('[data-geld-ui]') === null);
  const description = descriptions.length === 1 ? gitLabDescriptionHost(doc) : null;
  const seen = new Set<string>();
  for (const anchor of description?.querySelectorAll<HTMLAnchorElement>('a.gfm[data-reference-type][href]') ?? []) {
    const entry = make(anchor, 'outgoing', { reviewUrl: page.url, anchor: null });
    if (entry === null || seen.has(entry.reference.id)) continue;
    seen.add(entry.reference.id);entries.push(entry);
    if (entries.length >= MAX_REFERENCES) break;
  }
  const byId = new Map<string, ProviderReviewPanelEvent>();
  const duplicateEvents = new Set<string>();
  for (const event of events) { if (byId.has(event.id)) duplicateEvents.add(event.id); else byId.set(event.id, event); }
  for (const row of doc.querySelectorAll<HTMLElement>('.issuable-discussion li.js-timeline-entry.system-note[id]')) {
    if (entries.length >= MAX_REFERENCES) break;
    if (row.closest('[data-geld-ui]') !== null || !/^note_[1-9]\d*$/.test(row.id)) continue;
    const event = byId.get(row.id.slice(5));
    if (event === undefined || duplicateEvents.has(event.id) || event.url !== `${page.url}#${row.id}` || !/^mentioned in (?:merge request|issue)\s/.test(event.body)) continue;
    if (doc.querySelectorAll(`[id="${row.id}"]`).length !== 1) continue;
    const messages = row.querySelectorAll<HTMLElement>('[data-testid="system-note-content"].system-note-message');
    if (messages.length !== 1) continue;
    const message = messages[0];
    if (message === undefined || !/^mentioned in (?:merge request|issue)\s/.test(message.textContent?.trim() ?? '')) continue;
    const anchors = message.querySelectorAll<HTMLAnchorElement>('a.gfm[data-reference-type][href]');
    if (anchors.length !== 1) continue;
    const anchor = anchors[0];
    if (anchor === undefined) continue;
    const kind = event.body.startsWith('mentioned in merge request ') ? 'merge-request' : 'issue';
    const messageKind = message.textContent?.trim().startsWith('mentioned in merge request ') ? 'merge-request' : 'issue';
    const entry = make(anchor, 'incoming', { reviewUrl: page.url, anchor: row.id, eventId: event.id, author: event.author, createdAt: event.createdAt });
    if (entry !== null && entry.reference.target.kind === kind && messageKind === kind) entries.push(entry);
  }
  const conflicts = new Set<string>();
  const ids = new Map<string, string>();
  for (const { reference } of entries) {
    const key = JSON.stringify([reference.target.origin, reference.target.repository, reference.target.kind, reference.target.number]);
    const identity = JSON.stringify([reference.target.projectId, reference.target.nativeId]);
    if (ids.has(key) && ids.get(key) !== identity) conflicts.add(key);
    ids.set(key, identity);
  }
  return entries.filter(({ reference }) => !conflicts.has(JSON.stringify([reference.target.origin, reference.target.repository, reference.target.kind, reference.target.number])));
}

export function readGitLabReferences(page: ProviderReviewPage, doc: Document, events: readonly ProviderReviewPanelEvent[]): readonly GitLabReviewReference[] {
  return scan(page, doc, events).map((entry) => entry.reference);
}

export function gitLabReferenceAnchor(reference: ProviderReviewReference, page: ProviderReviewPage, doc: Document, events: readonly ProviderReviewPanelEvent[]): HTMLAnchorElement | null {
  const expected = JSON.stringify(reference);
  return scan(page, doc, events).find((entry) => JSON.stringify(entry.reference) === expected)?.anchor ?? null;
}
