import type { Preview } from '@geld/review';
import { previewHostFor } from '@geld/review';
import { loginOfLink } from './login';

/**
 * GitHub's deployment events ("X deployed to storybook-app — with GitHub
 * Actions · View deployment"), read off the timeline. Three shapes, from
 * public pull requests in Nov 2026 (tldraw/tldraw#11342, nodejs/nodejs.org#9313):
 * a person through an App ("temporarily deployed" linking to the job, the
 * environment as plain text, "— with GitHub Actions", an Inactive label),
 * an App itself (Vercel: the environment linked, a View deployment button,
 * "had a problem deploying" with a Failure label), and `github-actions[bot]`.
 */

export type DeploymentState = 'active' | 'inactive' | 'failed' | 'pending';

export interface Deployment {
  /** The event row's id (`event-N`). */
  readonly anchor: string;
  readonly environment: string;
  readonly state: DeploymentState;
  /** Where the deployment is (GitHub's View deployment); null when it has no address. */
  readonly url: string | null;
  /** The run that deployed it (GitHub Actions' job), when GitHub links one apart from `url`. */
  readonly logUrl: string | null;
  readonly actor: string;
  readonly actorAvatar: string | null;
  /** The App a person deployed through ("— with GitHub Actions"). */
  readonly via: { readonly name: string; readonly avatarSrc: string | null } | null;
  /** The event's `relative-time` datetime; '' when the row carries none. */
  readonly at: string;
}

/** One environment: its latest deployment and how many times the pull request deployed there. */
export interface DeploymentGroup {
  readonly latest: Deployment;
  readonly count: number;
}

const DEPLOY_PHRASE = /^.*?\b(temporarily deployed|had a problem deploying|deployed)\s+to\s+(.+)$/i;
const TIME_LINK = 'a[href^="#event-"], relative-time';
const STATUS_LABEL = '.Label[title^="Deployment Status Label"]';

const STATE_BY_LABEL: Readonly<Record<string, DeploymentState>> = {
  active: 'active',
  success: 'active',
  inactive: 'inactive',
  destroyed: 'inactive',
  failure: 'failed',
  error: 'failed',
  pending: 'pending',
  queued: 'pending',
  'in progress': 'pending',
};

function text(node: Node | null): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function absoluteHref(link: Element | null | undefined): string | null {
  const href = link?.getAttribute('href') ?? '';
  if (href === '' || href.startsWith('#')) return null;
  try {
    return new URL(href, document.baseURI).href;
  } catch {
    return null;
  }
}

function isOnPageHost(href: string): boolean {
  try {
    return new URL(href).host === location.host;
  } catch {
    return false;
  }
}

/** The sentence's words before its time link, with the status label, the actor's "Bot" label and the buttons left out. */
function sentenceOf(body: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null) continue;
    if (parent.closest(TIME_LINK) !== null) break;
    if (parent.closest('.Label, .btn, tool-tip, .sr-only') !== null) continue;
    parts.push(node.textContent ?? '');
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const cache = new WeakMap<Element, { readonly text: string; readonly deployment: Deployment | null }>();

/** The deployment a timeline event row records, or null when the row is some other event. */
export function deploymentOf(row: Element): Deployment | null {
  const raw = row.textContent ?? '';
  const kept = cache.get(row);
  if (kept !== undefined && kept.text === raw) return kept.deployment;
  const deployment = readDeployment(row);
  cache.set(row, { text: raw, deployment });
  return deployment;
}

