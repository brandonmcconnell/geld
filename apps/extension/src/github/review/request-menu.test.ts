// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { BotVerdictRecord } from '@geld/review';
import { botRunState } from './panel';

const HEAD = 'a'.repeat(40);

function state(record: Omit<BotVerdictRecord, 'id' | 'login' | 'reviewedSha'> & { readonly reviewedSha?: string }, ranSincePush: ReadonlySet<string> | null) {
  const bot: BotVerdictRecord = { id: 'coderabbit', login: 'coderabbitai[bot]', reviewedSha: HEAD, ...record };
  return botRunState('coderabbit', { ranSincePush, meta: { bots: [bot], headSha: HEAD } });
}

describe('the request menu’s line for a bot', () => {
  it('says Findings for a run with findings, ticked only when the bot has not reported since the latest push', () => {
    // Reported after the push: it has reviewed this commit, and asking again would hear the same.
    expect(state({ verdict: 'findings', count: 2, sourceId: 'discussion_r1' }, new Set(['coderabbit']))).toMatchObject({ word: 'Findings', preselect: false });
    expect(state({ verdict: 'findings', count: 0, sourceId: 'discussion_r1' }, new Set(['coderabbit']))).toMatchObject({ word: 'Findings', preselect: false });
    // Its findings came before the latest push: it has not seen the fixes.
    expect(state({ verdict: 'findings', count: 0, sourceId: 'discussion_r1' }, new Set())).toMatchObject({ word: 'Findings', preselect: true });
    // A low score is findings too, not a failed run.
    expect(state({ verdict: 'findings', score: 2, sourceId: 'issuecomment-1' }, new Set(['coderabbit']))).toMatchObject({ word: 'Findings', preselect: false });
  });

  it('keeps ticking a failed run and one on an earlier commit, and leaves a clean one and a skip alone', () => {
    expect(state({ verdict: 'failed', sourceId: 'issuecomment-1' }, new Set(['coderabbit']))).toMatchObject({ word: 'Failed', preselect: true });
    expect(state({ verdict: 'findings', count: 1, reviewedSha: 'b'.repeat(40) }, new Set(['coderabbit']))).toMatchObject({ word: 'Earlier commit', preselect: true });
    expect(state({ verdict: 'clean', sourceId: 'issuecomment-1' }, new Set())).toMatchObject({ word: 'Passed', preselect: false });
    expect(state({ verdict: 'failed', reason: 'Bugbot is disabled for this repository' }, new Set())).toMatchObject({ word: 'Skipped', preselect: false });
  });

  it('reads a page with no push to tell by as this commit', () => {
    expect(state({ verdict: 'findings', count: 1, sourceId: 'discussion_r1' }, null)).toMatchObject({ word: 'Findings', preselect: false });
  });
});
