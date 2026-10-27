/**
 * Asking people to review, and what GitHub lets the reader do with a review
 * they gave — through GitHub's own means on the page, never an API.
 *
 * - Who can be asked comes from the same JSON GitHub's Reviewers menu loads
 *   when it opens (`data-filterable-src`, the pull request's
 *   `/review-requests` with `Accept: application/json`): suggestions, then
 *   everyone with access, each with GitHub's user id and whether they are
 *   requested right now.
 * - Asking posts GitHub's own sidebar form (`form.js-issue-sidebar-form`
 *   whose action ends in `/review-requests`), with its token and the ids of
 *   everyone who should be requested after this: the people asked here plus
 *   those already pending, since the form is the whole set and an id left
 *   out is a request withdrawn. Asking someone who has reviewed is how GitHub
 *   itself re-requests them; one post covers both.
 * - Dismissing a review needs a reason GitHub records in the timeline, so
 *   the reader gives it in GitHub's own dialog: the merge box's Reviews
 *   section lists each verdict with a "More review options" menu holding
 *   Dismiss review and Re-request review, and Geld presses those.
 */

import { fragmentHeaders } from './deeplink';

export interface ReviewerCandidate {
  readonly id: number;
  readonly login: string;
  readonly name: string;
  readonly avatar: string;
  /** Requested right now (pending). */
  readonly selected: boolean;
  /** GitHub's suggestion (recently reviewed or edited these files). */
  readonly suggested: boolean;
  /** GitHub offers a team as a reviewer; its id goes in `reviewer_team_ids[]`. */
  readonly team: boolean;
}

const SIDEBAR_FORM = 'form.js-issue-sidebar-form[action$="/review-requests"]';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function candidateOf(value: unknown, suggested: boolean): ReviewerCandidate | null {
  if (!isRecord(value)) return null;
  const { id, login, name, avatar, selected, type } = value;
  if (typeof id !== 'number' || typeof login !== 'string' || login === '') return null;
  // A team comes as `{ type: 'team', ... }` with its slug as the login.
  return {
    id,
    login,
    name: typeof name === 'string' ? name : '',
    avatar: typeof avatar === 'string' ? avatar : '',
    selected: selected === true,
    suggested,
    team: type === 'team',
  };
}

/** The pull request's review-requests form on the page, which names the endpoint and carries the token. */
export function reviewRequestForm(): HTMLFormElement | null {
  return document.querySelector<HTMLFormElement>(SIDEBAR_FORM);
}

/**
 * Everyone the reader can ask, as GitHub's own menu would list them:
 * suggestions first, then the rest, each once. Null when the page has no
 * such form (signed out, no access, a merged pull request).
 */
export async function fetchReviewerCandidates(): Promise<readonly ReviewerCandidate[] | null> {
  const form = reviewRequestForm();
  if (form === null) return null;
  const source = form.querySelector('[data-filterable-src]')?.getAttribute('data-filterable-src') ?? form.getAttribute('action') ?? '';
  if (source === '') return null;
  const response = await fetch(source, { credentials: 'same-origin', headers: { ...fragmentHeaders(), Accept: 'application/json' } });
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!isRecord(body)) return null;
  const out: ReviewerCandidate[] = [];
  const seen = new Set<string>();
  const take = (list: unknown, suggested: boolean): void => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const candidate = candidateOf(entry, suggested);
      if (candidate === null || seen.has(`${candidate.team ? 't' : 'u'}:${candidate.id}`)) continue;
      seen.add(`${candidate.team ? 't' : 'u'}:${candidate.id}`);
      out.push(candidate);
    }
  };
  take(body.suggestions, true);
  take(body.users, false);
  take(body.teams, false);
  return out;
}

/**
 * Ask the people (and teams) with these ids to review, keeping everyone
 * already requested. Posts GitHub's own form, so GitHub records the request,
 * notifies the reviewer and refreshes the sidebar over its socket. Resolves
 * once GitHub has answered; false when there is no form or GitHub refused.
 */
