import { beforeEach, expect, it, vi } from 'vitest';
import type { Conflict } from './conflicts';

const state = vi.hoisted(() => {
  const conflict = (): Conflict | null => null;
  const extensions: { id: string; name: string; enabled: boolean }[] = [];
  const ids: string[] = [];
  return { conflict: conflict(), extensions, ids,
  listener: () => {},
  register: vi.fn(async (_scripts: unknown) => {}),
  unregister: vi.fn(async (_scripts: unknown) => {}),
  sync: vi.fn(async () => {}),
  inject: vi.fn(async (_id: number, _reason: unknown) => true),
  reload: vi.fn(),
}; });
vi.mock('wxt/browser', () => ({ browser: {
  runtime: { id: 'self', reload: state.reload },
  management: { getAll: async () => state.extensions,
    onEnabled: { addListener: (fn: () => void) => { state.listener = fn; } },
    onDisabled: { addListener: vi.fn() }, onInstalled: { addListener: vi.fn() }, onUninstalled: { addListener: vi.fn() } },
  scripting: { getRegisteredContentScripts: async () => state.ids.map((id) => ({ id })),
    registerContentScripts: state.register, unregisterContentScripts: state.unregister,
    insertCSS: vi.fn(async () => {}), executeScript: vi.fn(async () => {}) },
} }));
vi.mock('../lib/enterprise', () => ({ grantedHosts: async () => [], syncEnterpriseHosts: async () => {} }));
vi.mock('../lib/provider-access', () => ({ grantedProviderHosts: async () => ['gitlab.com', 'bitbucket.org'],
  isOptionalProviderScript: (id: string) => id === 'geld-bitbucket', syncOptionalProviders: state.sync }));
vi.mock('../lib/storage', () => ({ settingsItem: { getValue: async () => ({ enterpriseHosts: [] }) } }));
vi.mock('../lib/error-capture', () => ({ reportError: vi.fn() }));
vi.mock('../lib/inject', () => ({ ensureContentScript: state.inject, tabsOnHosts: async (hosts: string[]) => hosts.map((host, i) => ({ id: i, url: `https://${host}/` })) }));
vi.mock('./state', () => ({ nightlyConflictItem: {
  getValue: async () => state.conflict, setValue: async (value: Conflict | null) => { state.conflict = value; },
} }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  state.conflict = null; state.extensions = []; state.ids = [];
  vi.stubGlobal('location', { origin: 'chrome-extension://self' });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [{ matches: ['https://github.com/*'], js: ['content-scripts/github.js'] }] })));
});

it('retires already registered provider scripts before reloading when another Geld is active', async () => {
  state.extensions = [{ id: 'nfbkhldmnfgeeldfafojajnfanikbhia', name: 'Geld', enabled: true }];
  state.ids = ['geld-bitbucket'];
  (await import('./pause')).startPauseWatch();
  await vi.waitFor(() => expect(state.reload).toHaveBeenCalledOnce());
  expect(state.sync).toHaveBeenCalledOnce();
  expect(state.register).not.toHaveBeenCalled();
  expect(state.inject).not.toHaveBeenCalled();
});

it('resumes already open permitted provider tabs and registers their scripts', async () => {
  (await import('./pause')).startPauseWatch();
  await vi.waitFor(() => expect(state.inject).toHaveBeenCalledTimes(3));
  expect(state.sync).toHaveBeenCalledOnce();
  expect(state.inject.mock.calls.map(([, reason]) => reason)).toEqual([
    { reason: 'install', url: 'https://github.com/' }, { reason: 'install', url: 'https://gitlab.com/' }, { reason: 'install', url: 'https://bitbucket.org/' },
  ]);
});

it('shows the conflict notice only on already granted provider origins', async () => {
  state.extensions = [{ id: 'nfbkhldmnfgeeldfafojajnfanikbhia', name: 'Geld', enabled: true }];
  (await import('./pause')).startPauseWatch();
  await vi.waitFor(() => expect(state.register).toHaveBeenCalledOnce());
  expect(state.register).toHaveBeenCalledWith([expect.objectContaining({ id: 'geld-nightly-conflict', matches: ['https://github.com/*', 'https://gitlab.com/*', 'https://bitbucket.org/*'] })]);
  expect(state.inject).not.toHaveBeenCalled();
});
