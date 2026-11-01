// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProviderReviewItems, isOpenStatus } from '@geld/review';
import type { ProviderReviewInput, ProviderReviewThread, ReviewItemStatus } from '@geld/review';
import { renderProviderReviewPanel } from './review-panel';
import type { ProviderReviewPanelEvent } from './review-panel';

const url = 'https://gitlab.com/gitlab-org/gitlab/-/merge_requests/266334';
const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'gitlab-org/gitlab', id: '266334', headSha: 'd03aadd2c95a94ecbe229896b29c9dcda009a916' } as const;
function thread(id: string, createdAt: string, state: 'open' | 'resolved' | 'outdated' = 'open'): ProviderReviewThread {
  return { id, anchor: `note_${id}`, url: `${url}#note_${id}`, path: `${id}.rb`, resolved: state === 'resolved', outdated: state === 'outdated', comments: [{ id, anchor: `note_${id}`, url: `${url}#note_${id}`, author: { id: '33096491', login: 'jotolo_gl' }, body: `Concern ${id} with original words.`, createdAt }] };
}
function mount(threads: readonly ProviderReviewThread[]) {
  const host = document.createElement('div');document.body.append(host);
  const input: ProviderReviewInput = { subject, threads };
  return { host, input };
}
const pushes: readonly ProviderReviewPanelEvent[] = [
  { id: 'first', kind: 'push', url: `${url}#note_4109758181`, author: { id: '33096491', login: 'jotolo_gl' }, body: 'Typed native commit event', createdAt: '2026-10-29T17:00:00Z' },
  { id: '4135374883', kind: 'push', url: `${url}#note_4135374883`, author: { id: '33096491', login: 'jotolo_gl' }, body: 'Native later commit event', createdAt: '2026-11-01T11:59:15.345Z' },
];
beforeEach(() => { document.body.replaceChildren();window.location.href = url; });

