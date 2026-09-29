import { describe, expect, it } from 'vitest';
import { buildMeta } from './build';
import type { RawPullRequest } from './build';
import { parseSummaryBody, parseSummaryElement } from './summary-parse';
import { renderSummary } from './summary-render';
import { PAYLOAD_BUDGET, parseGeldPrMeta } from './model';
import { botByTrigger, botsTriggeredBy, isStatusLineComment, looksLikeBotLogin, parseBotBody, verdictsFrom } from './bots';
import type { DerivedBotVerdict } from './bots';
import { parseConsolidateOutput } from './prompts';

const PRODUCER = { kind: 'action' as const, version: '0.1.0', ai: false };

function fixturePr(): RawPullRequest {
  return {
    owner: 'acme',
    repo: 'widgets',
    number: 123,
    headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    threads: [
      {
        path: 'src/diff.ts',
        line: 42,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            databaseId: 1,
            author: 'cursor[bot]',
            body: 'Null check missing in parseDiff.',
            createdAt: '2026-09-18T10:00:00.000Z',
          },
          {
            databaseId: 2,
            author: 'greptile-apps[bot]',
            body: 'parseDiff should reject null.',
            createdAt: '2026-09-18T10:01:00.000Z',
          },
          {
            databaseId: 3,
            author: 'alice',
            body: 'Will fix.',
            createdAt: '2026-09-18T10:02:00.000Z',
          },
        ],
      },
      {
        path: 'src/cache.ts',
        line: 18,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            databaseId: 4,
            author: 'bob',
            body: 'Question: why drop the cache on rename?',
            createdAt: '2026-09-18T10:03:00.000Z',
          },
        ],
      },
      {
        path: 'src/util.ts',
        line: 7,
        isResolved: false,
        isOutdated: false,
        comments: [
          {
            databaseId: 6,
            author: 'devin-ai-integration[bot]',
            body: 'Unused import left behind.',
            createdAt: '2026-09-18T10:05:00.000Z',
          },
        ],
      },
    ],
    comments: [
      {
        databaseId: 88,
        author: 'greptile-apps[bot]',
        body: 'Greptile score 4/5. Found 1 issue.',
        createdAt: '2026-09-18T10:00:00.000Z',
      },
    ],
    reviews: [
      {
        databaseId: 9,
        author: 'alice',
        state: 'COMMENTED',
        body: '',
        submittedAt: '2026-09-18T10:04:00.000Z',
        commitOid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
    checks: [
      {
        name: 'Cursor Bugbot',
        status: 'completed',
        conclusion: 'success',
        sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
  };
}

describe('render / parse round trip', () => {
  it('parse(render(meta)) deep-equals meta', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const body = renderSummary(meta, { owner: 'acme', repo: 'widgets', number: 123 });
    expect(body).toContain('<!-- geld:summary:v1 -->');
    expect(body).toContain('```geld');
    const parsed = parseSummaryBody(body);
    expect(parsed).toEqual({ ok: true, value: meta });
  });

  it('tolerates GitHub rendering (nbsp, smart quotes, pre lang wrapping)', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const mangled = JSON.stringify(meta).replace(/ /g, '\u00a0').replace(/-/g, '\u2013');
    const parsed = parseSummaryBody('```geld\n' + mangled + '\n```');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.headSha).toBe(meta.headSha);
  });

  it('round-trips context, fixes and the TL;DR', () => {
    const base = buildMeta(fixturePr(), { producer: { ...PRODUCER, ai: true }, generatedAt: '2026-09-18T12:00:00.000Z' });
    const bot = base.items.find((item) => item.sources.every((source) => source.bot !== undefined));
    expect(bot).toBeDefined();
    if (bot === undefined) return;
    const meta = buildMeta(fixturePr(), {
      producer: { ...PRODUCER, ai: true },
      generatedAt: '2026-09-18T12:00:00.000Z',
      rewritten: [{ id: bot.id, title: 'Remove the unused import', context: 'Left behind by the refactor.', fix: '-import { x } from "y";' }],
      suggestedFixes: 'all',
      summary: { tldr: 'One bot nit and one open question; nothing blocking.', updatedAt: '2026-09-18T12:00:00.000Z', forItems: base.items.map((item) => item.id).sort() },
    });
    const item = meta.items.find((entry) => entry.id === bot.id);
    expect(item?.context).toBe('Left behind by the refactor.');
    expect(item?.fix).toEqual({ text: '-import { x } from "y";', source: 'ai' });
    const body = renderSummary(meta, { owner: 'acme', repo: 'widgets', number: 123 });
    expect(body).toContain('nothing blocking');
    expect(parseSummaryBody(body)).toEqual({ ok: true, value: meta });
    const noFixes = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z', rewritten: [{ id: bot.id, title: 'x', fix: 'y' }], suggestedFixes: 'off' });
    expect(noFixes.items.find((entry) => entry.id === bot.id)?.fix).toBeUndefined();
  });

  it('reads a QueryRoot the way GitHub renders <pre lang="geld">', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const withNbsp = JSON.stringify(meta).replace(/: /g, ':\u00a0');
    const parsed = parseSummaryElement({
      textContent: withNbsp,
      querySelector: (selector: string) => (selector.includes('lang="geld"') ? { textContent: withNbsp } : null),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.items.length).toBe(meta.items.length);
  });

  it('keeps a 200-thread payload under budget, truncating closed items first', () => {
    const threads = Array.from({ length: 200 }, (_, index) => ({
      path: `src/f${index}.ts`,
      line: index + 1,
      isResolved: index >= 40,
      isOutdated: false,
      comments: [
        {
          databaseId: 1000 + index,
          author: index % 2 === 0 ? 'cursor[bot]' : 'alice',
          body: `Finding number ${index}: ${'x'.repeat(80)}`,
          createdAt: '2026-09-18T10:00:00.000Z',
        },
      ],
    }));
    const pr: RawPullRequest = { ...fixturePr(), threads };
    const built = buildMeta(pr, { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const body = renderSummary(built);
    expect(JSON.stringify(built).length).toBeLessThanOrEqual(PAYLOAD_BUDGET);
    expect(body.length).toBeLessThan(65_536);
    if (built.truncated === true) {
      expect(built.items.some((item) => item.status === 'open')).toBe(true);
    }
  });
});

describe('buildMeta', () => {
  it('clusters the nearby bot thread, keeps the human question, and records bot verdicts', () => {
    const meta = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    expect(meta.items.length).toBeGreaterThanOrEqual(2);
    const human = meta.items.find((item) => item.sources.some((source) => source.author === 'bob'));
    expect(human?.title).toMatch(/why drop the cache/i);
    expect(human?.status).toBe('open');
    expect(meta.bots.some((bot) => bot.id === 'bugbot' && bot.verdict === 'clean')).toBe(true);
    expect(meta.bots.some((bot) => bot.id === 'greptile')).toBe(true);
    expect(meta.reviewers).toEqual([{ login: 'alice', state: 'commented' }]);
    expect(meta.fold.comments).toContain('issuecomment-88');
  });

  it('carries done-manual from a ticked previous comment', () => {
    const first = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const ticked = renderSummary(first).replace('- [ ]', '- [x]');
    const second = buildMeta(fixturePr(), {
      producer: PRODUCER,
      generatedAt: '2026-09-18T12:05:00.000Z',
      previous: first,
      previousBody: ticked,
    });
    expect(second.items.some((item) => item.status === 'done-manual')).toBe(true);
  });

  it('rewrites bot-only titles when the model output is valid', () => {
    const first = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const botItem = first.items.find((item) => item.sources.every((source) => source.bot !== undefined));
    expect(botItem).toBeDefined();
    if (botItem === undefined) return;
    const rewritten = buildMeta(fixturePr(), {
      producer: { ...PRODUCER, ai: true },
      generatedAt: '2026-09-18T12:00:00.000Z',
      rewritten: [{ id: botItem.id, title: 'Guard parseDiff against null input' }],
    });
    expect(rewritten.items.find((item) => item.id === botItem.id)?.title).toBe('Guard parseDiff against null input');
    expect(rewritten.items.find((item) => item.id === botItem.id)?.rewritten).toBe(true);
  });

  it('marks a finding addressed only when a later push touched its path', () => {
    const first = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    const bot = first.items.find((item) => item.path === 'src/diff.ts');
    expect(bot?.status).toBe('needs-reply');
    const later = buildMeta(
      { ...fixturePr(), changedPaths: ['src/diff.ts'] },
      { producer: PRODUCER, generatedAt: '2026-09-18T12:10:00.000Z' },
    );
    expect(later.items.find((item) => item.path === 'src/diff.ts')?.status).toBe('addressed');
  });
});

describe('bots + prompts', () => {
  it('parses greptile scores and known logins', () => {
    expect(looksLikeBotLogin('cursor[bot]')).toBe(true);
    expect(parseBotBody('Greptile 4/5. Found 1 issue.', 'greptile')).toEqual({ count: 1, score: 4, clean: false, severity: null });
    expect(parseBotBody('1 high severity bug found.', 'bugbot').severity).toBe('high');
    // A deploy bot's comment is not a review verdict.
    expect(verdictsFrom([], [{ author: 'vercel[bot]', body: 'Deployment ready', anchor: 'issuecomment-5' }], 'aaa')).toEqual([]);
    expect(verdictsFrom([], [{ author: 'acme[bot]', body: 'Found 2 issues', anchor: 'issuecomment-6' }], 'aaa', ['acme[bot]'])[0]?.count).toBe(2);
    const verdicts = verdictsFrom(
      [{ name: 'Cursor Bugbot', status: 'completed', conclusion: 'success', sha: 'aaa' }],
      [],
      'aaa',
    );
    expect(verdicts[0]?.verdict).toBe('clean');
  });

  it('lets a green check speak for a bot whose only comment says it started', () => {
    for (const body of ['Starting Devin Review.', 'Bugbot is reviewing your changes…', 'Review in progress', "I'm looking into this now and will comment when done."]) {
      expect(isStatusLineComment(body), body).toBe(true);
    }
    for (const body of ['Found 2 issues', 'Bugbot reviewed your changes and found no new issues!', 'Starting from line 12, the loop never exits.']) {
      expect(isStatusLineComment(body), body).toBe(false);
    }
    // Bugbot: a run that found something, then a run that found nothing. The latest word wins, and the earlier
    // run's count does not ride along on a clean verdict.
    const bugbot = verdictsFrom(
      [],
      [
        { author: 'cursor[bot]', body: 'Cursor Bugbot has reviewed your changes and found 1 potential issue.', anchor: 'issuecomment-1' },
        { author: 'cursor[bot]', body: '✅ Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2' },
      ],
      'aaa',
    );
    expect(bugbot[0]).toMatchObject({ id: 'bugbot', verdict: 'clean', sourceId: 'issuecomment-2' });
    expect(bugbot[0]?.count).toBeUndefined();
    // Devin: says it is looking, then says nothing more when all is well; the completed check is the verdict.
    const devin = verdictsFrom([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'aaa' }], [{ author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' }], 'aaa');
    expect(devin[0]).toMatchObject({ id: 'devin', verdict: 'clean', sourceId: 'issuecomment-7' });
    // No check to go by: the bot is still running as far as anyone can tell.
    expect(verdictsFrom([], [{ author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' }], 'aaa')[0]?.verdict).toBe('running');
    // A later comment with findings still counts.
    const found = verdictsFrom([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'aaa' }], [{ author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' }, { author: 'devin-ai-integration[bot]', body: 'Found 3 issues in this change.', anchor: 'issuecomment-8' }], 'aaa');
    expect(found[0]).toMatchObject({ verdict: 'findings', count: 3, sourceId: 'issuecomment-8' });
    // Findings, then a new push and "Starting" again, then a green check and silence: the latest run found nothing.
    const rerun = verdictsFrom(
      [{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'bbb' }],
      [
        { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-7' },
        { author: 'devin-ai-integration[bot]', body: 'Devin Review found 1 potential issue.', anchor: 'pullrequestreview-1' },
        { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-9' },
      ],
      'bbb',
    );
    expect(rerun[0]).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-9' });
    expect(rerun[0]?.count).toBeUndefined();
    // The same with the check still going: running.
    expect(verdictsFrom([{ name: 'Devin Review', status: 'in_progress', conclusion: null, sha: 'bbb' }], [{ author: 'devin-ai-integration[bot]', body: 'Found 1 issue.', anchor: 'a' }, { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'b' }], 'bbb')[0]?.verdict).toBe('running');
  });

  it('starts a run when a person asks a bot to', () => {
    const now = Date.UTC(2026, 8, 29, 19, 0);
    const at = (minutesAgo: number): string => new Date(now - minutesAgo * 60_000).toISOString();
    const before = [
      { author: 'greptile-apps[bot]', body: 'Confidence Score: 5/5\nNo issues found.', anchor: 'issuecomment-1', createdAt: at(60) },
      { author: 'cursor[bot]', body: 'Bugbot reviewed your changes and found no new issues!', anchor: 'issuecomment-2', createdAt: at(60) },
    ];
    const asked = [...before, { author: 'brandonmcconnell', body: '@greptileai', anchor: 'issuecomment-3', createdAt: at(1) }];
    const byId = (list: readonly DerivedBotVerdict[], id: string): DerivedBotVerdict | undefined => list.find((bot) => bot.id === id);
    // Greptile was asked a minute ago and has not spoken: running, from the request. Bugbot was not asked.
    expect(byId(verdictsFrom([], asked, 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-3', login: 'greptile-apps[bot]' });
    expect(byId(verdictsFrom([], asked, 'aaa', [], now), 'bugbot')?.verdict).toBe('clean');
    // Its answer ends the run.
    const answered = [...asked, { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 1 issue.', anchor: 'issuecomment-4', createdAt: at(0) }];
    expect(byId(verdictsFrom([], answered, 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'findings', score: 4, sourceId: 'issuecomment-4' });
    // Several bots in one comment; a request that aged with no answer is a run that never reported.
    expect(verdictsFrom([], [...before, { author: 'someone', body: 'bugbot run @greptileai', anchor: 'c', createdAt: at(1) }], 'aaa', [], now).map((bot) => `${bot.id}:${bot.verdict}`).sort()).toEqual(['bugbot:running', 'greptile:running']);
    expect(byId(verdictsFrom([], [...before, { author: 'someone', body: '@greptileai', anchor: 'c', createdAt: at(120) }], 'aaa', [], now), 'greptile')).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-1' });
    expect(botsTriggeredBy('/devin review').map((bot) => bot.id)).toEqual(['devin']);
  });

  it('does not keep a bot running on a status line that aged with nothing after it', () => {
    const t = (minutesAgo: number): string => new Date(Date.UTC(2026, 8, 25, 5, 40) - minutesAgo * 60_000).toISOString();
    const now = Date.UTC(2026, 8, 25, 5, 40) + 4 * 24 * 3_600_000;
    // Devin on mintlify/mint#11955: starting, a clean review, starting again on a push, then silence for days
    // and no check run on the repository. The clean review stands; "running" for four days does not.
    const devin = [
      { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-1', createdAt: t(5) },
      { author: 'devin-ai-integration[bot]', body: '✅ Devin Review: No Issues Found\nDevin Review analyzed this PR and found no bugs or issues to report.', anchor: 'pullrequestreview-1', createdAt: t(4) },
      { author: 'devin-ai-integration[bot]', body: 'Starting Devin Review.', anchor: 'issuecomment-2', createdAt: t(0) },
    ];
    expect(verdictsFrom([], devin, 'aaa', [], now)[0]).toMatchObject({ verdict: 'clean', sourceId: 'pullrequestreview-1' });
    // The same lines ten minutes later: still running.
    expect(verdictsFrom([], devin, 'aaa', [], Date.UTC(2026, 8, 25, 5, 50))[0]).toMatchObject({ verdict: 'running', sourceId: 'issuecomment-2' });
    // A bot that only ever said "starting", long ago: it did not review this.
    expect(verdictsFrom([], devin.slice(2), 'aaa', [], now)[0]).toMatchObject({ verdict: 'failed', sourceId: 'issuecomment-2' });
    // A check run says how the run ended, however old the line.
    expect(verdictsFrom([{ name: 'Devin Review', status: 'completed', conclusion: 'success', sha: 'aaa' }], devin.slice(2), 'aaa', [], now)[0]?.verdict).toBe('clean');
    // Without a timestamp nothing ages.
    expect(verdictsFrom([], devin.slice(2).map(({ createdAt: _at, ...rest }) => rest), 'aaa', [], now)[0]?.verdict).toBe('running');
  });

  it('weighs a bot\'s review threads by whether they are still open', () => {
    const summary = { author: 'greptile-apps[bot]', body: 'Confidence Score: 4/5\nFound 2 issues.', anchor: 'pullrequestreview-1' };
    const open = [
      summary,
      { author: 'greptile-apps[bot]', body: 'Distinct cookie name dropped', anchor: 'discussion_r1', resolved: false },
      { author: 'greptile-apps[bot]', body: 'Copied paths use wrong encoding', anchor: 'discussion_r2', resolved: true },
    ];
    // One thread still open: that is the outstanding finding, and where the chip points.
    expect(verdictsFrom([], open, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r1' });
    // Every thread resolved: nothing outstanding, whatever the wording of the threads themselves.
    const resolved = open.map((comment) => ('resolved' in comment ? { ...comment, resolved: true } : comment));
    // ...and the run's score stays with it: the score is what Greptile is read for.
    expect(verdictsFrom([], resolved, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 0, score: 4, sourceId: 'discussion_r2' });
    expect(verdictsFrom([], open, 'aaa')[0]?.score).toBe(4);
    // With a check to go by, the check says how that run ended.
    expect(verdictsFrom([{ name: 'Greptile', status: 'completed', conclusion: 'success', sha: 'aaa' }], resolved, 'aaa')[0]?.verdict).toBe('clean');
    // A clean summary after resolved threads is the latest word; threads after a summary belong to that summary's run.
    const later = [...resolved, { author: 'greptile-apps[bot]', body: 'No findings outside the diff remain.', anchor: 'issuecomment-9' }];
    expect(verdictsFrom([], later, 'aaa')[0]).toMatchObject({ verdict: 'clean', sourceId: 'issuecomment-9' });
    const rerun = [...later, { author: 'greptile-apps[bot]', body: 'Escaped schema refs fail', anchor: 'discussion_r3', resolved: false }];
    expect(verdictsFrom([], rerun, 'aaa')[0]).toMatchObject({ verdict: 'findings', count: 1, sourceId: 'discussion_r3' });
  });

  it('counts only review-shaped comments from a conversational agent', () => {
    const replies = [
      { author: 'replicas-connector[bot]', body: '@greptile-apps[bot] Request accepted: [Open workspace](https://app.replicas.dev/w/1). Your message was accepted and Codex will start automatically when the workspace is ready.', anchor: 'c1' },
      { author: 'replicas-connector[bot]', body: 'Thank you. That review covered the previous head. 9ae3272 now also requires HTTPS for remote artifact endpoints.', anchor: 'c2' },
    ];
    // Replies to another bot are not a review: no verdict from them alone (the first is a status line, the second a reply).
    expect(verdictsFrom([], replies, 'aaa').map((bot) => bot.verdict)).toEqual(['running']);
    const scored = verdictsFrom([], [...replies, { author: 'replicas-connector[bot]', body: 'Code Review\n\nReview score: 4/5\n\nFound 1 issue: the retry loop never backs off.', anchor: 'c3' }], 'aaa');
    expect(scored[0]).toMatchObject({ id: 'replicas', verdict: 'findings', score: 4, count: 1, sourceId: 'c3' });
    expect(botByTrigger('/replicas run code-review')?.id).toBe('replicas');
  });

  it('drops unknown ids from model output', () => {
    const parsed = parseConsolidateOutput(
      JSON.stringify({ items: [{ id: 'keep', title: 'Hello' }, { id: 'nope', title: 'X' }] }),
      new Set(['keep']),
    );
    expect(parsed).toEqual({ ok: true, value: [{ id: 'keep', title: 'Hello' }] });
  });

  it('rejects non-JSON model output', () => {
    expect(parseConsolidateOutput('not json', new Set(['a'])).ok).toBe(false);
  });
});

describe('parseGeldPrMeta of rendered objects', () => {
  it('round-trips the fixture through JSON.parse', () => {
    const built = buildMeta(fixturePr(), { producer: PRODUCER, generatedAt: '2026-09-18T12:00:00.000Z' });
    expect(parseGeldPrMeta(JSON.parse(JSON.stringify(built)))).toEqual({ ok: true, value: built });
  });
});
