import { pageFetch } from './page-fetch';

/**
 * What the reader may do to the pull request beyond reviewing it, and the
 * requests that do it, as GitHub's React merge box reads and sends them
 * (verified Oct 2026 by reading its bundle and capturing its requests with
 * the writes stubbed): `GET page_data/merge_box?merge_method=…&bypass_requirements=…`
 * says whether the reader can merge (directly, or only by bypassing the
 * rules), close and mark a draft ready, and whose verdicts stand; `POST page_data/merge`
 * merges; `POST page_data/close_pull_request` closes; `POST page_data/mark_ready_for_review`
 * takes a draft out of draft; `POST page_data/enable_auto_merge` with a merge queue's strategy adds the pull request to
 * the repository's merge queue ("Merge when ready"). A pull request in a GitHub stack merges through the stack's own
 * `POST page_data/enqueue_stack` (`mergeAction` `DIRECT_MERGE`, or `MERGE_QUEUE` alone), which takes it and every pull
 * request below it, and `GET page_data/stacks` lists the stack. Same origin and session as the page, so they work from
 * any tab.
 */

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE';

export interface MergeBox {
  /** GitHub's state for the pull request (a draft is `OPEN` with `draft`); null when the answer did not say. */
  readonly state: 'OPEN' | 'CLOSED' | 'MERGED' | null;
  readonly open: boolean;
  readonly draft: boolean;
  readonly canClose: boolean;
  /** Whether the reader may turn the open pull request back into a draft. */
  readonly canConvertToDraft: boolean;
  /** Whether the reader may take the draft out of draft ("Ready for review"). */
  readonly canMarkReady: boolean;
  /** Each reviewer's standing verdict, as GitHub counts them (their latest approval or request for changes, dismissed ones gone). */
  readonly verdicts: readonly ReviewVerdict[];
  /** Whether GitHub would merge it now with the method asked for (the rules, checks, reviews and conflicts all allow it). */
  readonly mergeable: boolean;
  /** Whether the reader is an admin GitHub lets bypass the rules that block it. */
  readonly canBypass: boolean;
  /** Blocked by what no bypass lifts: a merge conflict, or the repository's or the reader's own state. */
  readonly unbypassable: boolean;
  /** The direct merge methods the repository allows the reader, GitHub's default first. */
  readonly methods: readonly MergeMethod[];
  /** The methods an admin's bypass may use: those plus the ones GitHub allows only past the rules (`ALLOWED_WITH_BYPASS`). */
  readonly bypassMethods: readonly MergeMethod[];
  /** GitHub's prefilled commit for the method asked for (none for a rebase). */
  readonly commitTitle: string;
  readonly commitMessage: string;
  readonly authorEmail: string | null;
  /** Part of a GitHub stack: GitHub merges it through the stack's own request, `enqueue_stack`, not `merge`. */
  readonly stacked: boolean;
  /** Whether the reader may add it to the repository's merge queue now (GitHub's "Merge when ready"); false once it is in. */
  readonly canQueue: boolean;
  /** Whether GitHub offers "Enable auto-merge": the repository allows it and the pull request cannot merge yet; false once it is on. */
  readonly canAutoMerge: boolean;
  /** In the repository's merge queue now. */
  readonly queued: boolean;
  /** Auto-merge is on: GitHub merges it once its requirements are met. */
  readonly autoMerging: boolean;
}

export interface ReviewVerdict {
  readonly login: string;
  readonly state: 'APPROVED' | 'CHANGES_REQUESTED';
  /** The review's id, as its timeline anchor names it (`pullrequestreview-<id>`). */
  readonly id: number | null;
}

/**
 * What the controls offer: a merge, a merge only past the rules (GitHub's bypass), a place in the merge queue, a merge
 * once the requirements are met (auto-merge), or none.
 */
export type MergeOffer = 'merge' | 'bypass' | 'queue' | 'auto' | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isMethod(value: unknown): value is MergeMethod {
  return value === 'MERGE' || value === 'SQUASH' || value === 'REBASE';
}

/**
 * Whether GitHub would merge it now, as its merge box decides: `MERGEABLE`, or `MERGEABLE_IF_STATUSES_PASS` once the
 * statuses do pass. The box reads those from its separate status query; the pull request's `mergeStateStatus` says
 * the same in one word: `CLEAN` (mergeable with passing commit status), `HAS_HOOKS` (the same with pre-receive hooks)
 * and `UNSTABLE` (mergeable with a check that is not required still pending or failing: GitHub's merge box offers its
 * merge there, geld#486 in Nov 2026), where `BEHIND`, `BLOCKED` (a required check, review or rule still waiting) and
 * the rest are not ready.
 */
export function mergeableNow(requirementsState: unknown, mergeStateStatus: unknown): boolean {
  if (requirementsState === 'MERGEABLE') return true;
  return requirementsState === 'MERGEABLE_IF_STATUSES_PASS' && (mergeStateStatus === 'CLEAN' || mergeStateStatus === 'HAS_HOOKS' || mergeStateStatus === 'UNSTABLE');
}

