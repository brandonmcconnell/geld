import { browser } from 'wxt/browser';
import { repositoryKey } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { isDependencyUpdate, officialSourceForBot, relatedLinksFrom } from '@geld/review/related-links';
import type { LinkCandidate, RelatedLink } from '@geld/review/related-links';
import { previewDocFromMarkdown } from '@geld/review';
import type { PreviewLink, ProviderReviewComment } from '@geld/review';
import { digestIcon } from './digest-icons';
import { element } from './dom';
import { projectProviderPeople } from './hidden-people';
import { referenceForSubject } from './references';
import type { ProviderReviewReference } from './references';
import type { ProviderAdapter, ProviderReviewPage, ProviderReviewSnapshot } from './types';
import { isProviderReviewPage } from './types';
import './related-context.css';

const EXCLUDED = '[data-geld-ui],pre,code,form,button,[contenteditable],dialog,[role="dialog"],[role="tooltip"]';
const HOST_EXCLUDED = `${EXCLUDED},.md,.note-body,.ak-renderer-document,[data-testid="comment"],[data-qa="pull-request-description"]`;
const commentLinks = new WeakMap<ProviderReviewComment, { readonly body: string; readonly links: readonly PreviewLink[] }>();

export function providerRelatedHost(provider: 'gitlab' | 'bitbucket', doc: Document): HTMLElement | null {
  const selector = provider === 'gitlab' ? 'aside[data-testid="issuable-sidebar"][data-issuable-type="merge_request"]' : 'aside [data-testid="pr-cards-list"]';
  const hosts = [...doc.querySelectorAll<HTMLElement>(selector)].filter((host) => host.closest(HOST_EXCLUDED) === null);
  return hosts.length === 1 ? hosts[0] ?? null : null;
}

/** Where the sections go: right under GitLab's Reviewers block, as GitHub's stand under Reviewers, else at the host's end. */
function relatedAnchor(provider: 'gitlab' | 'bitbucket', host: HTMLElement): { readonly parent: HTMLElement; readonly before: Node | null } {
  if (provider === 'gitlab') {
    const reviewers = [...host.querySelectorAll<HTMLElement>('.block.reviewer')].filter((block) => block.closest('[data-geld-ui]') === null);
    const block = reviewers.length === 1 ? reviewers[0] : undefined;
    if (block?.parentElement != null) {
      let after: Node = block;
      while (after.nextSibling instanceof HTMLElement && after.nextSibling.classList.contains('geld-provider-related')) after = after.nextSibling;
      return { parent: block.parentElement, before: after.nextSibling };
    }
  }
  return { parent: host, before: null };
}

export type ReferenceState = 'open' | 'closed' | 'merged';

/** GitHub's short form for a reference, nearest first: `#965` here, `project#965` in the same group, the full path elsewhere,
 * with `!` for a merge request; the state is GitLab's own suffix on the link ("(closed)", "(merged)"). */
