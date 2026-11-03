/**
 * Recover GeldPrMeta from a comment body (raw markdown) or from the text
 * GitHub actually renders (`pre[lang="geld"]`, nbsp, smart quotes).
 */

import type { GeldPrMeta, ParseResult } from './model';
import { DATA_SUMMARY, PAYLOAD_ATTR_PREFIX, PAYLOAD_FENCE, SITE_ORIGIN, SUMMARY_HEADING, SUMMARY_MARKER, howItWorksUrl, parseGeldPrMeta } from './model';

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

/** Shared raw footer format. This is a transport frame, never proof of authorship. */
export function publishedSummaryFooter(json: string, href: string, label: string): string {
  return `<sub>Maintained by Geld · <a href="${href}">${label}</a> · <a href="${howItWorksUrl()}">what is this?</a><span title='${encodePayloadAttribute(json)}'></span></sub>`;
}

function publishedLink(href: string, label: string): boolean {
  if (label === 'Open in Geld') {
    return href === howItWorksUrl() || (href.startsWith(`${SITE_ORIGIN}/pr/`) && /^[^/?#]+\/[^/?#]+\/[1-9]\d*#[A-Za-z0-9_-]+$/.test(href.slice(`${SITE_ORIGIN}/pr/`.length)));
  }
  const review = label === 'Open merge request' ? '-/merge_requests' : '(?:pull-requests|pull)';
  return new RegExp(`^https?://[^/?#@\\s]+/(?:[^/?#\\s]+/)+${review}/[1-9]\\d*$`).test(href);
}

/** Recognizes the publisher's leading frame, even when its cached data is damaged. Not ownership proof. */
export function hasPublishedSummaryPrefix(body: string): boolean {
  const [marker, heading] = body.split(/\r?\n/, 3);
  return marker === SUMMARY_MARKER && heading === `### ${SUMMARY_HEADING}`;
}

interface RawPublishedFrame {
  readonly json: string;
  readonly href: string;
  readonly label: string;
}

function publishedFrame(body: string): RawPublishedFrame | null {
  const lines = body.split(/\r?\n/);
  if (!hasPublishedSummaryPrefix(body)) return null;
  // The renderer emits one final newline. An EOF without it is equivalent;
  // additional trailing content (including blank lines) is not its frame.
  if (lines.at(-1) === '') lines.pop();
  let fence: { readonly character: string; readonly length: number } | null = null;
  let payload: RawPublishedFrame | null = null;
  for (let index = 2; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    const run = delimiter?.[1];
    if (fence !== null) {
      if (run !== undefined && run[0] === fence.character && run.length >= fence.length && delimiter?.[2]?.trim() === '') fence = null;
      continue;
    }
    if (run !== undefined) {
      // Backticks in a backtick fence's info string do not open a fence.
      if (run[0] !== '`' || !delimiter?.[2]?.includes('`')) fence = { character: run[0] ?? '', length: run.length };
      continue;
    }
    const footer = /^<sub>Maintained by Geld · <a href="([^"<>\r\n]+)">(Open in Geld|Open merge request|Open pull request)<\/a> · <a href="([^"<>\r\n]+)">what is this\?<\/a><span title='([^']*)'><\/span><\/sub>$/.exec(line);
    if (footer === null) continue;
    // More than one unquoted footer is ambiguous, even if the last is valid.
    if (payload !== null || index !== lines.length - 1) return null;
    const href = footer[1];
    const label = footer[2];
    const carried = footer[4];
    if (href === undefined || label === undefined || carried === undefined || footer[3] !== howItWorksUrl() || !publishedLink(href, label)) return null;
    const json = payloadFromAttribute(decodeEntities(carried));
    if (json === null || line !== publishedSummaryFooter(json, href, label)) return null;
    payload = { json, href, label };
  }
  return fence === null ? payload : null;
}

function publishedPayloadText(body: string): string | null { return publishedFrame(body)?.json ?? null; }

function parsePayload(text: string): ParseResult<GeldPrMeta> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: ['$: Payload is not valid JSON.'] };
  }
  return parseGeldPrMeta(parsed);
}

/**
 * Read only the exact terminal frame written by our publisher, outside code.
 * Callers must independently verify native ownership, review scope and head.
 * Legacy/body-only carriers intentionally fail instead of becoming cached data.
 */
export function parsePublishedSummaryBody(body: string): ParseResult<GeldPrMeta> {
  const text = publishedPayloadText(body);
  return text === null ? { ok: false, issues: ['$: No unambiguous published Geld footer.'] } : parsePayload(text);
}

/** The strict frame's validated link remains available for provider scope checks. */
export function parsePublishedSummaryFrame(body: string): ParseResult<{ readonly meta: GeldPrMeta; readonly href: string; readonly label: string }> {
  const frame = publishedFrame(body);
  if (frame === null) return { ok: false, issues: ['$: No unambiguous published Geld footer.'] };
  const meta = parsePayload(frame.json);
  return meta.ok ? { ok: true, value: { meta: meta.value, href: frame.href, label: frame.label } } : meta;
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
  const published = publishedPayloadText(body);
  if (published !== null && parsePayload(published).ok) return published;
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
  return parsePayload(text);
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
