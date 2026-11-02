import { describe, expect, it } from 'vitest';
import { providerFindings, sourceThreads, findingFingerprint, agentStructure } from './provider-findings';
const comment = (id: number, author: string, body: string) => ({
  id: String(id),
  databaseId: id,
  createdAt: '2026-11-01T10:00:00Z',
  author,
  body,
  url: `https://github.com/o/r/pull/1#discussion_r${id}`,
  path: 'src/review.ts',
  line: 20,
});
const thread = (id: string, n: number, author: string, body: string) => ({
  id,
  path: 'src/review.ts',
  line: 20,
  resolved: false,
  outdated: false,
  comments: [comment(n, author, body)],
});
describe('provider finding source integrity', () => {
  it('groups overlapping agent concerns and retains every source thread', () => {
    const draft = providerFindings(
      [
        thread('one', 1, 'cursor[bot]', 'Bug: stale head permits a write'),
        thread('two', 2, 'greptile-apps[bot]', 'Bug: stale head permits a write'),
      ],
      [],
    );
    expect(draft.items).toHaveLength(1);
    const item = draft.items[0];
    if (!item) throw new Error('Missing item');
    expect(sourceThreads(draft, item)).toEqual(['one', 'two']);
    expect(draft.sources).toHaveLength(2);
  });
  it('changes the revision fingerprint for a new reply or resolved source', async () => {
    const first = thread('one', 1, 'cursor[bot]', 'Bug: stale head permits a write');
    const draft = providerFindings([first], []);
    const item = draft.items[0];
    if (!item) throw new Error('Missing item');
    const before = await findingFingerprint(draft, item);
    const changed = providerFindings(
      [
        {
          ...first,
          comments: [...first.comments, comment(2, 'human', 'This changed after your read')],
        },
      ],
      [],
    );
    expect(await findingFingerprint(changed, item)).not.toBe(before);
    expect(await findingFingerprint(providerFindings([{ ...first, resolved: true }], []), item)).not.toBe(before);
  });
  it('omits opaque identities rather than inventing numeric anchors and emits no source content in structural records', () => {
    expect(
      providerFindings(
        [
          {
            ...thread('one', 1, 'cursor[bot]', 'Private content'),
            comments: [
              {
                ...comment(1, 'cursor[bot]', 'Private content'),
                databaseId: undefined,
                id: 'opaque',
              },
            ].map(({ databaseId: _ignored, ...rest }) => rest),
          },
        ],
        [],
      ).omitted,
    ).toBe(1);
    const records = agentStructure(
      providerFindings(
        [],
        [
          {
            ...comment(1, 'greptile-apps[bot]', 'Found 2 potential issues'),
            path: null,
            line: null,
          },
        ],
      ),
    );
    expect(JSON.stringify(records)).not.toContain('Found');
    expect(records[0]?.agent).toBe('greptile');
  });
});