export function referenceWords(reference: ProviderReviewReference, repository: string): { readonly ref: string; readonly title: string; readonly state: ReferenceState } {
  const target = reference.target;
  const sigil = target.provider === 'gitlab' && target.kind === 'issue' ? '#' : '!';
  const here = repository.split('/'), there = target.repository.split('/');
  // GitLab paths nest groups deeply, so a project elsewhere is named by its own name; the full path is the link's tooltip.
  const path = target.repository === repository ? '' : there.length > 2 || here.slice(0, -1).join('/') === there.slice(0, -1).join('/') ? there.at(-1) ?? target.repository : target.repository;
  const suffix = /\((closed|merged)\)\s*$/.exec(reference.label)?.[1];
  const state: ReferenceState = suffix === 'merged' ? 'merged' : suffix === 'closed' ? 'closed' : 'open';
  const words = reference.label.replace(/\s*\((?:closed|merged|opened)\)\s*$/, '').trim();
  const title = reference.title ?? (/^[#!]?\d+$|[#!]\d+$/.test(words) ? '' : words);
  return { ref: `${path}${sigil}${target.number}`, title, state };
}

function descriptionCandidates(body: HTMLElement | null, page: ProviderReviewPage): LinkCandidate[] {
  if (body === null || body.closest('[data-geld-ui]') !== null || isDependencyUpdate((body.textContent ?? '').replace(/^\s*This MR contains/, 'This PR contains'))) return [];
  return [...body.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((anchor) => anchor.closest(EXCLUDED) === null).flatMap((anchor) => {
    try { return [{ href: new URL(anchor.getAttribute('href') ?? '', page.url).href, text: [anchor.textContent ?? '', ...[...anchor.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt') ?? '')].join(' ').trim() }]; }
    catch { return []; }
  });
}

export function providerRelatedLinks(page: ProviderReviewPage, body: HTMLElement | null, snapshot?: ProviderReviewSnapshot, hiddenAuthors: readonly string[] = [], shownPeople: ReadonlySet<string> = new Set()): readonly RelatedLink[] {
  const candidates = descriptionCandidates(body, page);
  if (snapshot !== undefined && (snapshot.input.subject.provider !== page.provider || snapshot.input.subject.origin !== page.repository.origin || snapshot.input.subject.repository !== page.repository.path || snapshot.input.subject.id !== page.number)) snapshot = undefined;
  const people = snapshot === undefined ? null : projectProviderPeople(snapshot.input, snapshot.comments, snapshot.events, hiddenAuthors, shownPeople);
  const bots = new Map((people?.input.bots ?? []).map((bot) => [bot.authorId, bot.id]));
  const seen = new Set<string>();
  for (const comment of [...(people?.comments ?? []), ...(people?.input.threads ?? []).flatMap((thread) => thread.comments)]) {
    if (seen.has(comment.anchor) || !bots.has(comment.author.id)) continue;
    seen.add(comment.anchor);
    let parsed = commentLinks.get(comment);
    if (parsed?.body !== comment.body) {
      const markdown = comment.body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, '');
      parsed = { body: comment.body, links: previewDocFromMarkdown(comment.author.login, comment.anchor, markdown).links };
      commentLinks.set(comment, parsed);
    }
    candidates.push(...parsed.links.map((link) => ({ ...link, author: comment.author.login, authorId: comment.author.id })));
  }
  return relatedLinksFrom(candidates, { host: new URL(page.url).hostname, repository: page.repository.path,
    isOfficialSource: (specId, candidate) => candidate.authorId !== undefined && officialSourceForBot(specId, bots.get(candidate.authorId) ?? ''),
  }).filter((link) => { const url = new URL(link.href), self = new URL(page.url); return url.origin !== self.origin || url.pathname.replace(/\/$/, '') !== self.pathname.replace(/\/$/, ''); });
}

type Group = 'links' | 'work';

export class ProviderRelatedContext {
  private host: HTMLElement | null = null;
  private signature = '';
  private key = '';
  private readonly nodes: HTMLElement[] = [];
  private readonly all = new Set<Group>();
  constructor(private readonly adapter: ProviderAdapter) {}

  update(page: ProviderReviewPage, settings: GeldSettings, doc: Document, snapshot?: ProviderReviewSnapshot, shownPeople: ReadonlySet<string> = new Set()): void {
    const active = this.adapter.describe(new URL(doc.URL), doc);
    if (!settings.enabled || !settings.relatedLinks || page.kind !== 'overview' || active === null || !isProviderReviewPage(active) || active.kind !== 'overview'
      || active.number !== page.number || repositoryKey(active.repository) !== repositoryKey(page.repository)) { this.clear(); return; }
    if (this.key !== page.url) { this.clear(); this.key = page.url; }
    const host = providerRelatedHost(page.provider, doc) ?? this.adapter.reviewHost?.(doc) ?? null;
    if (host === null) { this.clear(); return; }
    const body = this.adapter.descriptionHost?.(doc) ?? null;
    const links = providerRelatedLinks(page, body, snapshot, settings.hiddenAuthors, shownPeople);
    const references = isDependencyUpdate((body?.textContent ?? '').replace(/^\s*This MR contains/, 'This PR contains')) ? [] : this.adapter.readReferences?.(page, doc, snapshot?.events ?? []) ?? [];
    const work = references.filter((reference) => reference.direction === 'outgoing' && reference.source.anchor === null && reference.source.eventId === undefined
      && reference.target.url !== page.url && referenceForSubject(reference, { provider: page.provider, origin: page.repository.origin, repository: page.repository.path, id: page.number, headSha: page.headSha ?? '' }));
    const native = new Set(work.map((reference) => reference.target.url));
    const external = links.filter((link) => !native.has(link.href));
    const signature = JSON.stringify([external, work]);
    if (this.host === host && this.signature === signature && this.nodes.every((node) => node.isConnected && host.contains(node))) return;
    for (const node of this.nodes) node.remove();this.nodes.length = 0;
    this.host = host;this.signature = signature;
    const place = { ...relatedAnchor(page.provider, host), gitlab: page.provider === 'gitlab' };
    if (external.length > 0) this.add(place, 'links', 'Related links', external.map((link) => this.linkRow(link)));
    if (work.length > 0) this.add(place, 'work', 'Related work', work.map((reference) => this.workRow(reference, page.repository.path)));
  }

  clear(): void {
    for (const node of this.nodes) node.remove();this.nodes.length = 0;
    this.host = null;this.signature = '';this.key = '';this.all.clear();
  }

  private anchor(href: string, label: string, title?: string): HTMLAnchorElement {
    const anchor = element('a', label, 'geld-provider-related__link');anchor.href = href;anchor.rel = 'noreferrer';
    if (title !== undefined) anchor.title = title;
    return anchor;
  }

  private linkRow(link: RelatedLink): HTMLElement {
    const row = element('li', '', 'geld-provider-related__row');
    const label = [link.service, link.ref ?? link.title ?? link.noun].join(' · ');
    const anchor = this.anchor(link.href, label, link.action);
    if (link.icon !== null) {
      try { const image = element('img');image.src = browser.runtime.getURL(`/tracker-icons/${link.icon}.svg`);image.alt = '';image.width = 16;image.height = 16;anchor.prepend(image); }
      catch { /* A retired extension context can still leave readable links. */ }
    }
    row.append(anchor);
    if (link.context !== null) row.append(element('span', link.context, 'geld-provider-related__context'));
    return row;
  }

  private workRow(reference: ProviderReviewReference, repository: string): HTMLElement {
    const row = element('li', '', 'geld-provider-related__row');
    const { ref, title, state } = referenceWords(reference, repository);
    const anchor = this.anchor(reference.target.url, '', [`${reference.target.repository}${ref.slice(ref.search(/[#!]\d+$/))}`, title].filter(Boolean).join(' '));
    const kind = reference.target.provider === 'gitlab' && reference.target.kind === 'issue' ? (state === 'open' ? 'issue-open' : 'issue-closed') : 'merge-request';
    const glyph = digestIcon(kind);glyph.dataset.geldReferenceState = state;
    const words = element('span', '', 'geld-provider-related__words');
    words.append(element('span', ref, 'geld-provider-related__ref'));
    if (title !== '') words.append(' ', title);
    anchor.append(glyph, words);anchor.dataset.geldReferenceState = state;
    row.append(anchor);
    return row;
  }

  private add(place: { readonly parent: HTMLElement; readonly before: Node | null; readonly gitlab: boolean }, group: Group, label: string, rows: readonly HTMLElement[]): void {
    const section = element('section', '', 'geld-provider-related');section.dataset.geldRelated = group;section.setAttribute('aria-label', label);
    section.append(element('h3', label));
    const list = element('ul');list.append(...rows);section.append(list);
    if (rows.length > 8 && !this.all.has(group)) {
      for (const row of rows.slice(8)) row.hidden = true;
      const more = element('button', `Show ${rows.length - 8} more`);more.type = 'button';
      more.addEventListener('click', () => { const focused = document.activeElement === more;this.all.add(group);for (const row of rows) row.hidden = false;more.remove();if (focused) rows[8]?.querySelector('a')?.focus(); });section.append(more);
    }
    if (place.gitlab) section.classList.add('block');
    place.parent.insertBefore(section, place.before);this.nodes.push(section);
  }
}
