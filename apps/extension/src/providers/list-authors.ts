import { compileAuthorRules, normalizeAuthorRule } from '@geld/core';
import type { GeldSettings } from '@geld/core';
import type { ProviderListAuthor, ProviderListAuthorFetcher, ProviderListRow } from './types';

interface Visit {
  readonly key: string;
  readonly abort: AbortController;
  authors: ReadonlyMap<string, ProviderListAuthor>;
}

/** One optional metadata batch per active author-filter visit, independent of diff/config demand. */
export class ProviderListAuthors {
  private visit: Visit | null = null;

  constructor(private readonly fetcher: ProviderListAuthorFetcher | undefined, private readonly changed: () => void) {}

  update(rows: readonly ProviderListRow[], settings: Pick<GeldSettings, 'enabled' | 'hiddenAuthors' | 'repoRules'>, url: string): readonly ProviderListRow[] {
    const rules = compileAuthorRules(settings.hiddenAuthors.filter((line) => normalizeAuthorRule(line) !== ''));
    if (this.fetcher === undefined || !settings.enabled || rules.isEmpty) { this.clear(); return rows; }
    const key = JSON.stringify([url, settings.hiddenAuthors, settings.repoRules]);
    if (rows.length === 0) { if (this.visit?.key !== key) this.clear(); return rows; }
    if (this.visit?.key !== key) {
      this.clear();
      const visit: Visit = { key, abort: new AbortController(), authors: new Map() };
      this.visit = visit;
      // Bound the association set as well as the provider's response; responsive hosts share a canonical URL.
      const visible = [...new Set(rows.map((row) => row.url))].slice(0, 100);
      void Promise.resolve().then(() => {
        visit.abort.signal.throwIfAborted();
        return this.fetcher?.(new URL(url), visible, visit.abort.signal) ?? [];
      }).then((result) => {
        if (this.visit !== visit || visit.abort.signal.aborted) return;
        const expected = new Set(visible);
        const authors = new Map<string, ProviderListAuthor>();
        for (const author of result) {
          if (!expected.has(author.url)) continue;
          if (authors.has(author.url)) throw new Error('Ambiguous provider list author');
          authors.set(author.url, author);
        }
        visit.authors = authors;
        if (authors.size > 0) this.changed();
      }).catch(() => undefined); // Unavailable metadata remains unknown/visible; no automatic retry or fan-out.
    }
    const authors = this.visit?.authors;
    return rows.map((row) => {
      const author = row.author === null ? authors?.get(row.url) : undefined;
      return author === undefined ? row : { ...row, author: author.author, authorName: author.authorName };
    });
  }

  clear(): void { this.visit?.abort.abort(); this.visit = null; }
  pause(): void { this.visit?.abort.abort(); }
}
