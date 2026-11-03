// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment } from '@geld/review';
import { renderPublisherIdentity } from './publisher-identity';

const repository: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/subgroup/project' };
const comment: ProviderReviewComment = { id: '123', anchor: 'note_123', url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_123', author: { id: '12345', login: 'Actual personal account' }, body: 'Candidate body never grants trust by itself', createdAt: '2026-11-01T00:00:00Z' };
function host(): HTMLElement { const element = document.createElement('div');document.body.append(element);return element; }
function button(element: HTMLElement, label: string): HTMLButtonElement {
  const result = [...element.querySelectorAll('button')].find((value) => value.textContent === label);
  if (result === undefined) throw new Error(`Missing ${label}`);
  return result;
}
beforeEach(() => document.body.replaceChildren());

describe('explicit native publisher confirmation', () => {
  it('shows actual human account, durable id, exact repository and source before an explicit confirmation', async () => {
    const element = host();const save = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    renderPublisherIdentity(element, comment, repository, save);
    expect(element.querySelector('summary')?.textContent).toBe('Trust this account’s Geld summaries in this repository');
    expect(element.textContent).toContain(comment.author.login);
    expect(element.textContent).toContain('12345');
    expect(element.textContent).toContain('gitlab.com/group/subgroup/project');
    expect(element.textContent).toContain('does not identify a review bot');
    expect(element.querySelector<HTMLAnchorElement>('a')?.href).toBe(comment.url);
    element.querySelector('summary')?.click();
    expect(save).not.toHaveBeenCalled();
    button(element, 'Cancel').click();expect(save).not.toHaveBeenCalled();
    element.querySelector('summary')?.click();button(element, 'Trust summaries').click();
    await vi.waitFor(() => expect(element.querySelector('[role="status"]')?.textContent).toContain('Trusted Actual personal account'));
    button(element, 'Trust summaries').dispatchEvent(new MouseEvent('click'));
    expect(save).toHaveBeenCalledTimes(1);
    expect([...element.querySelectorAll('button')].every((value) => value.type === 'button')).toBe(true);
  });
  it('renders account names as text and shows save failures without silently granting trust', async () => {
    const element = host();const save = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('The native source changed'));
    renderPublisherIdentity(element, { ...comment, author: { ...comment.author, login: '<img src=x onerror=attack()>' } }, repository, save);
    button(element, 'Trust summaries').click();
    await vi.waitFor(() => expect(element.querySelector('[role="alert"]')?.textContent).toContain('The native source changed'));
    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('summary')?.textContent).toBe('Trust this account’s Geld summaries in this repository');
    expect(button(element, 'Trust summaries').disabled).toBe(false);
  });
  it('refuses unrelated scopes, source IDs, origins and unsafe permalink routes', () => {
    const save = vi.fn<() => Promise<void>>();
    for (const candidate of [
      { ...comment, url: 'javascript:alert(1)' },
      { ...comment, url: comment.url.replace('gitlab.com', 'evil.example') },
      { ...comment, url: comment.url.replace('subgroup/project', 'another/project') },
      { ...comment, url: comment.url.replace('#note_123', '#note_999') },
      { ...comment, url: comment.url.replace('/42#', '/42/settings#') },
      { ...comment, author: { ...comment.author, id: 'same-name-account' } },
    ]) { const element = host();renderPublisherIdentity(element, candidate, repository, save);expect(element.children).toHaveLength(0); }
    expect(save).not.toHaveBeenCalled();
  });
  it('shows actual Bitbucket UUID and leaves existing contents untouched when destroyed during a save', async () => {
    let finish = (): void => undefined;
    const save = vi.fn<() => Promise<void>>(() => new Promise((resolve) => { finish = resolve; }));
    const element = host();const original = document.createElement('p');original.textContent = 'Original source';element.append(original);
    const uuid = '{12345678-1234-1234-1234-123456789ABC}';
    const handle = renderPublisherIdentity(element, { ...comment, anchor: 'comment-123', url: 'https://bitbucket.org/workspace/repo/pull-requests/42#comment-123', author: { id: uuid, login: 'Native publisher' } }, { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'workspace/repo' }, save);
    expect(element.textContent).toContain(uuid);
    const trust = button(element, 'Trust summaries');trust.click();trust.click();
    expect(save).toHaveBeenCalledTimes(1);
    handle.destroy();handle.destroy();finish();await Promise.resolve();await Promise.resolve();trust.dispatchEvent(new MouseEvent('click'));
    expect(save).toHaveBeenCalledTimes(1);expect([...element.children]).toEqual([original]);
  });
});
