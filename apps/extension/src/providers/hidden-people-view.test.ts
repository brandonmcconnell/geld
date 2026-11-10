// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { ProviderHiddenPeopleView } from './hidden-people-view';
import type { ProviderPeopleProjection } from './hidden-people';
import { projectProviderPeople } from './hidden-people';
import type { ProviderReviewComment } from '@geld/review';

const projection: ProviderPeopleProjection = {
  input: { subject: { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '1', headSha: 'a'.repeat(40) }, threads: [] },
  comments: [], events: [], people: [{ id: 'id', login: 'alice', ruleIdentity: 'alice', shown: false, exactRules: [] }],
  hiddenAnchors: new Map([['note_1', 'id']]), hiddenCommentAnchors: new Map([['note_1', 'id']]), hiddenEvents: new Map(),
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

it('keeps other authors native replies visible when their starter-owned thread leaves the digest', () => {
  const comment = (id: string, authorId: string, login: string): ProviderReviewComment => ({
    id, anchor: `note_${id}`, url: `https://gitlab.com/group/project/-/merge_requests/1#note_${id}`,
    author: { id: authorId, login }, body: `Comment ${id}`, createdAt: '2026-11-10T00:00:00Z',
  });
  const starter = comment('1', 'alice', 'alice'), reply = comment('2', 'bob', 'bob'), other = comment('3', 'carol', 'carol'), hiddenReply = comment('4', 'alice', 'alice');
  const input = { ...projection.input, threads: [
    { id: 'a', anchor: starter.anchor, url: starter.url, comments: [starter, reply], resolved: false, outdated: false },
    { id: 'b', anchor: other.anchor, url: other.url, comments: [other, hiddenReply], resolved: false, outdated: false },
  ] };
  const host = document.createElement('main');
  const roots = [starter, reply, other, hiddenReply].map((item) => {
    const root = document.createElement('article');root.id = item.anchor;root.textContent = item.body;host.append(root);
    return { root, anchors: [item.anchor], kind: 'comment' as const };
  });
  document.body.append(host);
  const nativeHidden = roots[3]?.root;
  if (nativeHidden === undefined) throw new Error('Missing native comment');
  nativeHidden.hidden = true;
  const view = new ProviderHiddenPeopleView(vi.fn());
  const people = projectProviderPeople(input, [], [], ['alice'], new Set());
  expect(people.input.threads.map((thread) => thread.id)).toEqual(['b']);
  expect(people.input.threads[0]?.comments).toEqual([other]);
  view.update(host, people, roots);
  expect(roots.map(({ root }) => root.hasAttribute('data-geld-provider-person-hidden'))).toEqual([true, false, false, true]);
  expect(roots[1]?.root.textContent).toBe(reply.body);
  view.update(host, projectProviderPeople(input, [], [], ['alice'], new Set(['alice'])), roots);
  expect(roots.every(({ root }) => !root.hasAttribute('data-geld-provider-person-hidden'))).toBe(true);
  expect(nativeHidden.hidden).toBe(true);
  view.clear();
  expect(nativeHidden.hidden).toBe(true);
});
