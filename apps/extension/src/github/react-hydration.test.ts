// @vitest-environment happy-dom
import {
  ATTR_HYDRATION_WATCH,
  ATTR_REACT_HYDRATED,
  ATTR_REACT_SHELL,
  ATTR_UNHYDRATED,
  boundaryElements,
  HYDRATION_GIVE_UP_MS,
  HYDRATION_POLL_MS,
  HYDRATION_STALL_MS,
  headerReactSettled,
  hydrationSettled,
  markOpenBoundaries,
  REACT_HYDRATED_EVENT,
  reactSettled,
  readHydration,
  subtreeSettled,
  watchReactHydration,
} from './react-hydration';

const SUFFIX = 'abc123';

/** A root as React leaves it: its container mark, whose root fiber says whether the shell's render has committed. */
function rootWith(html: string, shell: { readonly isDehydrated: boolean; readonly child: boolean } | null): Element {
  document.body.innerHTML = `<react-app app-name="repo"><div data-target="react-app.reactRoot">${html}</div></react-app>`;
  const root = document.querySelector('[data-target="react-app.reactRoot"]');
  if (root === null) throw new Error('no root');
  if (shell !== null) setShell(root, shell);
  return root;
}

function setShell(root: Element, shell: { readonly isDehydrated: boolean; readonly child: boolean }): void {
  const current = { child: shell.child ? {} : null, memoizedState: { isDehydrated: shell.isDehydrated } };
  Reflect.set(root, `__reactContainer$${SUFFIX}`, { stateNode: { current } });
}

function comments(root: Node): Comment[] {
  const found: Comment[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if (node instanceof Comment) found.push(node);
  return found;
}

function claim(marker: Comment, fiber: { readonly dehydrated: boolean; readonly alternate?: { readonly dehydrated: boolean } }): void {
  const state = (dehydrated: boolean): { dehydrated: object | null } => ({ dehydrated: dehydrated ? marker : null });
  Reflect.set(marker, `__reactFiber$${SUFFIX}`, {
    memoizedState: state(fiber.dehydrated),
    alternate: fiber.alternate === undefined ? null : { memoizedState: state(fiber.alternate.dehydrated) },
  });
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`no #${id}`);
  return found;
}

describe('readHydration', () => {
  it('has not started before React takes the root', () => {
    expect(readHydration(rootWith('<div>server</div>', null))).toEqual({ started: false, shellCommitted: false, openBoundaries: [] });
  });

  it('waits for the shell, then for each boundary to be claimed and its content hydrated', () => {
    const root = rootWith('<header></header><!--$--><main>timeline</main><!--/$--><!--$--><aside></aside><!--/$-->', { isDehydrated: true, child: false });
    const [first, , second] = comments(root);
    if (first === undefined || second === undefined) throw new Error('markers');
    expect(readHydration(root)).toEqual({ started: true, shellCommitted: false, openBoundaries: [first, second] });

    setShell(root, { isDehydrated: false, child: true });
    claim(first, { dehydrated: true });
    expect(readHydration(root).openBoundaries).toEqual([first, second]);
    // React at work on it: one copy hydrated, the other still holding the server markup.
    claim(first, { dehydrated: false, alternate: { dehydrated: true } });
    expect(readHydration(root).openBoundaries).toEqual([first, second]);
    claim(first, { dehydrated: false, alternate: { dehydrated: false } });
    expect(readHydration(root).openBoundaries).toEqual([second]);
    claim(second, { dehydrated: false });
    expect(readHydration(root)).toEqual({ started: true, shellCommitted: true, openBoundaries: [] });
  });

  it('counts pending, queued and client-rendered boundaries, and ignores every other comment', () => {
    const root = rootWith('<!--$?--><i></i><!--/$--><!--$~--><!--/$--><!--$!--><!--/$--><!-- a comment --><!--geld:quick-view:7-->', { isDehydrated: false, child: true });
    expect(readHydration(root).openBoundaries.map((marker) => marker.data)).toEqual(['$?', '$~', '$!']);
  });

  it('takes a client-rendered root as committed once it has rendered something', () => {
    expect(readHydration(rootWith('', { isDehydrated: false, child: false })).shellCommitted).toBe(false);
    expect(readHydration(rootWith('<div></div>', { isDehydrated: false, child: true })).shellCommitted).toBe(true);
  });
});

