/**
 * Whether GitHub's server-rendered React has hydrated a part of the page, so Geld may put nodes of its own among React's.
 *
 * React hydrates a server-rendered page by walking the DOM it was sent and claiming each node in order. A node
 * Geld inserted before that (the status pill beside GitHub's label, the review group in the tab bar) is a node React
 * did not render, so hydration fails and React throws the whole boundary's markup away and renders it again on the
 * client. On a pull request that boundary is the page's content container: the digest, the timeline Geld had folded
 * and every thread it had fetched went with it, and the digest started over a second or two into the load.
 *
 * React's state lives in the page's JavaScript world, so the watcher runs there (`entrypoints/portal.content.ts`) and
 * marks what it learns on the DOM, which the content script reads: the app's shell once its own render committed, each
 * element of a Suspense boundary still to hydrate, the app whole once nothing is. HTML React set itself
 * (`dangerouslySetInnerHTML`: the conversation's `<rails-partial>`s, rendered Markdown) is never compared on hydration,
 * so what stands inside it may be dressed at any time.
 */

/** Set on a `<react-app>` by the page-world watcher once React has hydrated it (or rendered it, with no markup to hydrate). */
export const ATTR_REACT_HYDRATED = 'data-geld-hydrated';
/** On a `<react-app>` once its root's own render, everything outside its Suspense boundaries, has committed. */
export const ATTR_REACT_SHELL = 'data-geld-shell';
/** On each element of a Suspense boundary React has yet to hydrate, while the app is not hydrated whole. */
export const ATTR_UNHYDRATED = 'data-geld-unhydrated';
/** Dispatched on the document whenever the watcher lets a part of the page through. */
export const REACT_HYDRATED_EVENT = 'geld:react-hydrated';
/**
 * On `<html>` while a watcher runs. Separate from the portal's own one-copy mark: a page that kept an older portal
 * across an extension update has no watcher, and then nothing waits for a mark that would never come.
 */
export const ATTR_HYDRATION_WATCH = 'data-geld-hydration-watch';

const REACT_APP = 'react-app';
const REACT_ROOT = '[data-target="react-app.reactRoot"]';
/** React's comments opening a Suspense or Activity boundary: completed, pending, queued, client-rendered fallback, activity. */
const BOUNDARY_STARTS: ReadonlySet<string> = new Set(['$', '$?', '$~', '$!', '&']);
const BOUNDARY_ENDS: ReadonlySet<string> = new Set(['/$', '/&']);
const CONTAINER_KEY = '__reactContainer$';
const FIBER_KEY = '__reactFiber$';

export const HYDRATION_POLL_MS = 50;
/**
 * An app whose hydration has not moved for this long in view, or has not finished in the longer time, is marked anyway,
 * so Geld's controls never wait for good. React still making progress on a heavy page is waited for.
 */
export const HYDRATION_STALL_MS = 10_000;
export const HYDRATION_GIVE_UP_MS = 30_000;

export interface HydrationReading {
  /** React has taken the root: `hydrateRoot` (or `createRoot`) has run on it. */
  readonly started: boolean;
  /** The root's own render, the page's shell outside every boundary, has committed. */
  readonly shellCommitted: boolean;
  /** The markers opening boundaries React has not claimed yet, or has claimed but whose content it has yet to hydrate. */
  readonly openBoundaries: readonly Comment[];
}

const NOT_STARTED: HydrationReading = { started: false, shellCommitted: false, openBoundaries: [] };

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}

/** A root fiber keeps `isDehydrated` until its first render commits; `createRoot`'s never had markup, only no child yet. */
function shellCommitted(hostRoot: unknown): boolean {
  const current = field(field(hostRoot, 'stateNode'), 'current');
  return field(current, 'child') != null && field(field(current, 'memoizedState'), 'isDehydrated') !== true;
}

