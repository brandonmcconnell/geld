/**
 * GitHub stops listening to a page's live updates once its tab has been
 * hidden 30s (its visibility handler's timer) and listens again when it
 * shows, so a reply posted in an existing thread meanwhile never arrives: the
 * thread's review region (`partials/reviews/<id>`) refreshes only on its own
 * socket message. Back after that long on a page Geld is active on, the
 * content script asks the page-world script (`portal.content.ts`) to send each
 * live region the `socket:message` GitHub's socket would have sent, and
 * GitHub's own handler refetches it. A message's `detail` reaches GitHub's
 * handler whole only from the page's world, hence the hop.
 */

/** GitHub's own grace before it stops listening. */
export const QUIET_AFTER_MS = 30_000;

/** On `document`, from the content script to the page-world script. */
export const LIVE_CATCH_UP_EVENT = 'geld:live-catch-up';

const LIVE_REGION = '.js-socket-channel.js-updatable-content[data-url]';

/**
 * The description, which holds Geld's panel and the comments on loan to it, and the timeline marker, which
 * `catchUpTimeline` already reads: GitHub's handler would replace both whole.
 */
const LEFT_ALONE: ReadonlySet<string> = new Set(['body_updated', 'timeline_updated']);

/** GitHub fetches each region on its own: spaced out, a page of reviews is not one burst. */
export const STAGGER_MS = 100;

export interface LiveRegionMessage {
  readonly region: Element;
  readonly detail: { readonly name: string; readonly data: { readonly event_updates: Readonly<Record<string, true>>; readonly wait: number } };
}

export function liveCatchUpDue(awayMs: number): boolean {
  return awayMs >= QUIET_AFTER_MS;
}

/**
 * The message for each live region to refresh: every region but those left alone and the batched checks rollup
 * (`expireHeadChecks` reads the checks). A region naming its event refreshes only when the message lists it, so
 * every message lists every region's.
 */
export function liveRegionMessages(root: ParentNode): readonly LiveRegionMessage[] {
  const regions = [...root.querySelectorAll(LIVE_REGION)].filter((region) => !LEFT_ALONE.has(region.getAttribute('data-channel-event-name') ?? '') && !region.hasAttribute('data-batched'));
  const eventUpdates: Record<string, true> = {};
  for (const region of regions) {
    const name = region.getAttribute('data-channel-event-name');
    if (name !== null) eventUpdates[name] = true;
  }
  return regions.map((region, index) => ({ region, detail: { name: region.getAttribute('data-channel') ?? '', data: { event_updates: eventUpdates, wait: index * STAGGER_MS } } }));
}
