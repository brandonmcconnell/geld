'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Popover } from '@base-ui/react/popover';
import { parseDashboardPathname, repositoryPath } from '@geld/domain';
import { useDashboard } from '@/lib/dashboard-context';
import { useRepositoryOptions } from '@/lib/use-repository-options';
import { Check, ChevronsUpDown, FolderGit2, Layers, Search, Settings, Sparkles } from './icons';
import { settingsLinks } from './settings-navigation';
import { OpenReview } from './open-review';
import { SidebarTrigger, useSidebar } from './ui/sidebar';

export function WorkspaceHeader() {
  const pathname = usePathname();
  const route = parseDashboardPathname(pathname);
  const { assistantOpen, setAssistantOpen } = useDashboard();
  const { open, isMobile } = useSidebar();
  const queue = pathname === '/' || (route?.kind === 'repository' && !route.settings);
  const settings =
    pathname.startsWith('/settings') ||
    pathname.startsWith('/connect') ||
    (route && route.kind !== 'pull' && route.settings) ||
    /^\/teams\/[^/]+/.test(pathname);
  const title = queue
    ? 'Review queue'
    : route?.kind === 'pull'
      ? `Pull request #${route.ref.number}`
      : settings
        ? (settingsLinks.find((item) => pathname === item.href)?.name ?? 'Settings')
        : pathname === '/repositories'
          ? 'Repositories'
          : pathname === '/teams'
            ? 'Teams'
            : pathname === '/inbox'
              ? 'Inbox'
              : 'Workspace';
  return (
    <header className="workspace-header" aria-label="Workspace toolbar">
      <div className="workspace-header-start">
        {(isMobile || !open) && <SidebarTrigger className="workspace-sidebar-trigger" />}
        <RepositoryPicker />
      </div>
      {queue ? <h1 className="workspace-header-title">{title}</h1> : <p className="workspace-header-title">{title}</p>}
      <div className="workspace-header-actions">
        {route?.kind === 'repository' && !route.settings && (
          <Link
            href={`${repositoryPath(route.ref)}/~settings`}
            className="icon-button"
            aria-label="Repository settings"
            title="Repository settings"
          >
            <Settings size={16} />
            <span className="touch-target" aria-hidden="true" />
          </Link>
        )}
        {!settings && <OpenReview />}
        {route?.kind === 'pull' && (
          <button
            type="button"
            className="workspace-action"
            aria-label="Toggle assistant"
            aria-pressed={assistantOpen}
            onClick={() => setAssistantOpen(!assistantOpen)}
          >
            <Sparkles size={16} />
            <span className="workspace-action-label">Assistant</span>
            <span className="touch-target" aria-hidden="true" />
          </button>
        )}
      </div>
    </header>
  );
}

function RepositoryPicker() {
  const pathname = usePathname();
  const router = useRouter();
  const route = parseDashboardPathname(pathname);
  const selected = route && route.kind !== 'organisation' ? route.ref : null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const options = useRepositoryOptions(open);
  const repositories = options.repositories.filter(({ ref }) =>
    `${ref.owner}/${ref.repo} ${ref.host}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <Popover.Trigger
        className="repository-picker"
        aria-label="Select repository"
        title={selected ? `${selected.owner}/${selected.repo}` : 'All repositories'}
      >
        <span>{selected?.repo ?? 'All repositories'}</span>
        <ChevronsUpDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="start" sideOffset={8} className="popover-positioner">
          <Popover.Popup className="scope-menu repository-menu">
            <Popover.Title className="sr-only">Choose a repository</Popover.Title>
            <label className="menu-search">
              <Search size={15} />
              <input
                name="repositorySearch"
                type="search"
                aria-label="Find a repository"
                placeholder="Find a repository…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="scope-options">
              <button
                type="button"
                aria-pressed={!selected}
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                  router.push('/');
                }}
              >
                <Layers size={16} />
                <span>All repositories</span>
                {!selected && <Check size={15} />}
              </button>
              {repositories.map(({ ref }) => {
                const active = !!selected && repositoryPath(selected) === repositoryPath(ref);
                return (
                  <button
                    type="button"
                    key={repositoryPath(ref)}
                    aria-label={`${ref.owner}/${ref.repo} on ${ref.host}`}
                    aria-pressed={active}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                      router.push(repositoryPath(ref));
                    }}
                  >
                    <FolderGit2 size={16} />
                    <span>
                      {ref.owner}/<strong>{ref.repo}</strong>
                      <small>{ref.host}</small>
                    </span>
                    {active && <Check size={15} />}
                  </button>
                );
              })}
              {options.loading && (
                <p className="menu-empty" role="status">
                  Loading repositories…
                </p>
              )}
              {options.error && (
                <div className="menu-empty" role="status">
                  {options.error}
                  <button type="button" onClick={options.retry}>
                    Retry
                  </button>
                </div>
              )}
              {!options.loading && !repositories.length && (
                <p className="menu-empty">{query ? 'No matching repositories' : 'No connected repositories'}</p>
              )}
              {options.nextCursor && (
                <button type="button" disabled={options.loading} onClick={options.loadMore}>
                  Load more repositories
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
