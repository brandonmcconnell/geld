'use client';
import { useEffect, useRef, useState } from 'react';
import { useStarredPulls } from '@/lib/local-preferences';
import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpRight, Check, ChevronDown, Filter, GitPullRequest, RefreshCw, Search, Star } from 'lucide-react';
import { cn } from 'cn';
import { pullPath } from '@geld/domain';
import { providerViewer } from '@geld/domain/identities';
import type { RepositoryRef } from '@geld/domain';
import { parseQuery } from '@geld/github/query';
import { Button, buttonVariants } from '@geld/ui';
import { EmptyState, useDashboard } from './app-shell';

export function ReviewQueue({ repository }: { readonly repository?: RepositoryRef }) {
  const { queue, session, loading, error, refresh } = useDashboard();
  const [tab, setTab] = useState('all');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('all');
  const [stars, setStars] = useStarredPulls();
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === '/' && event.target instanceof HTMLElement && !event.target.closest('input,textarea,[contenteditable=true]')) { event.preventDefault(); search.current?.focus(); } }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, []);
  const [limit, setLimit] = useState(20);
  const [sort, setSort] = useState('updated');
  const scoped = queue.pulls.filter((pull) => !repository || (pull.ref.provider === repository.provider && pull.ref.host === repository.host && pull.ref.owner === repository.owner && pull.ref.repo === repository.repo));
  const filtered = scoped.filter((pull) => {
    const key = pullPath(pull.ref);
    if (provider !== 'all' && pull.ref.provider !== provider) return false;
    if (tab === 'starred' && !stars.includes(key)) return false;
    const viewer = providerViewer(session.viewers, pull.ref);
    if (tab === 'requested' && (!viewer || !pull.reviewers.includes(viewer))) return false;
    if (tab === 'mine' && (!viewer || pull.author !== viewer)) return false;
    return parseQuery(query).every((token) => {
      if (token.key === 'repo') return `${pull.ref.owner}/${pull.ref.repo}`.toLowerCase() === token.value.toLowerCase();
      if (token.key === 'author') return pull.author.toLowerCase() === token.value.toLowerCase();
      if (token.key === 'label') return pull.labels.some((label) => label.toLowerCase() === token.value.toLowerCase());
      if (token.key === 'is') return token.value === 'draft' ? pull.draft : token.value === 'open' ? pull.state === 'open' : token.value === 'pr';
      return `${pull.title} ${pull.ref.owner}/${pull.ref.repo} ${pull.ref.number} ${pull.author}`.toLowerCase().includes(token.value.toLowerCase());
    });
  }).sort((a, b) => sort === 'size' ? a.additions + a.deletions - b.additions - b.deletions : b.updatedAt.localeCompare(a.updatedAt));
  const visible = filtered.slice(0, limit);
  return <div className="page queue-page"><div className="page-heading"><div><p className="eyebrow">YOUR WORK, IN FOCUS</p><h1>{repository ? repository.repo : 'Review queue'}<span className="heading-count">{scoped.length}</span></h1><p>Find the change that needs your attention.</p></div><div className="page-actions"><Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''}/><span>Refresh</span></Button><Link href="/connect" className={buttonVariants({ size: 'sm' })}>Connect repository <ArrowUpRight size={14}/></Link></div></div>
    {session.demo && <p className="demo-notice"><span className="live-dot"/> Local demonstration <span>Sample repositories and pull requests. Provider writes are disabled.</span></p>}
    <div className="queue-summary"><div><span className="summary-icon"><GitPullRequest size={17}/></span><div><strong>{scoped.filter((p) => !p.draft).length}</strong><span>Ready for a closer look</span></div></div><div><span className="summary-icon"><Check size={17}/></span><div><strong>{scoped.filter((p) => p.reviewers.length > 0).length}</strong><span>Waiting on reviewers</span></div></div><div className="summary-guide"><span className="summary-icon">✦</span><div><strong>Start with the story</strong><span>A guide connects the changes across files.</span></div><Link href="/settings/providers">Set up AI <ArrowUpRight size={13}/></Link></div></div>
    <div className="queue-tabs" role="tablist" aria-label="Review queue views">{[{ id: 'all', title: 'All pull requests', count: scoped.length }, { id: 'requested', title: 'Requested from me' }, { id: 'mine', title: 'Created by me' }, { id: 'starred', title: 'Starred' }].map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={cn('queue-tab', tab === item.id && 'selected')} onClick={() => setTab(item.id)}>{item.title}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>
    <div className="queue-toolbar"><label className="search-field"><Search size={16}/><input ref={search} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(20); }} placeholder="Filter pull requests..." aria-label="Filter pull requests"/><kbd>/</kbd></label><label className="toolbar-select"><Filter size={14}/><select aria-label="Filter by provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="all">All providers</option><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="bitbucket">Bitbucket</option></select><ChevronDown size={12}/></label><label className="toolbar-select"><ArrowDownWideNarrow size={14}/><select aria-label="Sort pull requests" value={sort} onChange={(event) => setSort(event.target.value)}><option value="updated">Last updated</option><option value="size">Smallest first</option></select></label></div>
    <section className="pull-list" aria-label="Pull requests" aria-busy={loading}>
      {loading ? <div className="queue-loading">{[1,2,3,4].map((n) => <div className="skeleton-row" key={n}><span/><span/></div>)}</div> : error ? <EmptyState title="Your queue could not be loaded" action={<Button onClick={refresh}>Try again</Button>}>{error}</EmptyState> : !session.user ? <EmptyState icon={GitPullRequest} title="Your next review starts here" action={<Link href="/sign-in" className={buttonVariants()}>Sign in to Geld <ArrowUpRight size={15}/></Link>}>Connect GitHub, GitLab or Bitbucket to bring your pull requests together.</EmptyState> : visible.length === 0 ? <EmptyState title={query || tab !== 'all' ? 'Nothing matches this view' : 'Your queue is clear'} action={<Link href="/connect" className={buttonVariants({ variant: 'outline' })}>Manage connections</Link>}>{query ? 'Try a different title, author:login or repo:owner/name filter.' : 'Connect a provider or open a pull request when you are ready.'}</EmptyState> : visible.map((pull) => {
        const path = pullPath(pull.ref); const starred = stars.includes(path);
        return <article className="pull-row" key={path}><GitPullRequest size={19} className={pull.draft ? 'draft-icon' : 'open-icon'}/><div className="pull-row-content"><div className="pull-row-meta"><span className="provider-tag">{pull.ref.provider === 'github' ? 'GH' : pull.ref.provider === 'gitlab' ? 'GL' : 'BB'}</span><span>{pull.ref.owner} <span className="muted-slash">/</span> <strong>{pull.ref.repo}</strong></span><span>#{pull.ref.number}</span>{pull.draft && <span className="draft-badge">Draft</span>}</div><Link href={path} className="pull-title">{pull.title}</Link><div className="pull-row-detail"><span className="mini-avatar">{pull.author.slice(0, 1).toUpperCase()}</span><span>{pull.author}</span><span className="meta-dot">·</span><span>{pull.reviewers.length ? `${pull.reviewers.length} reviewer${pull.reviewers.length === 1 ? '' : 's'} requested` : 'No review requested'}</span>{pull.labels.slice(0,2).map((label) => <span className="label-badge" key={label}>{label}</span>)}</div></div><div className="pull-row-trailing"><div className="diffstat"><span>+{pull.additions}</span><span>−{pull.deletions}</span></div><button className="icon-button star-button" aria-label={starred ? 'Unstar pull request' : 'Star pull request'} aria-pressed={starred} onClick={() => setStars(starred ? stars.filter((item) => item !== path) : [...stars, path])}><Star size={16} fill={starred ? 'currentColor' : 'none'}/></button></div></article>;
      })}
    </section><div className="queue-footer"><span>{filtered.length ? `Showing ${Math.min(limit, filtered.length)} of ${filtered.length} loaded pull requests` : 'Everything in its place.'}</span>{filtered.length > limit && <Button variant="ghost" size="sm" onClick={() => setLimit((value) => value + 20)}>Show more</Button>}<span className="queue-footer-hint"><kbd>↵</kbd> Open a review</span></div>
    {queue.sources?.some((source) => source.more) && <p className="inline-note">This queue shows a bounded selection of recently updated repositories. Open a repository to load its next page.</p>}
    {queue.sources?.some((source) => source.error) && <div className="source-notices">{queue.sources.filter((source) => source.error).map((source) => <Link href="/connect" key={source.provider}>{source.provider}: {source.error === 'signed_out' ? 'Connect or reconnect this provider' : source.error}</Link>)}</div>}
  </div>;
}