/** The failed merge conditions GitHub's merge box treats as beyond an admin's bypass (conflicts, the repository's or the reader's state). */
const UNBYPASSABLE: ReadonlySet<string> = new Set(['PULL_REQUEST_MERGE_CONFLICT_STATE', 'PULL_REQUEST_REPO_STATE', 'PULL_REQUEST_USER_STATE']);

function methodsIn(listed: readonly unknown[], statuses: readonly string[]): readonly MergeMethod[] {
  return listed
    .filter((method): method is Record<string, unknown> => isRecord(method) && typeof method.allowableStatus === 'string' && statuses.includes(method.allowableStatus) && isMethod(method.name))
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true))
    .map((method) => method.name)
    .filter(isMethod);
}

/** A `page_data/merge_box` answer, or null when it is not one. */
export function parseMergeBox(payload: unknown): MergeBox | null {
  if (!isRecord(payload) || !isRecord(payload.pullRequest)) return null;
  const pull = payload.pullRequest;
  const requirements = isRecord(payload.mergeRequirements) ? payload.mergeRequirements : {};
  const actions = Array.isArray(pull.viewerMergeActions) ? pull.viewerMergeActions : [];
  const direct = actions.find((action): action is Record<string, unknown> => isRecord(action) && action.name === 'DIRECT_MERGE');
  // GitHub shows "Merge when ready" when the queue's action is allowed, as it shows its merge button for the direct one.
  const queue = actions.find((action): action is Record<string, unknown> => isRecord(action) && action.name === 'MERGE_QUEUE');
  const listed = direct !== undefined && Array.isArray(direct.mergeMethods) ? direct.mergeMethods : [];
  const methods = direct?.allowableStatus === 'ALLOWED' ? methodsIn(listed, ['ALLOWED']) : [];
  // An admin blocked by the rules sees the merge and its methods as ALLOWED_WITH_BYPASS, and GitHub's merge box offers them.
  const bypassMethods = direct?.allowableStatus === 'ALLOWED' || direct?.allowableStatus === 'ALLOWED_WITH_BYPASS' ? methodsIn(listed, ['ALLOWED', 'ALLOWED_WITH_BYPASS']) : [];
  // GitHub's merge box sends the default email only while it offers emails to pick from: with none (a pull request a bot
  // opened, whose noreply address is the default) it sends no email and GitHub takes the reader's own, which the bot's is not.
  const offered = Array.isArray(requirements.possibleCommitAuthorEmails) && requirements.possibleCommitAuthorEmails.length > 0;
  const email = offered ? stringOf(requirements.defaultCommitAuthorEmail) : '';
  const conditions = Array.isArray(requirements.conditions) ? requirements.conditions : [];
  const stacked = conditions.some((condition) => isRecord(condition) && condition.type === 'STACK' && condition.isStacked === true);
  const unbypassable = conditions.some((condition) => isRecord(condition) && condition.result === 'FAILED' && typeof condition.type === 'string' && UNBYPASSABLE.has(condition.type));
  const reviews = Array.isArray(pull.latestOpinionatedReviews) ? pull.latestOpinionatedReviews : [];
  const verdicts: ReviewVerdict[] = [];
  for (const review of reviews) {
    if (!isRecord(review) || !isRecord(review.author)) continue;
    const login = stringOf(review.author.login);
    const id = typeof review.id === 'number' && Number.isFinite(review.id) ? review.id : null;
    if (login !== '' && (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED')) verdicts.push({ login, state: review.state, id });
  }
  return {
    state: pull.state === 'OPEN' || pull.state === 'CLOSED' || pull.state === 'MERGED' ? pull.state : null,
    open: pull.state === 'OPEN',
    draft: pull.isDraft === true,
    canClose: pull.viewerCanClose === true,
    canMarkReady: pull.viewerCanMarkReadyForReview === true,
    canConvertToDraft: pull.viewerCanConvertToDraft === true,
    verdicts,
    mergeable: mergeableNow(requirements.state, pull.mergeStateStatus),
    canBypass: pull.viewerCanAdminBypassMergeRequirements === true,
    unbypassable,
    methods,
    bypassMethods,
    commitTitle: stringOf(requirements.commitMessageHeadline),
    commitMessage: stringOf(requirements.commitMessageBody),
    authorEmail: email === '' ? null : email,
    stacked,
    canQueue: queue?.allowableStatus === 'ALLOWED' && pull.isInMergeQueue !== true,
    canAutoMerge: pull.viewerCanEnableAutoMerge === true && !isRecord(pull.autoMergeRequest),
    queued: pull.isInMergeQueue === true,
    autoMerging: isRecord(pull.autoMergeRequest),
  };
}

/**
 * The merge on offer: none on a draft or a closed pull request; a plain
 * merge when GitHub would take it now; a bypass when it would take it only
 * past the rules (`asBypass` is the same box read with
 * `bypass_requirements=true`); in the order GitHub's merge box picks its
 * button: a place in the merge queue wherever the repository merges through
 * one and the reader may add it (whether or not a direct merge would also go:
 * GitHub shows the queue, and the queue waits for the checks itself); else a
 * merge GitHub would take now; else auto-merge where GitHub offers it (a pull
 * request still waiting on checks or reviews in a repository that allows it);
 * else a merge only past the rules.
 */
export function mergeOffer(box: MergeBox, asBypass: MergeBox | null): MergeOffer {
  if (!box.open || box.draft) return null;
  if (box.canQueue) return 'queue';
  if (box.methods.length > 0 && box.mergeable) return 'merge';
  if (box.methods.length > 0 && box.canAutoMerge) return 'auto';
  if (bypassMerges(box, asBypass)) return 'bypass';
  return null;
}

/**
 * As GitHub's merge box offers its bypass: to an admin, while the pull request would not merge on its own (or a queue
 * stands in the way) and auto-merge is off. The box read past the rules still says unmergeable for a failing required
 * check, so only conflicts and the like rule the bypass out.
 */
function bypassMerges(box: MergeBox, asBypass: MergeBox | null): boolean {
  if (!box.canBypass || box.autoMerging || box.unbypassable || asBypass?.unbypassable === true) return false;
  if (box.mergeable && !box.canQueue) return false;
  return (asBypass?.bypassMethods.length ?? 0) > 0 || box.bypassMethods.length > 0;
}

/**
 * Whether an admin's bypass stands beside the offer, as GitHub's "bypass
 * rules" checkbox does: beside the queue (merging at once, ahead of it) or
 * beside auto-merge (merging now instead of once the requirements are met),
 * never beside a merge GitHub would take now.
 */
export function bypassBeside(box: MergeBox, asBypass: MergeBox | null, offer: MergeOffer): boolean {
  return (offer === 'queue' || offer === 'auto') && bypassMerges(box, asBypass);
}

/** "Squash and merge", the words GitHub's merge box gives each method. */
export const METHOD_LABEL: { readonly [M in MergeMethod]: string } = { MERGE: 'Create a merge commit', SQUASH: 'Squash and merge', REBASE: 'Rebase and merge' };

/** "Confirm squash and merge", GitHub's confirmation for each method. */
export const METHOD_CONFIRM: { readonly [M in MergeMethod]: string } = { MERGE: 'Confirm merge', SQUASH: 'Confirm squash and merge', REBASE: 'Confirm rebase and merge' };

export interface MergeSubmission {
  readonly method: MergeMethod;
  readonly commitTitle: string;
  readonly commitMessage: string;
  readonly authorEmail: string | null;
  readonly bypass: boolean;
  readonly stacked: boolean;
  /** How many pull requests a stacked merge takes (it and every one below it), when known. */
  readonly stackEntries?: number;
}

/**
 * Whether the merge names its commit's author, as GitHub's merge box decides: only where it offered emails to pick
 * from (`authorEmail` is null otherwise), never for a rebase, which writes no commit of its own, and never for a squash
 * of more than one stacked pull request, which writes one commit per pull request ("Choosing author email is not
 * allowed"). A stack whose size is not known is taken to be several: leaving the email out costs nothing.
 */
function authorEmailFor(submission: Pick<MergeSubmission, 'authorEmail' | 'method'> & Partial<Pick<MergeSubmission, 'stacked' | 'stackEntries'>>): string | null {
  if (submission.method === 'REBASE') return null;
  if (submission.stacked === true && submission.method === 'SQUASH' && (submission.stackEntries ?? 2) > 1) return null;
  return submission.authorEmail;
}

function headers(nonce: string, json: boolean): Record<string, string> {
  const out: Record<string, string> = { Accept: 'application/json', 'GitHub-Verified-Fetch': 'true', 'X-Requested-With': 'XMLHttpRequest' };
  if (json) out['Content-Type'] = 'application/json';
  if (nonce !== '') out['X-Fetch-Nonce'] = nonce;
  return out;
}

export function mergeBoxUrl(pullPath: string, method: MergeMethod, bypass: boolean): string {
  return `${pullPath}/page_data/merge_box?merge_method=${method}&bypass_requirements=${String(bypass)}`;
}

/**
 * What GitHub's merge box sends to merge directly (a rebase carries no
 * commit): `merge` with `bypassBranchProtections`, or, for a pull request in
 * a stack, `enqueue_stack` with `mergeAction` and `bypassRules` as a string.
 */
export function mergeRequest(pullPath: string, submission: MergeSubmission, nonce: string): { readonly url: string; readonly init: RequestInit } {
  const body: Record<string, string | boolean> = submission.stacked
    ? { mergeAction: 'DIRECT_MERGE', bypassRules: String(submission.bypass), mergeMethod: submission.method }
    : { bypassBranchProtections: submission.bypass, mergeMethod: submission.method };
  if (submission.method !== 'REBASE') {
    body.commitTitle = submission.commitTitle;
    body.commitMessage = submission.commitMessage;
  }
  const email = authorEmailFor(submission);
  if (email !== null) body.authorEmail = email;
  return { url: `${pullPath}/page_data/${submission.stacked ? 'enqueue_stack' : 'merge'}`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, true), body: JSON.stringify(body) } };
}

