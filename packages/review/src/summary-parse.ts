/**
 * Recover GeldPrMeta from a comment body (raw markdown) or from the text
 * GitHub actually renders (`pre[lang="geld"]`, nbsp, smart quotes).
 */

import type { GeldPrMeta, ParseResult } from './model';
import { DATA_SUMMARY, PAYLOAD_ATTR_PREFIX, PAYLOAD_FENCE, SUMMARY_HEADING, SUMMARY_MARKER, parseGeldPrMeta } from './model';

const FENCE = new RegExp('```(?:' + PAYLOAD_FENCE + '|json)\\s*\\r?\\n([\\s\\S]*?)```', 'i');
/**
 * The carrier in the comment's markdown source. The renderer writes the
 * attribute single-quoted (`title='geld:…'`), so JSON's own double quotes
 * stand as they are and only `&`, `'`, `<`, `>` are entities — a 40 KB
 * payload grows by a few bytes, not by half; the same JSON double-quoted
 * grew past GitHub's 65,536-character comment cap. GitHub re-serializes
 * the rendered attribute double-quoted with `&quot;`, which the browser
 * decodes before `getAttribute` hands it over.
 */
const CARRIER = new RegExp("title='" + PAYLOAD_ATTR_PREFIX + "([^']*)'");

/** The payload as the renderer writes it into a single-quoted attribute value. */
export function encodePayloadAttribute(json: string): string {
  return PAYLOAD_ATTR_PREFIX + json.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Entities back to characters; `&amp;` last, so an escaped entity in the JSON itself comes back as the entity. */
function decodeEntities(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** The payload JSON from an attribute value read from the DOM (already decoded) or null when it is not a carrier. */
export function payloadFromAttribute(value: string | null | undefined): string | null {
  if (value === null || value === undefined || !value.startsWith(PAYLOAD_ATTR_PREFIX)) return null;
  return value.slice(PAYLOAD_ATTR_PREFIX.length);
}

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
  // The carrier first, from the markdown source: exact bytes, no typographic guesswork needed.
  const carried = CARRIER.exec(body);
  if (carried?.[1] !== undefined) return decodeEntities(carried[1]);
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
  return body.includes(SUMMARY_MARKER) || body.includes(`### ${SUMMARY_HEADING}`) || body.includes(`title='${PAYLOAD_ATTR_PREFIX}`) || body.includes(`<summary>${DATA_SUMMARY}</summary>`);
}

/** Minimal DOM surface so this package stays free of browser lib types. */
export interface QueryRoot {
  readonly textContent: string | null;
  querySelector(selector: string): { readonly textContent: string | null; getAttribute?(name: string): string | null } | null;
}

/** The selector for the payload's carrier in a rendered comment. */
export const PAYLOAD_CARRIER_SELECTOR = `span[title^="${PAYLOAD_ATTR_PREFIX}"]`;

/**
 * Read the payload from a rendered comment element: the carrier span's
 * `title` (the browser has decoded the entities), else — for summaries
 * written before the carrier — the `pre[lang="geld"]` fence, tolerating
 * highlight wrappers and entity decoding.
 */
export function parseSummaryElement(root: QueryRoot): ParseResult<GeldPrMeta> {
  const carrier = root.querySelector(PAYLOAD_CARRIER_SELECTOR);
  const carried = carrier?.getAttribute === undefined ? null : payloadFromAttribute(carrier.getAttribute('title'));
  if (carried !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(carried);
    } catch {
      return { ok: false, issues: ['$: Payload is not valid JSON.'] };
    }
    return parseGeldPrMeta(parsed);
  }
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
