/**
 * What the reader may do to the pull request beyond reviewing it, and the
 * requests that do it, as GitHub's React merge box reads and sends them
 * (verified Oct 2026 by reading its bundle and capturing its requests with
 * the writes stubbed): `GET page_data/merge_box?merge_method=…&bypass_requirements=…`
 * says whether the reader can merge (directly, or only by bypassing the
 * rules), close and mark a draft ready, and whose verdicts stand; `POST page_data/merge`
 * merges; `POST page_data/close_pull_request` closes; `POST page_data/mark_ready_for_review`
 * takes a draft out of draft; `POST page_data/enable_auto_merge` with a merge queue's strategy adds the pull request to
 * the repository's merge queue ("Merge when ready"). Same origin and session as the page, so they work from any tab.
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
  /** The direct merge methods the repository allows the reader, GitHub's default first. */
  readonly methods: readonly MergeMethod[];
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
 * the same in one word (`CLEAN`: mergeable with passing commit status, `HAS_HOOKS`: the same with pre-receive hooks),
 * where `BEHIND`, `BLOCKED`, `UNSTABLE` and the rest are not ready.
 */
export function mergeableNow(requirementsState: unknown, mergeStateStatus: unknown): boolean {
  if (requirementsState === 'MERGEABLE') return true;
  return requirementsState === 'MERGEABLE_IF_STATUSES_PASS' && (mergeStateStatus === 'CLEAN' || mergeStateStatus === 'HAS_HOOKS');
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
  const allowed = direct !== undefined && direct.allowableStatus === 'ALLOWED' && Array.isArray(direct.mergeMethods) ? direct.mergeMethods : [];
  const methods = allowed
    .filter((method): method is Record<string, unknown> => isRecord(method) && method.allowableStatus === 'ALLOWED' && isMethod(method.name))
    .sort((a, b) => Number(b.isDefault === true) - Number(a.isDefault === true))
    .map((method) => method.name)
    .filter(isMethod);
  const email = stringOf(requirements.defaultCommitAuthorEmail);
  const conditions = Array.isArray(requirements.conditions) ? requirements.conditions : [];
  const stacked = conditions.some((condition) => isRecord(condition) && condition.type === 'STACK' && condition.isStacked === true);
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
    methods,
    commitTitle: stringOf(requirements.commitMessageHeadline),
    commitMessage: stringOf(requirements.commitMessageBody),
    authorEmail: email === '' ? null : email,
    stacked,
    canQueue: queue?.allowableStatus === 'ALLOWED' && pull.isInMergeQueue !== true,
    canAutoMerge: pull.viewerCanEnableAutoMerge === true && !isRecord(pull.autoMergeRequest),
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

function bypassMerges(box: MergeBox, asBypass: MergeBox | null): boolean {
  return box.canBypass && asBypass?.mergeable === true && (asBypass.methods.length > 0 || box.methods.length > 0);
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
  if (submission.authorEmail !== null) body.authorEmail = submission.authorEmail;
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
export function queueRequest(pullPath: string, nonce: string): { readonly url: string; readonly init: RequestInit } {
  return { url: `${pullPath}/page_data/enable_auto_merge`, init: { method: 'POST', credentials: 'same-origin', headers: headers(nonce, true), body: JSON.stringify({ mergeMethod: 'GROUP' }) } };
}

/**
 * What GitHub's merge box sends for "Enable auto-merge": `enable_auto_merge` with the method and the commit GitHub
 * would write, which it then merges with once the requirements are met.
 */
export function autoMergeRequest(pullPath: string, submission: Pick<MergeSubmission, 'method' | 'commitTitle' | 'commitMessage' | 'authorEmail'>, nonce: string): { readonly url: string; readonly init: RequestInit } {
  const body: Record<string, string> = { mergeMethod: submission.method, commitTitle: submission.commitTitle, commitMessage: submission.commitMessage };
  if (submission.authorEmail !== null) body.authorEmail = submission.authorEmail;
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
export async function fetchMergeBox(pullPath: string, method: MergeMethod, bypass: boolean): Promise<MergeBox | null> {
  try {
    const response = await fetch(mergeBoxUrl(pullPath, method, bypass), { credentials: 'same-origin', headers: headers(fetchNonce(), false) });
    if (!response.ok) return null;
    return parseMergeBox(await response.json());
  } catch {
    return null;
  }
}

export interface MergeActions {
  readonly box: MergeBox;
  readonly offer: MergeOffer;
  /** An admin's bypass beside the offer (`bypassBeside`): the menu lists it too. */
  readonly bypass: boolean;
  /** The direct methods the bypass may use, as the box read past the rules lists them (a queue's repository may allow none otherwise). */
  readonly bypassMethods: readonly MergeMethod[];
}

/** What the reader may do now: the merge on offer and whether they may close, read with GitHub's default method. */
export async function readMergeActions(pullPath: string): Promise<MergeActions | null> {
  const first = await fetchMergeBox(pullPath, 'SQUASH', false);
  if (first === null) return null;
  const method = first.methods[0] ?? 'SQUASH';
  // The squash box's commit title and message would be sent under another method: no reading is safer than that.
  const box = method === 'SQUASH' ? first : await fetchMergeBox(pullPath, method, false);
  if (box === null) return null;
  // Past the rules: where it is not mergeable, or where a queue stands in a direct merge's way.
  const asBypass = box.canBypass && (!box.mergeable || box.canQueue) ? await fetchMergeBox(pullPath, method, true) : null;
  const offer = mergeOffer(box, asBypass);
  return { box, offer, bypass: bypassBeside(box, asBypass, offer), bypassMethods: asBypass?.methods ?? [] };
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