export async function requestReviewers(ids: readonly number[], teamIds: readonly number[], candidates: readonly ReviewerCandidate[]): Promise<boolean> {
  const form = reviewRequestForm();
  if (form === null) return false;
  const action = form.getAttribute('action') ?? '';
  if (action === '') return false;
  const body = new FormData();
  for (const input of form.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')) {
    if (input.name.endsWith('[]')) continue;
    body.append(input.name, input.value);
  }
  const users = new Set<number>(ids);
  const teams = new Set<number>(teamIds);
  for (const candidate of candidates) {
    if (!candidate.selected) continue;
    (candidate.team ? teams : users).add(candidate.id);
  }
  for (const id of users) body.append('reviewer_user_ids[]', String(id));
  for (const id of teams) body.append('reviewer_team_ids[]', String(id));
  const response = await fetch(action, { method: 'POST', credentials: 'same-origin', headers: fragmentHeaders(), body });
  if (!response.ok) return false;
  void refreshSidebarReviewers();
  return true;
}

/**
 * GitHub refreshes its Reviewers block over the live socket a moment after
 * the post; a tab without that connection gets the same partial fetched here
 * (`data-url` on the block, as GitHub's `js-updatable-content` does), so the
 * digest reads the new state on its next pass.
 */
async function refreshSidebarReviewers(): Promise<void> {
  const block = reviewRequestForm()?.closest<HTMLElement>('.js-updatable-content[data-url]') ?? null;
  const url = block?.getAttribute('data-url') ?? '';
  if (block === null || url === '') return;
  try {
    const response = await fetch(url, { credentials: 'same-origin', headers: fragmentHeaders() });
    if (!response.ok) return;
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const fresh = parsed.body.firstElementChild;
    if (fresh !== null && block.isConnected) block.replaceWith(document.importNode(fresh, true));
  } catch {
    // The socket will bring it, or the next page load.
  }
}

/** The merge box's Reviews section, where each verdict has GitHub's "More review options". */
function reviewsSection(): HTMLElement | null {
  return document.querySelector<HTMLElement>('section[aria-label="Reviews"]');
}

/** Whether GitHub's review actions are on this page at all (an open pull request's merge box lists the verdicts). */
export function hasReviewActions(): boolean {
  return reviewsSection() !== null;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * The merge box's row for `login`'s verdict, its group expanded if need be
 * (the groups — approvals, changes requested — render their rows only when
 * open). Null when GitHub lists no such verdict (nothing to dismiss) or the
 * page has no Reviews section (merged, or the reader cannot act).
 */
async function verdictRowFor(login: string): Promise<HTMLElement | null> {
  const section = reviewsSection();
  if (section === null) return null;
  const find = (): HTMLElement | null => [...section.querySelectorAll<HTMLElement>('li[aria-label]')].find((row) => (row.getAttribute('aria-label') ?? '').toLowerCase().startsWith(`${login.toLowerCase()} `)) ?? null;
  const found = find();
  if (found !== null) return found;
  const expanders = [...section.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"][aria-label^="Expand "]')].filter((button) => !/pending review/i.test(button.getAttribute('aria-label') ?? ''));
  if (expanders.length === 0) return null;
  for (const button of expanders) button.click();
  await wait(250);
  return find();
}

/**
 * Press one of GitHub's review actions for `login`'s verdict: its row's
 * "More review options" menu, then the item. "Dismiss review" opens GitHub's
 * dialog for the reason; "Re-request review" acts at once. False when GitHub
 * offers no such action here.
 */
export async function pressReviewAction(login: string, action: 'Dismiss review' | 'Re-request review'): Promise<boolean> {
  const row = await verdictRowFor(login);
  const toggle = row?.querySelector<HTMLButtonElement>('button[aria-haspopup]') ?? null;
  if (toggle === null) return false;
  toggle.click();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await wait(100);
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.getBoundingClientRect().height > 0 && (node.textContent ?? '').trim() === action);
    if (item !== undefined) {
      item.click();
      return true;
    }
  }
  // The menu never showed the action: close whatever opened.
  if (toggle.getAttribute('aria-expanded') === 'true') toggle.click();
  return false;
}
