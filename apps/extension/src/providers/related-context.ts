import { browser } from 'wxt/browser';
import { compileAuthorRules, repositoryKey } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import { isDependencyUpdate, officialSourceForBot, relatedLinksFrom } from '@geld/review/related-links';
import type { LinkCandidate, RelatedLink } from '@geld/review/related-links';
import { previewDocFromMarkdown } from '@geld/review';
import type { PreviewLink, ProviderReviewComment } from '@geld/review';
import { element } from './dom';
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

function descriptionCandidates(body: HTMLElement | null, page: ProviderReviewPage): LinkCandidate[] {
  if (body === null || body.closest('[data-geld-ui]') !== null || isDependencyUpdate((body.textContent ?? '').replace(/^\s*This MR contains/, 'This PR contains'))) return [];
  return [...body.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((anchor) => anchor.closest(EXCLUDED) === null).flatMap((anchor) => {
    try { return [{ href: new URL(anchor.getAttribute('href') ?? '', page.url).href, text: [anchor.textContent ?? '', ...[...anchor.querySelectorAll('img[alt]')].map((image) => image.getAttribute('alt') ?? '')].join(' ').trim() }]; }
    catch { return []; }
  });
}

export function providerRelatedLinks(page: ProviderReviewPage, body: HTMLElement | null, snapshot?: ProviderReviewSnapshot, hiddenAuthors: readonly string[] = [], shownPeople: ReadonlySet<string> = new Set()): readonly RelatedLink[] {
  const candidates = descriptionCandidates(body, page);
  const hidden = compileAuthorRules(hiddenAuthors);
  if (snapshot !== undefined && (snapshot.input.subject.provider !== page.provider || snapshot.input.subject.origin !== page.repository.origin || snapshot.input.subject.repository !== page.repository.path || snapshot.input.subject.id !== page.number)) snapshot = undefined;
  const bots = new Map((snapshot?.input.bots ?? []).map((bot) => [bot.authorId, bot.id]));
  const seen = new Set<string>();
  for (const comment of [...(snapshot?.comments ?? []), ...(snapshot?.input.threads ?? []).flatMap((thread) => thread.comments)]) {
    if (seen.has(comment.anchor) || !bots.has(comment.author.id) || !shownPeople.has(comment.author.id) && (hidden.hides(comment.author.login) || hidden.hides(`${page.provider}:${comment.author.login}`))) continue;
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
    if (this.host === host && this.signature === signature && this.nodes.every((node) => node.parentElement === host)) return;
    for (const node of this.nodes) node.remove();this.nodes.length = 0;
    this.host = host;this.signature = signature;
    if (external.length > 0) this.add(host, 'links', 'Related links', external.map((link) => this.linkRow(link)));
    if (work.length > 0) this.add(host, 'work', 'Related work', work.map((reference) => this.workRow(reference)));
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

  private workRow(reference: ProviderReviewReference): HTMLElement {
    const row = element('li', '', 'geld-provider-related__row');
    row.append(this.anchor(reference.target.url, reference.title === null ? reference.label : `${reference.label} · ${reference.title}`));
    if (reference.target.repository !== '') row.append(element('span', reference.target.repository, 'geld-provider-related__context'));
    return row;
  }

  private add(host: HTMLElement, group: Group, label: string, rows: readonly HTMLElement[]): void {
    const section = element('section', '', 'geld-provider-related');section.dataset.geldRelated = group;section.setAttribute('aria-label', label);
    section.append(element('h3', label));
    const list = element('ul');list.append(...rows);section.append(list);
    if (rows.length > 8 && !this.all.has(group)) {
      for (const row of rows.slice(8)) row.hidden = true;
      const more = element('button', `Show ${rows.length - 8} more`);more.type = 'button';
      more.addEventListener('click', () => { const focused = document.activeElement === more;this.all.add(group);for (const row of rows) row.hidden = false;more.remove();if (focused) rows[8]?.querySelector('a')?.focus(); });section.append(more);
    }
    host.append(section);this.nodes.push(section);
  }
}
