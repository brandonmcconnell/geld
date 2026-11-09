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

/** Whether the API should be asked about `tag`: never asked, or asked but not answered with it, long enough ago. */
export function needsDetails(status: NightlyStatus, tag: string, now: number): boolean {
  if (tag !== status.askedTag) return true;
  if (status.latest?.tag === tag) return false;
  return status.askedAt === null || now - new Date(status.askedAt).getTime() >= DETAILS_RETRY_MS;
}
