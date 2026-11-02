'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog } from '@base-ui/react/dialog';
import { cn } from 'cn';
import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  CircleHelp,
  GitPullRequest,
  Layers,
  Menu,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { z } from 'zod';
import { parseDashboardPathname, repositoryPath } from '@geld/domain';
import { queueSchema, sessionSchema } from '@/lib/contracts';
import type { QueueData, SessionData } from '@/lib/contracts';
import { Brand } from './brand';

const teamListSchema = z.object({ teams: z.array(z.object({ id: z.string(), name: z.string() })) });
const emptyQueue: QueueData = { pulls: [], repositories: [] };
interface DashboardContext {
  readonly queue: QueueData;
  readonly session: SessionData;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
  readonly teams: readonly { id: string; name: string }[];
  readonly activeTeam: string;
  readonly setActiveTeam: (id: string) => void;
  readonly loadMore: () => void;
}
const context = createContext<DashboardContext>({
  queue: emptyQueue,
  session: { user: null, configured: false, demo: false },
  loading: true,
  error: null,
  refresh: () => undefined,
  teams: [],
  activeTeam: '',
  setActiveTeam: () => undefined,
  loadMore: () => undefined,
});
export function useDashboard() {
  return useContext(context);
}

export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const queueOwner = useRef<string | null>(null);
  const route = parseDashboardPathname(pathname);
  const repository = route?.kind === 'repository' ? route.ref : null;
  const repositoryKey = repository ? JSON.stringify(repository) : '';
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [activeTeam, setActiveTeam] = useState('');
  const queueKey = `${activeTeam}:${repositoryKey}`;
  const [pageState, setPageState] = useState({ key: '', page: '1' });
  if (pageState.key !== queueKey) setPageState({ key: queueKey, page: '1' });
  const queuePage = pageState.key === queueKey ? pageState.page : '1';
  const [queueState, setQueueState] = useState<{ key: string; data: QueueData }>({ key: '', data: emptyQueue });
  const queue = queueState.key === queueKey ? queueState.data : emptyQueue;
  const [session, setSession] = useState<SessionData>({ user: null, configured: false, demo: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch('/api/teams', { signal: abort.signal })
      .then(async (r) => {
        const value: unknown = await r.json();
        const parsed = teamListSchema.safeParse(value);
        if (parsed.success) setTeams(parsed.data.teams);
      })
      .catch(() => undefined);
    Promise.all([
      fetch('/api/session', { signal: abort.signal }).then(async (r): Promise<unknown> => r.json()),
      fetch(
        `/api/queue?team=${encodeURIComponent(activeTeam)}&repository=${encodeURIComponent(repositoryKey)}&cursor=${queuePage}`,
        { signal: abort.signal },
      ).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json() })),
    ])
      .then(([sessionValue, result]) => {
        if (abort.signal.aborted) return;
        const account = sessionSchema.safeParse(sessionValue);
        const data = queueSchema.safeParse(result.data);
        if (!account.success || (!account.data.user && !account.data.demo)) {
          queueOwner.current = null;
          setQueueState({ key: queueKey, data: emptyQueue });
          setSession(account.success ? account.data : { user: null, configured: false, demo: false });
          setError(account.success ? null : 'The account could not be verified. Try again.');
          setLoading(false);
          return;
        }
        const owner = account.data.demo ? 'demo' : (account.data.user?.id ?? null);
        const ownerChanged = owner !== queueOwner.current;
        if (ownerChanged) setQueueState({ key: queueKey, data: emptyQueue });
        queueOwner.current = owner;
        setSession(account.data);
        if (result.status === 401 || result.status === 403) setQueueState({ key: queueKey, data: emptyQueue });
        if (result.ok && data.success) {
          setQueueState((previous) => ({
            key: queueKey,
            data:
              queuePage === '1' || ownerChanged || previous.key !== queueKey
                ? data.data
                : {
                    ...data.data,
                    pulls: [
                      ...new Map(
                        [...previous.data.pulls, ...data.data.pulls].map((pull) => [JSON.stringify(pull.ref), pull]),
                      ).values(),
                    ],
                    repositories: [
                      ...new Map(
                        [...previous.data.repositories, ...data.data.repositories].map((repo) => [
                          JSON.stringify(repo.ref),
                          repo,
                        ]),
                      ).values(),
                    ],
                  },
          }));
          setError(null);
        } else if (!account.success || account.data.user) setError('The review queue could not be loaded. Try again.');
        setLoading(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          queueOwner.current = null;
          setQueueState({ key: queueKey, data: emptyQueue });
          setSession({ user: null, configured: false, demo: false });
          setError('The dashboard could not connect. Try again.');
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [revision, activeTeam, repositoryKey, queuePage, queueKey]);
  const data = {
    queue,
    session,
    loading,
    error,
    teams,
    activeTeam,
    setActiveTeam,
    loadMore: () => {
      setLoading(true);
      setPageState({ key: queueKey, page: queue.nextCursor ?? String(Number(queuePage) + 1) });
    },
    refresh: () => {
      setPageState({ key: queueKey, page: '1' });
      setQueueState({ key: queueKey, data: emptyQueue });
      setLoading(true);
      setRevision((value) => value + 1);
    },
  };
  return (
    <context.Provider value={data}>
      <div className="app-shell" data-collapsed={collapsed}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <aside className="desktop-sidebar">
          <Sidebar collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} />
        </aside>
        <div className="mobile-navigation">
          <Dialog.Root key={pathname}>
            <Dialog.Trigger className="icon-button" aria-label="Open navigation">
              <Menu size={20} />
            </Dialog.Trigger>
            <Link href="/" aria-label="Geld home">
              <Brand compact />
            </Link>
            <Dialog.Portal>
              <Dialog.Backdrop className="dialog-backdrop" />
              <Dialog.Popup className="mobile-sidebar">
                <Dialog.Title className="sr-only">Navigation</Dialog.Title>
                <Dialog.Close className="icon-button mobile-close" aria-label="Close navigation">
                  <X size={18} />
                </Dialog.Close>
                <Sidebar collapsed={false} />
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        <main id="main" className="main-content">
          {children}
        </main>
      </div>
    </context.Provider>
  );
}