/** What GitHub's merge box sends to close the pull request: nothing but the request. */
export function closeRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/close_pull_request`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, false) } };
}

/** What GitHub's merge box sends to take a draft out of draft: nothing but the request (a body only carries Copilot's review effort). */
export function readyRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/mark_ready_for_review`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, false) } };
}

/** What GitHub's header sends to turn an open pull request back into a draft: nothing but the request. */
export function draftRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/convert_to_draft`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, false) } };
}

/** What GitHub's merge box sends for "Merge when ready": `enable_auto_merge` with the queue's grouped strategy (its "Queue and force solo merge" sends `SOLO`). */
/** A stacked pull request's place in the merge queue, with every pull request below it, as GitHub's stack merge box sends it. */
export function stackQueueRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/enqueue_stack`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, true), body: JSON.stringify({ mergeAction: 'MERGE_QUEUE' }) } };
}

export function queueRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/enable_auto_merge`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, true), body: JSON.stringify({ mergeMethod: 'GROUP' }) } };
}

/**
 * What GitHub's merge box sends for "Enable auto-merge": `enable_auto_merge` with the method and the commit GitHub
 * would write, which it then merges with once the requirements are met.
 */
export function autoMergeRequest(pullPath: string, submission: Pick<MergeSubmission, 'method' | 'commitTitle' | 'commitMessage' | 'authorEmail'>, nonce: string): { readonly url: string; readonly init: RequestInit } {
  const body: Record<string, string> = { mergeMethod: submission.method, commitTitle: submission.commitTitle, commitMessage: submission.commitMessage };
  const email = authorEmailFor(submission);
  if (email !== null) body.authorEmail = email;
  return { url: `${pullPath}/page_data/enable_auto_merge`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, true), body: JSON.stringify(body) } };
}

/** What GitHub sends to reopen a closed pull request: nothing but the request. */
export function reopenRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/reopen_pull_request`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, false) } };
}

