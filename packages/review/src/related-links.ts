/**
 * Links in a pull request that lead to the context it came from: the ticket it closes, the chat thread it was asked
 * for in, the agent session that wrote it, the review tool that read it, the design or doc behind it. Each link is
 * read by an exact pattern over its host, path and the query parameters it needs (anchored from start to end), so a
 * settings page, a docs link or a share button on the same site is never taken for one. Surveyed on public pull
 * request bodies through GitHub search in Nov 2026; the shapes each pattern was read from are in its test.
 */

import { botById } from './bots';

export type RelatedKind = 'github' | 'ticket' | 'conversation' | 'agent' | 'review' | 'doc' | 'error';

/**
 * The order the kinds are listed in: GitHub's own pull requests and issues, then what the pull request is for, where
 * it was asked, who wrote it, what read it.
 */
export const RELATED_KIND_ORDER: readonly RelatedKind[] = ['github', 'ticket', 'conversation', 'agent', 'review', 'doc', 'error'];

/** A bundled mark for services with no GitHub App to borrow a picture from (`public/tracker-icons/<name>.svg`). */
export type RelatedIcon = 'linear' | 'jira' | 'asana' | 'youtrack' | 'gitlab' | 'bitbucket';

export interface RelatedLink {
  /** Two links with one key lead to the same thing (Cursor's "Open in Web" and "Open in Cursor"). */
  readonly key: string;
  readonly kind: RelatedKind;
  /** "Linear", "Slack", "Replicas". */
  readonly service: string;
  /** What the link leads to within the service: "issue", "thread", "workspace". */
  readonly noun: string;
  /** The identifier the service shows for it, when the link names one: "LIM-1391", "sc-123". */
  readonly ref: string | null;
  /** What it is called, when the link's words or its URL say: a ticket's title from its slug, the link's own text. */
  readonly title: string | null;
  /** Where it lives: a Slack workspace, a Jira site, a Linear workspace. */
  readonly context: string | null;
  readonly href: string;
  /** The words for following it: "View workspace in Replicas", "Open thread in Slack". */
  readonly action: string;
  /** The GitHub App whose mark stands for the service (`avatars.githubusercontent.com/in/<id>`). */
  readonly appId: number | null;
  readonly icon: RelatedIcon | null;
}

/** A link as the page or the Markdown has it: its target and the words it shows (its text and any image's alt). */
export interface LinkCandidate {
  readonly href: string;
  readonly text: string;
  /**
   * Who wrote the comment the link is in; absent for the description. A comment's link counts only when its author
   * is the service's own bot (`officialSources`): Linear's linkback naming its issue, not a person pasting one.
   */
  readonly author?: string | null;
}

interface Match {
  readonly url: URL;
  readonly host: RegExpExecArray;
  readonly path: RegExpExecArray;
  readonly query: ReadonlyMap<string, string>;
  readonly text: string;
}

interface Reading {
  /** Unique within the service. */
  readonly id: string;
  readonly noun: string;
  readonly ref?: string | null;
  readonly title?: string | null;
  readonly context?: string | null;
}

interface LinkSpec {
  /** The service's id, the first part of every key it reads. */
  readonly id: string;
  readonly service: string;
  readonly kind: RelatedKind;
  /** The whole hostname. */
  readonly host: RegExp;
  /** The whole pathname. */
  readonly path: RegExp;
  /** Parameters the link must carry, each value matched whole. Others are allowed and kept. */
  readonly query?: Readonly<Record<string, RegExp>>;
  readonly read: (match: Match) => Reading | null;
  readonly verb?: 'View' | 'Open';
  /** Overrides the service's name in the action ("Open in Devin Desktop"). */
  readonly actionTarget?: string;
  readonly appId?: number;
  /** A review bot whose registry mark stands for the service. */
  readonly bot?: string;
  readonly icon?: RelatedIcon;
  /** Of two links with one key, the lower rank is kept: the web page over a desktop deep link. */
  readonly rank?: number;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REPO_PART = '[\\w.-]+';
/** A URL slug as the browser hands it over: percent-escapes for any script, dots and tildes. */
const SLUG = '[\\w%.~-]+';

const group = (match: RegExpExecArray, index: number): string => match[index] ?? '';

/** A URL slug as words: `feat-streaming-add-buffered` → "Feat streaming add buffered". */
export function slugTitle(slug: string): string | null {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug.replace(/\+/g, ' '));
  } catch {
    // A malformed escape leaves the slug as written.
  }
  const words = decoded.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (words === '' || /^[\da-f\s]+$/i.test(words)) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DEVIN_HOST = /^(?:app\.devin\.ai|[a-z0-9-]+\.devinenterprise\.com)$/;
const WARP_HOST = /^(?:app|staging)\.warp\.dev$/;

/** YouTrack Cloud (`<site>.youtrack.cloud`) and a self-hosted one (`youtrack.<company>`). */
const YOUTRACK_HOST = /^(?:([a-z0-9][a-z0-9-]*)\.youtrack\.cloud|(youtrack\.[a-z0-9-]+(?:\.[a-z0-9-]+)+))$/;
const youtrackSite = (host: RegExpExecArray): string => host[1] ?? group(host, 2);
const YOUTRACK_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

