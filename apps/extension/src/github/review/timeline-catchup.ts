import { fragmentHeaders } from './deeplink';

/**
 * The classic conversation's live marker: GitHub's socket handler replaces it
 * from its `data-url` (`partials/unread_timeline?since=…`) on every
 * `timeline_updated` message, and the answer is the timeline items since that
 * moment followed by a fresh marker with a later `since`. A tab that missed
 * those messages (hidden while bots finished, the socket gone quiet) or a
 * comment Geld posted itself is brought up to date the same way, without a
 * reload. The React conversation has no such marker and is left to GitHub.
 */
const MARKER = '#partial-timeline.js-timeline-marker';

/** The catch-up out now, for one marker and its URL: a pull request moved to in place has a marker of its own. */
let inFlight: { readonly marker: HTMLElement; readonly src: string; readonly promise: Promise<boolean>; readonly token: object } | null = null;

/** Read the timeline since GitHub's marker and put it in place; true when the timeline is now at least as new as that read. */
export function catchUpTimeline(): Promise<boolean> {
  const marker = document.querySelector<HTMLElement>(MARKER);
  const src = marker?.getAttribute('data-url') ?? null;
  if (marker === null || src === null || src === '') return Promise.resolve(false);
  if (inFlight !== null && inFlight.marker === marker && inFlight.src === src) return inFlight.promise;
  const token = {};
  const promise = (async (): Promise<boolean> => {
    try {
      const response = await fetch(new URL(src, location.href), { headers: fragmentHeaders(), credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return false;
      const html = await response.text();
      // GitHub's own refresh replaced the marker meanwhile: its answer is at least as new as this one, so nothing is lost.
      const current = document.querySelector<HTMLElement>(MARKER);
      if (current !== null && current !== marker && current.getAttribute('data-url') !== src) return true;
      if (!marker.isConnected || marker.getAttribute('data-url') !== src) return false;
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      // Without a marker in the answer the timeline would have nothing to refresh from again: keep the old one.
      if (parsed.querySelector(MARKER) === null) return false;
      marker.replaceWith(...[...parsed.body.childNodes].map((node) => document.adoptNode(node)));
      return true;
    } catch {
      return false;
    } finally {
      if (inFlight?.token === token) inFlight = null;
    }
  })();
  inFlight = { marker, src, promise, token };
  return promise;
}