function readDeployment(row: Element): Deployment | null {
  if (!/deploy/i.test(row.textContent ?? '')) return null;
  const body = row.querySelector('.TimelineItem-body') ?? row;
  const match = DEPLOY_PHRASE.exec(sentenceOf(body));
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const environment = match[2].replace(/\s+—\s+with\b.*$/, '').trim();
  if (environment === '') return null;
  const links = [...body.querySelectorAll('a')];
  const actorLink = body.querySelector('a.author, [data-test-selector="pr-timeline-events-actor-profile-link"]');
  const actor = actorLink === null ? '' : (loginOfLink(actorLink) ?? '');
  const actorAvatar = body.querySelector<HTMLImageElement>('[data-test-selector="pr-timeline-events-actor-avatar"] img, a.d-inline-block img.avatar');
  const view = links.find((link) => /^view deployment$/i.test(text(link)));
  const action = links.find((link) => /deploy/i.test(text(link)) && link !== view);
  const environmentLink = links.find((link) => text(link) === environment && link !== actorLink);
  const actionHref = absoluteHref(action);
  // The "deployed" link is the run on GitHub Actions; an App (Vercel) links the word to the deployment's address instead.
  const actionIsRun = actionHref !== null && (isOnPageHost(actionHref) || /\/actions\/runs\/\d+/.test(actionHref));
  const url = absoluteHref(view) ?? absoluteHref(environmentLink) ?? (actionIsRun ? null : actionHref);
  const viaLink = links.find((link) => link !== actorLink && link.closest('[data-test-selector="pr-timeline-events-actor-avatar"]') === null && /\/apps\//.test(link.getAttribute('href') ?? '') && text(link) !== '');
  const viaAvatar = viaLink?.previousElementSibling instanceof HTMLImageElement ? viaLink.previousElementSibling : null;
  const label = text(body.querySelector(STATUS_LABEL)).toLowerCase();
  const state: DeploymentState = STATE_BY_LABEL[label] ?? (/problem deploying/i.test(match[1]) ? 'failed' : 'active');
  return {
    anchor: row.id,
    environment,
    state,
    url,
    logUrl: actionIsRun ? actionHref : null,
    actor,
    actorAvatar: actorAvatar === null ? null : actorAvatar.getAttribute('src'),
    via: viaLink === undefined ? null : { name: text(viaLink), avatarSrc: viaAvatar?.getAttribute('src') ?? null },
    at: body.querySelector('relative-time')?.getAttribute('datetime') ?? '',
  };
}

/** Each environment once, by its latest deployment, in the order of those latest deployments; `all` in timeline order. */
export function latestDeployments(all: readonly Deployment[]): readonly DeploymentGroup[] {
  const byEnvironment = new Map<string, { latest: Deployment; count: number }>();
  for (const deployment of all) {
    const key = deployment.environment.toLowerCase();
    const group = byEnvironment.get(key);
    // A re-added key moves to the end, so the groups come out in the order of their latest deployments.
    byEnvironment.delete(key);
    byEnvironment.set(key, { latest: deployment, count: (group?.count ?? 0) + 1 });
  }
  return [...byEnvironment.values()];
}

/**
 * The preview host whose comments say what this deployment is (Vercel posts both a comment and a deployment per
 * project). A host that takes any bot's comments (`generic`, GitHub Actions' Azure notes) says nothing about who
 * deployed, so only a host of its own counts.
 */
function hostOf(deployment: Deployment): string | null {
  const host = previewHostFor(deployment.actor);
  if (host === null || host.id === 'generic' || host.logins.includes('github-actions[bot]')) return null;
  return host.id;
}

/** "Preview – examples" is the `examples` project's: the name ends the environment, after a break. */
function namesProject(environment: string, project: string): boolean {
  const env = environment.trim().toLowerCase();
  const name = project.trim().toLowerCase();
  if (name === '' || !env.endsWith(name)) return false;
  const before = env.charAt(env.length - name.length - 1);
  return before === '' || !/[\p{L}\p{N}]/u.test(before);
}

function isSuccess(deployment: Deployment): boolean {
  return deployment.state === 'active' || deployment.state === 'inactive';
}

/**
 * A preview's deployments, in timeline order: its host's, to the environment named after its project. A host with
 * one project on the page and one environment (Vercel calls it "Preview" then) is matched without the name.
 */
export function deploymentsOfPreview(preview: Preview, previews: readonly Preview[], all: readonly Deployment[]): readonly Deployment[] {
  const hosts = all.filter((deployment) => hostOf(deployment) === preview.host);
  const projects = [...new Set([preview.project, ...previews.filter((entry) => entry.host === preview.host).map((entry) => entry.project)].map((project) => project.toLowerCase()))];
  // "Preview – tldraw-docs" names `docs` too: an environment is the longest project name it ends in.
  const ownerOf = (environment: string): string | undefined => projects.filter((project) => namesProject(environment, project)).sort((a, b) => b.length - a.length)[0];
  const named = hosts.filter((deployment) => ownerOf(deployment.environment) === preview.project.toLowerCase());
  if (named.length > 0) {
    const environment = named.at(-1)?.environment.toLowerCase();
    return named.filter((deployment) => deployment.environment.toLowerCase() === environment);
  }
  const environments = new Set(hosts.map((deployment) => deployment.environment.toLowerCase()));
  return projects.length === 1 && environments.size === 1 ? hosts : [];
}

/** What a preview's pill and line open: the site, as near as there is one, and the last good build while the latest is not. */
export interface PreviewLinks {
  /** The pill's link: the preview, else the last good build, else the host's page for the deployment, else its run. */
  readonly href: string | null;
  /** The last successful build's site, while the latest deployment is not a success; null otherwise. */
  readonly lastSuccess: string | null;
}

export function previewLinks(preview: Preview, previews: { readonly latest: readonly Preview[]; readonly archived: readonly Preview[] }, all: readonly Deployment[]): PreviewLinks {
  const deployments = deploymentsOfPreview(preview, previews.latest, all);
  const good = [...deployments].reverse().find((deployment) => isSuccess(deployment) && deployment.url !== null)?.url ?? previews.archived.find((entry) => entry.host === preview.host && entry.project === preview.project && entry.status === 'ready' && entry.url !== null)?.url ?? null;
  const run = deployments.at(-1)?.logUrl ?? null;
  return { href: preview.url ?? good ?? preview.inspectUrl ?? run, lastSuccess: preview.status === 'ready' ? null : good };
}

const PIN_SLACK_MS = 60_000;

/**
 * An earlier push's preview with its own build's address: Vercel's one comment links the branch, which serves the
 * newest build, so an archived preview opened that. The build GitHub recorded by the time the row was written is
 * the one it was about.
 */
export function pinnedToBuild(preview: Preview, deployments: readonly Deployment[]): Preview {
  const written = Date.parse(preview.updatedAt ?? '');
  if (preview.status !== 'ready' || Number.isNaN(written)) return preview;
  const build = [...deployments].reverse().find((deployment) => deployment.url !== null && isSuccess(deployment) && Date.parse(deployment.at) <= written + PIN_SLACK_MS);
  return build?.url === undefined || build.url === null ? preview : { ...preview, url: build.url };
}

/** One environment in the Deployments row: its latest deployment and what the host's comment adds to it. */
export interface DeploymentEntry extends DeploymentGroup {
  /** The host's own page for the latest deployment (Vercel's, with its build logs), from its comment. */
  readonly page: string | null;
  /** The host's comment about the environment, which its line opens to. */
  readonly comment: string | null;
  /** The run behind the last successful deployment, while the latest is not one. */
  readonly lastSuccessRun: string | null;
}

export function deploymentEntries(all: readonly Deployment[], previews: readonly Preview[]): readonly DeploymentEntry[] {
  return latestDeployments(all).map((group) => {
    const preview = previews.find((entry) => deploymentsOfPreview(entry, previews, all).some((deployment) => deployment.anchor === group.latest.anchor)) ?? null;
    const environment = group.latest.environment.toLowerCase();
    const lastRun = isSuccess(group.latest) ? null : ([...all].reverse().find((deployment) => deployment.environment.toLowerCase() === environment && isSuccess(deployment) && deployment.logUrl !== null)?.logUrl ?? null);
    return { ...group, page: preview?.inspectUrl ?? null, comment: preview?.anchor ?? null, lastSuccessRun: lastRun };
  });
}

/** Where a deployment's pill goes: the host's page for it, else the run that made it, else the deployment itself. */
export function deploymentHref(entry: DeploymentEntry): string | null {
  return entry.page ?? entry.latest.logUrl ?? entry.latest.url;
}

/** The mark a deployment wears: the App it went through, else the App that made it; a person's face says nothing. */
export function deploymentMark(deployment: Deployment): string | null {
  if (deployment.via?.avatarSrc !== undefined && deployment.via.avatarSrc !== null) return deployment.via.avatarSrc;
  return /\[bot\]$/i.test(deployment.actor) ? deployment.actorAvatar : null;
}