const linkSpecs: readonly LinkSpec[] = [
  // Tickets.
  {
    id: 'linear',
    service: 'Linear',
    kind: 'ticket',
    host: /^linear\.app$/,
    path: new RegExp(`^/([\\w-]+)/issue/([A-Za-z][A-Za-z0-9_]*-\\d+)(?:/(${SLUG}))?/?$`),
    read: ({ path }) => {
      const key = group(path, 2).toUpperCase();
      return { id: `${group(path, 1)}:${key}`, noun: 'issue', ref: key, title: path[3] === undefined ? null : slugTitle(path[3]), context: group(path, 1) };
    },
    appId: 20150,
    icon: 'linear',
  },
  {
    id: 'linear',
    service: 'Linear',
    kind: 'ticket',
    host: /^linear\.app$/,
    path: new RegExp(`^/([\\w-]+)/(project|document)/(${SLUG}?)-([0-9a-f]{12})(?:/(?:overview|issues|updates|documents|activity))?/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}:${group(path, 4)}`, noun: group(path, 2), title: slugTitle(group(path, 3)), context: group(path, 1) }),
    appId: 20150,
    icon: 'linear',
  },
  {
    // Linear's review of the pull request, linked under its linkback. The slug is the pull request's own title.
    id: 'linear',
    service: 'Linear',
    kind: 'review',
    host: /^linear\.app$/,
    path: new RegExp(`^/([\\w-]+)/review/(?:${SLUG}-)?([0-9a-z]{8,})/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}:review:${group(path, 2)}`, noun: 'review', context: group(path, 1) }),
    appId: 20150,
    icon: 'linear',
  },
  {
    // An issue linked by its id rather than its key.
    id: 'linear',
    service: 'Linear',
    kind: 'ticket',
    host: /^linear\.app$/,
    path: new RegExp(`^/([\\w-]+)/issue/(${UUID})/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}`, noun: 'issue', context: group(path, 1) }),
    appId: 20150,
    icon: 'linear',
  },
  {
    // Atlassian Cloud (`<site>.atlassian.net`), Atlassian's own tracker, and a self-hosted Jira (`jira.<company>`,
    // `issues.apache.org/jira`), all on the same `/browse/<KEY>` path.
    id: 'jira',
    service: 'Jira',
    kind: 'ticket',
    host: /^(?:([a-z0-9][a-z0-9-]*)\.atlassian\.net|(jira\.atlassian\.com|(?:jira|issues)\.[a-z0-9-]+(?:\.[a-z0-9-]+)+))$/,
    path: /^\/(?:jira\/)?browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/,
    read: ({ host, path }) => {
      const site = host[1] ?? group(host, 2);
      return { id: `${site}:${group(path, 1)}`, noun: 'issue', ref: group(path, 1), context: site };
    },
    icon: 'jira',
  },
  {
    // A board or the issue list with the issue open beside it.
    id: 'jira',
    service: 'Jira',
    kind: 'ticket',
    host: /^([a-z0-9][a-z0-9-]*)\.atlassian\.net$/,
    path: /^\/jira\/(?:software\/(?:c\/)?)?projects\/[A-Z][A-Z0-9_]*\/(?:boards\/\d+(?:\/backlog)?|issues|list)\/?$/,
    query: { selectedIssue: /^[A-Z][A-Z0-9_]*-\d+$/ },
    read: ({ host, query }) => {
      const key = query.get('selectedIssue') ?? '';
      return { id: `${group(host, 1)}:${key}`, noun: 'issue', ref: key, context: group(host, 1) };
    },
    icon: 'jira',
    rank: 1,
  },
  {
    id: 'youtrack',
    service: 'YouTrack',
    kind: 'ticket',
    host: YOUTRACK_HOST,
    path: new RegExp(`^/issue/([A-Za-z][A-Za-z0-9_]*-\\d+)(?:/(${SLUG}))?/?$`),
    read: ({ host, path }) => ({ id: `${youtrackSite(host)}:${group(path, 1)}`, noun: 'issue', ref: group(path, 1), title: path[2] === undefined ? null : slugTitle(path[2]), context: youtrackSite(host) }),
    icon: 'youtrack',
  },
  {
    // The issue open beside a list (`/issues?preview=KEY`, a saved search) or on a board (`/agiles/<board>/current?issue=KEY`).
    id: 'youtrack',
    service: 'YouTrack',
    kind: 'ticket',
    host: YOUTRACK_HOST,
    path: /^\/(?:issues|search\/[^/]+)\/?$/,
    query: { preview: YOUTRACK_KEY },
    read: ({ host, query }) => ({ id: `${youtrackSite(host)}:${query.get('preview') ?? ''}`, noun: 'issue', ref: query.get('preview') ?? null, context: youtrackSite(host) }),
    icon: 'youtrack',
    rank: 1,
  },
  {
    id: 'youtrack',
    service: 'YouTrack',
    kind: 'ticket',
    host: YOUTRACK_HOST,
    path: /^\/agiles\/[\w-]+\/[\w-]+\/?$/,
    query: { issue: YOUTRACK_KEY },
    read: ({ host, query }) => ({ id: `${youtrackSite(host)}:${query.get('issue') ?? ''}`, noun: 'issue', ref: query.get('issue') ?? null, context: youtrackSite(host) }),
    icon: 'youtrack',
    rank: 1,
  },
  {
    id: 'youtrack-article',
    service: 'YouTrack',
    kind: 'doc',
    host: YOUTRACK_HOST,
    path: new RegExp(`^/articles/([A-Za-z][A-Za-z0-9_]*-A-\\d+)(?:/(${SLUG}))?/?$`),
    read: ({ host, path }) => ({ id: `${youtrackSite(host)}:${group(path, 1)}`, noun: 'article', ref: group(path, 1), title: path[2] === undefined ? null : slugTitle(path[2]), context: youtrackSite(host) }),
    icon: 'youtrack',
  },
  {
    id: 'height',
    service: 'Height',
    kind: 'ticket',
    host: /^height\.app$/,
    path: new RegExp(`^/([\\w-]+)/(T-\\d+)(?:/(${SLUG}))?/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}`, noun: 'task', ref: group(path, 2), title: path[3] === undefined ? null : slugTitle(path[3]) }),
  },
  {
    id: 'plane',
    service: 'Plane',
    kind: 'ticket',
    host: /^app\.plane\.so$/,
    path: /^\/([\w-]+)\/browse\/([A-Z][A-Z0-9_]*-\d+)\/?$/,
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}`, noun: 'issue', ref: group(path, 2), context: group(path, 1) }),
  },
  {
    id: 'shortcut',
    service: 'Shortcut',
    kind: 'ticket',
    host: /^app\.shortcut\.com$/,
    path: new RegExp(`^/([\\w-]+)/story/(\\d+)(?:/(${SLUG}))?/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}`, noun: 'story', ref: `sc-${group(path, 2)}`, title: path[3] === undefined ? null : slugTitle(path[3]), context: group(path, 1) }),
  },
  {
    id: 'shortcut-epic',
    service: 'Shortcut',
    kind: 'ticket',
    host: /^app\.shortcut\.com$/,
    path: new RegExp(`^/([\\w-]+)/epic/(\\d+)(?:/(${SLUG}))?/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}`, noun: 'epic', title: path[3] === undefined ? null : slugTitle(path[3]), context: group(path, 1) }),
  },
  {
    id: 'asana',
    service: 'Asana',
    kind: 'ticket',
    host: /^app\.asana\.com$/,
    path: /^\/(?:0\/\d+\/(\d+)(?:\/f)?|1\/\d+\/(?:(?:home|inbox|search|project\/\d+(?:\/list\/\d+)?)\/)?task\/(\d+)(?:\/comment\/\d+)?)\/?$/,
    read: ({ path }) => ({ id: path[1] ?? group(path, 2), noun: 'task' }),
    icon: 'asana',
  },
  {
    id: 'clickup',
    service: 'ClickUp',
    kind: 'ticket',
    host: /^app\.clickup\.com$/,
    path: /^\/t\/(?:\d+\/)?([A-Za-z0-9-]+)\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'task', ref: group(path, 1) }),
    appId: 68952,
  },
  {
    id: 'clickup-doc',
    service: 'ClickUp',
    kind: 'doc',
    host: /^app\.clickup\.com$/,
    path: /^\/\d+\/docs\/([\w-]+)(?:\/[\w-]+)?\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'doc' }),
    appId: 68952,
  },
  {
    id: 'trello',
    service: 'Trello',
    kind: 'ticket',
    host: /^trello\.com$/,
    path: new RegExp(`^/c/([A-Za-z0-9]{8}|[0-9a-f]{24})(?:/(?:\\d+-)?(${SLUG}))?/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'card', title: path[2] === undefined ? null : slugTitle(path[2]) }),
  },

  // Conversations.
  {
    id: 'slack',
    service: 'Slack',
    kind: 'conversation',
    host: /^(?:([a-z0-9][a-z0-9-]*)(?:\.enterprise)?\.)?slack\.com$/,
    path: /^\/archives\/([CDGZ][A-Z0-9]{6,})(?:\/p(\d{10})(\d{6}))?\/?$/,
    read: ({ host, path, query, text }) => {
      const workspace = host[1] === undefined || host[1] === 'app' ? null : host[1];
      if (workspace === 'hooks' || workspace === 'api' || workspace === 'files') return null;
      const channel = group(path, 1);
      const direct = channel.startsWith('D');
      const context = [workspace, direct ? 'direct message' : null].filter((part) => part !== null).join(' · ') || null;
      if (path[2] === undefined) return { id: `${workspace ?? ''}:${channel}`, noun: direct ? 'direct message' : 'channel', context: workspace };
      const ts = `${group(path, 2)}.${group(path, 3)}`;
      const thread = query.get('thread_ts');
      const root = thread !== undefined && /^\d{10}\.\d{6}$/.test(thread) ? thread : null;
      return { id: `${workspace ?? ''}:${channel}:${root ?? ts}`, noun: root !== null || /\bthread\b/i.test(text) ? 'thread' : 'message', context };
    },
    appId: 7100,
  },
  {
    // The web client's own address for a thread: `/client/<team>/<channel>/thread/<channel>-<ts>`.
    id: 'slack',
    service: 'Slack',
    kind: 'conversation',
    host: /^app\.slack\.com$/,
    path: /^\/client\/(T[A-Z0-9]+)\/([CDGZ][A-Z0-9]{6,})(?:\/thread\/[CDGZ][A-Z0-9]{6,}-(\d{10}\.\d{6}))?\/?$/,
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}${path[3] === undefined ? '' : `:${path[3]}`}`, noun: path[3] === undefined ? 'channel' : 'thread' }),
    appId: 7100,
  },
  {
    id: 'discord',
    service: 'Discord',
    kind: 'conversation',
    host: /^(?:www\.|ptb\.|canary\.)?discord(?:app)?\.com$/,
    path: /^\/channels\/(\d+|@me)\/(\d+)(?:\/(threads\/)?(\d+))?\/?$/,
    read: ({ path }) => ({ id: `${group(path, 1)}:${group(path, 2)}:${path[4] ?? ''}`, noun: path[4] === undefined ? 'channel' : path[3] === undefined ? 'message' : 'thread' }),
  },
  {
    id: 'teams',
    service: 'Microsoft Teams',
    kind: 'conversation',
    host: /^teams\.microsoft\.com$/,
    // `/l/message/<thread>/<message id>`, `/l/channel/<channel>/<name>`, `/l/chat/0/0?users=…`: a message is one of
    // many in its thread, and a chat is told apart only by its query.
    path: /^\/l\/(message|channel|chat)\/([^/]+)(?:\/([^/]+))?(?:\/[^/]+)*\/?$/,
    read: ({ url, path }) => {
      const kind = group(path, 1);
      const where = decodeSafe(group(path, 2));
      const id = kind === 'message' ? `${where}:${path[3] ?? ''}` : kind === 'chat' ? `${where}:${path[3] ?? ''}${url.search}` : where;
      return { id: `${kind}:${id}`, noun: kind };
    },
    appId: 66341,
  },

  // Agent sessions.
  {
    id: 'replicas',
    service: 'Replicas',
    kind: 'agent',
    host: /^(?:app\.)?replicas\.dev$/,
    path: new RegExp(`^/workspaces/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'workspace' }),
    verb: 'View',
    bot: 'replicas',
  },
  {
    id: 'replicas-automation',
    service: 'Replicas',
    kind: 'agent',
    host: /^(?:app\.)?replicas\.dev$/,
    path: new RegExp(`^/automations/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'automation' }),
    verb: 'View',
    bot: 'replicas',
  },
  {
    id: 'devin',
    service: 'Devin',
    kind: 'agent',
    host: DEVIN_HOST,
    path: /^\/sessions\/([0-9a-f]{32})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    verb: 'View',
    bot: 'devin',
  },
  {
    id: 'devin',
    service: 'Devin',
    kind: 'agent',
    host: DEVIN_HOST,
    path: /^\/desktop\/session\/([0-9a-f]{32})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    actionTarget: 'Devin Desktop',
    bot: 'devin',
    rank: 1,
  },
  {
    id: 'cursor',
    service: 'Cursor',
    kind: 'agent',
    host: /^(?:www\.)?cursor\.com$/,
    path: new RegExp(`^/agents/(bc-${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'agent' }),
    verb: 'View',
    bot: 'bugbot',
  },
  {
    // "Open in Cursor": the same agent in the desktop app.
    id: 'cursor',
    service: 'Cursor',
    kind: 'agent',
    host: /^(?:www\.)?cursor\.com$/,
    path: /^\/background-agent\/?$/,
    query: { bcId: new RegExp(`^bc-${UUID}$`) },
    read: ({ query }) => ({ id: query.get('bcId') ?? '', noun: 'agent' }),
    bot: 'bugbot',
    rank: 1,
  },
  {
    id: 'cursor',
    service: 'Cursor',
    kind: 'agent',
    host: /^(?:www\.)?cursor\.com$/,
    path: /^\/agents\/?$/,
    query: { id: new RegExp(`^bc-${UUID}$`) },
    read: ({ query }) => ({ id: query.get('id') ?? '', noun: 'agent' }),
    verb: 'View',
    bot: 'bugbot',
  },
  {
    id: 'cursor-automation',
    service: 'Cursor',
    kind: 'agent',
    host: /^(?:www\.)?cursor\.com$/,
    path: new RegExp(`^/automations/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'automation' }),
    verb: 'View',
    bot: 'bugbot',
  },
  {
    id: 'codex',
    service: 'Codex',
    kind: 'agent',
    host: /^chatgpt\.com$/,
    path: new RegExp(`^/codex/(?:cloud/)?tasks/(task_[a-z]_[0-9a-f]{32}|${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'task' }),
    verb: 'View',
    bot: 'codex',
  },
  {
    id: 'claude-code',
    service: 'Claude Code',
    kind: 'agent',
    host: /^claude\.ai$/,
    path: /^\/code\/(session_[A-Za-z0-9]{20,})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    verb: 'View',
    bot: 'claude',
  },
  {
    // A Claude Code project's channel, opened at the thread a request was made in ("Requested by … · project thread").
    id: 'claude-code',
    service: 'Claude Code',
    kind: 'agent',
    host: /^claude\.ai$/,
    path: /^\/code\/project\/(chan_[A-Za-z0-9]{20,})\/?$/,
    read: ({ path, query }) => {
      const thread = query.get('thread');
      return thread !== undefined && /^cmsg_[A-Za-z0-9]{20,}$/.test(thread) ? { id: thread, noun: 'thread' } : { id: group(path, 1), noun: 'project' };
    },
    verb: 'View',
    bot: 'claude',
  },
  {
    // A thread's hosted link, what T3 Code's Copy thread writes (pingdotgg/t3code#26290): ids percent-encode anything
    // outside [A-Za-z0-9_-]. Its prompt links (`/new?prompt=`) are drafts, not work done on the pull request.
    id: 't3code',
    service: 'T3 Code',
    kind: 'agent',
    host: /^app\.t3\.codes$/,
    path: /^\/threads\/([\w%-]+)\/([\w%-]+)\/?$/,
    read: ({ path }) => ({ id: `${group(path, 1)}/${group(path, 2)}`, noun: 'thread' }),
    verb: 'View',
  },
  {
    id: 'jules',
    service: 'Jules',
    kind: 'agent',
    host: /^jules\.google\.com$/,
    path: /^\/(session|task)\/(\d{6,})\/?$/,
    read: ({ path }) => ({ id: group(path, 2), noun: group(path, 1) }),
    verb: 'View',
    appId: 842251,
  },
  {
    id: 'copilot',
    service: 'Copilot',
    kind: 'agent',
    host: /^github\.com$/,
    path: /^\/copilot\/tasks\/pull\/(PR_[\w-]+)\/?$/,
    query: { session_id: new RegExp(`^${UUID}$`) },
    read: ({ query }) => ({ id: query.get('session_id') ?? '', noun: 'session' }),
    verb: 'View',
    appId: 1143301,
  },
  {
    id: 'copilot',
    service: 'Copilot',
    kind: 'agent',
    host: /^github\.com$/,
    path: new RegExp(`^/${REPO_PART}/${REPO_PART}/pull/\\d+/agent-sessions/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    verb: 'View',
    appId: 1143301,
  },
  {
    id: 'factory',
    service: 'Factory',
    kind: 'agent',
    host: /^app\.factory\.ai$/,
    path: /^\/sessions\/(?!new\/?$)([\w-]{8,})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    verb: 'View',
    appId: 358017,
  },
  {
    id: 'factory-automation',
    service: 'Factory',
    kind: 'agent',
    host: /^app\.factory\.ai$/,
    path: /^\/automations\/?$/,
    query: { editAutomationId: new RegExp(`^${UUID}$`) },
    read: ({ query }) => ({ id: query.get('editAutomationId') ?? '', noun: 'automation' }),
    verb: 'View',
    appId: 358017,
  },
  {
    id: 'amp',
    service: 'Amp',
    kind: 'agent',
    host: /^ampcode\.com$/,
    path: new RegExp(`^/threads/(T-${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'thread' }),
    verb: 'View',
  },
  {
    id: 'openhands',
    service: 'OpenHands',
    kind: 'agent',
    host: /^app\.all-hands\.dev$/,
    path: new RegExp(`^/(?:canvas/)?conversations/([0-9a-f]{32}|${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'conversation' }),
    verb: 'View',
    appId: 1062359,
  },
  {
    id: 'codegen',
    service: 'Codegen',
    kind: 'agent',
    host: /^codegen\.com$/,
    path: /^\/agent\/trace\/(\d+)\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'run' }),
    verb: 'View',
    appId: 321279,
  },
  {
    id: 'tembo',
    service: 'Tembo',
    kind: 'agent',
    host: /^app\.tembo\.io$/,
    path: new RegExp(`^/sessions/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    verb: 'View',
    appId: 1223475,
  },
  {
    id: 'tembo-task',
    service: 'Tembo',
    kind: 'agent',
    host: /^app\.tembo\.io$/,
    path: new RegExp(`^/tasks/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'task' }),
    verb: 'View',
    appId: 1223475,
  },
  {
    id: 'tembo',
    service: 'Tembo',
    kind: 'agent',
    host: /^app\.tembo\.io$/,
    path: /^\/reviews\/redirect\/?$/,
    query: { sessionId: new RegExp(`^${UUID}$`) },
    read: ({ query }) => ({ id: query.get('sessionId') ?? '', noun: 'session' }),
    verb: 'View',
    appId: 1223475,
    rank: 1,
  },
  {
    id: 'terragon',
    service: 'Terragon',
    kind: 'agent',
    host: /^(?:www\.)?terragonlabs\.com$/,
    path: new RegExp(`^/task/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'task' }),
    verb: 'View',
  },
  {
    id: 'warp',
    service: 'Warp',
    kind: 'agent',
    host: WARP_HOST,
    path: new RegExp(`^/(conversation|session)/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 2), noun: group(path, 1) }),
    verb: 'View',
  },
  {
    id: 'oz',
    service: 'Oz',
    kind: 'agent',
    host: /^(?:oz|platform)(?:\.staging)?\.warp\.dev$/,
    path: new RegExp(`^/(?:[\\w-]+/)?runs/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'run' }),
    verb: 'View',
  },
  {
    id: 'cosine',
    service: 'Cosine',
    kind: 'agent',
    host: /^cosine\.sh$/,
    path: new RegExp(`^/(${REPO_PART})/(${REPO_PART})/task/([a-z0-9]{10,})/?$`),
    read: ({ path }) => ({ id: group(path, 3), noun: 'task' }),
    verb: 'View',
  },
  {
    id: 'opencode',
    service: 'opencode',
    kind: 'agent',
    host: /^opencode\.ai$/,
    path: /^\/s\/([A-Za-z0-9]{6,})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'session' }),
    verb: 'View',
    appId: 1549082,
  },
  {
    id: 'lovable',
    service: 'Lovable',
    kind: 'agent',
    host: /^lovable\.dev$/,
    path: new RegExp(`^/projects/(${UUID})/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'project' }),
    appId: 818760,
  },
  {
    id: 'v0',
    service: 'v0',
    kind: 'agent',
    host: /^v0\.(?:app|dev)$/,
    path: /^\/(?:[\w-]+\/)?chat\/([\w-]+)\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'chat' }),
    appId: 8329,
  },
  {
    id: 'graphite-agent',
    service: 'Graphite',
    kind: 'agent',
    host: /^app\.graphite\.(?:dev|com)$/,
    path: new RegExp(`^/background-agents/${REPO_PART}/${REPO_PART}/task/(bgt_\\w+)/?$`),
    read: ({ path }) => ({ id: group(path, 1), noun: 'agent task' }),
    verb: 'View',
    appId: 158384,
  },

  // Review tools' own view of the pull request.
  {
    id: 'devin-review',
    service: 'Devin Review',
    kind: 'review',
    host: DEVIN_HOST,
    path: new RegExp(`^/review/(${REPO_PART})/(${REPO_PART})/pull/(\\d+)/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}/${group(path, 2)}#${group(path, 3)}`.toLowerCase(), noun: 'findings' }),
    verb: 'View',
    bot: 'devin',
  },
  {
    id: 'greptile',
    service: 'Greptile',
    kind: 'review',
    host: /^app\.greptile\.com$/,
    path: /^\/(?!api\/|-\/)((?:[\w.-]+\/)+pull\/\d+)\/?$/,
    read: ({ path }) => ({ id: group(path, 1).toLowerCase(), noun: 'review' }),
    verb: 'View',
    bot: 'greptile',
  },
  {
    // Since Nov 2026 through its tenant switch, the review's path in `next`.
    id: 'greptile',
    service: 'Greptile',
    kind: 'review',
    host: /^app\.greptile\.com$/,
    path: /^\/-\/switch-tenant\/?$/,
    query: { next: /^\/((?:[\w.-]+\/)+pull\/\d+)\/?$/ },
    read: ({ query }) => ({ id: (query.get('next') ?? '').replace(/^\/|\/$/g, '').toLowerCase(), noun: 'review' }),
    verb: 'View',
    bot: 'greptile',
  },
  {
    id: 'coderabbit',
    service: 'CodeRabbit',
    kind: 'review',
    host: /^app\.coderabbit\.ai$/,
    path: /^\/change-stack\/([\w./-]+?)\/?$/,
    read: ({ path }) => ({ id: group(path, 1).toLowerCase(), noun: 'change stack' }),
    verb: 'View',
    bot: 'coderabbit',
  },
  {
    id: 'cubic',
    service: 'cubic',
    kind: 'review',
    host: /^(?:www\.)?cubic\.dev$/,
    path: /^\/pr\/([\w./-]+?)\/?$/,
    read: ({ path }) => ({ id: group(path, 1).toLowerCase(), noun: 'guided diff' }),
    verb: 'View',
    bot: 'cubic',
  },
  {
    id: 'graphite',
    service: 'Graphite',
    kind: 'review',
    host: /^app\.graphite\.(?:dev|com)$/,
    path: new RegExp(`^/github/pr/(${REPO_PART})/(${REPO_PART})/(\\d+)(?:/[^/]*)?/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}/${group(path, 2)}#${group(path, 3)}`.toLowerCase(), noun: 'pull request' }),
    verb: 'View',
    appId: 158384,
  },

  {
    id: 'cosine-review',
    service: 'Cosine',
    kind: 'review',
    host: /^cosine\.sh$/,
    path: new RegExp(`^/gh/(${REPO_PART})/(${REPO_PART})/pull/(\\d+)/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}/${group(path, 2)}#${group(path, 3)}`.toLowerCase(), noun: 'pull request' }),
    verb: 'View',
  },

  // Other forges: issues and merge or pull requests, never commits, files or the project itself.
  {
    // gitlab.com and any self-hosted GitLab, known by the `/-/` its project routes carry.
    id: 'gitlab',
    service: 'GitLab',
    kind: 'ticket',
    host: /^(?!github\.com$)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/,
    path: /^\/((?:[\w.-]+\/)*[\w.-]+)\/-\/(issues|merge_requests|work_items|epics)\/(\d+)\/?$/,
    read: ({ url, path }) => {
      const kind = group(path, 2);
      const project = group(path, 1).replace(/^groups\//, '');
      const sigil = kind === 'merge_requests' ? '!' : kind === 'epics' ? '&' : '#';
      const noun = kind === 'merge_requests' ? 'merge request' : kind === 'work_items' ? 'work item' : kind === 'epics' ? 'epic' : 'issue';
      return { id: `${url.hostname}/${project}${sigil}${group(path, 3)}`.toLowerCase(), noun, ref: `${sigil}${group(path, 3)}`, context: url.hostname === 'gitlab.com' ? project : `${url.hostname}/${project}` };
    },
    icon: 'gitlab',
  },
  {
    id: 'bitbucket',
    service: 'Bitbucket',
    kind: 'ticket',
    host: /^bitbucket\.org$/,
    path: new RegExp(`^/(${REPO_PART}/${REPO_PART})/(issues|pull-requests)/(\\d+)(?:/${SLUG})?/?$`),
    read: ({ path }) => ({ id: `${group(path, 1)}#${group(path, 3)}`.toLowerCase(), noun: group(path, 2) === 'issues' ? 'issue' : 'pull request', ref: `#${group(path, 3)}`, context: group(path, 1) }),
    icon: 'bitbucket',
  },

  // Documents and designs.
  {
    id: 'notion',
    service: 'Notion',
    kind: 'doc',
    host: /^(?:(?:www\.)?notion\.so|app\.notion\.com|[\w-]+\.notion\.site)$/,
    path: /^\/(?:p\/)?(?:[\w-]+\/)?(?:([\w%-]*?)-)?([0-9a-f]{32})\/?$/,
    read: ({ path }) => ({ id: group(path, 2), noun: 'page', title: path[1] === undefined ? null : slugTitle(path[1]) }),
  },
  {
    id: 'confluence',
    service: 'Confluence',
    kind: 'doc',
    host: /^([a-z0-9][a-z0-9-]*)\.atlassian\.net$/,
    path: /^\/wiki\/spaces\/([\w~-]+)\/pages\/(\d+)(?:\/([^/]+))?\/?$/,
    read: ({ host, path }) => ({ id: `${group(host, 1)}:${group(path, 2)}`, noun: 'page', title: path[3] === undefined ? null : slugTitle(path[3]), context: group(host, 1) }),
    icon: 'jira',
  },
  {
    // Confluence's short link (`/wiki/x/<tiny id>`), what its Share button copies.
    id: 'confluence-short',
    service: 'Confluence',
    kind: 'doc',
    host: /^([a-z0-9][a-z0-9-]*)\.atlassian\.net$/,
    path: /^\/wiki\/x\/([\w-]{4,})\/?$/,
    read: ({ host, path }) => ({ id: `${group(host, 1)}:${group(path, 1)}`, noun: 'page', context: group(host, 1) }),
    icon: 'jira',
  },
  {
    id: 'figma',
    service: 'Figma',
    kind: 'doc',
    host: /^(?:www\.)?figma\.com$/,
    path: /^\/(file|design|board|proto|slides|deck|make)\/([A-Za-z0-9]{22,128})(?:\/([^/]+))?\/?$/,
    read: ({ path }) => ({ id: group(path, 2), noun: group(path, 1) === 'board' ? 'board' : group(path, 1) === 'slides' || group(path, 1) === 'deck' ? 'slides' : 'file', title: path[3] === undefined ? null : slugTitle(path[3]) }),
    appId: 1136528,
  },
  {
    id: 'google',
    service: 'Google',
    kind: 'doc',
    host: /^docs\.google\.com$/,
    path: /^\/(document|spreadsheets|presentation|forms)\/d\/(?:e\/)?([\w-]{20,})(?:\/[\w./-]*)?$/,
    read: ({ path }) => ({ id: group(path, 2), noun: GOOGLE_LABELS[group(path, 1)] ?? 'doc' }),
  },
  {
    id: 'loom',
    service: 'Loom',
    kind: 'doc',
    host: /^(?:www\.)?loom\.com$/,
    path: /^\/(?:share|embed)\/(?:[\w-]+-)?([0-9a-f]{32})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'video' }),
  },
  {
    id: 'warp-notebook',
    service: 'Warp',
    kind: 'doc',
    host: WARP_HOST,
    path: /^\/drive\/notebook\/([\w-]{10,})\/?$/,
    read: ({ path }) => ({ id: group(path, 1), noun: 'notebook' }),
  },

  // Errors.
  {
    id: 'sentry',
    service: 'Sentry',
    kind: 'error',
    host: /^(?:([a-z0-9][a-z0-9-]*)\.)?sentry\.io$/,
    path: /^\/(?:organizations\/([\w-]+)\/|([\w-]+)\/[\w-]+\/)?issues\/(\d+|[A-Z0-9]+(?:-[A-Z0-9]+)+)\/?$/,
    read: ({ host, path }) => {
      const org = host[1] ?? path[1] ?? path[2] ?? null;
      return { id: `${org ?? ''}:${group(path, 3)}`, noun: 'issue', ref: /^\d+$/.test(group(path, 3)) ? null : group(path, 3), context: org };
    },
    appId: 12637,
  },
  {
    // A page under the issue (an event, its tags): the issue still, kept only when the issue itself is not linked.
    id: 'sentry',
    service: 'Sentry',
    kind: 'error',
    host: /^(?:([a-z0-9][a-z0-9-]*)\.)?sentry\.io$/,
    path: /^\/(?:organizations\/([\w-]+)\/|([\w-]+)\/[\w-]+\/)?issues\/(\d+|[A-Z0-9]+(?:-[A-Z0-9]+)+)\/(?:events|tags|activity|replays|similar|merged|feedback|attachments)(?:\/[\w-]+)?\/?$/,
    read: ({ host, path }) => {
      const org = host[1] ?? path[1] ?? path[2] ?? null;
      return { id: `${org ?? ''}:${group(path, 3)}`, noun: 'issue', ref: /^\d+$/.test(group(path, 3)) ? null : group(path, 3), context: org };
    },
    appId: 12637,
    rank: 1,
  },
];