/**
 * A boundary's marker has no fiber until React claims it, and once claimed the fiber (and its alternate, while React
 * works on it) keeps the server markup as `dehydrated` until the boundary's content is hydrated. That can last seconds
 * with nothing in the markup changing (React waiting on a code chunk on a busy page), so only React's own state tells it.
 */
function boundaryOpen(marker: unknown): boolean {
  if (marker === undefined) return true;
  const dehydrated = (fiber: unknown): boolean => field(field(fiber, 'memoizedState'), 'dehydrated') != null;
  return dehydrated(marker) || dehydrated(field(marker, 'alternate'));
}

/** Reads, in the page's world, how far React has got with `root` (a `react-app`'s root element). */
export function readHydration(root: Element): HydrationReading {
  const container = Object.keys(root).find((key) => key.startsWith(CONTAINER_KEY));
  if (container === undefined) return NOT_STARTED;
  const fiber = `${FIBER_KEY}${container.slice(CONTAINER_KEY.length)}`;
  const openBoundaries: Comment[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Comment && BOUNDARY_STARTS.has(node.data) && boundaryOpen(Reflect.get(node, fiber))) openBoundaries.push(node);
  }
  return { started: true, shellCommitted: shellCommitted(Reflect.get(root, container)), openBoundaries };
}

/** The elements standing in the boundary `start` opens, up to its own end marker (boundaries nest). */
export function boundaryElements(start: Comment): Element[] {
  const elements: Element[] = [];
  let depth = 0;
  for (let node = start.nextSibling; node !== null; node = node.nextSibling) {
    if (node instanceof Element) elements.push(node);
    else if (node instanceof Comment && BOUNDARY_STARTS.has(node.data)) depth += 1;
    else if (node instanceof Comment && BOUNDARY_ENDS.has(node.data)) {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  return elements;
}

/**
 * Marks the elements of the boundaries still open and unmarks those of boundaries React has hydrated since `marked`
 * was made. An attribute React did not render is no hydration mismatch in its production build. Returns what is
 * marked now and whether a mark came off.
 */
export function markOpenBoundaries(open: readonly Comment[], marked: ReadonlySet<Element>): { readonly marked: Set<Element>; readonly freed: boolean } {
  const next = new Set(open.flatMap(boundaryElements));
  let freed = false;
  for (const element of marked) {
    if (next.has(element)) continue;
    element.removeAttribute(ATTR_UNHYDRATED);
    freed = true;
  }
  for (const element of next) if (!element.hasAttribute(ATTR_UNHYDRATED)) element.setAttribute(ATTR_UNHYDRATED, '');
  return { marked: next, freed };
}

/**
 * Hydrated: the shell committed and no boundary open, or given up on, `waitedMs` in view since the app was first seen
 * and `stalledMs` since its reading last changed.
 */
export function hydrationSettled(reading: HydrationReading, waitedMs: number, stalledMs: number): boolean {
  if (waitedMs >= HYDRATION_GIVE_UP_MS || stalledMs >= HYDRATION_STALL_MS) return true;
  return reading.started && reading.shellCommitted && reading.openBoundaries.length === 0;
}

interface AppTrack {
  /** When the app was first seen and when its reading last changed, both moved on by however long the tab was hidden. */
  firstSeen: number;
  changedAt: number;
  signature: string;
  marked: Set<Element>;
}

/**
 * Page world: reads each `<react-app>` while it is hydrating and marks what React has done, again on every
 * navigation. Paused while the tab is hidden: nobody sees the page, and the content script makes no pass then either.
 */
export function watchReactHydration(): void {
  const html = document.documentElement;
  if (html.hasAttribute(ATTR_HYDRATION_WATCH)) return;
  html.setAttribute(ATTR_HYDRATION_WATCH, '');
  const tracks = new Map<Element, AppTrack>();
  let timer: number | null = null;
  let hiddenSince: number | null = null;
  const check = (): void => {
    timer = null;
    if (document.hidden) {
      hiddenSince ??= performance.now();
      return;
    }
    let waiting = false;
    let freed = false;
    const now = performance.now();
    for (const app of tracks.keys()) if (!app.isConnected) tracks.delete(app);
    for (const app of document.querySelectorAll(`${REACT_APP}:not([${ATTR_REACT_HYDRATED}])`)) {
      const track = tracks.get(app) ?? { firstSeen: now, changedAt: now, signature: '', marked: new Set<Element>() };
      tracks.set(app, track);
      const root = app.querySelector(`:scope > ${REACT_ROOT}`) ?? app.querySelector(REACT_ROOT);
      const reading = root === null ? NOT_STARTED : readHydration(root);
      const signature = `${reading.started}:${reading.shellCommitted}:${reading.openBoundaries.length}`;
      if (signature !== track.signature) {
        track.signature = signature;
        track.changedAt = now;
      }
      if (hydrationSettled(reading, now - track.firstSeen, now - track.changedAt)) {
        for (const element of track.marked) element.removeAttribute(ATTR_UNHYDRATED);
        tracks.delete(app);
        app.setAttribute(ATTR_REACT_HYDRATED, '');
        freed = true;
        continue;
      }
      waiting = true;
      if (!reading.shellCommitted) continue;
      if (!app.hasAttribute(ATTR_REACT_SHELL)) {
        app.setAttribute(ATTR_REACT_SHELL, '');
        freed = true;
      }
      const marks = markOpenBoundaries(reading.openBoundaries, track.marked);
      track.marked = marks.marked;
      freed ||= marks.freed;
    }
    if (freed) document.dispatchEvent(new CustomEvent(REACT_HYDRATED_EVENT));
    // Until the document has loaded more apps may still arrive; after that only a navigation brings one.
    if (waiting || document.readyState !== 'complete') timer = window.setTimeout(check, HYDRATION_POLL_MS);
  };
  const soon = (): void => {
    if (timer === null) timer = window.setTimeout(check, 0);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || hiddenSince === null) return;
    const away = performance.now() - hiddenSince;
    hiddenSince = null;
    for (const track of tracks.values()) {
      track.firstSeen += away;
      track.changedAt += away;
    }
    soon();
  });
  for (const type of ['turbo:render', 'turbo:load', 'soft-nav:end']) document.addEventListener(type, soon);
  check();
}

