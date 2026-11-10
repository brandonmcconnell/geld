export const BITBUCKET_COLOR_MODE_ATTRIBUTE = 'data-geld-bitbucket-colorblind';
const TAKEOVER = 'geld:bitbucket-color-mode-takeover';
const ACTION = 'diffSettings/UPDATE_GLOBAL_IS_COLOR_BLIND_MODE_ENABLED_SUCCESS';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function field(value: unknown, key: string): unknown { return object(value) ? value[key] : undefined; }

interface ColorModeBinding {
  current(): boolean;
  read(): boolean | null;
  subscribe(callback: () => void): (() => void) | null;
}

function bind(host: Window): ColorModeBinding | null {
  const loader: unknown = Reflect.get(host, 'parcelRequirecbf3');
  if (typeof loader !== 'function') return null;
  try {
    const module: unknown = loader.call(host, 'jSBTO'), settings: unknown = loader.call(host, 'fozrM');
    const store = field(module, 'bitbucketStore'), get = field(store, 'getState'), subscribe = field(store, 'subscribe');
    const select = field(settings, 'getGlobalIsColorBlindModeEnabled');
    if (!object(store) || typeof get !== 'function' || typeof subscribe !== 'function' || typeof select !== 'function'
      || field(settings, 'UPDATE_GLOBAL_IS_COLOR_BLIND_MODE_ENABLED_SUCCESS') !== ACTION) return null;
    return {
      current: () => {
        try { return Reflect.get(host, 'parcelRequirecbf3') === loader && field(loader.call(host, 'jSBTO'), 'bitbucketStore') === store && loader.call(host, 'fozrM') === settings; }
        catch { return false; }
      },
      read: () => {
        try {
          const state: unknown = get.call(store), value: unknown = select.call(settings, state);
          return typeof value === 'boolean' && field(field(state, 'diffSettings'), 'globalIsColorBlindModeEnabled') === value ? value : null;
        } catch { return null; }
      },
      subscribe: callback => { const off: unknown = subscribe.call(store, callback);return typeof off === 'function' ? () => { off(); } : null; },
    };
  } catch { return null; }
}

/** Native colorblind mode chooses different accent tokens rather than changing the green and red tokens. */
export function startBitbucketNativeColorMode(doc: Document, host: Window): () => void {
  if (host.top !== host || new URL(doc.URL).origin !== 'https://bitbucket.org') return () => undefined;
  doc.dispatchEvent(new Event(TAKEOVER));
  let binding: ColorModeBinding | null = null, unsubscribe: (() => void) | null = null, stopped = false;
  let owned: { element: HTMLElement; previous: string | null; value: string } | null = null;
  const restore = (): void => {
    if (owned !== null && owned.element.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE) === owned.value) {
      if (owned.previous === null) owned.element.removeAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE);
      else owned.element.setAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE, owned.previous);
    }
    owned = null;
  };
  const paint = (value: boolean | null): void => {
    const root = doc.documentElement;
    if (value === null || root === null) { restore();return; }
    const text = String(value);
    if (owned?.element !== root) { restore();owned = { element: root, previous: root.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE), value: text }; }
    if (root.getAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE) !== text) root.setAttribute(BITBUCKET_COLOR_MODE_ATTRIBUTE, text);
    owned.value = text;
  };
  const tick = (): void => {
    if (stopped) return;
    if (binding !== null && !binding.current()) { unsubscribe?.();unsubscribe = null;binding = null;restore(); }
    if (binding === null) {
      binding = bind(host);
      try { unsubscribe = binding?.subscribe(tick) ?? null; }
      catch { binding = null; }
    }
    paint(binding?.read() ?? null);
  };
  const timer = host.setInterval(tick, 500);
  const stop = (): void => {
    if (stopped) return;
    stopped = true;host.clearInterval(timer);unsubscribe?.();restore();doc.removeEventListener(TAKEOVER, stop);
  };
  doc.addEventListener(TAKEOVER, stop, { once: true });
  tick();
  return stop;
}