const GOOGLE_LABELS: Readonly<Record<string, string>> = { document: 'doc', spreadsheets: 'sheet', presentation: 'slides', forms: 'form' };

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Words a link's text uses that say nothing the service, noun and identifier do not: "Open in Web", "Slack Thread", "Linear LIM-1391". */
const GENERIC_WORDS = new Set([
  'link', 'here', 'this', 'that', 'view', 'open', 'see', 'show', 'follow', 'in', 'on', 'the', 'a', 'to', 'at', 'of', 'for', 'and', 'with', 'via', 'from', 'my', 'your',
  'web', 'desktop', 'app', 'browser', 'thread', 'message', 'channel', 'session', 'task', 'run', 'workspace', 'issue', 'ticket', 'story', 'card', 'page', 'doc', 'project',
  'conversation', 'chat', 'agent', 'automation', 'review', 'findings', 'finding', 'work', 'details', 'trace', 'cloud', 's', 'url', 'reference',
  'explain', 'change', 'changes', 'diff', 'guided', 'stack', 'summary', 'check', 'go', 'jump', 'visit',
]);

/** The link's own words as its title, when they say more than the service, noun and identifier (and are not its URL). */
function titleFromText(text: string, service: string, noun: string, ref: string | null): string | null {
  const words = text.replace(/\s+/g, ' ').trim();
  if (words === '' || /^(?:https?:\/\/|www\.)\S+$/i.test(words)) return null;
  const withoutKey = ref === null ? words : words.replace(new RegExp(`^(?:${escapeRegExp(service)}\\s+)?${escapeRegExp(ref)}\\s*[:·–—-]?\\s*`, 'i'), '').trim();
  const wordsOf = (value: string): string[] => value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '');
  const known = new Set([...wordsOf(service), ...wordsOf(noun), ...wordsOf(ref ?? '')]);
  const telling = wordsOf(withoutKey).filter((word) => !GENERIC_WORDS.has(word) && !known.has(word) && !/^\d+$/.test(word));
  return telling.length === 0 ? null : withoutKey;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchSpec(spec: LinkSpec, url: URL, text: string, official: boolean): RelatedLink | null {
  const host = spec.host.exec(url.hostname);
  if (host === null) return null;
  const path = spec.path.exec(url.pathname);
  if (path === null) return null;
  const query = new Map<string, string>();
  for (const [name, value] of url.searchParams) if (!query.has(name)) query.set(name, value);
  for (const [name, pattern] of Object.entries(spec.query ?? {})) {
    const value = query.get(name);
    if (value === undefined || !pattern.test(value)) return null;
  }
  const reading = spec.read({ url, host, path, query, text });
  if (reading === null || reading.id === '') return null;
  const ref = reading.ref ?? null;
  // A title in the URL is the service's, an author's link words may be anything; a service's own bot words its links as the
  // title itself, whole and cased, where its URL lowercases the title and cuts it short.
  const fromText = titleFromText(text, spec.service, reading.noun, ref);
  const title = official ? (fromText ?? reading.title ?? null) : (reading.title ?? fromText);
  const target = spec.actionTarget ?? spec.service;
  return {
    key: `${spec.id}:${reading.id}`,
    kind: spec.kind,
    service: spec.service,
    noun: reading.noun,
    ref,
    title,
    context: reading.context ?? null,
    href: url.href,
    action: `${spec.verb ?? 'Open'} ${reading.noun} in ${target}`,
    appId: spec.appId ?? (spec.bot === undefined ? null : botById(spec.bot)?.appId ?? null),
    icon: spec.icon ?? null,
  };
}

