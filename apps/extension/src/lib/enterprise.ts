import { browser } from 'wxt/browser';

/**
 * Runtime registration of Geld's content script on GitHub Enterprise Server
 * hosts. github.com is declared statically in the manifest; extra hosts are
 * granted by the user (optional host permissions) and registered here.
 */

export const GHES_SCRIPT_ID = 'geld-enterprise';
const CONTENT_JS = 'content-scripts/github.js';
const CONTENT_CSS = 'content-scripts/github.css';

export function originPattern(host: string): string {
  return `https://${host}/*`;
}

/** Which of the given hosts the user has actually granted access to. */
export async function grantedHosts(hosts: readonly string[]): Promise<string[]> {
  const granted: string[] = [];
  for (const host of hosts) {
    try {
      if (await browser.permissions.contains({ origins: [originPattern(host)] })) granted.push(host);
    } catch {
      // Treat permission API failures as "not granted".
    }
  }
  return granted;
}

/** Firefox MV2 exposes `browser.contentScripts` (not in the shared typings). */
interface FirefoxRegisteredScript {
  unregister(): Promise<void> | void;
}

interface FirefoxContentScripts {
  register(options: {
    matches: string[];
    js: Array<{ file: string }>;
    css: Array<{ file: string }>;
    runAt: 'document_start';
  }): Promise<FirefoxRegisteredScript>;
}

function firefoxContentScripts(): FirefoxContentScripts | null {
  const candidate: unknown = Reflect.get(browser, 'contentScripts');
  if (typeof candidate !== 'object' || candidate === null) return null;
  const register: unknown = Reflect.get(candidate, 'register');
  if (typeof register !== 'function') return null;
  return {
    register: (options) => {
      const result: unknown = register.call(candidate, options);
      if (!(result instanceof Promise)) return Promise.reject(new Error('contentScripts.register did not return a promise'));
      return result.then((handle: unknown) => {
        if (typeof handle !== 'object' || handle === null) throw new Error('Unexpected registration handle');
        const unregister: unknown = Reflect.get(handle, 'unregister');
        return {
          unregister: () => {
            if (typeof unregister === 'function') {
              const value: unknown = unregister.call(handle);
              return value instanceof Promise ? value.then(() => undefined) : undefined;
            }
            return undefined;
          },
        };
      });
    },
  };
}

let firefoxHandle: FirefoxRegisteredScript | null = null;

/**
 * Make the content script run on exactly the granted Enterprise hosts.
 * Idempotent: call it on startup and whenever the host list changes.
 */
export async function syncEnterpriseHosts(hosts: readonly string[]): Promise<void> {
  const matches = (await grantedHosts(hosts)).map(originPattern);

  if (import.meta.env.MANIFEST_VERSION === 3) {
    try {
      await browser.scripting.unregisterContentScripts({ ids: [GHES_SCRIPT_ID] });
    } catch {
      // Nothing registered yet.
    }
    if (matches.length === 0) return;
    await browser.scripting.registerContentScripts([
      {
        id: GHES_SCRIPT_ID,
        matches,
        js: [CONTENT_JS],
        css: [CONTENT_CSS],
        runAt: 'document_start',
        persistAcrossSessions: true,
      },
    ]);
    return;
  }

  // MV2 (Firefox): registrations do not persist, so redo them each startup.
  const api = firefoxContentScripts();
  if (api === null) return;
  if (firefoxHandle !== null) {
    await firefoxHandle.unregister();
    firefoxHandle = null;
  }
  if (matches.length === 0) return;
  firefoxHandle = await api.register({
    matches,
    js: [{ file: CONTENT_JS }],
    css: [{ file: CONTENT_CSS }],
    runAt: 'document_start',
  });
}
