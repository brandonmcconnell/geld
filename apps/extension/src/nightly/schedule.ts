import type { NightlyStatus } from './state';

/**
 * When to look for a build, and when to ask the API about it. Every GitHub page load and in-page navigation
 * looks, through the cheap latest-release redirect; these keep a burst of them (ten tabs restored, a quick
 * run of clicks) to one look, and the API to one request per new tag.
 */

/** Navigations closer together than this share one look. */
export const NAVIGATION_GAP_MS = 10_000;
/** With no GitHub page in use, the alarm still looks this often. */
export const BACKGROUND_CHECK_MINUTES = 30;
/** A tag the API did not describe yet (its zips still uploading, a lagging mirror) is asked about again after this. */
export const DETAILS_RETRY_MS = 2 * 60_000;

export function navigationDue(lastLookAt: number | null, now: number): boolean {
  return lastLookAt === null || now - lastLookAt >= NAVIGATION_GAP_MS;
}

/** With no time in a rate-limited answer, the API is left alone this long. */
export const LIMITED_DEFAULT_MS = 15 * 60_000;
const LIMITED_MAX_MS = 60 * 60_000;

/**
 * Whether the API should be asked about `tag`: never asked, or asked but not answered with it, long enough ago.
 * `null` is a latest-release page that could not be read, which must not turn every navigation into a request.
 */
export function needsDetails(status: NightlyStatus, tag: string | null, now: number): boolean {
  if (status.limitedUntil !== null && now < new Date(status.limitedUntil).getTime()) return false;
  const askedLongAgo = status.askedAt === null || now - new Date(status.askedAt).getTime() >= DETAILS_RETRY_MS;
  if (tag === null) return askedLongAgo;
  if (tag !== status.askedTag) return true;
  if (status.latest?.tag === tag) return false;
  return askedLongAgo;
}

/** When a rate-limited API answer lets Geld ask again: `retry-after` seconds, else `x-ratelimit-reset` epoch seconds. */
export function limitedUntil(retryAfter: string | null, reset: string | null, now: number): number {
  const after = retryAfter === null ? NaN : Number(retryAfter) * 1000;
  const at = Number.isFinite(after) && after >= 0 ? now + after : reset === null ? NaN : Number(reset) * 1000;
  const until = Number.isFinite(at) && at > now ? at : now + LIMITED_DEFAULT_MS;
  return Math.min(until, now + LIMITED_MAX_MS);
}
