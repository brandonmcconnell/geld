import type { RelatedLink } from '@geld/review/related-links';
import { requestLinkDetails, watchConnections, type LinkAnswerView, MAX_LINKS_PER_REQUEST } from '../lib/connections';

/**
 * What the reader's connected accounts say of the page's related links, asked of the background once per link per
 * visit (it keeps its own cache across visits). A link waiting for its answer is `pending`; one answered with a failure
 * is asked again after the service's `Retry-After`, or a minute.
 */
type Entry = { readonly view: LinkAnswerView | 'pending'; readonly at: number };

const entries = new Map<string, Entry>();
let page = '';
let batch: RelatedLink[] = [];
let scheduled = false;
let unwatch: (() => void) | null = null;
const listeners = new Set<() => void>();

const RETRY_MS = 60_000;

function stale(entry: Entry, now: number): boolean {
  if (entry.view === 'pending') return false;
  if (entry.view.status !== 'failed') return false;
  return now - entry.at > (entry.view.retryAfterMs ?? RETRY_MS);
}

function flush(): void {
  scheduled = false;
  const links = batch.splice(0, MAX_LINKS_PER_REQUEST);
  if (batch.length > 0) schedule();
  if (links.length === 0) return;
  const asked = page;
  void requestLinkDetails(links).then((answers) => {
    if (asked !== page) return;
    let changed = false;
    let retry: number | null = null;
    for (const link of links) {
      const view = answers.get(link.key);
      entries.set(link.key, { view: view ?? { key: link.key, status: 'none' }, at: Date.now() });
      if (view !== undefined && view.status !== 'none') changed = true;
      if (view?.status === 'failed') retry = Math.min(retry ?? Infinity, view.retryAfterMs ?? RETRY_MS);
    }
    if (changed) for (const listener of [...listeners]) listener();
    // A link waiting on a service's limit is asked again when the wait is over, which needs a pass.
    if (retry !== null) setTimeout(() => {
      if (asked === page) for (const listener of [...listeners]) listener();
    }, retry + 500);
  });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

function samePage(): void {
  const here = location.pathname;
  if (here === page) return;
  page = here;
  entries.clear();
  batch = [];
}

/**
 * The connected answer for each link, asking for those not yet asked. `onChange` is called when answers land that
 * change what the page shows.
 */
export function linkDetails(links: readonly RelatedLink[], onChange: () => void): ReadonlyMap<string, LinkAnswerView | 'pending'> {
  samePage();
  listeners.clear();
  listeners.add(onChange);
  unwatch ??= watchConnections(() => {
    entries.clear();
    for (const listener of [...listeners]) listener();
  });
  const now = Date.now();
  const out = new Map<string, LinkAnswerView | 'pending'>();
  for (const link of links) {
    const entry = entries.get(link.key);
    if (entry === undefined || stale(entry, now)) {
      entries.set(link.key, { view: 'pending', at: now });
      batch.push(link);
      schedule();
      out.set(link.key, 'pending');
      continue;
    }
    out.set(link.key, entry.view);
  }
  return out;
}

/** The answer already in hand for a link, without asking. */
export function knownLinkDetails(key: string): LinkAnswerView | null {
  const view = entries.get(key)?.view;
  return view === undefined || view === 'pending' ? null : view;
}

export function forgetLinkDetails(): void {
  entries.clear();
  batch = [];
  listeners.clear();
  unwatch?.();
  unwatch = null;
  page = '';
}
