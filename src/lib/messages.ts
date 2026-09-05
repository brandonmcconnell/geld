import type { CategoryId } from './categories';
import type { FileStats } from './diff-parse';
import type { ChangeTotals } from './format';

/** Messages exchanged between the content script, popup and background. */

export interface FetchDiffRequest {
  readonly type: 'geld:fetch-diff';
  readonly url: string;
}

export type FetchDiffResponse =
  | { readonly ok: true; readonly files: readonly FileStats[] }
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

export interface TabCategoryState {
  readonly id: CategoryId;
  readonly title: string;
  readonly count: number;
  readonly paths: readonly string[];
}

/** What Geld knows about the current tab; drives the popup and the badge. */
export interface TabState {
  readonly repo: string | null;
  readonly allowed: boolean;
  /** The repo rule that turned Geld off here, if any. */
  readonly rule: string | null;
  readonly hasDiff: boolean;
  readonly hiddenCount: number;
  readonly all: ChangeTotals | null;
  readonly visible: ChangeTotals | null;
  readonly categories: readonly TabCategoryState[];
  readonly expanded: boolean;
}

/** Content script → background: update the toolbar badge for this tab. */
export interface TabStateMessage {
  readonly type: 'geld:tab-state';
  readonly state: TabState;
}

export type GeldRequest = FetchDiffRequest | ColorSchemeMessage | ToggleHiddenMessage | GetTabStateMessage | TabStateMessage;

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

export function isColorSchemeMessage(value: unknown): value is ColorSchemeMessage {
  return isRecord(value) && value.type === 'geld:color-scheme' && typeof value.dark === 'boolean';
}

export function isToggleHiddenMessage(value: unknown): value is ToggleHiddenMessage {
  return isRecord(value) && value.type === 'geld:toggle-hidden';
}

export function isGetTabStateMessage(value: unknown): value is GetTabStateMessage {
  return isRecord(value) && value.type === 'geld:get-tab-state';
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
    typeof value.expanded === 'boolean'
  );
}