/** The reader's own standing verdict on the pull request, if they have one. */
export function viewerVerdict(box: MergeBox, login: string): ReviewVerdict['state'] | null {
  return box.verdicts.find((verdict) => verdict.login.toLowerCase() === login.toLowerCase())?.state ?? null;
}

function fetchNonce(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="fetch-nonce"]')?.content ?? '';
}

/** The merge box for a method, or null when GitHub could not say. */
export async function fetchMergeBox(pullPath: string, method: MergeMethod, bypass: boolean, signal?: AbortSignal): Promise<MergeBox | null> {
  try {
    const response = await pageFetch(mergeBoxUrl(pullPath, method, bypass), { credentials: 'same-origin', headers: headers(fetchNonce(), false), ...(signal === undefined ? {} : { signal }) });
    if (!response.ok) return null;
    return parseMergeBox(await response.json());
  } catch {
    return null;
  }
}

/** A pull request of the GitHub stack the page's belongs to. */
export interface StackMember {
  readonly number: number;
  /** `/owner/repo/pull/N`, where its own `page_data` requests go. */
  readonly path: string;
  readonly title: string;
  readonly current: boolean;
}

export interface Stack {
  /** Top of the stack first, as GitHub lists them, merged ones left out: they are no longer anyone's to act on. */
  readonly members: readonly StackMember[];
  /** Each member's merge box, for what the reader may do to it; missing where the read failed. */
  readonly boxes: ReadonlyMap<number, MergeBox>;
}

/** `page_data/stacks`: `{ stack: { pulls: [{ number, title, state, url }] } }`, top first. */
export function parseStack(payload: unknown, pullPath: string): readonly StackMember[] | null {
  if (!isRecord(payload) || !isRecord(payload.stack) || !Array.isArray(payload.stack.pulls)) return null;
  const current = Number(/\/pull\/(\d+)/.exec(pullPath)?.[1] ?? Number.NaN);
  const members: StackMember[] = [];
  for (const pull of payload.stack.pulls) {
    // A member that cannot be read would be left out of every choice that should take it: no stack rather than part of one.
    if (!isRecord(pull)) return null;
    if (pull.state === 'MERGED') continue;
    if (typeof pull.number !== 'number' || typeof pull.url !== 'string') return null;
    const path = new URL(pull.url, 'https://github.com').pathname;
    members.push({ number: pull.number, path, title: stringOf(pull.title), current: pull.number === current });
  }
  return members.some((member) => member.current) ? members : null;
}