/** What the page tells the registry about where it is, for GitHub's own references. */
export interface RelatedOptions {
  /** Hosts that are GitHub on this page: github.com, and an Enterprise page's own host. */
  readonly githubHosts?: readonly string[];
  /** The repository the page is in (`owner/repo`), whose references read `#N` as GitHub writes them. */
  readonly repository?: string | null;
  /** The pull request being read (`owner/repo#N`), which is never one of its own related links. */
  readonly self?: string | null;
  /**
   * The page's host. A reference on another host (github.com from an Enterprise page) is another thing even with the
   * same owner, repository and number: never the page's repository, its owner's, or the pull request itself.
   */
  readonly host?: string | null;
}

/** An issue, pull request or discussion, or one of a pull request's tabs; a link to a comment in it carries a hash. */
const GITHUB_PATH = /^\/([\w.-]+)\/([\w.-]+)\/(issues|pull|discussions)\/(\d+)(?:\/(?:files|commits|changes|checks))?\/?$/;
const GITHUB_NOT_OWNERS = new Set(['orgs', 'users', 'enterprises', 'settings', 'marketplace', 'apps', 'sponsors']);

function readGitHub(url: URL, text: string, options: RelatedOptions): RelatedLink | null {
  const path = GITHUB_PATH.exec(url.pathname);
  const owner = path?.[1];
  if (path === null || owner === undefined || GITHUB_NOT_OWNERS.has(owner.toLowerCase())) return null;
  const repository = `${owner}/${group(path, 2)}`;
  const number = group(path, 4);
  const noun = group(path, 3) === 'pull' ? 'pull request' : group(path, 3) === 'issues' ? 'issue' : 'discussion';
  const sameHost = sameHostAs(url.hostname, options);
  const id = `${repository}#${number}`.toLowerCase();
  // Discussions are numbered on their own, so only an issue or a pull request can be the one being read.
  if (noun !== 'discussion' && sameHost && options.self !== undefined && options.self !== null && id === options.self.toLowerCase()) return null;
  const near = nearness(url.hostname, repository, options);
  const ref = near === 'repository' ? `#${number}` : near === 'owner' ? `${group(path, 2)}#${number}` : `${repository}#${number}`;
  const host = url.hostname === 'github.com' ? '' : `${url.hostname.toLowerCase()}/`;
  return {
    // Issues and pull requests share one numbering, so a link to either is the same thing.
    key: `github:${host}${noun === 'discussion' ? 'd:' : ''}${id}`,
    kind: 'github',
    service: 'GitHub',
    noun,
    ref,
    // GitHub writes a reference as `#12`, `owner/repo#12` or `#12 (comment)`, none of them a title.
    title: /^(?:[\w.-]+\/)?(?:[\w.-]+)?#\d+(?:\s*\(comment\))?$/.test(text.trim()) ? null : titleFromText(text, 'GitHub', noun, ref),
    context: `${host}${repository}`,
    href: url.href,
    action: `View ${noun} on GitHub`,
    appId: null,
    icon: null,
  };
}

