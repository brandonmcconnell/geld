import { describe, expect, it, vi } from 'vitest';
import type { StoredChat } from './local-state';

const stored = new Map<string, unknown>();

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: <T>(key: string, options: { fallback: T }) => ({
      getValue: async (): Promise<unknown> => {
        // A slow read, so two saves started together would both read the same map if nothing held the second back.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return stored.has(key) ? stored.get(key) : options.fallback;
      },
      setValue: async (value: T): Promise<void> => {
        stored.set(key, value);
      },
    }),
  },
}));
vi.mock('wxt/browser', () => ({ browser: { runtime: {}, permissions: { contains: async () => true } } }));
vi.mock('./storage', () => ({ settingsItem: { getValue: async () => ({}) } }));

const { saveAssistantChat } = await import('./chat-service');

describe('saveAssistantChat', () => {
  it('keeps both chats when two tabs save at once', async () => {
    await Promise.all([
      saveAssistantChat({ type: 'geld:chat-save', key: 'github:/o/r/pull/1', turns: [{ role: 'user', text: 'one' }] }),
      saveAssistantChat({ type: 'geld:chat-save', key: 'github:/o/r/pull/2', turns: [{ role: 'user', text: 'two' }] }),
    ]);
    const chats = stored.get('local:assistantChats');
    const keys = typeof chats === 'object' && chats !== null ? Object.keys(chats) : [];
    expect(keys.sort()).toEqual(['github:/o/r/pull/1', 'github:/o/r/pull/2']);
  });

  it('forgets a chat saved with no turns', async () => {
    await saveAssistantChat({ type: 'geld:chat-save', key: 'github:/o/r/pull/1', turns: [] });
    const chats = stored.get('local:assistantChats');
    const kept: Readonly<Record<string, StoredChat>> = typeof chats === 'object' && chats !== null ? Object.fromEntries(Object.entries(chats)) : {};
    expect(Object.keys(kept)).toEqual(['github:/o/r/pull/2']);
  });
});
