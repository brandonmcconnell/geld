import type { AnyCategoryId, ChangeTotals, FileStats, RepoConfigMode, SettingsIssue } from '@geld/core';
import type { JevRequest, JevResult } from '@geld/review';

/** Messages exchanged between the content script, popup and background. */

export interface FetchDiffRequest {
  readonly type: 'geld:fetch-diff';
  readonly url: string;
}

export type FetchDiffResponse =
  | { readonly ok: true; readonly files: readonly FileStats[] }
  /** `retryAfterMs`: for `rate-limited`, how long the background will refuse before asking GitHub again. */
  | { readonly ok: false; readonly reason: string; readonly retryAfterMs?: number };

/**
 * Content script → background: read one public repository file (an
 * organisation's `.github` defaults) by its raw URL. Fetched from the
 * background rather than the page so that a missing file — the normal case —
 * does not put a red "404" line in the page's console attributed to Geld.
 */
export interface FetchFileRequest {
  readonly type: 'geld:fetch-file';
  readonly url: string;
}

export type FetchFileResponse =
  /** `text` is `null` when the repository has no such file (404). */
  | { readonly ok: true; readonly text: string | null }
  | { readonly ok: false; readonly reason: string };

/** Sent by the offscreen document whenever the OS/browser colour scheme changes. */
export interface ColorSchemeMessage {
  readonly type: 'geld:color-scheme';
  readonly dark: boolean;
}

/** Background → content script: the keyboard shortcut was pressed. */
export interface ToggleHiddenMessage {
  readonly type: 'geld:toggle-hidden';
}

/** Popup → content script: describe what Geld is doing on this tab. */
export interface GetTabStateMessage {
  readonly type: 'geld:get-tab-state';
}

/** Hash the popup's "go to file" navigates with when the diffs are on another tab of the PR. */
export const REVEAL_HASH_PREFIX = '#geld-reveal=';

/** Popup → content script: expand the hidden files and scroll to this one. */
export interface RevealFileMessage {
  readonly type: 'geld:reveal';
  readonly path: string;
}

/** Popup → background: the tab did not answer; inject the content script if it belongs there. */
export interface EnsureContentMessage {
  readonly type: 'geld:ensure-content';
  readonly tabId: number;
}

export interface EnsureContentResponse {
  /** `true` when the script was injected just now (the caller should ask again shortly). */
  readonly injected: boolean;
}

export interface TabCategoryState {
  readonly id: AnyCategoryId;
  readonly title: string;
  /** Compact nouns for counts ("test" / "tests"), so the popup can say "3 generated" when one category describes everything hidden. */
  readonly shortNoun: string;
  readonly shortNounPlural: string;
  readonly count: number;
  readonly paths: readonly string[];
}

/** What Geld knows about the current tab; drives the popup and the badge. */
export type RepoConfigDecision = 'use' | 'ignore' | 'undecided';

/** One repository-provided config file, as the popup shows it. */
export interface TabRepoConfigFile {
  readonly kind: 'repo' | 'org' | 'gitattributes';
  /** `owner/repo` holding the file. */
  readonly repo: string;
  readonly path: string;
  readonly url: string;
  /** "2 categories, 5 patterns"; empty when the file is invalid. */
  readonly summary: string;
  /** Validation problems; an empty list means the file is in use (or would be). */
  readonly issues: readonly SettingsIssue[];
}

/** What the current repository provides and what Geld does with it. */
export interface TabRepoConfig {
  readonly repo: string;
  readonly mode: RepoConfigMode;
  readonly decision: RepoConfigDecision;
  readonly loading: boolean;
  readonly files: readonly TabRepoConfigFile[];
}