describe('boundaryElements', () => {
  it('takes the elements up to the boundary’s own end, across nested boundaries', () => {
    const root = rootWith('<p id="before"></p><!--$--><b id="a"></b>text<!--$--><i id="b"></i><!--/$--><u id="c"></u><!--/$--><p id="after"></p>', null);
    const [start] = comments(root);
    if (start === undefined) throw new Error('marker');
    expect(boundaryElements(start).map((each) => each.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('markOpenBoundaries', () => {
  it('marks what is still to hydrate and frees what React has hydrated since', () => {
    const root = rootWith('<!--$--><div id="one"></div><!--/$--><!--$--><div id="two"></div><!--/$-->', null);
    const [first, , second] = comments(root);
    if (first === undefined || second === undefined) throw new Error('markers');
    const both = markOpenBoundaries([first, second], new Set());
    expect(both.freed).toBe(false);
    expect(element('one').hasAttribute(ATTR_UNHYDRATED)).toBe(true);
    expect(element('two').hasAttribute(ATTR_UNHYDRATED)).toBe(true);
    const one = markOpenBoundaries([second], both.marked);
    expect(one.freed).toBe(true);
    expect(element('one').hasAttribute(ATTR_UNHYDRATED)).toBe(false);
    expect(element('two').hasAttribute(ATTR_UNHYDRATED)).toBe(true);
    expect(markOpenBoundaries([second], one.marked).freed).toBe(false);
  });
});

describe('hydrationSettled', () => {
  const done = { started: true, shellCommitted: true, openBoundaries: [] };

  it('settles once the shell committed with no boundary open', () => {
    expect(hydrationSettled(done, 0, 0)).toBe(true);
    expect(hydrationSettled({ ...done, openBoundaries: [document.createComment('$')] }, 0, 0)).toBe(false);
    expect(hydrationSettled({ ...done, shellCommitted: false }, 0, 0)).toBe(false);
    expect(hydrationSettled({ started: false, shellCommitted: false, openBoundaries: [] }, 0, 0)).toBe(false);
  });

  it('waits while React makes progress, and gives up on a stall or after the longer time, so Geld’s controls still come', () => {
    const open = { ...done, openBoundaries: [document.createComment('$')] };
    expect(hydrationSettled(open, HYDRATION_GIVE_UP_MS - 1, HYDRATION_STALL_MS - 1)).toBe(false);
    expect(hydrationSettled(open, HYDRATION_STALL_MS, HYDRATION_STALL_MS)).toBe(true);
    expect(hydrationSettled(open, HYDRATION_GIVE_UP_MS, 0)).toBe(true);
  });
});

describe('watchReactHydration', () => {
  let hidden = true;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute(ATTR_HYDRATION_WATCH);
    Reflect.deleteProperty(document, 'hidden');
  });

  it('reads nothing while the tab is hidden, then marks the shell, the boundary still open, and the app once it is hydrated', () => {
    const root = rootWith('<header id="head"></header><!--$--><main id="main"></main><!--/$-->', { isDehydrated: false, child: true });
    const [marker] = comments(root);
    if (marker === undefined) throw new Error('marker');
    claim(marker, { dehydrated: true });
    const app = document.querySelector('react-app');
    const freed = vi.fn();
    document.addEventListener(REACT_HYDRATED_EVENT, freed);
    hidden = true;
    watchReactHydration();
    vi.advanceTimersByTime(HYDRATION_STALL_MS * 2);
    expect(app?.hasAttribute(ATTR_REACT_SHELL)).toBe(false);
    expect(app?.hasAttribute(ATTR_REACT_HYDRATED)).toBe(false);

    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(0);
    expect(app?.hasAttribute(ATTR_REACT_SHELL)).toBe(true);
    expect(element('main').hasAttribute(ATTR_UNHYDRATED)).toBe(true);
    expect(element('head').hasAttribute(ATTR_UNHYDRATED)).toBe(false);
    expect(freed).toHaveBeenCalledTimes(1);

    claim(marker, { dehydrated: false });
    vi.advanceTimersByTime(HYDRATION_POLL_MS);
    expect(app?.hasAttribute(ATTR_REACT_HYDRATED)).toBe(true);
    expect(element('main').hasAttribute(ATTR_UNHYDRATED)).toBe(false);
    expect(freed).toHaveBeenCalledTimes(2);
    document.removeEventListener(REACT_HYDRATED_EVENT, freed);
  });
});

describe('reactSettled', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(ATTR_HYDRATION_WATCH);
  });

  const page = `<react-app><div data-component="PageHeader"><span id="label"></span><div id="counts"><span id="count"></span></div></div>
    <rails-partial><div id="body"></div></rails-partial><section id="column"></section></react-app><div id="outside"></div>`;

  it('waits only while a watcher runs, for the shell and then for the boundary a node stands in', () => {
    document.body.innerHTML = page;
    expect(reactSettled(element('label'))).toBe(true);
    document.documentElement.setAttribute(ATTR_HYDRATION_WATCH, '');
    expect(reactSettled(element('label'))).toBe(false);
    expect(reactSettled(element('body'))).toBe(true);
    expect(reactSettled(element('outside'))).toBe(true);
    const app = document.querySelector('react-app');
    app?.setAttribute(ATTR_REACT_SHELL, '');
    element('counts').setAttribute(ATTR_UNHYDRATED, '');
    expect(reactSettled(element('label'))).toBe(true);
    expect(reactSettled(element('count'))).toBe(false);
    expect(reactSettled(element('counts'))).toBe(false);
    element('counts').removeAttribute(ATTR_UNHYDRATED);
    expect(reactSettled(element('count'))).toBe(true);
    app?.removeAttribute(ATTR_REACT_SHELL);
    app?.setAttribute(ATTR_REACT_HYDRATED, '');
    expect(reactSettled(element('count'))).toBe(true);
  });

  it('asks nothing inside a node to wait either, for what Geld writes into', () => {
    document.body.innerHTML = page;
    document.documentElement.setAttribute(ATTR_HYDRATION_WATCH, '');
    document.querySelector('react-app')?.setAttribute(ATTR_REACT_SHELL, '');
    element('count').setAttribute(ATTR_UNHYDRATED, '');
    const header = document.querySelector('[data-component="PageHeader"]');
    expect(header === null ? null : reactSettled(header)).toBe(true);
    expect(header === null ? null : subtreeSettled(header)).toBe(false);
    expect(headerReactSettled()).toBe(false);
    element('count').removeAttribute(ATTR_UNHYDRATED);
    expect(headerReactSettled()).toBe(true);
  });

  it('reads the app when the header has not arrived, and lets a loaded page with neither through', () => {
    document.documentElement.setAttribute(ATTR_HYDRATION_WATCH, '');
    document.body.innerHTML = '<react-app></react-app>';
    expect(headerReactSettled()).toBe(false);
    document.querySelector('react-app')?.setAttribute(ATTR_REACT_HYDRATED, '');
    expect(headerReactSettled()).toBe(true);
    document.body.innerHTML = '<div class="gh-header"></div>';
    expect(document.readyState).not.toBe('loading');
    expect(headerReactSettled()).toBe(true);
  });
});
