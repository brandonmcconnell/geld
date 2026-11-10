// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderHiddenPeopleView } from './hidden-people-view';
import type { ProviderPeopleProjection } from './hidden-people';

const projection: ProviderPeopleProjection = {
  input: { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '1', headSha: 'a'.repeat(40) }, threads: [] },
  comments: [], events: [], people: [{ id: 'id', login: 'alice', ruleIdentity: 'alice', shown: false, exactRules: [] }],
  hiddenAnchors: new Map([['note_1', 'id']]), hiddenEvents: new Map(),
};
afterEach(() => document.body.replaceChildren());

it('hides only qualified native sources and restores them without moving nodes', () => {
  const host = document.createElement('main'), hidden = document.createElement('article'), mixed = document.createElement('article'), editor = document.createElement('textarea');
  document.body.append(host, hidden, mixed, editor);
  const show = vi.fn();
  const view = new ProviderHiddenPeopleView(show);
  const entries = [{ root: hidden, anchors: ['note_1'], kind: 'comment' as const }, { root: mixed, anchors: ['note_1', 'note_2'], kind: 'comment' as const }, { root: editor, anchors: ['note_1'], kind: 'comment' as const }];
  view.update(host, projection, entries);
  expect(hidden.hasAttribute('data-geld-provider-person-hidden')).toBe(true);
  expect(mixed.hasAttribute('data-geld-provider-person-hidden')).toBe(false);
  expect(editor.hasAttribute('data-geld-provider-person-hidden')).toBe(false);
  const control = hidden.previousElementSibling;
  expect(hidden.parentElement).toBe(document.body);
  control?.querySelector<HTMLButtonElement>('button')?.click();
  expect(show).toHaveBeenCalledWith('id', true);
  expect(host.textContent).not.toContain('Stop hiding');
  const observer = new MutationObserver(() => undefined);observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  view.update(host, projection, entries);
  expect(observer.takeRecords()).toHaveLength(0);observer.disconnect();
  view.clear();
  expect(hidden.hasAttribute('data-geld-provider-person-hidden')).toBe(false);
  expect(hidden.parentElement).toBe(document.body);
  expect(control?.isConnected).toBe(false);
});


it('removes the exact canonical rule rather than the display login', () => {
  const host = document.createElement('main');document.body.append(host);
  const identity = 'bitbucket.org/uuid/7177c565-3bb4-44d3-b17b-e791dfb8fed8';
  const unhide = vi.fn(async () => undefined);
  const view = new ProviderHiddenPeopleView(vi.fn(), unhide);
  view.update(host, { ...projection, people: [{ id: 'uuid', login: 'Readable name', ruleIdentity: identity, shown: false, exactRules: [identity] }] }, []);
  [...host.querySelectorAll('button')].find(button => button.textContent === 'Stop hiding')?.click();
  expect(unhide).toHaveBeenCalledWith(identity);
  view.clear();
});
