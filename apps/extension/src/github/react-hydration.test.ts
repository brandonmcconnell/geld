// @vitest-environment happy-dom
import { ATTR_HYDRATION_WATCH, ATTR_REACT_HYDRATED, HYDRATION_GIVE_UP_MS, headerReactSettled, hydrationSettled, reactSettled, readHydration } from './react-hydration';

const SUFFIX = 'abc123';

/** A root as React leaves it: its container mark, whose root fiber says whether the shell's render has committed. */
function rootWith(html: string, shell: { readonly isDehydrated: boolean; readonly child: boolean } | null): Element {
  document.body.innerHTML = `<react-app app-name="repo"><div data-target="react-app.reactRoot">${html}</div></react-app>`;
  const root = document.querySelector('[data-target="react-app.reactRoot"]');
  if (root === null) throw new Error('no root');
  if (shell !== null) {
    const current = { child: shell.child ? {} : null, memoizedState: { isDehydrated: shell.isDehydrated } };
    Reflect.set(root, `__reactContainer$${SUFFIX}`, { stateNode: { current } });
  }
  return root;
}

function markers(root: Element): Comment[] {
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

describe('readHydration', () => {
  it('has not started before React takes the root', () => {
    expect(readHydration(rootWith('<div>server</div>', null))).toEqual({ started: false, shellCommitted: false, openBoundaries: 0 });
  });

  it('waits for the shell, then for each boundary to be claimed and its content hydrated', () => {
    const root = rootWith('<header></header><!--$--><main>timeline</main><!--/$--><!--$--><aside></aside><!--/$-->', { isDehydrated: true, child: false });
    expect(readHydration(root)).toEqual({ started: true, shellCommitted: false, openBoundaries: 2 });

    Reflect.set(root, `__reactContainer$${SUFFIX}`, { stateNode: { current: { child: {}, memoizedState: { isDehydrated: false } } } });
    const [first, , second] = markers(root);
    if (first === undefined || second === undefined) throw new Error('markers');
    claim(first, { dehydrated: true });
    expect(readHydration(root).openBoundaries).toBe(2);
    // React at work on it: one copy hydrated, the other still holding the server markup.
    claim(first, { dehydrated: false, alternate: { dehydrated: true } });
    expect(readHydration(root).openBoundaries).toBe(2);
    claim(first, { dehydrated: false, alternate: { dehydrated: false } });
    expect(readHydration(root).openBoundaries).toBe(1);
    claim(second, { dehydrated: false });
    expect(readHydration(root)).toEqual({ started: true, shellCommitted: true, openBoundaries: 0 });
  });

  it('counts pending, queued and client-rendered boundaries, and ignores every other comment', () => {
    const root = rootWith('<!--$?--><i></i><!--/$--><!--$~--><!--/$--><!--$!--><!--/$--><!-- a comment --><!--geld:quick-view:7-->', { isDehydrated: false, child: true });
    expect(readHydration(root).openBoundaries).toBe(3);
  });

  it('takes a client-rendered root as committed once it has rendered something', () => {
    expect(readHydration(rootWith('', { isDehydrated: false, child: false })).shellCommitted).toBe(false);
    expect(readHydration(rootWith('<div></div>', { isDehydrated: false, child: true })).shellCommitted).toBe(true);
  });
});

describe('hydrationSettled', () => {
  const done = { started: true, shellCommitted: true, openBoundaries: 0 };

  it('settles once the shell committed with no boundary open', () => {
    expect(hydrationSettled(done, 0)).toBe(true);
    expect(hydrationSettled({ ...done, openBoundaries: 1 }, 0)).toBe(false);
    expect(hydrationSettled({ ...done, shellCommitted: false }, 0)).toBe(false);
    expect(hydrationSettled({ started: false, shellCommitted: false, openBoundaries: 0 }, 0)).toBe(false);
  });

  it('gives up waiting, so Geld’s controls still come', () => {
    expect(hydrationSettled({ ...done, openBoundaries: 1 }, HYDRATION_GIVE_UP_MS - 1)).toBe(false);
    expect(hydrationSettled({ ...done, openBoundaries: 1 }, HYDRATION_GIVE_UP_MS)).toBe(true);
  });
});

describe('reactSettled', () => {
  afterEach(() => {
    document.documentElement.removeAttribute(ATTR_HYDRATION_WATCH);
  });

  it('waits for the app’s mark only while a watcher runs', () => {
    document.body.innerHTML = '<react-app><div data-component="PageHeader"><span id="label"></span></div><rails-partial><div id="body"></div></rails-partial></react-app><div id="outside"></div>';
    const label = document.getElementById('label');
    expect(reactSettled(label)).toBe(true);
    document.documentElement.setAttribute(ATTR_HYDRATION_WATCH, '');
    expect(reactSettled(label)).toBe(false);
    expect(headerReactSettled()).toBe(false);
    expect(reactSettled(document.getElementById('body'))).toBe(true);
    expect(reactSettled(document.getElementById('outside'))).toBe(true);
    document.querySelector('react-app')?.setAttribute(ATTR_REACT_HYDRATED, '');
    expect(reactSettled(label)).toBe(true);
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
