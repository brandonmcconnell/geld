'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { pullPath, repositoryPath, organisationPath } from '@geld/domain';
import { useDashboard } from '@/lib/dashboard-context';
import { useRepositoryOptions } from '@/lib/use-repository-options';
import { Search, X } from './icons';
import { OpenReview } from './open-review';

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const router = useRouter();
  const { queue, teams } = useDashboard();
  const repos = useRepositoryOptions(open);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const entries = [
    { label: 'Review queue', href: '/', type: 'Page' },
    { label: 'Repositories', href: '/repositories', type: 'Page' },
    { label: 'Connect repository', href: '/connect', type: 'Action' },
    { label: 'Account', href: '/settings/account', type: 'Settings' },
    { label: 'AI providers', href: '/settings/providers', type: 'Settings' },
    ...teams.map((team) => ({ label: team.name, href: `/teams/${team.id}`, type: 'Team' })),
    ...[...new Map(repos.repositories.map((repo) => [organisationPath(repo.ref), repo.ref])).values()].map(
      (ref) => ({ label: ref.owner, href: organisationPath(ref), type: 'Organization' }),
    ),
    ...repos.repositories.map((repo) => ({
      label: `${repo.ref.owner}/${repo.ref.repo}`,
      href: repositoryPath(repo.ref),
      type: 'Repository',
    })),
    ...queue.pulls.map((pull) => ({
      label: `#${pull.ref.number} ${pull.title}`,
      href: pullPath(pull.ref),
      type: 'Pull request',
    })),
  ]
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 30);
  function navigate(href: string) {
    setOpen(false);
    router.push(href);
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setQuery('');
          setSelected(0);
        }
      }}
    >
      <Dialog.Trigger
        className="icon-button global-search-trigger"
        aria-label="Search workspace"
        title="Search workspace (⌘K / Ctrl+K)"
      >
        <Search size={14} />
        <span className="touch-target" aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Popup className="dialog-popup command-search">
          <Dialog.Title className="sr-only">Search workspace</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search connected repositories, loaded pull requests, teams and settings.
          </Dialog.Description>
          <div className="command-input">
            <Search size={16} />
            <input
              autoFocus
              role="combobox"
              aria-label="Search workspace"
              aria-expanded="true"
              aria-controls="workspace-results"
              aria-autocomplete="list"
              aria-activedescendant={entries[selected] ? `workspace-result-${selected}` : undefined}
              placeholder="Search repositories, pull requests, settings…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  const next = Math.max(
                    0,
                    Math.min(entries.length - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)),
                  );
                  setSelected(next);
                  document.getElementById(`workspace-result-${next}`)?.scrollIntoView({ block: 'nearest' });
                }
                if (e.key === 'Enter' && entries[selected]) {
                  e.preventDefault();
                  navigate(entries[selected].href);
                }
              }}
            />
            <Dialog.Close className="icon-button" aria-label="Close search">
              <X size={14} />
            </Dialog.Close>
          </div>
          <div id="workspace-results" role="listbox" aria-label="Results" className="command-results">
            {entries.map((entry, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === selected}
                id={`workspace-result-${index}`}
                key={`${entry.href}:${entry.type}`}
                onClick={() => navigate(entry.href)}
              >
                <span>{entry.label}</span>
                <small>{entry.type}</small>
              </button>
            ))}
          </div>
          {!entries.length && <p className="command-empty">No matching results</p>}
          {repos.loading && (
            <p role="status" className="command-empty">
              Loading repositories…
            </p>
          )}
          {repos.error && (
            <p role="status" className="command-empty">
              {repos.error}
              <button onClick={repos.retry}>Retry</button>
            </p>
          )}
          {repos.nextCursor && (
            <button className="command-more" onClick={repos.loadMore} disabled={repos.loading}>
              Load more repositories
            </button>
          )}
          <footer>
            <span>↑↓ navigate · ↵ open · Esc close</span>
            <OpenReview />
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
