'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ChevronDown,
  Check,
  ChevronsUpDown,
  CircleHelp,
  GitPullRequest,
  Layers,
  Plus,
  Search,
  Settings,
  Users,
  FolderGit2,
  Lock,
  MoreHorizontal,
} from './icons';
import type { AppIcon } from './icons';
import { Popover } from '@base-ui/react/popover';
import { settingsLinks } from './settings-navigation';
import { readyForReview } from '@/lib/queue';
import { z } from 'zod';
import { parseDashboardPathname, repositoryPath } from '@geld/domain';
import { queueSchema, sessionSchema } from '@/lib/contracts';
import type { QueueData, SessionData } from '@/lib/contracts';
import { InboxPopover } from './inbox';
import { DashboardContext, useDashboard } from '@/lib/dashboard-context';
import { WorkspaceHeader } from './workspace-header';
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from './ui/sidebar';

const teamListSchema = z.object({
  teams: z.array(z.object({ id: z.string(), name: z.string() })),
});
const emptyQueue: QueueData = { pulls: [], repositories: [] };
export { useDashboard } from '@/lib/dashboard-context';

export function AppShell({
  children,
  navigation = true,
}: {
  readonly children: ReactNode;
  readonly navigation?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queueOwner = useRef<string | null>(null);
  const route = parseDashboardPathname(pathname);
  const repository = route?.kind === 'repository' ? route.ref : null;
  const repositoryKey = repository ? JSON.stringify(repository) : '';
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const routeTeam = /^\/teams\/([^/]+)/.exec(pathname)?.[1] ?? '';
  const [teamScope, setTeamScope] = useState({
    routeTeam,
    selected: routeTeam,
  });
  if (routeTeam && routeTeam !== teamScope.routeTeam) setTeamScope({ routeTeam, selected: routeTeam });
  const activeTeam = teamScope.selected;
  const setActiveTeam = (selected: string) => setTeamScope({ routeTeam, selected });
  const queueKey = `${activeTeam}:${repositoryKey}`;
  const [pageState, setPageState] = useState({ key: '', page: '1' });
  if (pageState.key !== queueKey) setPageState({ key: queueKey, page: '1' });
  const queuePage = pageState.key === queueKey ? pageState.page : '1';
  const [queueState, setQueueState] = useState<{
    key: string;
    data: QueueData;
  }>({ key: '', data: emptyQueue });
  const queue = queueState.key === queueKey ? queueState.data : emptyQueue;
  const [session, setSession] = useState<SessionData>({
    user: null,
    configured: false,
    demo: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [assistant, setAssistant] = useState({ path: pathname, open: false });
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      fetch('/api/session', { signal: abort.signal }).then(async (r): Promise<unknown> => r.json()),
      navigation
        ? fetch(
            `/api/queue?team=${encodeURIComponent(activeTeam)}&repository=${encodeURIComponent(repositoryKey)}&cursor=${queuePage}`,
            { signal: abort.signal },
          ).then(async (r) => ({
            ok: r.ok,
            status: r.status,
            data: await r.json(),
          }))
        : Promise.resolve({ ok: true, status: 200, data: emptyQueue }),
      navigation
        ? fetch('/api/teams', { signal: abort.signal })
            .then(async (response): Promise<unknown> => (response.ok ? response.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([sessionValue, result, teamValue]) => {
        if (abort.signal.aborted) return;
        const account = sessionSchema.safeParse(sessionValue);
        const data = queueSchema.safeParse(result.data);
        if (!account.success || (!account.data.user && !account.data.demo)) {
          queueOwner.current = null;
          setTeams([]);
          if (!routeTeam) setTeamScope((previous) => (previous.selected ? { routeTeam, selected: '' } : previous));
          setQueueState({ key: queueKey, data: emptyQueue });
          setSession(account.success ? account.data : { user: null, configured: false, demo: false });
          setError(account.success ? null : 'The account could not be verified. Try again.');
          setLoading(false);
          return;
        }
        const owner = account.data.demo ? 'demo' : (account.data.user?.id ?? null);
        const ownerChanged = owner !== queueOwner.current;
        if (ownerChanged) {
          setQueueState({ key: queueKey, data: emptyQueue });
          if (queueOwner.current && !routeTeam)
            setTeamScope((previous) => (previous.selected ? { routeTeam, selected: '' } : previous));
        }
        queueOwner.current = owner;
        setSession(account.data);
        const teamList = teamListSchema.safeParse(teamValue);
        setTeams(teamList.success ? teamList.data.teams : []);
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
          setTeams([]);
          if (!routeTeam) setTeamScope((previous) => (previous.selected ? { routeTeam, selected: '' } : previous));
          setQueueState({ key: queueKey, data: emptyQueue });
          setSession({ user: null, configured: false, demo: false });
          setError('The dashboard could not connect. Try again.');
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [revision, activeTeam, repositoryKey, queuePage, queueKey, routeTeam, navigation]);
  useEffect(() => {
    if (navigation && !loading && !error && !session.user && !session.demo) router.replace('/sign-in');
  }, [navigation, loading, error, session.user, session.demo, router]);
  const data = {
    assistantOpen: assistant.path === pathname && assistant.open,
    setAssistantOpen: (open: boolean) => setAssistant({ path: pathname, open }),
    queue,
    session,
    loading,
    error,
    teams,
    activeTeam,
    setActiveTeam,
    loadMore: () => {
      setLoading(true);
      setPageState({
        key: queueKey,
        page: queue.nextCursor ?? String(Number(queuePage) + 1),
      });
    },
    refresh: () => {
      setPageState({ key: queueKey, page: '1' });
      setQueueState({ key: queueKey, data: emptyQueue });
      setLoading(true);
      setRevision((value) => value + 1);
    },
  };
  return (
    <DashboardContext.Provider value={data}>
      {!navigation ? (
        <div className="auth-shell isolate">
          <main id="main" className="main-content">
            {children}
          </main>
        </div>
      ) : !session.user && !session.demo ? (
        <main id="main" className="page" role="status">
          <p>{error ?? 'Loading your workspace...'}</p>
          {error && (
            <button type="button" className="button" onClick={data.refresh}>
              Try again
            </button>
          )}
        </main>
      ) : (
        <SidebarProvider className="app-shell isolate" navigationKey={pathname}>
          <WorkspaceChrome>{children}</WorkspaceChrome>
        </SidebarProvider>
      )}
    </DashboardContext.Provider>
  );
}
function WorkspaceChrome({ children }: { readonly children: ReactNode }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => {
    const close = () => setOpenMobile(false);
    window.addEventListener('geld:close-navigation', close);
    return () => window.removeEventListener('geld:close-navigation', close);
  }, [setOpenMobile]);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <AppSidebar />
      <div className="workspace-main">
        <WorkspaceHeader />
        <main id="main" className="main-content">
          {children}
        </main>
      </div>
    </>
  );
}

function NavigationLink({
  href,
  icon: Icon,
  children,
  count,
}: {
  readonly href: string;
  readonly icon: AppIcon;
  readonly children: ReactNode;
  readonly count?: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [base, query] = href.split('?');
  const active = query
    ? pathname === base &&
      [...new URLSearchParams(query)].every(
        ([key, value]) => (params.get(key) ?? (key === 'view' ? 'repositories' : '')) === value,
      )
    : base === '/'
      ? pathname === '/'
      : pathname === base || pathname.startsWith(base + '/');
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={href} />}
        isActive={active}
        data-measure="primary-nav"
        aria-label={typeof children === 'string' ? children : undefined}
        title={typeof children === 'string' ? children : undefined}
        aria-current={active ? 'page' : undefined}
      >
        <Icon size={16} />
        <span>{children}</span>
      </SidebarMenuButton>
      {count !== undefined && count > 0 && <SidebarMenuBadge>{count}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function AppSidebar() {
  const pathname = usePathname();
  const { queue, session } = useDashboard();
  const route = parseDashboardPathname(pathname);
  const scopedSettings = route && route.kind !== 'pull' && route.settings;
  const teamPath = /^\/teams\/[^/]+/.exec(pathname)?.[0];
  const teamSettings = !!teamPath;
  const settings =
    pathname.startsWith('/settings') || pathname.startsWith('/connect') || scopedSettings || teamSettings;
  const scopePath = scopedSettings
    ? route.kind === 'repository'
      ? repositoryPath(route.ref)
      : pathname.replace(/\/~settings$/, '')
    : (teamPath ?? '/');
  const teamLinks = teamPath
    ? [
        {
          href: teamPath + '?view=repositories',
          name: 'Repositories',
          icon: Layers,
        },
        { href: teamPath + '?view=members', name: 'Members', icon: Users },
        {
          href: teamPath + '?view=access',
          name: 'Access and permissions',
          icon: Settings,
        },
        {
          href: teamPath + '/settings',
          name: 'Review defaults',
          icon: GitPullRequest,
        },
        {
          href: teamPath + '?view=sso',
          name: 'Single sign-on',
          icon: Settings,
        },
        {
          href: teamPath + '?view=activity',
          name: 'Grant ledger',
          icon: Layers,
        },
        { href: teamPath + '?view=advanced', name: 'Advanced', icon: Settings },
      ]
    : [];
  const scopedName = scopedSettings
    ? route.kind === 'repository'
      ? route.ref.repo
      : route.owner
    : teamSettings
      ? 'Team settings'
      : 'Settings';
  const orgs = Array.from(
    new Map(
      queue.repositories.map((repo) => [`${repo.ref.provider}:${repo.ref.host}:${repo.ref.owner}`, repo.ref]),
    ).values(),
  );
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <TeamSwitcher />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={settings ? 'Settings navigation' : 'Main navigation'}>
          {settings ? (
            <SidebarGroup>
              <SidebarMenu>
                <NavigationLink href={teamSettings ? '/teams' : scopePath} icon={ArrowLeft}>
                  {teamSettings ? 'All teams' : scopedSettings ? 'Back to scope' : 'Back to workspace'}
                </NavigationLink>
              </SidebarMenu>
              <SidebarGroupLabel>{scopedName}</SidebarGroupLabel>
              <SidebarMenu>
                {(teamSettings
                  ? teamLinks
                  : scopedSettings
                    ? [{ href: pathname, name: 'General', icon: Settings }]
                    : settingsLinks
                ).map(({ href, name, icon }) => (
                  <NavigationLink key={href} href={href} icon={icon}>
                    {name}
                  </NavigationLink>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : (
            <>
              <SidebarGroup>
                <SidebarMenu>
                  <NavigationLink href="/" icon={GitPullRequest} count={queue.pulls.filter(readyForReview).length}>
                    Review queue
                  </NavigationLink>
                  <NavigationLink href="/repositories" icon={Layers}>
                    Repositories
                  </NavigationLink>
                </SidebarMenu>
              </SidebarGroup>
              <SidebarGroup className="group-data-[collapsible=icon]:hidden">
                <SidebarGroupLabel>Organizations</SidebarGroupLabel>
                <SidebarMenu>
                  {orgs.map((ref) => (
                    <SidebarMenuItem key={`${ref.provider}:${ref.host}:${ref.owner}`}>
                      <details className="sidebar-organization" open>
                        <SidebarMenuButton render={<summary />}>
                          <ChevronDown size={16} />
                          <span className="min-w-0 flex-1 truncate">{ref.owner}</span>
                          <span className="git-host-mark" title={ref.host}>
                            {ref.provider === 'github' ? 'GH' : ref.provider === 'gitlab' ? 'GL' : 'BB'}
                          </span>
                        </SidebarMenuButton>
                        <SidebarMenuSub>
                          {queue.repositories
                            .filter(
                              (repo) =>
                                repo.ref.provider === ref.provider &&
                                repo.ref.host === ref.host &&
                                repo.ref.owner === ref.owner,
                            )
                            .map((repo) => (
                              <SidebarMenuSubItem key={repo.id}>
                                <SidebarMenuSubButton
                                  render={<Link href={repositoryPath(repo.ref)} />}
                                  isActive={pathname === repositoryPath(repo.ref)}
                                  aria-current={pathname === repositoryPath(repo.ref) ? 'page' : undefined}
                                >
                                  {repo.private ? <Lock size={16} /> : <FolderGit2 size={16} />}
                                  <span>{repo.ref.repo}</span>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                        </SidebarMenuSub>
                      </details>
                    </SidebarMenuItem>
                  ))}
                  {!orgs.length && (
                    <NavigationLink href="/connect" icon={Plus}>
                      Connect repositories
                    </NavigationLink>
                  )}
                </SidebarMenu>
              </SidebarGroup>
              {(session.features?.projects || session.features?.roadmaps) && (
                <SidebarGroup>
                  <SidebarMenu>
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
                  </SidebarMenu>
                </SidebarGroup>
              )}
            </>
          )}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <AccountMenu />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

function TeamSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { teams, activeTeam, setActiveTeam } = useDashboard();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const name = teams.find((team) => team.id === activeTeam)?.name ?? 'Personal view';
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className="team-switcher">
        <span className="workspace-avatar">{activeTeam ? name.slice(0, 1) : <Users size={16} />}</span>
        <span className="workspace-name" title={name}>
          {name}
        </span>
        <Popover.Trigger className="icon-button team-switcher-trigger" aria-label="Switch team" title="Switch team">
          <ChevronsUpDown size={16} />
          <span className="touch-target" aria-hidden="true" />
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="popover-positioner">
          <Popover.Popup className="scope-menu">
            <Popover.Title className="sr-only">Choose a team</Popover.Title>
            <label className="menu-search">
              <Search size={15} />
              <input
                name="teamSearch"
                aria-label="Find a team"
                placeholder="Find a team…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="scope-options">
              {[{ id: '', name: 'Personal view' }, ...teams]
                .filter((team) => team.name.toLowerCase().includes(query.toLowerCase()))
                .map((team) => (
                  <button
                    type="button"
                    key={team.id}
                    aria-label={team.name}
                    onClick={() => {
                      setActiveTeam(team.id);
                      const currentTeam = /^\/teams\/[^/]+/.exec(pathname)?.[0];
                      const scoped = parseDashboardPathname(pathname);
                      if (scoped && (scoped.kind === 'pull' || !scoped.settings)) router.push('/');
                      else if (currentTeam)
                        router.push(
                          team.id ? pathname.replace(currentTeam, '/teams/' + encodeURIComponent(team.id)) : '/',
                        );
                      setOpen(false);
                    }}
                    aria-pressed={team.id === activeTeam}
                  >
                    <span className="workspace-avatar">{team.id ? team.name.slice(0, 1) : <Users size={15} />}</span>
                    <span>{team.name}</span>
                    {team.id === activeTeam && <Check size={15} />}
                  </button>
                ))}
            </div>
            <Link href="/teams" className="menu-link" onClick={() => setOpen(false)}>
              <Users size={16} />
              Manage teams
            </Link>
            <Link href="/teams?create=1" className="menu-link" onClick={() => setOpen(false)}>
              <Plus size={16} />
              Create team
            </Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
function AccountMenu() {
  const { session } = useDashboard();
  const [open, setOpen] = useState(false);
  return (
    <div className="account-row">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          render={<SidebarMenuButton className="account-trigger" />}
          aria-label="Account menu"
          title={session.user?.name ?? 'Sign in'}
        >
          <span className="account-avatar">{session.user?.name.slice(0, 1).toUpperCase() ?? 'G'}</span>
          <span className="account-name">{session.user?.name ?? 'Sign in'}</span>
          <MoreHorizontal size={16} className="ml-auto" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="top" align="start" sideOffset={6} className="popover-positioner">
            <Popover.Popup className="account-menu">
              <Popover.Title>{session.user?.name ?? 'Your account'}</Popover.Title>
              {session.user && <p className="muted account-email">{session.user.email}</p>}
              <Link
                href={session.user ? '/settings/account' : '/sign-in'}
                className="menu-link"
                onClick={() => setOpen(false)}
              >
                <Settings size={16} />
                {session.user ? 'Settings' : 'Sign in'}
              </Link>
              <Link href="https://www.geld.sh/how-it-works" className="menu-link">
                <CircleHelp size={16} />
                Documentation
              </Link>
              <button
                type="button"
                className="menu-link"
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new Event('geld:close-navigation'));
                  requestAnimationFrame(() => window.dispatchEvent(new Event('geld:privacy')));
                }}
              >
                Privacy choices
              </button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <InboxPopover />
    </div>
  );
}
export function EmptyState({
  icon: Icon = Search,
  title,
  children,
  action,
}: {
  readonly icon?: AppIcon;
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