describe('by-push Needs attention', () => {
  it('keeps old and pre-push work in one source-preserving home with keyboard-accessible history pointers', () => {
    const before = thread('4118584957', '2026-10-29T16:52:16.580Z');
    const old = thread('4118802074', '2026-10-29T17:20:07.477Z');
    const done = thread('4121113293', '2026-10-29T23:32:58.178Z', 'resolved');
    const { host, input } = mount([before, old, done]);const snapshot = JSON.stringify(input);const activate = vi.fn(async () => true);
    const panel = renderProviderReviewPanel(host, input, { reviewGrouping: 'batch', events: pushes, actionsForSource: () => [{ kind: 'reply', label: 'Reply', available: true, activate }] });
    const attention = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-attention]');
    expect(attention?.open).toBe(true);expect(attention?.querySelector('summary')?.textContent).toBe('Needs attention · 2 open threads');
    expect(attention?.querySelectorAll('[data-geld-item]')).toHaveLength(2);
    expect([...panel.element.querySelectorAll<HTMLElement>('[data-geld-review-round]')].map((round) => round.dataset.geldReviewRound)).toEqual(['4135374883', 'first']);
    expect(panel.element.querySelector('[data-geld-review-round="4135374883"] summary')?.textContent).toContain('Push round 2 · Latest recorded push');
    expect(panel.element.querySelector('[data-geld-review-round="4135374883"]')?.textContent).toContain('No conversation recorded after this push.');
    expect(panel.element.querySelector('[data-geld-review-round="first"] summary')?.textContent).toBe('Push round 1');
    for (const source of [before, old, done]) expect(panel.element.querySelectorAll(`[data-geld-source="note_${source.id}"]`)).toHaveLength(1);
    expect(panel.element.querySelectorAll('[data-geld-source] button')).toHaveLength(3);
    const item = buildProviderReviewItems(input).find((entry) => entry.sources.some((source) => source.anchor === old.anchor));
    if (item === undefined || attention === null) throw new Error('Missing attention item');
    const home = [...attention.querySelectorAll<HTMLDetailsElement>('[data-geld-item]')].find((entry) => entry.dataset.geldItem === item.id);
    const pointer = panel.element.querySelector<HTMLButtonElement>(`[data-geld-review-pointer="${item.id}"] button`);
    if (home === undefined || pointer === null) throw new Error('Missing one-home pointer');
    const summary = home.querySelector('summary');attention.open = false;home.open = false;
    pointer.focus();pointer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));pointer.click();
    expect(pointer.type).toBe('button');expect(pointer.getAttribute('aria-controls')).toBe(home.id);
    expect(attention.open).toBe(true);expect(home.open).toBe(true);expect(document.activeElement).toBe(summary);
    expect(activate).not.toHaveBeenCalled();expect(JSON.stringify(input)).toBe(snapshot);
    expect(home.querySelector<HTMLAnchorElement>(`[data-geld-source="${old.anchor}"] a`)?.href).toBe(old.url);
    expect(home.dataset.state).toBe('open');expect(panel.element.querySelector('[data-state="resolved"]')).not.toBeNull();
  });

  it('uses existing visible status semantics, preserving AI and personal reviewed labels', () => {
    const states: readonly ReviewItemStatus[] = ['open', 'needs-reply', 'addressed', 'outdated', 'resolved', 'done-manual'];
    const { host, input } = mount(states.map((_, index) => thread(String(index + 1), '2026-10-29T18:00:00Z')));
    const native = buildProviderReviewItems(input);const last = native.at(-1);
    if (last === undefined) throw new Error('Missing personal review fixture');
    const panel = renderProviderReviewPanel(host, input, { reviewGrouping: 'batch', events: pushes, transformItems: (items) => items.map((item, index) => ({ ...item, status: states[index] ?? item.status, rewritten: index === 2 })), localReviewed: { ids: new Set([last.id]), pending: new Set(), set: () => undefined } });
    const homes = panel.element.querySelectorAll<HTMLElement>('[data-geld-review-attention] [data-geld-item]');
    expect([...homes].map((home) => home.dataset.state)).toEqual(states.filter(isOpenStatus));
    expect(panel.element.querySelector('[data-state="addressed"]')?.textContent).toContain('AI triage · original comments below');
    expect(panel.element.querySelector('[data-state="done-manual"]')?.textContent).toContain('Reviewed on this device. Native status: Open.');
    expect(input.subject.headSha).toBe(subject.headSha);expect(input.threads.every((entry) => !entry.resolved)).toBe(true);
  });

  it('preserves explicit disclosure choices across grouping updates and rejects stale/head/navigation pointers', () => {
    const { host, input } = mount([thread('1', '2026-10-29T16:00:00Z')]);
    const panel = renderProviderReviewPanel(host, input, { reviewGrouping: 'batch', events: pushes });
    const attention = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-attention]');
    const oldPointer = panel.element.querySelector<HTMLButtonElement>('[data-geld-review-pointer] button');
    if (attention === null || oldPointer === null) throw new Error('Missing attention');
    attention.open = false;attention.dispatchEvent(new Event('toggle'));
    panel.update(input, { reviewGrouping: 'type', events: pushes });panel.update(input, { reviewGrouping: 'batch', events: pushes });
    const current = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-attention]');expect(current?.open).toBe(false);
    oldPointer.click();expect(current?.open).toBe(false);
    const pointer = panel.element.querySelector<HTMLButtonElement>('[data-geld-review-pointer] button');
    window.history.replaceState({}, '', `${url}?diff_id=another`);pointer?.click();expect(current?.open).toBe(false);
    window.history.replaceState({}, '', `${url}#note_1`);pointer?.click();expect(current?.open).toBe(true);
    panel.update({ ...input, subject: { ...subject, headSha: 'f'.repeat(40) } }, { reviewGrouping: 'batch', events: pushes });
    const updated = panel.element.querySelector<HTMLDetailsElement>('[data-geld-review-attention]');if (updated !== null) updated.open = false;
    pointer?.click();expect(updated?.open).toBe(false);
    panel.destroy();oldPointer.click();expect(panel.element.isConnected).toBe(false);
  });

  it('keeps one live home when push boundaries are unavailable and coalesces same-time native pushes', () => {
    const { host, input } = mount([thread('1', '2026-10-29T18:00:00Z')]);
    const panel = renderProviderReviewPanel(host, input, { reviewGrouping: 'batch', events: [] });
    expect(panel.element.querySelector('[data-geld-review-history]')?.textContent).toContain('push boundaries unavailable');
    expect(panel.element.querySelectorAll('[data-geld-source="note_1"]')).toHaveLength(1);
    const first = pushes[0];if (first === undefined) throw new Error('Missing typed push');
    panel.update(input, { reviewGrouping: 'batch', events: [first, { ...first, id: 'same-time' }] });
    expect(panel.element.querySelectorAll('[data-geld-review-round]')).toHaveLength(1);
    expect(panel.element.querySelectorAll('[data-geld-review-round] [data-geld-event]')).toHaveLength(2);
    expect(panel.element.querySelectorAll('[data-geld-source="note_1"]')).toHaveLength(1);
  });
});