export interface TabState {
  readonly repo: string | null;
  /** `null` when repository configs are off, or the page is not in a repository. */
  readonly repoConfig: TabRepoConfig | null;
  readonly allowed: boolean;
  /** The repo rule that turned Geld off here, if any. */
  readonly rule: string | null;
  readonly hasDiff: boolean;
  readonly hiddenCount: number;
  readonly all: ChangeTotals | null;
  readonly visible: ChangeTotals | null;
  readonly categories: readonly TabCategoryState[];
  readonly expanded: boolean;
  /** Where the diffs for this page live (the PR's files tab, the commit itself), for "go to file". */
  readonly diffPageUrl: string | null;
  /** Whether the diffs are rendered on this page (so a reveal can happen in place). */
  readonly onDiffPage: boolean;
}

/** Content script → background: update the toolbar badge for this tab. */
export interface TabStateMessage {
  readonly type: 'geld:tab-state';
  readonly state: TabState;
}

/** Popup/options → background: account and sync actions. */
export interface AccountActionMessage {
  readonly type: 'geld:account';
  readonly action: AccountAction;
}

export type AccountAction =
  | 'sign-in'
  | 'cancel-sign-in'
  | 'sign-out'
  | 'sync-now'
  | 'resolve-remote'
  | 'resolve-local'
  /** The account's gist is corrupted: replace it (and this device) with the defaults. */
  | 'reset-remote';

export type AccountActionResponse = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * Options → background: look for a newer pattern catalog right now. The
 * outcome is also published through `local:catalogStatus`, which the options
 * page watches; the response only lets the caller stop its spinner.
 */
export interface CatalogCheckMessage {
  readonly type: 'geld:catalog-check';
}

export type GeldRequest =
  | FetchDiffRequest
  | FetchFileRequest
  | ColorSchemeMessage
  | ToggleHiddenMessage
  | GetTabStateMessage
  | RevealFileMessage
  | EnsureContentMessage
  | TabStateMessage
  | AccountActionMessage
  | CatalogCheckMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isFetchDiffRequest(value: unknown): value is FetchDiffRequest {
  return isRecord(value) && value.type === 'geld:fetch-diff' && typeof value.url === 'string';
}

export function isFetchDiffResponse(value: unknown): value is FetchDiffResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return Array.isArray(value.files);
  return value.ok === false && typeof value.reason === 'string';
}

export function isFetchFileRequest(value: unknown): value is FetchFileRequest {
  return isRecord(value) && value.type === 'geld:fetch-file' && typeof value.url === 'string';
}

export function isFetchFileResponse(value: unknown): value is FetchFileResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return value.text === null || typeof value.text === 'string';
  return value.ok === false && typeof value.reason === 'string';
}

export function isColorSchemeMessage(value: unknown): value is ColorSchemeMessage {
  return isRecord(value) && value.type === 'geld:color-scheme' && typeof value.dark === 'boolean';
}

export function isToggleHiddenMessage(value: unknown): value is ToggleHiddenMessage {
  return isRecord(value) && value.type === 'geld:toggle-hidden';
}

export function isGetTabStateMessage(value: unknown): value is GetTabStateMessage {
  return isRecord(value) && value.type === 'geld:get-tab-state';
}

export function isRevealFileMessage(value: unknown): value is RevealFileMessage {
  return isRecord(value) && value.type === 'geld:reveal' && typeof value.path === 'string';
}

export function isEnsureContentMessage(value: unknown): value is EnsureContentMessage {
  return isRecord(value) && value.type === 'geld:ensure-content' && typeof value.tabId === 'number';
}

export function isEnsureContentResponse(value: unknown): value is EnsureContentResponse {
  return isRecord(value) && typeof value.injected === 'boolean';
}

export function isTabStateMessage(value: unknown): value is TabStateMessage {
  return isRecord(value) && value.type === 'geld:tab-state' && isTabState(value.state);
}

