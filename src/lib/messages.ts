import type { FileStats } from './diff-parse';

/** Messages exchanged between the content script and the background script. */

export interface FetchDiffRequest {
  readonly type: 'geld:fetch-diff';
  readonly url: string;
}

/** Sent by the offscreen document whenever the OS/browser colour scheme changes. */
export interface ColorSchemeMessage {
  readonly type: 'geld:color-scheme';
  readonly dark: boolean;
}

export type GeldRequest = FetchDiffRequest | ColorSchemeMessage;

export function isColorSchemeMessage(value: unknown): value is ColorSchemeMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return record.type === 'geld:color-scheme' && typeof record.dark === 'boolean';
}

export type FetchDiffResponse =
  | { readonly ok: true; readonly files: readonly FileStats[] }
  | { readonly ok: false; readonly reason: string };

export function isFetchDiffRequest(value: unknown): value is FetchDiffRequest {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return record.type === 'geld:fetch-diff' && typeof record.url === 'string';
}

export function isFetchDiffResponse(value: unknown): value is FetchDiffResponse {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  if (record.ok === true) return Array.isArray(record.files);
  return record.ok === false && typeof record.reason === 'string';
}
