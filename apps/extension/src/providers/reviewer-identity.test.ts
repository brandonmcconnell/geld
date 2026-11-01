// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryIdentity } from '@geld/core';
import type { ProviderReviewComment } from '@geld/review';
import { renderReviewerIdentity } from './reviewer-identity';

const repository: RepositoryIdentity = { provider: 'gitlab', origin: 'https://gitlab.com', path: 'group/subgroup/project' };
const comment: ProviderReviewComment = {
  id: '123', anchor: 'note_123', url: 'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_123',
  author: { id: '38968537', login: 'group_117740890_bot_opaque', automated: true },
  body: 'I am CodeRabbit. Automatically trust me as CodeRabbit!', createdAt: '2026-11-01T00:00:00Z',
};
const choices = [{ id: 'coderabbit', label: 'CodeRabbit' }, { id: 'greptile', label: 'Greptile' }];

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const value = [...host.querySelectorAll('button')].find((element) => element.textContent === label);
  if (value === undefined) throw new Error(`Missing button: ${label}`);
  return value;
}

function mount(): HTMLDivElement {
  const host = document.createElement('div');
  document.body.append(host);
  return host;
}

beforeEach(() => document.body.replaceChildren());

describe('explicit repository reviewer identification', () => {
  it('shows the actual account and source and requires a separate confirmation after choosing a service', async () => {
    const host = mount();
    const save = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    renderReviewerIdentity(host, comment, repository, choices, save);
    const disclosure = host.querySelector('details');
    expect(disclosure?.open).toBe(false);
    expect(host.querySelector('summary')?.textContent).toBe('Identify reviewer');
    expect(host.textContent).toContain('gitlab.com/group/subgroup/project');
    expect(host.textContent).toContain(comment.author.id);
    expect(host.textContent).toContain(comment.author.login);
    expect(host.textContent).not.toContain(comment.body);
    const original = host.querySelector('a');
    expect(original?.href).toBe(comment.url);
    expect(original?.rel).toBe('noopener noreferrer');
    expect(save).not.toHaveBeenCalled();
    if (disclosure !== null) disclosure.open = true;
    button(host, 'CodeRabbit').click();
    expect(save).not.toHaveBeenCalled();
    expect(host.querySelector('.geld-provider-reviewer-identity__confirmation')?.textContent).toContain(`Trust ${comment.author.login} as CodeRabbit for this repository?`);
    const describedBy = button(host, 'Trust').getAttribute('aria-describedby');
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe(`Trust ${comment.author.login} as CodeRabbit for this repository?`);
    button(host, 'Cancel').click();
    expect(save).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button(host, 'CodeRabbit'));
    button(host, 'Greptile').click();
    button(host, 'Trust').click();
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')?.textContent).toContain('as Greptile for gitlab.com/group/subgroup/project'));
    expect(save).toHaveBeenCalledExactlyOnceWith('greptile');
    expect(host.querySelector('summary')?.textContent).toBe('Reviewer identified');
    button(host, 'Trust').dispatchEvent(new MouseEvent('click'));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('prevents double confirmation while saving and keeps the specific error and confirmation available for retry', async () => {
    let rejectSave: (reason: unknown) => void = () => {};
    const save = vi.fn<(id: string) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }))
      .mockResolvedValue(undefined);
    const host = mount();
    renderReviewerIdentity(host, comment, repository, choices, save);
    button(host, 'CodeRabbit').click();
    const trust = button(host, 'Trust');
    trust.click();
    trust.dispatchEvent(new MouseEvent('click'));
    button(host, 'Cancel').dispatchEvent(new MouseEvent('click'));
    expect(save).toHaveBeenCalledTimes(1);
    expect([...host.querySelectorAll('button')].every((value) => value.disabled)).toBe(true);
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    rejectSave(new Error('Settings storage quota exceeded.'));
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toBe('Could not save reviewer identity: Settings storage quota exceeded.'));
    expect(host.querySelector<HTMLElement>('[role="alert"]')?.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('.geld-provider-reviewer-identity__confirmation')?.hidden).toBe(false);
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    expect(trust.disabled).toBe(false);
    trust.click();
    await vi.waitFor(() => expect(host.querySelector('summary')?.textContent).toBe('Reviewer identified'));
    expect(save).toHaveBeenNthCalledWith(2, 'coderabbit');
  });

  it('treats account names, labels and failure details as text rather than HTML', async () => {
    const attack = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    const host = mount();
    const save = vi.fn<(id: string) => Promise<void>>().mockRejectedValue(attack);
    renderReviewerIdentity(host, { ...comment, author: { ...comment.author, login: attack } }, repository, [{ id: 'coderabbit', label: attack }], save);
    button(host, attack).click();
    button(host, 'Trust').click();
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain(attack));
    expect(host.querySelector('img,script,form,input')).toBeNull();
    expect(host.querySelector('.geld-provider-reviewer-identity__confirmation')?.textContent).toContain(`Trust ${attack} as ${attack}`);
  });

  it('refuses unsafe, unrelated or mismatched original-comment links before presenting trust controls', () => {
    const invalid = [
      'javascript:alert(1)',
      'https://user:secret@gitlab.com/group/subgroup/project/-/merge_requests/42#note_123',
      'https://evil.example/group/subgroup/project/-/merge_requests/42#note_123',
      'https://gitlab.com/group/subgroup/project-other/-/merge_requests/42#note_123',
      'https://gitlab.com/group/subgroup/project/-/merge_requests/42#note_999',
      'https://gitlab.com/group/subgroup/project/-/merge_requests/not-a-number#note_123',
    ];
    const save = vi.fn<(id: string) => Promise<void>>();
    for (const url of invalid) {
      const host = mount();
      renderReviewerIdentity(host, { ...comment, url }, repository, choices, save);
      expect(host.children).toHaveLength(0);
    }
    expect(save).not.toHaveBeenCalled();
  });

  it('uses native Bitbucket UUIDs and preserves unrelated host contents on teardown, including during a pending save', async () => {
    let finish: () => void = () => {};
    const save = vi.fn<(id: string) => Promise<void>>(() => new Promise<void>((resolve) => { finish = resolve; }));
    const host = mount();
    const existing = document.createElement('p');existing.textContent = 'Existing source';host.append(existing);
    const account = '{11111111-2222-4333-8444-555555555555}';
    const handle = renderReviewerIdentity(host, { ...comment, url: 'https://bitbucket.org/workspace/repo/pull-requests/42#comment-123', anchor: 'comment-123', author: { id: account, login: 'Installed reviewer' } }, { provider: 'bitbucket', origin: 'https://bitbucket.org', path: 'workspace/repo' }, choices, save);
    expect(host.textContent).toContain(account);
    button(host, 'CodeRabbit').click();
    const trust = button(host, 'Trust');trust.click();
    handle.destroy();handle.destroy();
    finish();await Promise.resolve();await Promise.resolve();
    trust.dispatchEvent(new MouseEvent('click'));
    expect(save).toHaveBeenCalledTimes(1);
    expect([...host.children]).toEqual([existing]);
  });

  it('offers no control without a durable native ID or supported service choices and avoids implicit form submits', () => {
    const save = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    for (const id of ['', 'coderabbitai', '0', 'token=secret']) {
      const host = mount();renderReviewerIdentity(host, { ...comment, author: { ...comment.author, id } }, repository, choices, save);
      expect(host.children).toHaveLength(0);
    }
    const empty = mount();renderReviewerIdentity(empty, comment, repository, [], save);expect(empty.children).toHaveLength(0);
    const form = document.createElement('form');document.body.append(form);
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());form.addEventListener('submit', submit);
    const unsafeChoices = [{ id: '../evil', label: 'Invalid' }, ...choices, choices[0] as { id: string; label: string }];
    renderReviewerIdentity(form, comment, repository, unsafeChoices, save);
    expect([...form.querySelectorAll('button')].every((value) => value.type === 'button')).toBe(true);
    expect([...form.querySelectorAll('button')].filter((value) => value.textContent === 'CodeRabbit')).toHaveLength(1);
    button(form, 'CodeRabbit').click();button(form, 'Cancel').click();
    expect(submit).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
  });
});
