'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import {
  ArrowDownWideNarrow,
  ChevronDown,
  GitPullRequest,
  GitPullRequestDraft,
  GitPullRequestClosed,
  GitMerge,
  RefreshCw,
  Search,
  Settings,
  Star,
  Plus,
  X,
} from './icons';
import { cn } from 'cn';
import { pullPath, pullRefSchema, repositoryPath } from '@geld/domain';
import { providerViewer } from '@geld/domain/identities';
import type { RepositoryRef } from '@geld/domain';
import { parseQuery } from '@geld/github/query';
import { Button, buttonVariants } from '@/components/button';
import { useStarredPulls } from '@/lib/local-preferences';
import { readyForReview } from '@/lib/queue';
import { EmptyState, useDashboard } from './app-shell';
import { ChangeCounts, useQueueInsights } from './queue-insights';
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
  const ready = scoped.filter(readyForReview);
  const filtered = scoped
    .filter((pull) => {
      if (!explicitState && !readyForReview(pull)) return false;
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
          ? a.additions + a.deletions - b.additions - b.deletions
          : b.updatedAt.localeCompare(a.updatedAt)),
    );
  const visible = filtered.slice(0, limit);
  const visiblePaths = visible.map((pull) => pullPath(pull.ref));
  const selection = selected.filter((path) => visiblePaths.includes(path));
  const allSelected = visiblePaths.length > 0 && selection.length === visiblePaths.length;
  return (
    <div className="page queue-page">
      <div className="page-heading">
        <h1>{repository ? repository.repo : 'Review queue'}</h1>
        <div className="page-actions">
          {repository && (
            <Link
              href={`${repositoryPath(repository)}/~settings`}
              className="icon-button"
              aria-label="Repository settings"
              title="Repository settings"
            >
              <Settings size={16} />
              <span className="touch-target" aria-hidden="true" />
            </Link>
          )}
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
          <OpenReview />
        </div>
      </div>
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
      </div>
      {tab === 'outgoing' && scoped.some((pull) => !insights[pullPath(pull.ref)]?.requesters) && (
        <p className="inline-note">
          Showing verified requests. Request history may be unavailable for some Git connections.
        </p>
      )}
      <section className="pull-list" aria-label="Pull requests" aria-busy={loading}>
        {!loading && visible.length > 0 && (
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
        {loading ? (
          <div className="queue-loading">
            {[1, 2, 3, 4].map((n) => (
              <div className="skeleton-row" key={n}>
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : error ? (
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
              <article className="pull-row" key={path}>
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
                  <Star size={15} fill={starred ? 'currentColor' : 'none'} />
                  <span className="touch-target" aria-hidden="true" />
                </button>
              </article>
            );
          })
        )}
      </section>
      {(filtered.length > limit || queue.sources?.some((source) => source.more)) && (
        <div className="queue-footer">
          <span>
            {visible.length} of {filtered.length} loaded
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => (filtered.length > limit ? setLimit(limit + 20) : loadMore())}
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
function OpenReview() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { queue } = useDashboard();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="icon-button" aria-label="Open a review">
        <Plus size={17} />
        <span className="touch-target" aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup">
          <div className="dialog-heading">
            <Dialog.Title>Open a review</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="Close">
              <X size={17} />
              <span className="touch-target" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <Dialog.Description>Paste a GitHub, GitLab or Bitbucket pull request URL.</Dialog.Description>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const parsed = new URL(url);
                if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port)
                  throw new Error();
                const parts = parsed.pathname.split('/').filter(Boolean);
                const host = parsed.hostname;
                const provider = host === 'gitlab.com' ? 'gitlab' : host === 'bitbucket.org' ? 'bitbucket' : 'github';
                if (
                  ![
                    'github.com',
                    'gitlab.com',
                    'bitbucket.org',
                    ...queue.repositories.map((repo) => repo.ref.host),
                  ].includes(host)
                )
                  throw new Error();
                const marker = provider === 'gitlab' ? parts.indexOf('-') : 2;
                if (
                  parts[marker] !==
                    (provider === 'gitlab' ? '-' : provider === 'bitbucket' ? 'pull-requests' : 'pull') ||
                  (provider === 'gitlab' && parts[marker + 1] !== 'merge_requests')
                )
                  throw new Error();
                const number = Number(parts[marker + (provider === 'gitlab' ? 2 : 1)]);
                const ref = pullRefSchema.safeParse({
                  provider,
                  host,
                  owner: parts.slice(0, marker - 1).join('/'),
                  repo: parts[marker - 1],
                  number,
                });
                if (!ref.success) throw new Error();
                setOpen(false);
                router.push(pullPath(ref.data));
              } catch {
                setError('Enter a pull request URL from a connected Git host.');
              }
            }}
          >
            <label>
              Pull request URL
              <input
                name="pullUrl"
                className="field"
                type="url"
                required
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close render={<Button variant="outline" size="sm" />}>Cancel</Dialog.Close>
              <Button type="submit">Open review</Button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
