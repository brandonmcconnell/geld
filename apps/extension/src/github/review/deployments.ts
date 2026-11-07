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
  const url = absoluteHref(view) ?? absoluteHref(environmentLink);
  const actionHref = absoluteHref(action);
  const viaLink = links.find((link) => link !== actorLink && link.closest('[data-test-selector="pr-timeline-events-actor-avatar"]') === null && /\/apps\//.test(link.getAttribute('href') ?? '') && text(link) !== '');
  const viaAvatar = viaLink?.previousElementSibling instanceof HTMLImageElement ? viaLink.previousElementSibling : null;
  const label = text(body.querySelector(STATUS_LABEL)).toLowerCase();
  const state: DeploymentState = STATE_BY_LABEL[label] ?? (/problem deploying/i.test(match[1]) ? 'failed' : 'active');
  return {
    anchor: row.id,
    environment,
    state,
    url,
    logUrl: actionHref !== null && actionHref !== url ? actionHref : null,
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
 * A deployment the Previews row already shows: one an App made whose comments the row reads (Vercel posts both a
 * comment and a deployment per project). A host that takes any bot's comments (`generic`, GitHub Actions' Azure
 * notes) says nothing about who deployed, so only a host of its own counts.
 */
export function shownAsPreview(deployment: Deployment, previews: readonly Preview[]): boolean {
  const host = previewHostFor(deployment.actor);
  if (host === null || host.id === 'generic' || host.logins.includes('github-actions[bot]')) return false;
  return previews.some((preview) => preview.host === host.id);
}

/** The mark a deployment wears: the App it went through, else the App that made it; a person's face says nothing. */
export function deploymentMark(deployment: Deployment): string | null {
  if (deployment.via?.avatarSrc !== undefined && deployment.via.avatarSrc !== null) return deployment.via.avatarSrc;
  return /\[bot\]$/i.test(deployment.actor) ? deployment.actorAvatar : null;
}
