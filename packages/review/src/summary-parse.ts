/**
 * Recover GeldPrMeta from a comment body (raw markdown) or from the text
 * GitHub actually renders (`pre[lang="geld"]`, nbsp, smart quotes).
 */

import type { GeldPrMeta, ParseResult } from './model';
import { DATA_SUMMARY, PAYLOAD_FENCE, SUMMARY_HEADING, SUMMARY_MARKER, parseGeldPrMeta } from './model';

const FENCE = new RegExp('```(?:' + PAYLOAD_FENCE + '|json)\\s*\\r?\\n([\\s\\S]*?)```', 'i');

/** GitHub turns `--` into en-dashes and spaces into nbsp in some renders. */
export function normaliseRenderedJson(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2013|\u2014/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function extractPayloadText(body: string): string | null {
  const normalised = normaliseRenderedJson(body);
  const fenced = FENCE.exec(normalised);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  const trimmed = normalised.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  return null;
}

export function parseSummaryBody(body: string): ParseResult<GeldPrMeta> {
  const text = extractPayloadText(body);
  if (text === null) return { ok: false, issues: ['$: No geld payload fence found.'] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: ['$: Payload is not valid JSON.'] };
  }
  return parseGeldPrMeta(parsed);
}

export function looksLikeSummaryBody(body: string): boolean {
  return body.includes(SUMMARY_MARKER) || body.includes(`### ${SUMMARY_HEADING}`) || body.includes(`<summary>${DATA_SUMMARY}</summary>`);
}

/** Minimal DOM surface so this package stays free of browser lib types. */
export interface QueryRoot {
  readonly textContent: string | null;
  querySelector(selector: string): { readonly textContent: string | null } | null;
}

/**
 * Read the payload from a rendered comment element. GitHub keeps unknown
 * fence languages as `pre[lang="geld"]`; highlight wrappers and entity
 * decoding are tolerated.
 */
export function parseSummaryElement(root: QueryRoot): ParseResult<GeldPrMeta> {
  const pre =
    root.querySelector('pre[lang="geld"]') ??
    root.querySelector('[class*="highlight-source-geld"] pre') ??
    root.querySelector('pre[lang="json"]');
  const text = pre?.textContent ?? extractPayloadText(root.textContent ?? '');
  if (text === null || text === undefined || text.trim() === '') {
    return { ok: false, issues: ['$: No rendered geld payload.'] };
  }
  return parseSummaryBody(text);
}

/** Item ids whose task-list checkbox is ticked in the human-readable markdown. */
export function tickedItemIds(body: string, items: readonly { readonly id: string; readonly sources: readonly { readonly anchor: string }[] }[]): ReadonlySet<string> {
  const ticked = new Set<string>();
  const lines = body.split(/\r?\n/);
  for (const item of items) {
    const anchors = item.sources.map((source) => source.anchor);
    const checked = lines.some((line) => {
      if (!/^\s*[-*]\s+\[[xX]\]/.test(line)) return false;
      return anchors.some((anchor) => line.includes(`#${anchor}`));
    });
    if (checked) ticked.add(item.id);
  }
  return ticked;
}