function sameHostAs(hostname: string, options: RelatedOptions): boolean {
  return options.host === undefined || options.host === null || hostname.toLowerCase() === options.host.toLowerCase();
}

/** How near a reference's repository is to the page's: the same repository, the same owner, or elsewhere. */
function nearness(hostname: string, repository: string, options: RelatedOptions): 'repository' | 'owner' | 'elsewhere' {
  const here = (options.repository ?? '').toLowerCase();
  const there = repository.toLowerCase();
  if (here === '' || !sameHostAs(hostname, options)) return 'elsewhere';
  if (there === here) return 'repository';
  return there.split('/')[0] === here.split('/')[0] ? 'owner' : 'elsewhere';
}

const NEARNESS_ORDER = ['repository', 'owner', 'elsewhere'];
const GITHUB_NOUN_ORDER = ['pull request', 'issue', 'discussion'];

/** GitHub's own references in reading order: pull requests, then issues, then discussions, each nearest first. */
function githubRank(link: RelatedLink, options: RelatedOptions): number {
  const url = new URL(link.href);
  const repository = /^\/([^/]+\/[^/]+)\//.exec(url.pathname)?.[1] ?? '';
  return GITHUB_NOUN_ORDER.indexOf(link.noun) * NEARNESS_ORDER.length + NEARNESS_ORDER.indexOf(nearness(url.hostname, repository, options));
}

