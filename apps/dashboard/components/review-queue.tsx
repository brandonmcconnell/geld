'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownWideNarrow,
  ChevronDown,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
  RefreshCw,
  Search,
  Star,
} from './icons';
import { cn } from 'cn';
import { pullPath } from '@geld/domain';
import { providerViewer } from '@geld/domain/identities';
import type { RepositoryRef } from '@geld/domain';
import { parseQuery } from '@geld/github/query';
import { Button, buttonVariants } from '@/components/button';
import { useStarredPulls } from '@/lib/local-preferences';
import { EmptyState, useDashboard } from './app-shell';
import { ChangeCounts, QueueDigestSummary, useQueueInsights } from './queue-insights';
const tabs = [
  { id: 'all', title: 'All', shortTitle: 'All' },
  { id: 'incoming', title: 'Requested from me', shortTitle: 'For me' },
  { id: 'outgoing', title: 'Requested by me', shortTitle: 'From me' },
  { id: 'mine', title: 'Created by me', shortTitle: 'Mine' },
];
export function ReviewQueue({ repository }: { readonly repository?: RepositoryRef }) {
  const { queue, session, activeTeam, loading, error, refresh, loadMore } = useDashboard();
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [gitHost, setGitHost] = useState('all');
  const [stars, setStars] = useStarredPulls();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('updated');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        event.target instanceof HTMLElement &&
        !event.target.closest('input,textarea,[contenteditable=true]')
      ) {
        event.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const scoped = queue.pulls.filter(
    (pull) =>
      !repository ||
      (pull.ref.provider === repository.provider &&
        pull.ref.host === repository.host &&
        pull.ref.owner === repository.owner &&
        pull.ref.repo === repository.repo),
  );
  const insights = useQueueInsights(scoped, `${session.user?.id ?? 'anonymous'}:${activeTeam}`);
  const tokens = parseQuery(query);
  const explicitState = tokens.some(
    (token) => token.key === 'is' && ['draft', 'closed', 'merged'].includes(token.value),
  );
  const ready = scoped.filter(pull => pull.state === 'open');
  const filtered = scoped
    .filter((pull) => {
      if (!explicitState && pull.state !== 'open') return false;
      if (gitHost !== 'all' && pull.ref.provider !== gitHost) return false;
      const viewer = providerViewer(session.viewers, pull.ref);
      if (tab === 'incoming' && (!viewer || !pull.reviewers.includes(viewer))) return false;
      if (tab === 'mine' && (!viewer || pull.author !== viewer)) return false;
      if (tab === 'outgoing' && (!viewer || !insights[pullPath(pull.ref)]?.requesters?.includes(viewer))) return false;
      return tokens.every((token) => {
        const value = token.value.toLowerCase();
        if (token.key === 'repo') return `${pull.ref.owner}/${pull.ref.repo}`.toLowerCase() === value;
        if (token.key === 'author') return pull.author.toLowerCase() === value;
        if (token.key === 'label') return pull.labels.some((label) => label.toLowerCase() === value);
        if (token.key === 'is') return value === 'draft' ? pull.draft : value === 'pr' ? true : pull.state === value;
        return `${pull.title} ${pull.ref.owner}/${pull.ref.repo} ${pull.ref.number} ${pull.author}`
          .toLowerCase()
          .includes(value);
      });
    })
    .sort(
      (a, b) =>
        Number(stars.includes(pullPath(b.ref))) - Number(stars.includes(pullPath(a.ref))) ||
        (sort === 'size'
          ? (insights[pullPath(a.ref)] ? insights[pullPath(a.ref)]!.essential.additions + insights[pullPath(a.ref)]!.essential.deletions : Number.POSITIVE_INFINITY) - (insights[pullPath(b.ref)] ? insights[pullPath(b.ref)]!.essential.additions + insights[pullPath(b.ref)]!.essential.deletions : Number.POSITIVE_INFINITY)
          : b.updatedAt.localeCompare(a.updatedAt)),
    );
  const visible = filtered.slice(0, limit);
  const visiblePaths = visible.map((pull) => pullPath(pull.ref));
  const selection = selected.filter((path) => visiblePaths.includes(path));
  const allSelected = visiblePaths.length > 0 && selection.length === visiblePaths.length;
  return (
    <div className="page queue-page">
      {session.demo && <p className="demo-notice">Sample workspace · Provider writes are disabled</p>}
      <div className="queue-tabs" role="tablist" aria-label="Review queue views">
        {tabs.map((item) => (
          <button
            type="button"
            key={item.id}
            role="tab"
            aria-label={item.id === 'all' ? 'All ' + ready.length : item.title}
            aria-selected={tab === item.id}
            className={cn('queue-tab', tab === item.id && 'selected')}
            onClick={() => {
              setTab(item.id);
              setSelected([]);
            }}
          >
            <span className="queue-tab-title">{item.title}</span>
            <span className="queue-tab-short" aria-hidden="true">
              {item.shortTitle}
            </span>
            {item.id === 'all' && <span className="queue-tab-count">{ready.length}</span>}
          </button>
        ))}
      </div>
      <div className="queue-toolbar">
        <label className="search-field">
          <Search size={16} />
          <input
            name="query"
            ref={search}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(20);
            }}
            placeholder="Filter by title, author: or repo:"
            aria-label="Filter pull requests"
          />
          <kbd>/</kbd>
        </label>
        <label className="toolbar-select">
          <select
            name="gitHost"
            aria-label="Git host"
            value={gitHost}
            onChange={(event) => setGitHost(event.target.value)}
          >
            <option value="all">All Git hosts</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="bitbucket">Bitbucket</option>
          </select>
          <ChevronDown size={12} />
        </label>
        <label className="toolbar-select">
          <ArrowDownWideNarrow size={15} />
          <select
            name="sort"
            aria-label="Sort pull requests"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            <option value="updated">Updated</option>
            <option value="size">Smallest</option>
          </select>
          <ChevronDown size={12} />
        </label>
        <button
          type="button"
          className="icon-button"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh review queue"
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          <span className="touch-target" aria-hidden="true" />
        </button>
      </div>
      {tab === 'outgoing' && scoped.some((pull) => !insights[pullPath(pull.ref)]?.requesters) && (
        <p className="inline-note">
          Showing verified requests. Request history may be unavailable for some Git connections.
        </p>
      )}
      {error && scoped.length > 0 && <p role="status" className="inline-note">{error} Cached results remain visible.</p>}
      <section className="pull-list" aria-label="Pull requests" aria-busy={loading}>
        {visible.length > 0 && (
          <div className="pull-list-heading">
            <input
              name="selectAll"
              ref={(element) => {
                if (element) element.indeterminate = selection.length > 0 && !allSelected;
              }}
              type="checkbox"
              aria-label="Select visible pull requests"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? [] : visiblePaths)}
            />
            {selection.length ? (
              <>
                <span>{selection.length} selected</span>
                <button
                  type="button"
                  onClick={() => {
                    setStars([...new Set([...stars, ...selection])]);
                    setSelected([]);
                  }}
                >
                  Star
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStars(stars.filter((path) => !selection.includes(path)));
                    setSelected([]);
                  }}
                >
                  Unstar
                </button>
                <button type="button" className="selection-clear" onClick={() => setSelected([])}>
                  Clear
                </button>
              </>
            ) : (
              <>
                <span>Pull request</span>
                <span className="changes-column-label">Review scope</span>
              </>
            )}
          </div>
        )}
        {loading && !scoped.length ? (
          <div className="queue-loading">
            {[1, 2, 3, 4].map((n) => (
              <div className="skeleton-row" key={n}>
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : error && !scoped.length ? (
          <EmptyState title="Queue unavailable" action={<Button onClick={refresh}>Try again</Button>}>
            {error}
          </EmptyState>
        ) : !session.user && !session.demo ? (
          <EmptyState
            icon={GitPullRequest}
            title="Sign in to see your reviews"
            action={
              <Link href="/sign-in" className={buttonVariants()}>
                Sign in
              </Link>
            }
          >
            Connect your Git account to get started.
          </EmptyState>
        ) : !visible.length ? (
          <EmptyState
            icon={GitPullRequest}
            title={query || tab !== 'all' ? 'No matching pull requests' : 'You’re all caught up'}
            action={
              query ? (
                <Button variant="outline" size="sm" onClick={() => setQuery('')}>
                  Clear filters
                </Button>
              ) : undefined
            }
          >
            {query
              ? 'Try another title, author or repository.'
              : tab === 'outgoing'
                ? 'Review requests you send will appear here.'
                : 'Pull requests ready for your review will appear here.'}
          </EmptyState>
        ) : (
          visible.map((pull) => {
            const path = pullPath(pull.ref),
              starred = stars.includes(path);
            const Status =
              pull.state === 'merged'
                ? GitMerge
                : pull.state === 'closed'
                  ? GitPullRequestClosed
                  : pull.draft
                    ? GitPullRequestDraft
                    : GitPullRequest;
            return (
              <article className="pull-row" data-selected={selection.includes(path)} key={path}>
                <input
                  name={`select-${pull.id}`}
                  type="checkbox"
                  aria-label={`Select ${pull.title}`}
                  checked={selection.includes(path)}
                  onChange={() =>
                    setSelected(
                      selection.includes(path) ? selection.filter((item) => item !== path) : [...selection, path],
                    )
                  }
                />
                <Status
                  size={16}
                  className={
                    pull.state === 'merged'
                      ? 'merged-icon'
                      : pull.state === 'closed'
                        ? 'closed-icon'
                        : pull.draft
                          ? 'draft-icon'
                          : 'open-icon'
                  }
                />
                <div className="pull-row-content">
                  <Link href={path} className="pull-title">
                    {pull.title}
                  </Link>
                  <div className="pull-row-meta">
                    <span>
                      {pull.ref.owner}/<strong>{pull.ref.repo}</strong>
                    </span>
                    <span>#{pull.ref.number}</span>
                    <span>by {pull.author}</span>
                    {pull.draft && <span className="draft-badge">Draft</span>}
                    {pull.labels.slice(0, 1).map((label) => (
                      <span className="label-badge" key={label}>
                        {label}
                      </span>
                    ))}
                    <QueueDigestSummary digest={insights[path]?.digest} href={path} />
                  </div>
                </div>
                <ChangeCounts insight={insights[path]} />
                <button
                  type="button"
                  className="icon-button star-button"
                  aria-label={starred ? 'Unstar pull request' : 'Star pull request'}
                  aria-pressed={starred}
                  onClick={() => setStars(starred ? stars.filter((item) => item !== path) : [...stars, path])}
                >
                  <Star size={15} active={starred} />
                  <span className="touch-target" aria-hidden="true" />
                </button>
              </article>
            );
          })
        )}
      </section>
      {(filtered.length > limit || !!queue.nextCursor) && (
        <div className="queue-footer">
          <span>
            {visible.length} shown{filtered.length > visible.length ? ` of ${filtered.length} loaded` : ''}{queue.nextCursor ? ' · More available' : ''}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => { setLimit(limit + 20); if (filtered.length <= limit) loadMore(); }}
          >
            Load more
          </Button>
        </div>
      )}
      {queue.sources?.some((source) => source.error) && (
        <div className="source-notices">
          {queue.sources
            .filter((source) => source.error)
            .map((source) => (
              <Link href="/connect" key={source.provider}>
                {source.provider}: {source.error}
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
