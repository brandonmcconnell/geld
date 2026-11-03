import { describe, expect, it } from 'vitest';
import { renderProviderItemMarkdown } from './summary-render';
import type { ReviewItem } from './model';
import type { ProviderReviewSubject } from './provider-review';

const subject: ProviderReviewSubject = { provider: 'gitlab', origin: 'https://gitlab.com', repository: 'group/subgroup/repo', id: '42', headSha: 'a'.repeat(40) };
const item: ReviewItem = { id: 'ri_test', title: 'Guard `response` before **reading** it', rewritten: false, severity: 'bug', status: 'open', path: 'src/request.ts', line: 5,
  sources: [{ anchor: 'note_1', kind: 'thread', author: 'alice', url: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/42#note_1' }, { anchor: 'note_2', kind: 'thread', author: 'bob', url: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/42/diffs#note_2' }],
  context: 'Keep the original question.', fix: { source: 'human', text: 'if (!response) return;\n  use(response);' } };

describe('native item clipboard Markdown', () => {
  it('preserves one concern, its formatting, location, context and every actual native source', () => {
    const copied = renderProviderItemMarkdown(item, subject, { showFix: true });
    expect(copied).toContain('**Guard `response` before reading it**');
    expect(copied).toContain('`src/request.ts:5`');expect(copied).toContain('Keep the original question.');
    expect(copied).toContain('https://gitlab.com/group/subgroup/repo/-/merge_requests/42#note_1');
    expect(copied).toContain('https://gitlab.com/group/subgroup/repo/-/merge_requests/42/diffs#note_2');
    expect(copied).toContain('Suggested fix (human):');expect(copied).toContain('    use(response);');
    expect(copied).not.toMatch(/geld:|Geld review|discussion_r|\/pull\//);
  });

  it('uses actual Bitbucket comment routes and never substitutes a GitHub identity', () => {
    const bb = { ...subject, provider: 'bitbucket' as const, origin: 'https://bitbucket.org', repository: 'workspace/repo' };
    const copied = renderProviderItemMarkdown({ ...item, sources: [{ anchor: 'comment-17', kind: 'thread', author: 'native-user', url: 'https://bitbucket.org/workspace/repo/pull-requests/42/_/diff#comment-17' }] }, bb, { showFix: false });
    expect(copied).toContain('https://bitbucket.org/workspace/repo/pull-requests/42/_/diff#comment-17');
    expect(copied).not.toContain('Suggested fix');expect(copied).not.toContain('discussion_r');
  });

  it('retains a verified native account spelling instead of substituting its bound bot service name', () => {
    const copied = renderProviderItemMarkdown({ ...item, sources: [{ anchor: 'note_1', kind: 'thread', author: 'group_84680077_bot_800401aaa75115e1bc0c76e02d860b8b', bot: 'greptile', url: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/42#note_1' }] }, subject, { showFix: false });
    expect(copied).toContain('@group\\_84680077\\_bot\\_800401aaa75115e1bc0c76e02d860b8b');
    expect(copied).not.toContain(' · Greptile');
  });

  it('keeps native source status, personal reviewed and AI assessment distinct', () => {
    const copied = renderProviderItemMarkdown({ ...item, title: 'AI wording', rewritten: true, status: 'addressed', addressed: { verdict: 'yes', evidence: ['The model reports a fix.'] }, fix: { source: 'ai', text: 'modelFix()' } }, subject, { showFix: true, sourceStatus: 'open', reviewedOnDevice: true });
    expect(copied).toContain('- [ ]');expect(copied).toContain('Source status: open.');
    expect(copied).toContain('AI triage wording.');expect(copied).toContain('Geld triage status: addressed.');
    expect(copied).toContain('Reviewed on this device.');expect(copied).toContain('AI assessment: yes.');expect(copied).toContain('Suggested fix (ai)');
    expect(copied).not.toContain('Source status: resolved');
  });

  it('omits disallowed fixes completely and preserves original human words', () => {
    const copied = renderProviderItemMarkdown(item, subject, { showFix: false });
    expect(copied).not.toContain('if (!response)');expect(copied).not.toContain('AI triage');expect(copied).toContain('Keep the original question.');
  });

  it('quotes hostile Markdown and handles arbitrary code fences without losing source provenance', () => {
    const source = item.sources[0];
    if (source === undefined) throw new Error('Missing source fixture');
    const copied = renderProviderItemMarkdown({ ...item, title: '<script> [link](javascript:bad)', path: 'src/```name\nfile.ts', sources: [{ ...source, author: 'A[li]ce' }], fix: { source: 'human', text: '```\nverbatim();\n````' } }, subject, { showFix: true });
    expect(copied).toContain('\\<script\\>');expect(copied).toContain('A\\[li\\]ce');
    expect(copied).toContain('`````suggestion');expect(copied).toContain('src/```name\\nfile.ts');
    expect(copied).toContain('https://gitlab.com/group/subgroup/repo/-/merge_requests/42#note_1');
  });

  it('keeps inline code containing multiple backticks inside a longer delimiter in titles and context', () => {
    const copied = renderProviderItemMarkdown({ ...item, title: 'Use ```a `` b``` safely', context: 'Keep ```x `` y``` literal.' }, subject, { showFix: false });
    expect(copied).toContain('**Use ``` a `` b ``` safely**');
    expect(copied).toContain('Keep ``` x `` y ``` literal.');
  });

  it('labels invalid or foreign native sources unavailable instead of creating trusted links', () => {
    const copied = renderProviderItemMarkdown({ ...item, sources: [{ anchor: 'discussion_r1', kind: 'thread', author: 'evil', url: 'https://evil.example' }, { anchor: 'note_3', kind: 'thread', author: 'other', url: 'https://gitlab.com/group/subgroup/repo/-/merge_requests/43#note_3' }] }, subject, { showFix: false });
    expect(copied.match(/source unavailable/g)).toHaveLength(2);expect(copied).not.toContain('evil.example');expect(copied).not.toContain('/43#');
  });
});