/**
 * The stack as the React page embeds it (`pullRequestsLayoutRoute.stack`, the shape `page_data/stacks` answers with), so
 * no request has to come first: `none` where the page says the pull request is in no stack, null where the payload is
 * missing or another pull request's (GitHub's router keeps the first page's payload across soft navigations).
 */
export function embeddedStackRecord(pullPath: string, root: ParentNode = document): Record<string, unknown> | 'none' | null {
  const page = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pullPath);
  if (page === null) return null;
  const [, owner = '', repo = '', number = ''] = page;
  for (const script of root.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
    const layout = layoutRouteOf(script);
    if (layout === null || !isRecord(layout.pullRequest) || layout.pullRequest.number !== Number(number)) continue;
    if (layout.stack === null) return 'none';
    const stack = layout.stack;
    // The number alone is not this pull request: a payload kept from another repository's pull request of the same
    // number would hand its stack's paths to every stack action.
    if (!isRecord(stack) || stringOf(stack.repositoryOwnerLogin).toLowerCase() !== owner.toLowerCase() || stringOf(stack.repositoryName).toLowerCase() !== repo.toLowerCase()) return null;
    return stack;
  }
  return null;
}

/** The members of the stack the page embeds, its paths all in this repository. */
export function embeddedStack(pullPath: string, root: ParentNode = document): readonly StackMember[] | 'none' | null {
  const stack = embeddedStackRecord(pullPath, root);
  if (stack === null || stack === 'none') return stack;
  const page = /^\/([^/]+)\/([^/]+)\/pull\//.exec(pullPath);
  const repoPrefix = `/${page?.[1] ?? ''}/${page?.[2] ?? ''}/pull/`.toLowerCase();
  const members = parseStack({ stack }, pullPath);
  return members !== null && members.every((member) => member.path.toLowerCase().startsWith(repoPrefix)) ? members : null;
}

/**
 * When the pull request was opened (`pullRequest.createdTime`), from the payload the React page embeds, or null when the
 * payload is missing or another pull request's: the Overview's description box carries no clock of its own.
 */
export function embeddedPullRequestCreated(pullPath: string, root: ParentNode = document): string | null {
  const page = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(pullPath);
  if (page === null) return null;
  const [, owner = '', repo = '', number = ''] = page;
  for (const script of root.querySelectorAll('script[type="application/json"][data-target="react-app.embeddedData"]')) {
    const layout = layoutRouteOf(script);
    if (layout === null || !isRecord(layout.pullRequest) || layout.pullRequest.number !== Number(number)) continue;
    const repository = layout.repository;
    if (!isRecord(repository) || stringOf(repository.ownerLogin).toLowerCase() !== owner.toLowerCase() || stringOf(repository.name).toLowerCase() !== repo.toLowerCase()) continue;
    const created = stringOf(layout.pullRequest.createdTime);
    return created === '' || Number.isNaN(Date.parse(created)) ? null : created;
  }
  return null;
}

/** GitHub's `page_data/stacks` for a pull request, as it answered, or null when it did not. */
export async function fetchStackPayload(pullPath: string): Promise<unknown> {
  try {
    const response = await pageFetch(`${pullPath}/page_data/stacks`, { credentials: 'same-origin', headers: headers(fetchNonce(), false) });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return payload;
  } catch {
    return null;
  }
}

const layoutRoutes = new WeakMap<Element, { readonly text: string; readonly layout: Record<string, unknown> | null }>();

function layoutRouteOf(script: Element): Record<string, unknown> | null {
  const text = script.textContent ?? '';
  const known = layoutRoutes.get(script);
  if (known?.text === text) return known.layout;
  let layout: Record<string, unknown> | null = null;
  if (text.includes('"pullRequestsLayoutRoute"')) {
    try {
      const data: unknown = JSON.parse(text);
      const route = isRecord(data) && isRecord(data.payload) ? data.payload.pullRequestsLayoutRoute : null;
      layout = isRecord(route) ? route : null;
    } catch {
      layout = null;
    }
  }
  layoutRoutes.set(script, { text, layout });
  return layout;
}

async function readStackMembers(pullPath: string): Promise<readonly StackMember[] | null> {
  const payload = await fetchStackPayload(pullPath);
  return payload === null ? null : parseStack(payload, pullPath);
}

interface MemberBoxes {
  /** Filled as each lands, so a reading can be made before the slowest. */
  readonly boxes: ReadonlyMap<number, MergeBox>;
  readonly done: Promise<void>;
  readonly settled: () => boolean;
}

/** Every member's merge box but the page's own, which the caller reads and adds. */
function memberBoxes(members: readonly StackMember[]): MemberBoxes {
  const boxes = new Map<number, MergeBox>();
  let settled = false;
  const done = Promise.all(
    members.map(async (member) => {
      if (member.current) return;
      const read = await fetchMergeBox(member.path, 'SQUASH', false);
      if (read !== null) boxes.set(member.number, read);
    }),
  ).then(() => {
    settled = true;
  });
  return { boxes, done, settled: () => settled };
}

