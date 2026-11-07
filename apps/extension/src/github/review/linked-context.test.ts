import { describe, expect, it, vi } from 'vitest';

const asked = vi.hoisted((): { purposes: string[] } => ({ purposes: [] }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage: async () => undefined, getURL: (path: string) => path } } }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined, watch: () => () => undefined }) } }));
vi.mock('../related-links', () => ({
  relatedLinksOnPage: () => [
    { key: 'slack:acme:C1:1.2', kind: 'conversation', service: 'Slack', noun: 'thread', ref: null, title: null, context: 'acme', href: 'https://acme.slack.com/archives/C1/p1', action: 'Open thread in Slack', appId: null, icon: null },
    { key: 'linear:acme:ENG-1', kind: 'ticket', service: 'Linear', noun: 'issue', ref: 'ENG-1', title: null, context: 'acme', href: 'https://linear.app/acme/issue/ENG-1', action: 'Open issue in Linear', appId: null, icon: null },
  ],
}));
vi.mock('../../lib/connections', () => ({
  requestLinkDetails: async (_links: unknown, purpose: string) => {
    asked.purposes.push(purpose);
    const details = { title: 'Login loops', state: null, tone: null, author: null, updatedAt: null, where: '#eng', body: null, messages: [{ author: 'ada', at: null, text: 'x'.repeat(5000) }] };
    return new Map([['slack:acme:C1:1.2', { key: 'slack:acme:C1:1.2', status: 'ok', service: 'slack', connection: 'Acme', details }], ['linear:acme:ENG-1', { key: 'linear:acme:ENG-1', status: 'none' }]]);
  },
}));

import { DEFAULT_SETTINGS } from '@geld/core';
import { LINKED_CONTEXT_ITEM_CAP, linkedContext } from './ai';

describe('linkedContext', () => {
  it('asks nothing while Connected services is off', async () => {
    asked.purposes = [];
    expect(await linkedContext(DEFAULT_SETTINGS)).toEqual({ items: [], from: [] });
    expect(asked.purposes).toEqual([]);
  });

  it('asks for AI context only, caps each item and names the accounts that gave it', async () => {
    asked.purposes = [];
    const { items, from } = await linkedContext({ ...DEFAULT_SETTINGS, connectedServices: true });
    expect(asked.purposes).toEqual(['ai']);
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('Slack');
    expect(items[0]?.text.length).toBe(LINKED_CONTEXT_ITEM_CAP);
    expect(from).toEqual(['Slack · Acme']);
  });
});