/**
 * The bots that speak for a service in a comment, beyond the review bots the registry names (`LinkSpec.bot`), keyed by
 * spec id. Read from what each App's comments link to on public pull requests (Nov 2026): Linear's linkback,
 * Atlassian's Jira bot, ClickUp's, Codegen's trace links.
 */
const OFFICIAL_SOURCES: Readonly<Record<string, readonly string[]>> = {
  // Linear's linkback App, and Linear Code, which posts the linkback with the issue's title and its reviews of the pull request.
  linear: ['linear[bot]', 'linear-code[bot]'],
  jira: ['atlassian[bot]'],
  confluence: ['atlassian[bot]'],
  'confluence-short': ['atlassian[bot]'],
  clickup: ['clickup[bot]'],
  'clickup-doc': ['clickup[bot]'],
  codegen: ['codegen-sh[bot]'],
  tembo: ['tembo[bot]'],
  'tembo-task': ['tembo[bot]'],
  factory: ['factory-droid[bot]'],
  'factory-automation': ['factory-droid[bot]'],
  jules: ['google-labs-jules[bot]'],
  copilot: ['copilot-swe-agent[bot]'],
  openhands: ['openhands-ai[bot]'],
  opencode: ['opencode-agent[bot]'],
  lovable: ['lovable-dev[bot]'],
  graphite: ['graphite-app[bot]'],
  'graphite-agent': ['graphite-app[bot]'],
  sentry: ['sentry[bot]'],
};