const PREFETCH_FRESH_MS = 10_000;
const prefetched = new Map<string, { readonly method: MergeMethod; readonly at: number; readonly box: Promise<MergeBox | null> }>();

/**
 * Ask for the page's merge box as the content script starts, before GitHub has drawn the header the controls wait for:
 * GitHub's own status menu on the Overview reads its box at load, and Geld's first read started half a second after.
 */
export function prefetchMergeBox(pullPath: string, method: MergeMethod): void {
  // One no read took (the controls never mounted) is spent once stale, or a visit back to the pull request asked nothing.
  const known = prefetched.get(pullPath);
  if (known !== undefined && Date.now() - known.at < PREFETCH_FRESH_MS) return;
  prefetched.set(pullPath, { method, at: Date.now(), box: fetchMergeBox(pullPath, method, false) });
}

function takePrefetched(pullPath: string, method: MergeMethod): Promise<MergeBox | null> | null {
  const entry = prefetched.get(pullPath);
  prefetched.delete(pullPath);
  return entry !== undefined && entry.method === method && Date.now() - entry.at < PREFETCH_FRESH_MS ? entry.box : null;
}

export interface MergeActions {
  readonly box: MergeBox;
  readonly offer: MergeOffer;
  /** The GitHub stack it belongs to, with every member's merge box; null when it is in none or the stack could not be read. */
  readonly stack: Stack | null;
  /** An admin's bypass beside the offer (`bypassBeside`): the menu lists it too. */
  readonly bypass: boolean;
  /** The direct methods the bypass may use, as the box read past the rules lists them (a queue's repository may allow none otherwise). */
  readonly bypassMethods: readonly MergeMethod[];
  /** Some members' boxes are still on their way: choices that take them are not offered yet. */
  readonly partial?: true;
}

/**
 * Whether each pull request was stacked when this page last read it. The embedded stack is the page's as it loaded,
 * so it answers the first read only: a member merged in another tab stayed in it, and its merged box then ruled out
 * every stack merge on each refresh. Later reads ask `page_data/stacks`, beside the box when the last read was stacked.
 */
const lastStacked = new Map<string, boolean>();

/**
 * What the reader may do now: the merge on offer and whether they may close, read with GitHub's default method.
 * `method` is the repository's default as last read, asked for first so the box needs no second read for its commit.
 * A stack's members have their boxes read beside this one's, so the menu waits on one box, not a chain.
 */
export async function readMergeActions(pullPath: string, method: MergeMethod = 'SQUASH', onPartial?: (actions: MergeActions) => void): Promise<MergeActions | null> {
  const known = lastStacked.get(pullPath);
  const embedded = known === undefined ? embeddedStack(pullPath) : null;
  const listed = embedded !== null && embedded !== 'none' ? Promise.resolve(embedded) : known === true ? readStackMembers(pullPath) : null;
  const early = listed === null ? null : listed.then((members) => (members === null ? null : { members, live: memberBoxes(members) }));
  const first = await (takePrefetched(pullPath, method) ?? fetchMergeBox(pullPath, method, false));
  if (first === null) return null;
  const preferred = first.methods[0] ?? first.bypassMethods[0] ?? 'SQUASH';
  // Another method's commit title and message would be sent under this one: no reading is safer than that.
  const box = preferred === method ? first : await fetchMergeBox(pullPath, preferred, false);
  if (box === null) return null;
  lastStacked.set(pullPath, box.stacked);
  const stackRead = async (): Promise<{ readonly members: readonly StackMember[]; readonly live: MemberBoxes } | null> => {
    if (!box.stacked) return null;
    const head = early === null ? null : await early;
    if (head !== null) return head;
    // A first read can start before GitHub has streamed its payload in; by the time the box is back it usually has.
    const late = known === undefined ? embeddedStack(pullPath) : null;
    const members = late !== null && late !== 'none' ? late : await readStackMembers(pullPath);
    return members === null ? null : { members, live: memberBoxes(members) };
  };
  // Past the rules: where it is not mergeable, or where a queue stands in a direct merge's way.
  const bypassRead = box.canBypass && (!box.mergeable || box.canQueue) ? fetchMergeBox(pullPath, preferred, true) : null;
  const listedStack = await stackRead();
  const stackNow = (): Stack | null => {
    if (listedStack === null) return null;
    const boxes = new Map(listedStack.live.boxes);
    const current = listedStack.members.find((member) => member.current);
    if (current !== undefined) boxes.set(current.number, box);
    return { members: listedStack.members, boxes };
  };
  // The page's own box is what this pull request's choices need: they show now, and a merge past the rules and the
  // stack's wider choices join when the box read past the rules and the other members' boxes land.
  if (onPartial !== undefined && (bypassRead !== null || (listedStack !== null && !listedStack.live.settled()))) {
    const offer = mergeOffer(box, null);
    onPartial({ box, offer, bypass: false, bypassMethods: box.bypassMethods, stack: stackNow(), partial: true });
  }
  const asBypass = bypassRead === null ? null : await bypassRead;
  await listedStack?.live.done;
  const offer = mergeOffer(box, asBypass);
  return { box, offer, bypass: bypassBeside(box, asBypass, offer), bypassMethods: asBypass?.bypassMethods ?? box.bypassMethods, stack: stackNow() };
}

