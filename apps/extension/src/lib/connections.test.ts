import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted((): { store: Map<string, unknown>; granted: boolean } => ({ store: new Map(), granted: true }));
vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, options: { fallback: unknown }) => ({
      getValue: async () => (state.store.has(key) ? state.store.get(key) : options.fallback),
      setValue: async (value: unknown) => void state.store.set(key, value),
      watch: () => () => undefined,
    }),
  },
}));
vi.mock('wxt/browser', () => ({ browser: { permissions: { contains: async () => state.granted, request: async () => state.granted } } }));

import { relatedLinkOf } from '@geld/review/related-links';
import type { Connection } from '@geld/review/link-resolvers/index';
import { isResolveLinksRequest, resolveLinksInBackground, wireLinkOf, writeConnections } from './connections';

const link = (href: string) => {
  const found = relatedLinkOf({ href, text: href });
  if (found === null) throw new Error(href);
  return wireLinkOf(found);
};

const account = (id: string, secret: string): Connection => ({
  id,
  service: 'github',
  label: id,
  host: null,
  secret,
  email: null,
  account: id,
  covers: ['github.com'],
  use: { details: true, ai: false },
  expiresAt: null,
  refresh: null,
});

beforeEach(() => {
  state.store = new Map();
  state.granted = true;
});

describe('resolveLinksInBackground', () => {
  it('answers from the account that can open the link, remembers it for the repository and caches the answer', async () => {
    await writeConnections([account('personal', 'p'), account('work', 'w')]);
    const calls: string[] = [];
    const fetch = async (_url: string, init?: RequestInit): Promise<Response> => {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      calls.push(auth);
      return auth === 'Bearer w' ? new Response(JSON.stringify({ title: 'Ship it', state: 'open', user: { login: 'ada' } })) : new Response('{}', { status: 404 });
    };
    const request = { type: 'geld:resolve-links' as const, purpose: 'details' as const, links: [link('https://github.com/acme/web/issues/3')] };
    const first = await resolveLinksInBackground(request, fetch);
    expect(first.answers).toMatchObject([{ key: 'github:acme/web#3', status: 'ok', connection: 'work', details: { title: 'Ship it' } }]);
    expect(calls).toEqual(['Bearer p', 'Bearer w']);
    expect(state.store.get('local:connectionHints')).toEqual({ 'github/github.com/acme/web': 'work', 'github/github.com/acme': 'work' });
    await resolveLinksInBackground(request, fetch);
    expect(calls).toHaveLength(2);
    await resolveLinksInBackground({ ...request, links: [link('https://github.com/acme/api/pull/9')] }, fetch);
    expect(calls.slice(2)).toEqual(['Bearer w']);
  });

  it('asks nothing when no account may open the link, or the browser never allowed its service', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    const request = { type: 'geld:resolve-links' as const, purpose: 'details' as const, links: [link('https://github.com/acme/web/issues/3')] };
    expect((await resolveLinksInBackground(request, fetch)).answers).toEqual([{ key: 'github:acme/web#3', status: 'none' }]);
    await writeConnections([account('work', 'w')]);
    state.granted = false;
    expect((await resolveLinksInBackground(request, fetch)).answers).toEqual([{ key: 'github:acme/web#3', status: 'not-allowed' }]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads AI context only from accounts it was turned on for', async () => {
    await writeConnections([account('work', 'w')]);
    const fetch = vi.fn(async () => new Response('{}'));
    const request = { type: 'geld:resolve-links' as const, purpose: 'ai' as const, links: [link('https://github.com/acme/web/issues/3')] };
    expect((await resolveLinksInBackground(request, fetch)).answers).toEqual([{ key: 'github:acme/web#3', status: 'none' }]);
  });

  it('takes only well-formed requests', () => {
    const wire = link('https://github.com/acme/web/issues/3');
    expect(isResolveLinksRequest({ type: 'geld:resolve-links', purpose: 'details', links: [wire] })).toBe(true);
    expect(isResolveLinksRequest({ type: 'geld:resolve-links', purpose: 'everything', links: [wire] })).toBe(false);
    expect(isResolveLinksRequest({ type: 'geld:resolve-links', purpose: 'details', links: [{ ...wire, href: 'http://github.com/x' }] })).toBe(false);
    expect(isResolveLinksRequest({ type: 'geld:resolve-links', purpose: 'details', links: Array.from({ length: 33 }, () => wire) })).toBe(false);
  });
});
