import { describe, expect, it, vi } from 'vitest';
import { createLocalReviewAuthority, isLocalReviewWrite, validateLocalReviewOrigin } from './local-review-service';
import { createLocalReviewClient } from './local-review-write';
import type { AiRunRecord, ProviderReviewedRecord } from './local-state';
import type { LocalReviewMutation, LocalReviewWrite } from './local-review-write';

vi.mock('wxt/browser', () => ({ browser: {} }));
vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined }) } }));

const key = 'gitlab@https://gitlab.com:group%2Frepo!42';
const head = 'a'.repeat(40);
const item = (itemId = 'ri_a'): Extract<LocalReviewMutation, { kind: 'reviewed' }> => ({ kind: 'reviewed', reviewKey: key, headSha: head, itemId, fingerprint: '1'.repeat(64), reviewed: true });
const run = (text = 'First'): AiRunRecord => ({ ranAt: '2026-11-03T07:00:00Z', rewrites: [{ id: 'ri_a', title: text }] });
const valid = async (): Promise<void> => undefined;

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function fixture() {
  let ai: Readonly<Record<string, AiRunRecord>> = {};
  let reviewed: Readonly<Record<string, ProviderReviewedRecord>> = {};
  const read = vi.fn(async () => ai);
  const writes = vi.fn(async (next: Readonly<Record<string, AiRunRecord>>) => { ai = next; });
  const stores = { ai: { getValue: read, setValue: writes }, reviewed: { getValue: async () => reviewed, setValue: async (next: Readonly<Record<string, ProviderReviewedRecord>>) => { reviewed = next; } } };
  let authority = createLocalReviewAuthority(stores);
  function tab() {
    let listener: (message: unknown) => Promise<unknown> | undefined = () => undefined;
    return createLocalReviewClient({
      subscribe: (next) => { listener = next; },
      send: async (message) => {
        expect(isLocalReviewWrite(message)).toBe(true);
        try {
          await authority(message.mutation, () => validateLocalReviewOrigin(async () => listener({ type: 'geld:local-review-validate', token: message.token })));
          return { ok: true };
        } catch { return { ok: false }; }
      },
    });
  }
  return { tab, read, writes, ai: () => ai, reviewed: () => reviewed, restart: () => { authority = createLocalReviewAuthority(stores); } };
}