/**
 * Whether a refresh's partial reading may wait for its complete one, leaving the complete reading in hand standing: only
 * while the pull request stands as it did (state, draft, what it may merge with) and its stack has the same members in
 * the same order. A member joined or gone changes what a stack merge takes (`enqueue_stack` takes every pull request
 * below), so the partial reading then stands in, which offers no stack choice until every member's box is read.
 */
export function partialMayWait(held: MergeActions, partial: MergeActions): boolean {
  const a = held.box;
  const b = partial.box;
  if (a.state !== b.state || a.draft !== b.draft || a.stacked !== b.stacked || a.mergeable !== b.mergeable || a.canQueue !== b.canQueue || held.offer !== partial.offer) return false;
  const members = (actions: MergeActions): string => actions.stack?.members.map((member) => `${member.number}${member.current ? '*' : ''}`).join(',') ?? '';
  return members(held) === members(partial);
}

/** The reason a merge or close failed, in GitHub's words when it gave any. */
export type StatusAction = 'merge' | 'queue' | 'auto' | 'close' | 'ready' | 'draft' | 'reopen';

const ACTION_VERB: { readonly [A in StatusAction]: string } = {
  merge: 'merge the pull request',
  queue: 'add the pull request to the merge queue',
  auto: 'enable auto-merge',
  close: 'close the pull request',
  ready: 'mark the pull request ready for review',
  draft: 'convert the pull request to a draft',
  reopen: 'reopen the pull request',
};

export function actionErrorText(action: StatusAction, status: number, payload: unknown): string {
  const verb = ACTION_VERB[action];
  if (isRecord(payload)) {
    const said = stringOf(payload.error).trim();
    const metadata = isRecord(payload.metadata) ? payload.metadata : {};
    const rules = Array.isArray(metadata.ruleErrors) ? metadata.ruleErrors.map((rule) => (isRecord(rule) ? stringOf(rule.message) : stringOf(rule))).filter((rule) => rule !== '') : [];
    const words = [said, ...rules].filter((word) => word !== '');
    if (words.length > 0) return `GitHub could not ${verb}: ${words.join(' ')}`;
  }
  return `GitHub could not ${verb} (HTTP ${status}).`;
}

/** Whether a merge answer says it went through (GitHub answers `{ status: "merged" }`, or `"failed"` with an error). */
export function mergeWentThrough(payload: unknown): boolean {
  return isRecord(payload) && payload.status !== 'failed' && payload.error === undefined;
}

export function isStackRequest(url: string): boolean {
  return /\/page_data\/enqueue_stack(?:$|[?#])/.test(url);
}

/**
 * Where a stack merge GitHub took stands, from `enqueue_stack`'s answer or a read of `merge_request_status`: settled
 * (`merged`, or `enqueued` into the merge queue), refused, or still under way. GitHub merges a stack one pull request at a
 * time from its foot, a second or so each, and may answer before it has finished, with an id to ask about.
 */
export type StackMergeState = { readonly kind: 'settled' } | { readonly kind: 'failed'; readonly payload: unknown } | { readonly kind: 'running' };

export function stackMergeState(payload: unknown): StackMergeState {
  const status = isRecord(payload) ? payload.status : undefined;
  if (status === 'failed') return { kind: 'failed', payload };
  return status === 'merged' || status === 'enqueued' ? { kind: 'settled' } : { kind: 'running' };
}

/** The id `enqueue_stack` answers with while the merge is still under way, or null when it says nothing more is coming. */
export function stackMergeId(payload: unknown): string | null {
  if (stackMergeState(payload).kind !== 'running' || !isRecord(payload)) return null;
  const uuid = stringOf(payload.uuid).trim();
  return uuid === '' ? null : uuid;
}

export function mergeRequestStatusUrl(pullPath: string, uuid: string): string {
  return `${pullPath}/page_data/merge_request_status/${encodeURIComponent(uuid)}`;
}

/** GitHub's own merge box polls at 1 s, growing by half each time, and gives up after ten minutes. */
const STACK_POLL_FIRST_MS = 1000;
const STACK_POLL_GROWTH = 1.5;
const STACK_POLL_LIMIT_MS = 600_000;
/** Reads of the status in a row that may fail before the merge is taken as done, as GitHub took the request. */
const STACK_POLL_MISSES = 5;

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));

/** The longest one read of a stack merge's status may take, so a stalled connection cannot keep the controls busy. */
const STATUS_READ_MS = 15_000;
const LEFT_CHECK_MS = 250;