function watching(): boolean {
  return document.documentElement.hasAttribute(ATTR_HYDRATION_WATCH);
}

/**
 * Content script: whether React has hydrated where `node` stands, so a node of Geld's may go in beside it. True outside
 * any app, inside a `<rails-partial>` (HTML React set itself), and where no watcher runs (no page-world script: Geld
 * then behaves as it did before it waited); within an app, once its shell has committed and outside every boundary
 * still to hydrate.
 */
export function reactSettled(node: Element | null): boolean {
  if (node === null || !watching()) return true;
  if (node.closest('rails-partial') !== null) return true;
  const app = node.closest(REACT_APP);
  if (app === null || app.hasAttribute(ATTR_REACT_HYDRATED)) return true;
  return app.hasAttribute(ATTR_REACT_SHELL) && node.closest(`[${ATTR_UNHYDRATED}]`) === null;
}

/** Content script: {@link reactSettled}, and nothing inside `node` waits either, for a node Geld writes into, not only beside. */
export function subtreeSettled(node: Element | null): boolean {
  if (!reactSettled(node)) return false;
  return node === null || node.closest('rails-partial') !== null || node.querySelector(`[${ATTR_UNHYDRATED}]`) === null;
}

/**
 * Content script: {@link subtreeSettled} for the pull request header, which holds the review group and the status pill.
 * Geld's first pass runs while the document still streams in, before the header or its app exists: that is not settled.
 */
export function headerReactSettled(): boolean {
  if (!watching()) return true;
  const header = document.querySelector('[data-component="PageHeader"]') ?? document.querySelector(REACT_APP);
  return header === null ? document.readyState !== 'loading' : subtreeSettled(header);
}