function NavigationLink({
  href,
  icon: Icon,
  children,
  count,
}: {
  readonly href: string;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
  readonly count?: number;
}) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      data-measure="primary-nav"
      href={href}
      className={cn('nav-link', active && 'active')}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={17} />
      <span className="sidebar-label">{children}</span>
      {count !== undefined && count > 0 && <span className="nav-count sidebar-label">{count}</span>}
    </Link>
  );
}
function Sidebar({ collapsed, onCollapse }: { readonly collapsed: boolean; readonly onCollapse?: () => void }) {
  const { queue, session, teams, activeTeam, setActiveTeam } = useDashboard();
  const orgs = Array.from(
    new Map(
      queue.repositories.map((repo) => [`${repo.ref.provider}:${repo.ref.host}:${repo.ref.owner}`, repo.ref]),
    ).values(),
  );
  return (
    <div className="sidebar-inner">
      <div className="sidebar-brand">
        <Link href="/" aria-label="Geld home">
          <Brand />
        </Link>
        {onCollapse && (
          <button
            className="icon-button sidebar-label"
            onClick={onCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>
      <label className="workspace-switch">
        <span className="workspace-avatar">{session.user ? session.user.name.slice(0, 1).toUpperCase() : 'G'}</span>
        <span className="sidebar-label">
          <span className="sr-only">Active team</span>
          <select aria-label="Active team" value={activeTeam} onChange={(event) => setActiveTeam(event.target.value)}>
            <option value="">Personal view</option>
            {teams.map((team) => (
              <option value={team.id} key={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <small>{activeTeam ? 'Team repositories' : 'Across your providers'}</small>
        </span>
      </label>
      <nav aria-label="Main navigation">
        <div className="nav-section">
          <NavigationLink href="/" icon={GitPullRequest} count={queue.pulls.length}>
            Review queue
          </NavigationLink>
          <NavigationLink href="/repositories" icon={Layers}>
            Repositories
          </NavigationLink>
          <NavigationLink href="/teams" icon={Users}>
            Teams
          </NavigationLink>
          <NavigationLink href="/inbox" icon={Bell}>
            Inbox
          </NavigationLink>
        </div>
        <div className="nav-section">
          <p className="nav-heading sidebar-label">PROVIDERS</p>
          {orgs.length ? (
            orgs.map((ref) => (
              <details className="provider-group" key={`${ref.provider}:${ref.host}:${ref.owner}`} open>
                <summary>
                  <span className="provider-letter">
                    {ref.provider === 'github' ? 'GH' : ref.provider === 'gitlab' ? 'GL' : 'BB'}
                  </span>
                  <span className="sidebar-label provider-owner">{ref.owner}</span>
                  <ChevronDown size={12} className="sidebar-label" />
                </summary>
                <div className="provider-repos sidebar-label">
                  {queue.repositories
                    .filter(
                      (repo) =>
                        repo.ref.provider === ref.provider &&
                        repo.ref.host === ref.host &&
                        repo.ref.owner === ref.owner,
                    )
                    .map((repo) => (
                      <Link href={repositoryPath(repo.ref)} key={repo.id}>
                        <span className="repo-dot" />
                        {repo.ref.repo}
                      </Link>
                    ))}
                </div>
              </details>
            ))
          ) : (
            <Link href="/connect" className="nav-link">
              <Plus size={17} />
              <span className="sidebar-label">Connect a provider</span>
            </Link>
          )}
        </div>
        <div className="nav-section">
          <p className="nav-heading sidebar-label">WORKSPACE</p>
          {session.features?.projects && (
            <NavigationLink href="/projects" icon={Layers}>
              Projects
            </NavigationLink>
          )}
          {session.features?.roadmaps && (
            <NavigationLink href="/roadmap" icon={Layers}>
              Roadmap
            </NavigationLink>
          )}
          <NavigationLink href="/settings/providers" icon={Sparkles}>
            AI providers
          </NavigationLink>
          <NavigationLink href="/settings/models" icon={BookOpen}>
            Models
          </NavigationLink>
          <NavigationLink href="/settings/security" icon={ShieldCheck}>
            Security log
          </NavigationLink>
          <NavigationLink href="/settings" icon={Settings}>
            Settings
          </NavigationLink>
        </div>
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note sidebar-label">
          <span className="tiny-sparkle">
            <Sparkles size={14} />
          </span>
          <strong>A clearer way to review.</strong>
          <p>Follow the change, one step at a time.</p>
          <Link href="/settings/providers">
            Set up your guide <ChevronLeft size={12} className="rotate-180" />
          </Link>
        </div>
        <Link href="https://www.geld.sh/how-it-works" className="nav-link">
          <CircleHelp size={17} />
          <span className="sidebar-label">Help and documentation</span>
        </Link>
        <Link href={session.user ? '/settings/account' : '/sign-in'} className="account-link">
          <span className="account-avatar">{session.user?.name.slice(0, 1).toUpperCase() ?? 'G'}</span>
          <span className="sidebar-label">
            <strong>{session.user?.name ?? 'Sign in to Geld'}</strong>
            <small>{session.demo ? 'Local demonstration' : (session.user?.email ?? 'Your review workspace')}</small>
          </span>
          <Settings size={14} className="sidebar-label" />
        </Link>
      </div>
    </div>
  );
}
export function EmptyState({
  icon: Icon = Search,
  title,
  children,
  action,
}: {
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={27} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