/** Sleep `ms`, ending early, within `LEFT_CHECK_MS`, once `wanted` turns false: the gaps between polls grow past a minute. */
async function delayWhile(ms: number, wanted: () => boolean): Promise<void> {
  const until = Date.now() + ms;
  while (wanted()) {
    const left = until - Date.now();
    if (left <= 0) return;
    await delay(Math.min(left, LEFT_CHECK_MS));
  }
}

/**
 * A read that gives up, with null, at its deadline or once `wanted` turns false, aborting the request where the
 * browser lets the signal reach it (in Firefox the page's own fetch sends it, and only the wait ends).
 */
function readWithin<T>(read: (signal: AbortSignal) => Promise<T>, ms: number, wanted: () => boolean): Promise<T | null> {
  const abort = new AbortController();
  return new Promise<T | null>((resolve) => {
    const finish = (value: T | null): void => {
      window.clearTimeout(deadline);
      window.clearInterval(watch);
      abort.abort();
      resolve(value);
    };
    const deadline = window.setTimeout(() => finish(null), ms);
    const watch = window.setInterval(() => {
      if (!wanted()) finish(null);
    }, LEFT_CHECK_MS);
    read(abort.signal).then(finish, () => finish(null));
  });
}

/**
 * Wait until a stack merge `enqueue_stack` answered for has settled, reading `merge_request_status` as GitHub's merge
 * box does. A refusal comes back with GitHub's words; anything else (settled, not followable, `wanted` turning false)
 * resolves with null, since GitHub took the request.
 */
export async function settleStackMerge(pullPath: string, answer: unknown, wanted: () => boolean): Promise<{ readonly payload: unknown; readonly status: number } | null> {
  const uuid = stackMergeId(answer);
  if (uuid === null) return null;
  const started = Date.now();
  let wait = STACK_POLL_FIRST_MS;
  let misses = 0;
  while (wanted() && Date.now() - started + wait <= STACK_POLL_LIMIT_MS) {
    await delayWhile(wait, wanted);
    wait *= STACK_POLL_GROWTH;
    if (!wanted()) return null;
    const read = await readWithin(
      async (signal) => {
        const response = await pageFetch(mergeRequestStatusUrl(pullPath, uuid), { credentials: 'same-origin', cache: 'no-store', headers: headers(fetchNonce(), false), signal });
        return response.ok ? { status: response.status, state: stackMergeState(await response.json()) } : null;
      },
      Math.max(0, Math.min(STATUS_READ_MS, STACK_POLL_LIMIT_MS - (Date.now() - started))),
      wanted,
    );
    if (!wanted()) return null;
    if (read === null) {
      misses += 1;
      if (misses >= STACK_POLL_MISSES) return null;
      continue;
    }
    if (read.state.kind === 'settled') return null;
    if (read.state.kind === 'failed') return { payload: read.state.payload, status: read.status };
    misses = 0;
  }
  return null;
}

const MERGED_WAIT_MS = 10_000;
const MERGED_READ_MS = 1000;

/**
 * Wait, ten seconds at most however the reads go, until the merge box reads the pull request as merged: a page
 * reloaded before then is served open, and its pill turned back from merged.
 */
export async function awaitMergedState(pullPath: string, wanted: () => boolean): Promise<boolean> {
  const until = Date.now() + MERGED_WAIT_MS;
  for (let read = 0; wanted(); read += 1) {
    if (read > 0) {
      if (until - Date.now() <= MERGED_READ_MS) return false;
      await delayWhile(MERGED_READ_MS, wanted);
    }
    const left = until - Date.now();
    if (left <= 0 || !wanted()) return false;
    const box = await readWithin((signal) => fetchMergeBox(pullPath, 'SQUASH', false, signal), left, wanted);
    if (box?.state === 'MERGED') return true;
  }
  return false;
}

/**
 * Each repository's default merge method as last read, so the next read asks for that method's box first and needs no
 * second one for its commit (a repository whose default is not squash cost two merge boxes in a row before the menu
 * could open). In the page's own storage, read and written beside the status menu's hints.
 */
const METHOD_KEY = 'geld:merge-method';
const METHOD_CAP = 200;

function readMethods(): Record<string, MergeMethod> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(METHOD_KEY) ?? '{}');
    if (!isRecord(parsed)) return {};
    const out: Record<string, MergeMethod> = {};
    for (const [repo, value] of Object.entries(parsed)) if (isMethod(value)) out[repo] = value;
    return out;
  } catch {
    return {};
  }
}

export function methodHint(repo: string): MergeMethod {
  return readMethods()[repo] ?? 'SQUASH';
}

export function rememberMethod(repo: string, method: MergeMethod): void {
  const methods = readMethods();
  if (methods[repo] === method) return;
  delete methods[repo];
  methods[repo] = method;
  const entries = Object.entries(methods);
  try {
    window.localStorage.setItem(METHOD_KEY, JSON.stringify(Object.fromEntries(entries.slice(Math.max(0, entries.length - METHOD_CAP)))));
  } catch {
    // Storage full or blocked: the next read asks for squash first, as before.
  }
}
