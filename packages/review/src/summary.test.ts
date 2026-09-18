import { describe, expect, it } from 'vitest';
import { buildMeta } from './build';
import type { RawPullRequest } from './build';
import { parseSummaryBody, parseSummaryElement } from './summary-parse';
import { renderSummary } from './summary-render';
import { PAYLOAD_BUDGET, parseGeldPrMeta } from './model';
import { looksLikeBotLogin, parseBotBody, verdictsFrom } from './bots';
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
