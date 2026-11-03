// @vitest-environment happy-dom
import { buildProviderReviewItems, createNativePublication, META_VERSION, readProviderPublication, renderProviderSummary } from '@geld/review';
import type { GeldPrMeta, ProviderReviewComment, ProviderReviewInput } from '@geld/review';
import { renderProviderReviewPanel } from './review-panel';

const subject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/project', id: '42', headSha: 'a'.repeat(40) } as const;
const url = 'https://gitlab.com/group/project/-/merge_requests/42';
const repository = { provider: subject.provider, origin: subject.origin, path: subject.repository };
const sourceCoverage = { comments: 'complete', threads: 'complete' } as const;

async function fixture() {
  const comment: ProviderReviewComment = { id: '1', anchor: 'note_1', url: `${url}#note_1`, author: { id: '12', login: 'alice' }, body: 'Preserve the original response before retrying.', createdAt: '2026-11-01T12:00:00Z' };
  const input: ProviderReviewInput = { subject, threads: [{ id: 'a'.repeat(40), anchor: `discussion_${'a'.repeat(40)}`, url: comment.url, stateKnown: true, resolved: false, outdated: false, comments: [comment] }] };
  const items = buildProviderReviewItems(input);
  const meta: GeldPrMeta = { v: META_VERSION, generatedAt: '2026-11-01T12:01:00Z', headSha: subject.headSha, producer: { kind: 'action', version: '0.1.0', ai: false }, items, bots: [], reviewers: [], fold: { comments: [], events: [] }, nativePublication: await createNativePublication(input, items) };
  const publisher: ProviderReviewComment = { id: '99', anchor: 'note_99', url: `${url}#note_99`, author: { id: '77', login: 'native-publisher' }, body: renderProviderSummary(meta, subject), createdAt: '2026-11-01T12:01:00Z' };
  const host = document.createElement('main'); document.body.append(host);
  return { input, comment, publisher, host };
}

afterEach(() => document.body.replaceChildren());

it('offers explicit account trust and changes only the machine-note presentation after verified adoption', async () => {
  const f = await fixture();
  const untrusted = await readProviderPublication({ input: f.input, comments: [f.publisher], sourceCoverage, trustedPublisherIds: [] });
  expect(untrusted.status).toBe('untrusted');
  const save = vi.fn(async () => undefined);
  const panel = renderProviderReviewPanel(f.host, untrusted.input, { comments: untrusted.comments, publication: { result: untrusted, repository, save } });
  expect(save).not.toHaveBeenCalled();
  expect(panel.element.querySelector('[data-geld-source="note_99"]')).not.toBeNull();
  expect(panel.element.querySelector('.geld-provider-publisher-identity')?.textContent).toContain('Native account ID77');
  expect(panel.element.querySelector('.geld-provider-publisher-identity summary')?.textContent).toBe('Trust this account’s Geld summaries in this repository');
  const trust = [...panel.element.querySelectorAll<HTMLButtonElement>('.geld-provider-publisher-identity button')].find((button) => button.textContent === 'Trust summaries');
  if (trust === undefined) throw new Error('Missing explicit publisher trust control');
  trust.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith(f.publisher));

  const current = await readProviderPublication({ input: f.input, comments: [f.publisher], sourceCoverage, trustedPublisherIds: ['77'] });
  expect(current.status).toBe('current');
  panel.update(current.input, { comments: current.comments, publication: { result: current, repository, save }, transformItems: () => current.items });
  expect(panel.element.querySelector('[data-geld-publication="current"]')?.textContent).toContain('1 item checked against current sources.');
  expect(panel.element.querySelector('.geld-provider-publisher-identity')).toBeNull();
  expect(panel.element.querySelector('[data-geld-source="note_99"]')).toBeNull();
  expect(panel.element.querySelector('[data-geld-source="note_1"] .geld-provider-review__body')?.textContent).toBe(f.comment.body);
  expect(panel.element.querySelector<HTMLAnchorElement>('[data-geld-publication] a')?.href).toBe(f.publisher.url);
});

it('shows updated native words and a partial source result when a comment changes at the same head', async () => {
  const f = await fixture();
  const edited = { ...f.input, threads: f.input.threads.map((thread) => ({ ...thread, comments: [{ ...f.comment, body: 'Keep the retry attempt isolated from the previous response.', updatedAt: '2026-11-01T12:02:00Z' }] })) };
  const result = await readProviderPublication({ input: edited, comments: [f.publisher], sourceCoverage, trustedPublisherIds: ['77'] });
  expect(result.status).toBe('partial');
  expect(result.matchedItemIds.size).toBe(0);
  const copy = vi.fn();
  const panel = renderProviderReviewPanel(f.host, result.input, { comments: result.comments, publication: { result, repository }, transformItems: () => result.items, copyText: copy });
  expect(panel.element.querySelector('[data-geld-publication="partial"]')).not.toBeNull();
  expect(panel.element.querySelector('[data-geld-source="note_1"] .geld-provider-review__body')?.textContent).toBe(edited.threads[0]?.comments[0]?.body);
  panel.element.querySelector<HTMLButtonElement>('.geld-provider-review__copy')?.click();
  await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
  expect(copy.mock.calls[0]?.[0]).toContain('Published summary: partial.');
  expect(copy.mock.calls[0]?.[0]).toContain(f.publisher.url);
});
