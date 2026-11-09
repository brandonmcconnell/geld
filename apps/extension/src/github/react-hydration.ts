/**
 * Whether GitHub's server-rendered React has hydrated, so Geld may put nodes of its own among React's.
 *
 * React hydrates a server-rendered page by walking the DOM it was sent and claiming each node in order. A node
 * Geld inserted before that (the status pill beside GitHub's label, the review group in the tab bar) is a node React
 * did not render, so hydration fails and React throws the whole boundary's markup away and renders it again on the
 * client. On a pull request that boundary is the page's content container: the digest, the timeline Geld had folded
 * and every thread it had fetched went with it, and the digest started over a second or two into the load.
 *
 * React's state lives in the page's JavaScript world, so the watcher runs there (`entrypoints/portal.content.ts`)
 * and marks each `<react-app>` once it has hydrated; the content script reads the mark. HTML React set itself
 * (`dangerouslySetInnerHTML`: the conversation's `<rails-partial>`s, rendered Markdown) is never compared on hydration,
 * so what stands inside it may be dressed at any time.
 */

/** Set on a `<react-app>` by the page-world watcher once React has hydrated it (or rendered it, with no markup to hydrate). */
export const ATTR_REACT_HYDRATED = 'data-geld-hydrated';
/** Dispatched on the document whenever the watcher marks an app. */
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
const CONTAINER_KEY = '__reactContainer$';
const FIBER_KEY = '__reactFiber$';

export const HYDRATION_POLL_MS = 50;
/** An app still unhydrated this long after it was first seen is marked anyway, so Geld's controls never wait for good. */
export const HYDRATION_GIVE_UP_MS = 10_000;

export interface HydrationReading {
  /** React has taken the root: `hydrateRoot` (or `createRoot`) has run on it. */
  readonly started: boolean;
  /** The root's own render, the page's shell outside every boundary, has committed. */
  readonly shellCommitted: boolean;
  /** Boundaries React has not claimed yet, or has claimed but whose content it has yet to hydrate. */
  readonly openBoundaries: number;
}

const NOT_STARTED: HydrationReading = { started: false, shellCommitted: false, openBoundaries: 0 };

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
  let openBoundaries = 0;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Comment && BOUNDARY_STARTS.has(node.data) && boundaryOpen(Reflect.get(node, fiber))) openBoundaries += 1;
  }
  return { started: true, shellCommitted: shellCommitted(Reflect.get(root, container)), openBoundaries };
}

/** Hydrated: the shell committed and no boundary open, or {@link HYDRATION_GIVE_UP_MS} since the app was first seen. */
export function hydrationSettled(reading: HydrationReading, waitedMs: number): boolean {
  if (waitedMs >= HYDRATION_GIVE_UP_MS) return true;
  return reading.started && reading.shellCommitted && reading.openBoundaries === 0;
}

/** Page world: marks each `<react-app>` once it has hydrated, reading while any is waiting and again on every navigation. */
export function watchReactHydration(): void {
  const html = document.documentElement;
  if (html.hasAttribute(ATTR_HYDRATION_WATCH)) return;
  html.setAttribute(ATTR_HYDRATION_WATCH, '');
  const firstSeen = new WeakMap<Element, number>();
  let timer: number | null = null;
  const check = (): void => {
    timer = null;
    let waiting = false;
    let marked = false;
    const now = performance.now();
    for (const app of document.querySelectorAll(`${REACT_APP}:not([${ATTR_REACT_HYDRATED}])`)) {
      const seen = firstSeen.get(app) ?? now;
      firstSeen.set(app, seen);
      const root = app.querySelector(`:scope > ${REACT_ROOT}`) ?? app.querySelector(REACT_ROOT);
      if (hydrationSettled(root === null ? NOT_STARTED : readHydration(root), now - seen)) {
        app.setAttribute(ATTR_REACT_HYDRATED, '');
        marked = true;
      } else {
        waiting = true;
      }
    }
    if (marked) document.dispatchEvent(new CustomEvent(REACT_HYDRATED_EVENT));
    // Until the document has loaded more apps may still arrive; after that only a navigation brings one.
    if (waiting || document.readyState !== 'complete') timer = window.setTimeout(check, HYDRATION_POLL_MS);
  };
  const soon = (): void => {
    if (timer === null) timer = window.setTimeout(check, 0);
  };
  for (const type of ['turbo:render', 'turbo:load', 'soft-nav:end']) document.addEventListener(type, soon);
  check();
}

/**
 * Content script: whether React has hydrated the `<react-app>` holding `node`, so a node of Geld's may go in beside
 * React's. True outside any app, inside a `<rails-partial>` (HTML React set itself), and where no watcher runs (no
 * page-world script: Geld then behaves as it did before it waited).
 */
export function reactSettled(node: Element | null): boolean {
  if (node === null || !document.documentElement.hasAttribute(ATTR_HYDRATION_WATCH)) return true;
  if (node.closest('rails-partial') !== null) return true;
  const app = node.closest(REACT_APP);
  return app === null || app.hasAttribute(ATTR_REACT_HYDRATED);
}

/**
 * Content script: {@link reactSettled} for the pull request header, which holds the review group and the status pill.
 * Geld's first pass runs while the document still streams in, before the header or its app exists: that is not settled.
 */
export function headerReactSettled(): boolean {
  if (!document.documentElement.hasAttribute(ATTR_HYDRATION_WATCH)) return true;
  const header = document.querySelector('[data-component="PageHeader"]') ?? document.querySelector(REACT_APP);
  return header === null ? document.readyState !== 'loading' : reactSettled(header);
}