export function isTabState(value: unknown): value is TabState {
  return (
    isRecord(value) &&
    typeof value.allowed === 'boolean' &&
    typeof value.hasDiff === 'boolean' &&
    typeof value.hiddenCount === 'number' &&
    Array.isArray(value.categories) &&
    typeof value.expanded === 'boolean' &&
    (value.diffPageUrl === null || typeof value.diffPageUrl === 'string') &&
    typeof value.onDiffPage === 'boolean' &&
    (value.repoConfig === null || isRecord(value.repoConfig))
  );
}

const ACCOUNT_ACTIONS: ReadonlySet<string> = new Set<AccountAction>([
  'sign-in',
  'cancel-sign-in',
  'sign-out',
  'sync-now',
  'resolve-remote',
  'resolve-local',
  'reset-remote',
]);

export function isAccountActionMessage(value: unknown): value is AccountActionMessage {
  return isRecord(value) && value.type === 'geld:account' && typeof value.action === 'string' && ACCOUNT_ACTIONS.has(value.action);
}

export function isCatalogCheckMessage(value: unknown): value is CatalogCheckMessage {
  return isRecord(value) && value.type === 'geld:catalog-check';
}

export function isAccountActionResponse(value: unknown): value is AccountActionResponse {
  if (!isRecord(value)) return false;
  return value.ok === true || (value.ok === false && typeof value.message === 'string');
}

/** Background → OpenAI-compatible gateway. Never sent without a user key. */
export interface AiChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface AiModelsRequest {
  readonly type: 'geld:ai-models';
  readonly baseUrl: string;
  readonly apiKey: string;
}

export type AiModelsResponse =
  | { readonly ok: true; readonly models: readonly { readonly id: string }[] }
  | { readonly ok: false; readonly reason: string };

export interface AiCompleteRequest {
  readonly type: 'geld:ai-complete';
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly AiChatMessage[];
  readonly jsonSchema?: unknown;
  readonly schemaName?: string;
}

export type AiCompleteResponse =
  | { readonly ok: true; readonly text: string; readonly model: string }
  | { readonly ok: false; readonly reason: string };

/** Background → Jev (through the gateway's TypeSafe-compatible API, or TypeSafe directly). */
export interface AiEvaluateRequest {
  readonly type: 'geld:ai-evaluate';
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly request: JevRequest;
}

export type AiEvaluateResponse = JevResult;

export function isAiEvaluateRequest(value: unknown): value is AiEvaluateRequest {
  return (
    isRecord(value) &&
    value.type === 'geld:ai-evaluate' &&
    typeof value.baseUrl === 'string' &&
    typeof value.apiKey === 'string' &&
    isRecord(value.request) &&
    typeof value.request.model === 'string' &&
    typeof value.request.state === 'string' &&
    isRecord(value.request.questions)
  );
}

export function isAiEvaluateResponse(value: unknown): value is AiEvaluateResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return typeof value.model === 'string' && isRecord(value.answers);
  return value.ok === false && typeof value.reason === 'string';
}

export function isAiModelsRequest(value: unknown): value is AiModelsRequest {
  return (
    isRecord(value) &&
    value.type === 'geld:ai-models' &&
    typeof value.baseUrl === 'string' &&
    typeof value.apiKey === 'string'
  );
}

export function isAiModelsResponse(value: unknown): value is AiModelsResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) {
    return Array.isArray(value.models) && value.models.every((entry) => isRecord(entry) && typeof entry.id === 'string');
  }
  return value.ok === false && typeof value.reason === 'string';
}

export function isAiCompleteRequest(value: unknown): value is AiCompleteRequest {
  return (
    isRecord(value) &&
    value.type === 'geld:ai-complete' &&
    typeof value.baseUrl === 'string' &&
    typeof value.apiKey === 'string' &&
    typeof value.model === 'string' &&
    Array.isArray(value.messages)
  );
}

export function isAiCompleteResponse(value: unknown): value is AiCompleteResponse {
  if (!isRecord(value)) return false;
  if (value.ok === true) return typeof value.text === 'string' && typeof value.model === 'string';
  return value.ok === false && typeof value.reason === 'string';
}