describe('one background owner for local review writes', () => {
  it('serializes reads from two independent tab clients and retains both paid AI results', async () => {
    const f = fixture(), firstRead = deferred(), release = deferred();
    f.read.mockImplementationOnce(async () => { firstRead.resolve(); await release.promise; return {}; });
    const first = f.tab(), second = f.tab();
    const one = first({ kind: 'ai', key, record: run() }, valid);
    await firstRead.promise;
    const two = second({ kind: 'ai', key: key.replace('!42', '!43'), record: run('Second') }, valid);
    await Promise.resolve();
    expect(f.read).toHaveBeenCalledTimes(1);
    release.resolve();
    await Promise.all([one, two]);
    expect(Object.keys(f.ai())).toHaveLength(2);
    expect(f.ai()[key]?.rewrites[0]?.title).toBe('First');
    expect(f.ai()[key.replace('!42', '!43')]?.rewrites[0]?.title).toBe('Second');
  });

  it('retains simultaneous marks in the same review and another review across tab contexts', async () => {
    const f = fixture(), a = f.tab(), b = f.tab();
    await Promise.all([a(item(), valid), b(item('ri_b'), valid), b({ ...item(), reviewKey: key.replace('!42', '!43') }, valid)]);
    expect(f.reviewed()[JSON.stringify([key, head])]?.items).toEqual({ ri_a: '1'.repeat(64), ri_b: '1'.repeat(64) });
    expect(Object.keys(f.reviewed())).toHaveLength(2);
  });

  it('revalidates the initiating tab after a queued wait and resumes after a rejected save', async () => {
    const f = fixture(), started = deferred(), release = deferred();
    f.read.mockImplementationOnce(async () => { started.resolve(); await release.promise; return {}; });
    const a = f.tab(), b = f.tab();
    const one = a({ kind: 'ai', key, record: run() }, valid);
    await started.promise;
    let current = true;
    const two = b(item(), async () => { if (!current) throw new Error('Changed source'); });
    await Promise.resolve(); current = false; release.resolve();
    await one;
    await expect(two).rejects.toThrow('Review state changed');
    expect(f.reviewed()).toEqual({});
    await b(item('ri_later'), valid);
    expect(Object.keys(f.reviewed())).toHaveLength(1);
  });

  it('keeps unrelated AI records when one tab clears a run and after worker restart', async () => {
    const f = fixture(), a = f.tab();
    await a({ kind: 'ai', key, record: run() }, valid);
    f.restart();
    await f.tab()({ kind: 'ai', key: key.replace('!42', '!43'), record: run() }, valid);
    await a({ kind: 'ai', key, record: null }, valid);
    expect(Object.keys(f.ai())).toEqual([key.replace('!42', '!43')]);
  });

  it('refuses a source that changes after the storage read and releases the client token', async () => {
    const f = fixture(), tab = f.tab();
    let validations = 0;
    await expect(tab({ kind: 'ai', key, record: run() }, async () => { if (++validations === 3) throw new Error('Changed after read'); })).rejects.toThrow('could not be saved');
    expect(f.writes).not.toHaveBeenCalled();
    await tab({ kind: 'ai', key, record: run('Current') }, valid);
    expect(f.ai()[key]?.rewrites[0]?.title).toBe('Current');
  });

  it('accepts actual shared severity values and retains the provider cache with the saved record', async () => {
    const record = { ...run(), rewrites: [{ id: 'ri_a', title: 'Fix this', severity: 'blocking' }], providerAi: { headSha: head, sourceKeys: {}, summaryKey: 'source', done: {}, skipped: [] } };
    expect(isLocalReviewWrite({ type: 'geld:local-review-write', token: 'actual', mutation: { kind: 'ai', key, record } })).toBe(true);
    const f = fixture();
    await f.tab()({ kind: 'ai', key, record: { ...record, rewrites: [{ id: 'ri_a', title: 'Fix this', severity: 'blocking' }] } }, valid);
    expect(f.ai()[key]).toEqual(record);
  });

  it('bounds a lost tab validation and refuses malformed mutation records', async () => {
    vi.useFakeTimers();
    try {
      const pending = validateLocalReviewOrigin(() => new Promise(() => undefined));
      const rejected = expect(pending).rejects.toThrow('Review source changed');
      await vi.advanceTimersByTimeAsync(2000); await rejected;
    } finally { vi.useRealTimers(); }
    expect(isLocalReviewWrite({ type: 'geld:local-review-write', token: 'ok', mutation: { kind: 'ai', key, record: { ...run(), rewrites: [{ id: 'ri_a' }] } } })).toBe(false);
    expect(isLocalReviewWrite({ type: 'geld:local-review-write', token: 'ok', mutation: { ...item(), itemId: '__proto__' } })).toBe(false);
  });

  it('does not validate another tab token or a token whose request has finished', async () => {
    const release = deferred(), requests: LocalReviewWrite[] = [];
    function transport() {
      let listener: (message: unknown) => Promise<unknown> | undefined = () => undefined;
      const write = createLocalReviewClient({ subscribe: (next) => { listener = next; }, send: async (message) => { requests.push(message); await release.promise; return { ok: true }; } });
      return { write, validate: (token: string) => listener({ type: 'geld:local-review-validate', token }) };
    }
    const a = transport(), b = transport();
    const first = a.write(item(), valid), second = b.write(item('ri_b'), valid);
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    const [one, two] = requests;
    if (!one || !two) throw new Error('Missing requests');
    expect(await a.validate(two.token)).toEqual({ ok: false });
    expect(await b.validate(one.token)).toEqual({ ok: false });
    release.resolve(); await Promise.all([first, second]);
    expect(await a.validate(one.token)).toEqual({ ok: false });
  });

  it('rejects a stale source before sending any write request', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const write = createLocalReviewClient({ send, subscribe: () => undefined });
    await expect(write(item(), async () => { throw new Error('Already stale'); })).rejects.toThrow('Already stale');
    expect(send).not.toHaveBeenCalled();
  });
});
