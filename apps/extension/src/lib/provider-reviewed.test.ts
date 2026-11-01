import { describe, expect, it, vi } from 'vitest';
import { normalizeProviderReviewedItems, PROVIDER_REVIEWED_BUCKET_CAP, PROVIDER_REVIEWED_BYTE_CAP, PROVIDER_REVIEWED_ITEM_CAP, readProviderReviewedItems, saveProviderReviewedItem } from './local-state';
import type { ProviderReviewedRecord, ProviderReviewedStorage } from './local-state';

vi.mock('wxt/utils/storage', () => ({ storage: { defineItem: () => ({ getValue: async () => ({}), setValue: async () => undefined }) } }));
const review = 'gitlab@https://gitlab.com:group%2Fsubgroup%2Fproject!42';
const head = 'a'.repeat(40);
const fingerprint = '1'.repeat(64);
const valid = async (): Promise<void> => undefined;
const key = (reviewKey = review, sha = head): string => JSON.stringify([reviewKey, sha]);
const bucket = (reviewKey = review, sha = head, items: Readonly<Record<string, string>> = { ri_a: fingerprint }, updatedAt = 1): ProviderReviewedRecord => ({ reviewKey, headSha: sha, updatedAt, items });
function store(initial: unknown = {}) {
  let value = initial;
  const storage: ProviderReviewedStorage = { getValue: async () => value, setValue: async (next) => { value = next; } };
  return { storage, raw: () => value, replace: (next: unknown) => { value = next; } };
}

function deferred() {
  let finish = (): void => undefined;
  const promise = new Promise<void>((resolve) => { finish = resolve; });
  return { promise, resolve: () => finish() };
}

describe('device-local provider reviewed markers', () => {
  it('merges simultaneous flag edits from the freshest local value without dropping another review', async () => {
    const other = review.replace('!42', '!43');
    const s = store({ [key(other)]: bucket(other) });
    await Promise.all([
      saveProviderReviewedItem(review, head, 'ri_a', fingerprint, true, valid, s.storage),
      saveProviderReviewedItem(review, head, 'ri_b', '2'.repeat(64), true, valid, s.storage),
    ]);
    expect(await readProviderReviewedItems(review, head, s.storage)).toEqual({ ri_a: fingerprint, ri_b: '2'.repeat(64) });
    expect(await readProviderReviewedItems(other, head, s.storage)).toEqual({ ri_a: fingerprint });
    await saveProviderReviewedItem(review, head, 'ri_a', fingerprint, false, valid, s.storage);
    expect(await readProviderReviewedItems(review, head, s.storage)).toEqual({ ri_b: '2'.repeat(64) });
    expect(await readProviderReviewedItems(other, head, s.storage)).toEqual({ ri_a: fingerprint });
  });

  it('reads storage after a queued guard and preserves an intervening different-review edit', async () => {
    const s = store();
    const gate = deferred();
    const saving = saveProviderReviewedItem(review, head, 'ri_a', fingerprint, true, () => gate.promise, s.storage);
    const other = review.replace('!42', '!99');
    s.replace({ [key(other)]: bucket(other) });
    gate.resolve();
    await saving;
    expect(await readProviderReviewedItems(other, head, s.storage)).toEqual({ ri_a: fingerprint });
  });

  it('never carries marks to another head and prunes only old heads of the explicitly edited review', async () => {
    const other = review.replace('!42', '!43');
    const next = 'b'.repeat(40);
    const s = store({ [key()]: bucket(), [key(other)]: bucket(other) });
    expect(await readProviderReviewedItems(review, next, s.storage)).toEqual({});
    await saveProviderReviewedItem(review, next, 'ri_a', '2'.repeat(64), true, valid, s.storage);
    expect(await readProviderReviewedItems(review, head, s.storage)).toEqual({});
    expect(await readProviderReviewedItems(review, next, s.storage)).toEqual({ ri_a: '2'.repeat(64) });
    expect(await readProviderReviewedItems(other, head, s.storage)).toEqual({ ri_a: fingerprint });
    expect(Object.keys(normalizeProviderReviewedItems(s.raw()))).toHaveLength(2);
  });

  it('does not write failed/stale queued edits, and a rejection does not poison later edits', async () => {
    const s = store();
    const write = vi.spyOn(s.storage, 'setValue');
    let calls = 0;
    const stale = async (): Promise<void> => { calls += 1; if (calls === 2) throw new Error('Changed source'); };
    await expect(saveProviderReviewedItem(review, head, 'ri_a', fingerprint, true, stale, s.storage)).rejects.toThrow('Changed source');
    expect(write).not.toHaveBeenCalled();
    await saveProviderReviewedItem(review, head, 'ri_b', fingerprint, true, valid, s.storage);
    expect(await readProviderReviewedItems(review, head, s.storage)).toEqual({ ri_b: fingerprint });
  });

  it('isolates providers, origins and nested repository namespaces', async () => {
    const scopes = [review, review.replace('group%2Fsubgroup', 'group%2Fother'), review.replace('gitlab.com', 'gitlab.example.com'), 'bitbucket@https://bitbucket.org:group%2Fproject!42'];
    const s = store();
    await Promise.all(scopes.map((scope, index) => saveProviderReviewedItem(scope, head, 'ri_a', String(index).repeat(64), true, valid, s.storage)));
    for (const [index, scope] of scopes.entries()) expect(await readProviderReviewedItems(scope, head, s.storage)).toEqual({ ri_a: String(index).repeat(64) });
  });

  it('drops malformed records/fingerprints and caps buckets, total flags and stored bytes', () => {
    expect(normalizeProviderReviewedItems({ [key()]: { ...bucket(), items: { ri_a: 'native source body', ri_b: fingerprint, bad: 8 } }, wrong: bucket() })).toEqual({ [key()]: bucket(review, head, { ri_b: fingerprint }) });
    const many = Object.fromEntries(Array.from({ length: 120 }, (_, index) => {
      const scope = review.replace('!42', `!${index + 1}`);
      return [key(scope), bucket(scope, head, Object.fromEntries(Array.from({ length: 40 }, (_, item) => [`ri_${item}`, fingerprint])), index + 1)];
    }));
    const result = normalizeProviderReviewedItems(many);
    expect(Object.keys(result).length).toBeLessThanOrEqual(PROVIDER_REVIEWED_BUCKET_CAP);
    expect(Object.values(result).reduce((sum, value) => sum + Object.keys(value.items).length, 0)).toBe(PROVIDER_REVIEWED_ITEM_CAP);
    const long = Object.fromEntries(Array.from({ length: 100 }, (_, index) => {
      const scope = `gitlab@https://gitlab.com:${'a'.repeat(3900)}!${index + 1}`;
      return [key(scope), bucket(scope, head, { ri_a: fingerprint }, index + 1)];
    }));
    const bounded = normalizeProviderReviewedItems(long);
    expect(Object.keys(bounded).length).toBeGreaterThan(0);
    expect(Object.keys(bounded).length).toBeLessThan(100);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).byteLength).toBeLessThanOrEqual(PROVIDER_REVIEWED_BYTE_CAP);
  });
});
