// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderHiddenPeopleView } from './hidden-people-view';
import type { ProviderPeopleProjection } from './hidden-people';

const projection: ProviderPeopleProjection = {
  input: { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '1', headSha: 'a'.repeat(40) }, threads: [] },
  comments: [], events: [], people: [{ id: 'id', login: 'alice', shown: false, exactRules: [] }],
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

it('folds observed sidebar identities and restores their original node on a visit peek', () => {
  const host = document.createElement('main'), sidebar = document.createElement('aside'), row = document.createElement('div');
  row.textContent = 'Alice approved';sidebar.append(row);document.body.append(host, sidebar);
  const show = vi.fn(), view = new ProviderHiddenPeopleView(show);
  const people = [{ root: row, authorId: 'id' }];
  view.update(host, projection, [], people);
  expect(row.hasAttribute('data-geld-provider-person-hidden')).toBe(true);
  expect(row.parentElement).toBe(sidebar);
  const control = row.previousElementSibling;control?.querySelector<HTMLButtonElement>('button')?.click();
  expect(show).toHaveBeenCalledWith('id', true);
  view.update(host, { ...projection, people: projection.people.map(person => ({ ...person, shown: true })) }, [], people);
  expect(row.hasAttribute('data-geld-provider-person-hidden')).toBe(false);
  expect(control?.isConnected).toBe(false);
  expect(row.textContent).toBe('Alice approved');
  view.clear();
});
