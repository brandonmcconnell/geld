import type { ProviderReviewSnapshot, ProviderSidebarPerson } from '../providers/types';
import { isProviderReviewPage } from '../providers/types';
import { describeGitLabPage } from './page';

export function gitLabSidebarPeople(doc: Document, snapshot: ProviderReviewSnapshot): readonly ProviderSidebarPerson[] {
  const subject = snapshot.input.subject;
  const page = describeGitLabPage(new URL(doc.URL), doc);
  if (subject.provider !== 'gitlab' || page === null || !isProviderReviewPage(page) || page.kind !== 'overview'
    || page.repository.origin !== subject.origin || page.repository.path !== subject.repository || page.number !== subject.id
    || page.headSha !== null && page.headSha !== subject.headSha) return [];
  const sidebars = [...doc.querySelectorAll('aside[data-testid="issuable-sidebar"][data-issuable-type="merge_request"]')]
    .filter(node => node.closest('[data-geld-ui], .md, .note-text') === null);
  const sidebar = sidebars.length === 1 ? sidebars[0] : undefined;
  if (sidebar === undefined) return [];
  const authors = new Map((snapshot.input.reviewers ?? []).map(reviewer => [reviewer.author.id, reviewer.author]));
  const result: ProviderSidebarPerson[] = [];
  for (const root of [...sidebar.querySelectorAll<HTMLElement>('[data-testid="reviewers-block-container"] [data-testid="reviewer"]')].slice(0, 200)) {
    const links = [...root.querySelectorAll<HTMLAnchorElement>('a.js-user-link[data-user-id][data-username][href]')];
    const link = links.length === 1 ? links[0] : undefined;
    if (link === undefined || root.closest('[data-geld-ui], .md, .note-text') !== null) continue;
    const id = link.getAttribute('data-user-id') ?? '', login = link.getAttribute('data-username') ?? '';
    const author = authors.get(id);
    if (!/^[1-9]\d*$/.test(id) || !/^[a-z\d_.-]+$/i.test(login) || author?.login.toLowerCase() !== login.toLowerCase()) continue;
    try {
      const url = new URL(link.getAttribute('href') ?? '', doc.URL);
      if (url.origin !== subject.origin || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' || url.pathname.toLowerCase() !== `/${login}`.toLowerCase()) continue;
    } catch { continue; }
    result.push({ root, authorId: id });
  }
  return result;
}