/** Whether `author` is one of the service's own bots, so its comment is a source for that service's links. */
export function officialSourceOf(specId: string, author: string): boolean {
  const spec = linkSpecs.find((candidate) => candidate.id === specId);
  if (spec === undefined) return false;
  const logins = [...(OFFICIAL_SOURCES[spec.id] ?? []), ...(spec.bot === undefined ? [] : botById(spec.bot)?.logins ?? [])];
  return logins.some((login) => login.toLowerCase() === author.toLowerCase());
}

interface ReadLink {
  readonly link: RelatedLink;
  readonly rank: number;
  /** Read from the service's own bot comment, whose words are the service's, not an author's. */
  readonly official: boolean;
}

function readLink(candidate: LinkCandidate, options: RelatedOptions = {}): ReadLink | null {
  let url: URL;
  try {
    url = new URL(candidate.href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return null;
  const author = candidate.author ?? null;
  for (const spec of linkSpecs) {
    const official = author !== null && officialSourceOf(spec.id, author);
    const link = matchSpec(spec, url, candidate.text, official);
    if (link === null) continue;
    if (author !== null && !official) return null;
    return { link, rank: spec.rank ?? 0, official };
  }
  // GitHub's own references come from the description only: every comment is full of them.
  if (author !== null) return null;
  if (url.hostname !== 'github.com' && !(options.githubHosts ?? []).includes(url.hostname)) return null;
  const link = readGitHub(url, candidate.text, options);
  return link === null ? null : { link, rank: 0, official: false };
}

/** What a link leads to, or null when it is not a link this registry knows. Only plain `https:` links count. */
export function relatedLinkOf(candidate: LinkCandidate, options: RelatedOptions = {}): RelatedLink | null {
  return readLink(candidate, options)?.link ?? null;
}

/**
 * Every related link among `candidates`, one per thing linked to, in kind order and then in the order they appear
 * (GitHub's own: pull requests before issues, each nearest the page's repository first, `githubRank`).
 * Of two links to one thing the web page is kept over a desktop deep link. The title is the service's own when its bot
 * gave one (Linear's linkback can carry the issue's title), else the first found: an author's words for a ticket may
 * be anything, the bot's are the ticket's.
 */
export function relatedLinksFrom(candidates: readonly LinkCandidate[], options: RelatedOptions = {}): RelatedLink[] {
  const found = new Map<string, { link: RelatedLink; rank: number; titleOfficial: boolean; byAuthor: boolean }>();
  for (const candidate of candidates) {
    const read = readLink(candidate, options);
    if (read === null) continue;
    const { link, rank, official } = read;
    const known = found.get(link.key);
    if (known === undefined) {
      found.set(link.key, { link, rank, titleOfficial: official && link.title !== null, byAuthor: !official });
      continue;
    }
    const kept = rank < known.rank ? link : known.link;
    const takesTitle = link.title !== null && (known.link.title === null || (official && !known.titleOfficial));
    const title = takesTitle ? link.title : known.link.title;
    found.set(link.key, { link: { ...kept, title }, rank: Math.min(rank, known.rank), titleOfficial: takesTitle ? official : known.titleOfficial, byAuthor: known.byAuthor || !official });
  }
  // A review named by a pull request says nothing more when it is the one being read. Linear Code links its review of
  // every pull request it knows, and one of another, linked by nobody else, belongs on that pull request's page.
  const self = options.self?.toLowerCase() ?? null;
  const links = [...found.values()].flatMap(({ link, byAuthor }) => {
    if (link.kind !== 'review' || link.title === null || !/^[\w.-]+\/[\w.-]+#\d+$/.test(link.title)) return [link];
    if (link.title.toLowerCase() === self) return [{ ...link, title: null }];
    return byAuthor ? [link] : [];
  });
  return RELATED_KIND_ORDER.flatMap((kind) => {
    const ofKind = links.filter((link) => link.kind === kind);
    return kind === 'github' ? ofKind.sort((a, b) => githubRank(a, options) - githubRank(b, options)) : ofKind;
  });
}

/**
 * A dependency update's description (Renovate's "This PR contains the following updates", Dependabot's "Bumps x from
 * a to b"): its links are the upstream projects' release notes, thousands of their issues and merge requests, and
 * none of them is where the change came from.
 */
export function isDependencyUpdate(text: string): boolean {
  const words = text.replace(/\s+/g, ' ');
  // Each opens its description on its own words, so a person quoting them further on ("Renovate's "This PR contains the
  // following updates"") writes no dependency update.
  return /^\s*This PR contains the following updates:/.test(words) || /^\s*Bumps (?:the \S+ group|\S+ from \S+ to \S+)/.test(words) || /\bDependabot will resolve any conflicts with this PR as long as you don't alter it yourself\b/.test(words);
}
